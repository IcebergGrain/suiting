import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMobileApi, createNativeRpc } from '../public/mobile-api.mjs';

test('native RPC correlates replies and rejects errors without exposing an arbitrary HTTP interface', async () => {
  const packets = [];
  const bridge = { postMessage: text => {
    const packet = JSON.parse(text); packets.push(packet);
    queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ requestId: packet.requestId, result: { completed: true } }) }));
  } };
  const request = createNativeRpc(bridge, 100);
  assert.deepEqual(await request('login_status'), { completed: true });
  assert.equal(packets[0].operation, 'login_status');
  bridge.postMessage = text => { const packet = JSON.parse(text); queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ requestId: packet.requestId, error: { code: 'BLOCKED', message: '拒绝', status: 403 } }) })); };
  await assert.rejects(request('unexpected'), error => error.code === 'BLOCKED' && error.status === 403);
});

test('native RPC timeout is explicit and late replies cannot resolve a different request', async () => {
  let packet;
  const bridge = { postMessage: text => { packet = JSON.parse(text); } };
  const request = createNativeRpc(bridge, 5);
  await assert.rejects(request('login_status'), error => error.code === 'NATIVE_TIMEOUT');
  bridge.onmessage({ data: JSON.stringify({ requestId: packet.requestId, result: { stale: true } }) });
});

function mobileFixture() {
  const calls = [];
  const ids = [];
  let loggedIn = true;
  const handlers = {
    login_status: () => ({ body: { data: { code: 200, profile: loggedIn ? { userId: 42, nickname: '模拟手机账号' } : null } } }),
    login_qr_key: () => ({ body: { code: 200, data: { unikey: 'native-key-12345' } } }),
    login_qr_check: () => ({ body: { code: 803 } }),
    qr_image: () => ({ image: 'data:image/png;base64,test' }),
    playlist_detail: parameters => ({ body: { code: 200, playlist: { id: parameters.id, name: '手机歌单', privacy: 10, creator: { userId: 42 }, trackCount: parameters.id === '700' ? ids.length : 2, trackIds: (parameters.id === '700' ? ids : ['1', '2']).map(id => ({ id, at: 0 })) } } }),
    song_detail: parameters => ({ body: { code: 200, songs: parameters.ids.split(',').map(id => ({ id, t: 0, name: `歌曲${id}`, ar: [{ name: '歌手' }] })) } }),
    playlist_create: () => ({ body: { code: 200, playlist: { id: '700' } } }),
    playlist_tracks: parameters => { ids.push(...parameters.tracks.split(',')); return { body: { code: 200 } }; },
    logout: () => { loggedIn = false; return { loggedIn: false }; },
  };
  const request = async (operation, parameters = {}) => {
    assert.equal(Object.hasOwn(parameters, 'cookie'), false);
    calls.push({ operation, parameters });
    if (!handlers[operation]) throw new Error(`Unexpected native operation ${operation}`);
    return handlers[operation](parameters);
  };
  const api = createMobileApi(request);
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  return { api, post, calls };
}

test('mobile QR and full synchronization use the native adapter without a desktop service', async () => {
  const app = mobileFixture();
  assert.equal((await app.api('/api/status')).loggedIn, true);
  const qr = await app.post('/api/login/qr', {});
  assert.match(qr.image, /^data:image/);
  assert.equal((await app.api(`/api/login/check?key=${qr.key}`)).loggedIn, true);
  const snapshot = await app.post('/api/playlist/sync', { id: '12' });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.songs.length, 2);
  assert.deepEqual(snapshot.songs.map(song => song.id), ['1', '2']);
  assert.equal(JSON.stringify(app.calls).includes('nativeManaged'), false);
});

test('mobile playlist tickets stay idempotent and become invalid after logout', async () => {
  const app = mobileFixture();
  await app.api('/api/status');
  const prepared = await app.post('/api/playlist/create/prepare', { name: '手机随机', privacy: 10, accountId: '42', ids: ['1', '2'] });
  const first = await app.post('/api/playlist/create', prepared);
  assert.equal(first.complete, true);
  assert.equal(first.url, 'https://music.163.com/playlist?id=700');
  assert.deepEqual(await app.post('/api/playlist/create', prepared), first);
  assert.equal(app.calls.filter(call => call.operation === 'playlist_create').length, 1);
  await app.post('/api/logout', {});
  await assert.rejects(app.post('/api/playlist/create', prepared), error => error.code === 'CREATE_TICKET_EXPIRED');
  assert.equal((await app.api('/api/status')).loggedIn, false);
  await assert.rejects(app.api('https://evil.example/api/status'), error => error.code === 'INVALID_ROUTE');
});

test('shared service is browser-portable and native assets do not launch localhost', async () => {
  const core = await readFile(new URL('../src/netease-core.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /node:|createRequire|worker_threads|import\('qrcode'\)/);
  const nativeActivity = await readFile(new URL('../android/app/src/main/java/io/suiting/music/MainActivity.java', import.meta.url), 'utf8');
  assert.doesNotMatch(nativeActivity, /addJavascriptInterface|127\.0\.0\.1|localhost/);
  assert.match(nativeActivity, /isMainFrame/);
  assert.match(nativeActivity, /MIXED_CONTENT_NEVER_ALLOW/);
});
