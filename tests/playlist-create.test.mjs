import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetEaseService } from '../src/netease.mjs';

function fixture(overrides = {}) {
  const calls = [];
  const lists = new Map();
  let nextId = 700;
  const handlers = {
    login_status: () => ({ body: { code: 200, profile: { userId: 42, nickname: '模拟账号（不连接网易云）' } } }),
    playlist_create: parameters => {
      const id = String(nextId++);
      lists.set(id, { id, name: parameters.name, privacy: parameters.privacy, creator: { userId: 42 }, ids: [] });
      return { body: { code: 200, playlist: { id } } };
    },
    playlist_tracks: parameters => {
      const list = lists.get(parameters.pid);
      list.ids = [...new Set([...parameters.tracks.split(','), ...list.ids])];
      return { status: 200, body: { status: 200, body: { code: 200 } } };
    },
    song_order_update: parameters => {
      lists.get(parameters.pid).ids = JSON.parse(parameters.ids);
      return { body: { code: 200 } };
    },
    playlist_detail: parameters => {
      const list = lists.get(parameters.id);
      return { body: { code: 200, playlist: { ...list, trackCount: list.ids.length, trackIds: list.ids.map(id => ({ id })) } } };
    },
    ...overrides,
  };
  const upstream = Object.fromEntries(Object.entries(handlers).map(([operation, handler]) => [operation, async parameters => {
    calls.push({ operation, parameters });
    return handler(parameters, lists);
  }]));
  const service = createNetEaseService({ upstream, batchSize: 2, batchDelayMs: 0 });
  const session = { profile: { userId: '42' }, cookie: { MUSIC_U: 'test-only-private-credential' } };
  const payload = { name: '测试随机', privacy: 10, ids: ['1', '2', '2', '3', '4', '5'], accountId: '42' };
  return { service, session, payload, calls, lists };
}

test('prepare has no remote writes; create is private, batched, order-verified and idempotent', async () => {
  const app = fixture();
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  assert.equal(prepared.count, 5);
  assert.equal(app.calls.length, 0);
  const [result, repeated] = await Promise.all([app.service.createPlaylist(app.session, prepared), app.service.createPlaylist(app.session, prepared)]);
  assert.deepEqual(repeated, result);
  assert.equal(result.complete, true);
  assert.equal(result.orderConfirmed, true);
  assert.equal(result.savedCount, 5);
  assert.equal(result.url, 'https://music.163.com/playlist?id=700');
  assert.equal(app.calls.filter(call => call.operation === 'playlist_create').length, 1);
  assert.equal(app.calls.find(call => call.operation === 'playlist_create').parameters.privacy, 10);
  assert.deepEqual(app.calls.filter(call => call.operation === 'playlist_tracks').map(call => call.parameters.tracks), ['1,2', '3,4', '5']);
  assert.ok(app.calls.filter(call => ['playlist_tracks', 'song_order_update'].includes(call.operation)).every(call => call.parameters.pid === '700'));
  assert.deepEqual(await app.service.createPlaylist(app.session, prepared), result);
  assert.equal(JSON.stringify(result).includes('test-only-private-credential'), false);
});

test('public visibility is explicit and invalid inputs never reach a writing operation', async () => {
  const app = fixture();
  const prepared = await app.service.preparePlaylist(app.session, { ...app.payload, privacy: 0 });
  assert.equal((await app.service.createPlaylist(app.session, prepared)).playlist.private, false);
  assert.equal(app.calls.find(call => call.operation === 'playlist_create').parameters.privacy, 0);
  const invalid = fixture();
  for (const change of [{ privacy: undefined }, { privacy: '10' }, { privacy: 5 }, { name: '' }, { name: 'a'.repeat(41) }, { name: 'bad\nname' }, { ids: [] }, { ids: ['demo-1'] }, { ids: ['1', 'javascript:alert(1)'] }, { ids: Array(5001).fill('1') }, { accountId: '43' }]) {
    await assert.rejects(invalid.service.preparePlaylist(invalid.session, { ...invalid.payload, ...change }));
  }
  assert.equal(invalid.calls.length, 0);
  await assert.rejects(invalid.service.preparePlaylist({ cookie: {} }, invalid.payload), error => error.status === 401);
});

test('creation tickets cannot cross sessions or survive a restart as a fresh write', async () => {
  const app = fixture();
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  await assert.rejects(app.service.createPlaylist({ profile: { userId: '42' }, cookie: {} }, prepared), error => error.code === 'CREATE_TICKET_EXPIRED');
  app.session.playlistCreations = undefined;
  await assert.rejects(app.service.createPlaylist(app.session, prepared), error => error.code === 'CREATE_TICKET_EXPIRED');
  assert.equal(app.calls.length, 0);
});

test('partial write failures return the actual read-back count and do not create again', async () => {
  let writes = 0;
  const app = fixture({ playlist_tracks: (parameters, lists) => {
    if (++writes > 1) return { body: { code: 500 } };
    lists.get(parameters.pid).ids = parameters.tracks.split(',');
    return { body: { code: 200 } };
  } });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  const result = await app.service.createPlaylist(app.session, prepared);
  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.equal(result.savedCount, 2);
  assert.equal(writes, 2);
  assert.ok(result.warnings.some(warning => warning.includes('2 / 5')));
  await app.service.createPlaylist(app.session, prepared);
  assert.equal(writes, 2);
  assert.equal(app.calls.filter(call => call.operation === 'playlist_create').length, 1);
});

test('ambiguous create timeout is cached and never automatically creates a duplicate', async () => {
  const app = fixture({ playlist_create: () => { throw new Error('simulated connection lost'); } });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  const result = await app.service.createPlaylist(app.session, prepared);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.url, null);
  assert.equal(result.savedCount, null);
  await app.service.createPlaylist(app.session, prepared);
  assert.equal(app.calls.filter(call => call.operation === 'playlist_create').length, 1);
  assert.equal(app.calls.some(call => call.operation === 'playlist_tracks'), false);
});

test('owner or privacy mismatch stops before adding tracks to a returned playlist ID', async () => {
  for (const change of [{ privacy: 0, creator: { userId: 42 } }, { privacy: 10, creator: { userId: 43 } }]) {
    const app = fixture({ playlist_detail: () => ({ body: { code: 200, playlist: { id: '700', ...change, trackCount: 0, trackIds: [] } } }) });
    const prepared = await app.service.preparePlaylist(app.session, app.payload);
    assert.equal((await app.service.createPlaylist(app.session, prepared)).status, 'unverified');
    assert.equal(app.calls.some(call => call.operation === 'playlist_tracks'), false);
  }
});

test('nested playlist_tracks failures are not treated as successful API responses', async () => {
  const app = fixture({ playlist_tracks: () => ({ status: 200, body: { status: 200, body: { code: 500 } } }) });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  const result = await app.service.createPlaylist(app.session, prepared);
  assert.equal(result.complete, false);
  assert.equal(result.savedCount, 0);
  assert.equal(app.calls.filter(call => call.operation === 'playlist_tracks').length, 1);
});

test('order failure is disclosed without falsely reporting lost successfully saved tracks', async () => {
  const app = fixture({ song_order_update: () => ({ body: { code: 500 } }) });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  const result = await app.service.createPlaylist(app.session, prepared);
  assert.equal(result.complete, true);
  assert.equal(result.orderConfirmed, false);
  assert.equal(result.savedCount, 5);
  assert.ok(result.warnings.some(warning => warning.includes('排列顺序')));
});

test('a successful order response without the requested order is visibly disclosed', async () => {
  const app = fixture({ song_order_update: () => ({ body: { code: 200 } }) });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  const result = await app.service.createPlaylist(app.session, prepared);
  assert.equal(result.complete, true);
  assert.equal(result.orderConfirmed, false);
  assert.ok(result.warnings.some(warning => warning.includes('排列顺序与本次队列不同')));
});

test('incomplete read-back is never presented as confirmed success', async () => {
  let reads = 0;
  const app = fixture({ playlist_detail: (_parameters, lists) => {
    const list = lists.get('700');
    return { body: { code: 200, playlist: { ...list, trackCount: ++reads === 1 ? 0 : 5, trackIds: [] } } };
  } });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  const result = await app.service.createPlaylist(app.session, prepared);
  assert.equal(result.complete, false);
  assert.equal(result.status, 'unverified');
  assert.equal(result.savedCount, null);
});

test('failed final verification after an order write clears earlier completeness claims', async () => {
  let reads = 0;
  const app = fixture({ playlist_detail: (_parameters, lists) => {
    const list = lists.get('700');
    reads += 1;
    return { body: { code: 200, playlist: { ...list, trackCount: list.ids.length, trackIds: reads > 2 ? [] : list.ids.map(id => ({ id })) } } };
  } });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  const result = await app.service.createPlaylist(app.session, prepared);
  assert.equal(result.complete, false);
  assert.equal(result.orderConfirmed, false);
  assert.equal(result.savedCount, null);
  assert.equal(result.status, 'unverified');
});

test('changed or expired accounts cannot execute a previously prepared operation', async () => {
  const app = fixture({ login_status: () => ({ body: { code: 200, profile: { userId: 43 } } }) });
  const prepared = await app.service.preparePlaylist(app.session, app.payload);
  await assert.rejects(app.service.createPlaylist(app.session, prepared), error => error.code === 'AUTH_REQUIRED');
  assert.equal(app.calls.some(call => call.operation === 'playlist_create'), false);
});
