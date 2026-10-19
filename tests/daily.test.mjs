import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createNetEaseService } from '../src/netease-core.mjs';
import { createMobileApi } from '../public/mobile-api.mjs';
import { createApp } from '../server.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture(overrides = {}) {
  const calls = [];
  const liked = new Set(['1']);
  let time = Date.parse('2026-10-18T06:00:00Z');
  let accountId = '42';
  const song = id => ({ id: String(id), t: 0, name: `合成歌曲 ${id}`, ar: [{ name: '合成歌手' }], al: { name: '合成专辑', picUrl: 'https://p1.music.126.net/synthetic.jpg' }, dt: 180000 });
  const handlers = {
    login_status: () => ({ body: { code: 200, profile: { userId: accountId, nickname: '合成验收账号' } } }),
    recommend_songs: () => ({ body: { code: 200, data: { dailySongs: [song('1'), song('2')] } } }),
    recommend_resource: () => ({ body: { code: 200, recommend: [{ id: '81', name: '合成推荐歌单', picUrl: 'https://p1.music.126.net/synthetic.jpg', trackCount: 2, creator: { userId: '43', nickname: '合成作者' } }] } }),
    song_detail: parameters => ({ body: { code: 200, songs: parameters.ids.split(',').map(song) } }),
    likelist: () => ({ body: { code: 200, ids: [...liked] } }),
    like: parameters => {
      if (parameters.like === 'true') liked.add(parameters.id);
      else if (parameters.like === 'false') liked.delete(parameters.id);
      else throw new Error('The package requires literal strings for both target states');
      return { body: { code: 200 } };
    },
    ...overrides,
  };
  const upstream = Object.fromEntries(Object.entries(handlers).map(([operation, handler]) => [operation, async parameters => {
    calls.push({ operation, parameters });
    return handler(parameters);
  }]));
  const session = { cookie: { MUSIC_U: 'synthetic-private-cookie' }, profile: { userId: '42' } };
  const service = createNetEaseService({ upstream, now: () => time, batchSize: 2, batchDelayMs: 0 });
  return { service, session, calls, liked, song, upstream, setTime: value => { time = value; }, setAccount: value => { accountId = value; } };
}

test('daily requires login and never writes to a NetEase account while reading', async () => {
  const app = fixture();
  await assert.rejects(app.service.daily({ cookie: {}, profile: null }), error => error.code === 'AUTH_REQUIRED');
  assert.equal(app.calls.length, 0);
  const result = await app.service.daily(app.session);
  assert.equal(result.accountId, '42');
  assert.equal(result.day, '2026-10-18');
  assert.equal(result.cached, false);
  assert.deepEqual(result.songs.map(song => song.id), ['1', '2']);
  assert.deepEqual(result.songs[0].playlistIds, []);
  assert.equal(Object.hasOwn(result.songs[0], 'addedAt'), false);
  assert.equal(Object.hasOwn(result.songs[0], 'mood'), false);
  assert.equal(result.playlists[0].cover, 'https://p1.music.126.net/synthetic.jpg');
  assert.deepEqual(result.warnings, []);
  assert.ok(app.calls.every(call => ['login_status', 'recommend_songs', 'recommend_resource'].includes(call.operation)));
  assert.equal(JSON.stringify(result).includes('synthetic-private-cookie'), false);
  assert.equal(app.calls.find(call => call.operation === 'recommend_songs').parameters.afresh, false);
});

test('daily caches by actual China date and account, returns defensive copies, and refresh bypasses only local cache', async () => {
  const app = fixture();
  const first = await app.service.daily(app.session);
  first.songs[0].title = 'Caller mutation';
  const cached = await app.service.daily(app.session);
  assert.equal(cached.cached, true);
  assert.equal(cached.songs[0].title, '合成歌曲 1');
  assert.equal(app.calls.filter(call => call.operation === 'recommend_songs').length, 1);
  await app.service.daily(app.session, { refresh: true });
  assert.equal(app.calls.filter(call => call.operation === 'recommend_songs').length, 2);
  app.setTime(Date.parse('2026-10-18T16:00:00Z'));
  assert.equal((await app.service.daily(app.session)).day, '2026-10-19');
  app.setAccount('43');
  await app.service.status(app.session);
  const differentAccount = await app.service.daily(app.session);
  assert.equal(differentAccount.accountId, '43');
  assert.equal(differentAccount.cached, false);
  assert.equal(app.calls.filter(call => call.operation === 'recommend_songs').length, 4);
  await assert.rejects(app.service.daily(app.session, { refresh: 'true' }), error => error.code === 'INVALID_DAILY');
});

test('daily keeps successful songs when recommendation playlists fail', async () => {
  const app = fixture({ recommend_resource: () => { throw new Error('Synthetic recommendation list failure'); } });
  const result = await app.service.daily(app.session);
  assert.equal(result.songs.length, 2);
  assert.deepEqual(result.playlists, []);
  assert.match(result.warnings.join(' '), /推荐歌单暂不可用/);
});

test('simultaneous daily requests share one read rather than refreshing recommendations twice', async () => {
  const started = deferred();
  const response = deferred();
  const app = fixture({ recommend_songs: () => { started.resolve(); return response.promise; } });
  const first = app.service.daily(app.session);
  await started.promise;
  const second = app.service.daily(app.session);
  response.resolve({ body: { code: 200, data: { dailySongs: [] } } });
  assert.deepEqual(await first, await second);
  assert.equal(app.calls.filter(call => call.operation === 'recommend_songs').length, 1);
});

test('daily skips unmatched cloud tracks, resolves official cloud matches and removes duplicates without guessing metadata', async () => {
  const app = fixture({
    recommend_songs: () => ({ body: { code: 200, data: { dailySongs: [
      { id: '1', name: '官方歌曲', t: 0, ar: [{ name: '歌手' }] },
      { id: '1', name: '官方歌曲', t: 0 },
      { id: '90', name: '未匹配云盘', t: 1 },
      { id: '91', name: '已匹配云盘', t: 2, s_id: '3' },
      { id: '92', name: '无映射云盘', t: 2 },
      { id: 'invalid', name: '坏 ID' },
    ] } } }),
  });
  const result = await app.service.daily(app.session);
  assert.deepEqual(result.songs.map(song => song.id), ['1', '3']);
  assert.match(result.warnings.join(' '), /跳过 3 首/);
  assert.equal(app.calls.find(call => call.operation === 'song_detail').parameters.ids, '3');
});

test('malformed daily refresh does not replace a previously valid snapshot', async () => {
  let malformed = false;
  const app = fixture({ recommend_songs: () => ({ body: { code: 200, data: { dailySongs: malformed ? null : [] } } }) });
  await app.service.daily(app.session);
  malformed = true;
  await assert.rejects(app.service.daily(app.session, { refresh: true }), error => error.code === 'DAILY_INCOMPLETE');
  assert.equal((await app.service.daily(app.session)).cached, true);
});

test('late daily response after logout cannot restore credentials or cache', async () => {
  const started = deferred();
  const response = deferred();
  const app = fixture({ recommend_songs: () => { started.resolve(); return response.promise; } });
  const pending = app.service.daily(app.session);
  await started.promise;
  app.service.invalidateSession(app.session);
  response.resolve({ body: { code: 200, data: { dailySongs: [] } }, cookie: ['MUSIC_U=late-cookie'] });
  await assert.rejects(pending, error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(app.session.profile, null);
  assert.equal(app.session.dailyCache, undefined);
  assert.equal(app.session.cookie.MUSIC_U, 'synthetic-private-cookie');
});

test('old daily response cannot enter a newly logged-in account and midnight in-flight data is discarded', async () => {
  const started = deferred();
  const response = deferred();
  const app = fixture({ recommend_songs: () => { started.resolve(); return response.promise; } });
  const pending = app.service.daily(app.session);
  await started.promise;
  app.setAccount('43');
  await app.service.status(app.session);
  response.resolve({ body: { code: 200, data: { dailySongs: [] } } });
  await assert.rejects(pending, error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(app.session.profile.userId, '43');
  const midnightStarted = deferred();
  const midnightResponse = deferred();
  const midnight = fixture({ recommend_songs: () => { midnightStarted.resolve(); return midnightResponse.promise; } });
  midnight.setTime(Date.parse('2026-10-18T15:59:59Z'));
  const midnightPending = midnight.service.daily(midnight.session);
  await midnightStarted.promise;
  midnight.setTime(Date.parse('2026-10-18T16:00:01Z'));
  midnightResponse.resolve({ body: { code: 200, data: { dailySongs: [] } } });
  await assert.rejects(midnightPending, error => error.code === 'DAILY_EXPIRED');
  assert.equal(midnight.session.dailyCache, undefined);
});

test('late authentication failures from an old account cannot log out the new account', async () => {
  const started = deferred();
  const response = deferred();
  let old = true;
  const app = fixture({ login_status: () => {
    if (old) { old = false; started.resolve(); return response.promise; }
    return { body: { code: 200, profile: { userId: '43' } } };
  } });
  const pending = app.service.status(app.session);
  await started.promise;
  await app.service.status(app.session);
  response.resolve({ body: { code: 301 } });
  await assert.rejects(pending, error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(app.session.profile.userId, '43');
});

test('likes are live account-scoped reads and explicit true/false writes must be verified by readback', async () => {
  const app = fixture();
  assert.deepEqual(await app.service.likes(app.session), { accountId: '42', ids: ['1'] });
  assert.deepEqual(await app.service.like(app.session, { accountId: '42', id: '2', liked: true }), { accountId: '42', id: '2', liked: true, verified: true });
  assert.deepEqual(await app.service.like(app.session, { accountId: '42', id: '2', liked: false }), { accountId: '42', id: '2', liked: false, verified: true });
  assert.deepEqual(app.calls.filter(call => call.operation === 'like').map(call => call.parameters.like), ['true', 'false']);
  assert.equal(app.liked.has('2'), false);
});

test('invalid like targets and account changes never perform a write', async () => {
  const app = fixture();
  for (const payload of [{ id: 'x', liked: true, accountId: '42' }, { id: '1', liked: 'false', accountId: '42' }, { id: '1', liked: true }, { id: '1', liked: true, accountId: '43' }]) {
    await assert.rejects(app.service.like(app.session, payload));
  }
  app.setAccount('43');
  await assert.rejects(app.service.like(app.session, { id: '1', liked: true, accountId: '42' }), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(app.calls.filter(call => call.operation === 'like').length, 0);
});

test('uncertain writes and mismatched or malformed readback never report a fake successful red heart', async () => {
  const uncertain = fixture({ like: () => { throw new Error('Synthetic timeout after dispatch'); } });
  await assert.rejects(uncertain.service.like(uncertain.session, { accountId: '42', id: '2', liked: true }), error => error.code === 'LIKE_UNCERTAIN');
  assert.equal(uncertain.calls.filter(call => call.operation === 'like').length, 1);
  const mismatch = fixture({ like: () => ({ body: { code: 200 } }) });
  await assert.rejects(mismatch.service.like(mismatch.session, { accountId: '42', id: '2', liked: true }), error => error.code === 'LIKE_UNVERIFIED');
  const invalid = fixture({ likelist: () => ({ body: { code: 200, ids: ['broken-id'] } }) });
  await assert.rejects(invalid.service.likes(invalid.session), error => error.code === 'LIKES_INCOMPLETE');
  await assert.rejects(invalid.service.like(invalid.session, { accountId: '42', id: '2', liked: true }), error => error.code === 'LIKE_UNVERIFIED');
});

test('same-song concurrent writes are rejected without retries, and a late write result is discarded after account change', async () => {
  const started = deferred();
  const response = deferred();
  const app = fixture({ like: () => { started.resolve(); return response.promise; } });
  const pending = app.service.like(app.session, { accountId: '42', id: '2', liked: true });
  await started.promise;
  await assert.rejects(app.service.like(app.session, { accountId: '42', id: '2', liked: false }), error => error.code === 'LIKE_IN_PROGRESS');
  app.setAccount('43');
  await app.service.status(app.session);
  response.resolve({ body: { code: 200 } });
  await assert.rejects(pending, error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(app.calls.filter(call => call.operation === 'like').length, 1);
  assert.equal(app.calls.filter(call => call.operation === 'likelist').length, 0);
});

test('mobile daily and red hearts stay in native RPC and convert cancellation to an actual boolean false', async () => {
  const calls = [];
  const liked = new Set(['1']);
  const api = createMobileApi(async (operation, parameters) => {
    assert.equal(Object.hasOwn(parameters, 'cookie'), false);
    calls.push({ operation, parameters });
    if (operation === 'login_status') return { body: { code: 200, profile: { userId: '42' } } };
    if (operation === 'recommend_songs') return { body: { code: 200, data: { dailySongs: [{ id: '1', name: '合成日推', ar: [] }] } } };
    if (operation === 'recommend_resource') return { body: { code: 200, recommend: [] } };
    if (operation === 'likelist') return { body: { code: 200, ids: [...liked] } };
    if (operation === 'like') {
      assert.equal(typeof parameters.like, 'boolean');
      if (parameters.like) liked.add(parameters.id); else liked.delete(parameters.id);
      return { body: { code: 200 } };
    }
    throw new Error(`Unexpected native operation: ${operation}`);
  });
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  await api('/api/status');
  assert.equal((await post('/api/daily', { refresh: false })).songs.length, 1);
  assert.deepEqual(await api('/api/likes'), { accountId: '42', ids: ['1'] });
  assert.equal((await post('/api/like', { accountId: '42', id: '1', liked: false })).verified, true);
  assert.equal(calls.find(call => call.operation === 'like').parameters.like, false);
});

test('HTTP daily and red heart routes require a session, JSON bodies and existing same-origin protections', async t => {
  const app = fixture();
  const upstream = {
    ...app.upstream,
    login_qr_key: async () => ({ body: { code: 200, data: { unikey: 'synthetic-key-12345' } } }),
    login_qr_check: async () => ({ body: { code: 803 }, cookie: ['MUSIC_U=synthetic-http-cookie; Path=/; HttpOnly'] }),
  };
  const server = createApp({ upstream, qrImage: async () => 'data:image/png;base64,synthetic' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (path, body, headers = {}) => {
    const result = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    cookie = result.headers.get('set-cookie')?.split(';')[0] || cookie;
    return { response: result, body: await result.json() };
  };
  await request('/api/features', { id: 'netease', enabled: true });
  assert.equal((await request('/api/daily', {})).response.status, 401);
  const qr = await request('/api/login/qr', {});
  await request(`/api/login/check?key=${qr.body.key}`);
  assert.equal((await request('/api/daily', {})).body.songs.length, 2);
  assert.equal((await request('/api/likes')).body.accountId, '42');
  assert.equal((await request('/api/like', { accountId: '42', id: '2', liked: true })).body.verified, true);
  assert.equal((await request('/api/like', { accountId: '42', id: '2', liked: false }, { Origin: 'https://untrusted.example' })).response.status, 403);
  assert.equal(app.calls.filter(call => call.operation === 'like').length, 1);
});
