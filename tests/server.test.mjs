import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server.mjs';

function upstreamFixture(overrides = {}) {
  const calls = [];
  let keyCount = 0;
  const liked = { id: 11, name: '我喜欢的音乐', specialType: 5, trackCount: 5, privacy: 0, creator: { userId: 42, nickname: '测试用户' } };
  const privateList = { id: 12, name: '私密收藏', trackCount: 5, privacy: 10, creator: { userId: 42, nickname: '测试用户' } };
  const handlers = {
    login_qr_key: () => ({ body: { code: 200, data: { unikey: `session-key-${++keyCount}` } }, cookie: [] }),
    login_qr_check: () => ({ body: { code: 803, cookie: 'MUSIC_U=private-credential; Path=/; HttpOnly' }, cookie: ['MUSIC_U=private-credential; Path=/; HttpOnly'] }),
    login_status: parameters => ({ body: { data: { code: 200, profile: parameters.cookie.MUSIC_U ? { userId: 42, nickname: '测试用户', avatarUrl: '' } : null } } }),
    user_playlist: parameters => ({ body: { code: 200, more: parameters.offset === 0, playlist: parameters.offset === 0 ? [liked, privateList] : [liked, { ...privateList, id: 13, privacy: 0 }] } }),
    playlist_detail: parameters => ({ body: { code: 200, playlist: { ...privateList, id: Number(parameters.id), trackIds: [1, 2, 3, 4, 5].map(id => ({ id })), tracks: [{ id: 1, name: '被截断的内嵌详情' }] } } }),
    song_detail: parameters => ({ body: { code: 200, songs: parameters.ids.split(',').map(id => ({ id: Number(id), name: `歌曲 ${id}`, ar: [{ name: '歌手' }], al: { name: '专辑', picUrl: 'https://p1.music.126.net/cover.jpg' }, dt: 180_000 })) } }),
    song_url_v1: parameters => ({ body: { code: 200, data: [{ id: Number(parameters.id), code: 200, url: 'https://m7.music.126.net/recording.mp3', expi: 1200, type: 'mp3', br: 128000, level: 'standard' }] } }),
    ...overrides,
  };
  const upstream = Object.fromEntries(Object.entries(handlers).map(([operation, handler]) => [operation, async parameters => {
    calls.push({ operation, parameters });
    return handler(parameters);
  }]));
  return { upstream, calls };
}

function creationFixture() {
  const lists = new Map();
  let nextId = 700;
  const handlers = {
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
  };
  return { lists, handlers };
}

async function running(t, options = {}) {
  const fixture = upstreamFixture(options.overrides);
  const server = createApp({ upstream: fixture.upstream, qrImage: async () => 'data:image/png;base64,test', batchSize: 2, batchDelayMs: 0, playlistPageSize: 2, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { cookie, method = 'GET', body, headers = {} } = {}) {
    let consentHeader;
    if (!route.startsWith('/api/features')) {
      const consent=await fetch(base+'/api/features',{method:'POST',headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:JSON.stringify({id:'netease',enabled:true})});
      consentHeader=consent.headers.get('set-cookie');
      cookie=consentHeader?.split(';')[0] || cookie;
    }
    const response = await fetch(`${base}${route}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { response, cookieHeader:response.headers.get('set-cookie') || consentHeader, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
  }
  async function login() {
    const qr = await request('/api/login/qr', { method: 'POST', body: {} });
    const confirmation = await request(`/api/login/check?key=${qr.body.key}`, { cookie: qr.cookie });
    assert.equal(confirmation.body.loggedIn, true);
    return qr.cookie;
  }
  return { ...fixture, server, base, request, login };
}

test('QR login keeps credentials in an HttpOnly browser session and pages all own playlists', async t => {
  const app = await running(t);
  const anonymous = await app.request('/api/status');
  assert.deepEqual(anonymous.body, { loggedIn: false, profile: null });
  assert.match(anonymous.cookieHeader, /HttpOnly; SameSite=Strict/);
  const denied = await app.request('/api/playlists', { cookie: anonymous.cookie });
  assert.equal(denied.response.status, 401);
  const cookie = await app.login();
  const lists = await app.request('/api/playlists', { cookie });
  assert.equal(lists.response.status, 200);
  assert.equal(lists.body.playlists.length, 3);
  assert.equal(lists.body.playlists.find(playlist => playlist.id === '11').isLiked, true);
  assert.equal(lists.body.playlists.find(playlist => playlist.id === '12').private, true);
  assert.deepEqual(app.calls.filter(call => call.operation === 'user_playlist').map(call => call.parameters.offset), [0, 2]);
  assert.equal(JSON.stringify(lists.body).includes('private-credential'), false);
  assert.equal(JSON.stringify(lists.body).includes('MUSIC_U'), false);
  assert.equal(app.calls.find(call => call.operation === 'user_playlist').parameters.cookie.MUSIC_U, 'private-credential');
});

test('HTTP playlist creation requires an authorized session, accepts large queues and reuses its prepared ticket', async t => {
  const creation = creationFixture();
  const app = await running(t, { overrides: creation.handlers });
  const payload = { name: '测试随机', privacy: 10, accountId: '42', ids: ['1', '2', '3', '4', '5'] };
  const denied = await app.request('/api/playlist/create/prepare', { method: 'POST', body: payload });
  assert.equal(denied.response.status, 401);
  const cookie = await app.login();
  const large = await app.request('/api/playlist/create/prepare', { cookie, method: 'POST', body: { ...payload, ids: Array.from({ length: 5000 }, (_, index) => String(index + 1)) } });
  assert.equal(large.response.status, 200);
  assert.equal(large.body.count, 5000);
  const prepared = await app.request('/api/playlist/create/prepare', { cookie, method: 'POST', body: payload });
  assert.equal(app.calls.some(call => call.operation === 'playlist_create'), false);
  const foreign = await app.request('/api/playlist/create', { method: 'POST', body: { requestId: prepared.body.requestId } });
  assert.equal(foreign.response.status, 409);
  const first = await app.request('/api/playlist/create', { cookie, method: 'POST', body: { requestId: prepared.body.requestId } });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.complete, true);
  assert.equal(first.body.orderConfirmed, true);
  const repeated = await app.request('/api/playlist/create', { cookie, method: 'POST', body: { requestId: prepared.body.requestId } });
  assert.deepEqual(repeated.body, first.body);
  assert.equal(app.calls.filter(call => call.operation === 'playlist_create').length, 1);
});

test('cross-origin or unprepared writes cannot create playlists', async t => {
  const creation = creationFixture();
  const app = await running(t, { overrides: creation.handlers });
  const cookie = await app.login();
  const payload = { name: '测试随机', privacy: 10, accountId: '42', ids: ['1'] };
  const prepared = await app.request('/api/playlist/create/prepare', { cookie, method: 'POST', body: payload });
  const blocked = await app.request('/api/playlist/create', { cookie, method: 'POST', body: { requestId: prepared.body.requestId }, headers: { Origin: 'https://example.com' } });
  assert.equal(blocked.response.status, 403);
  const missing = await app.request('/api/playlist/create', { cookie, method: 'POST', body: payload });
  assert.equal(missing.response.status, 409);
  assert.equal(app.calls.some(call => call.operation === 'playlist_create'), false);
});

test('sync uses every track ID in ordered batches rather than truncated playlist tracks', async t => {
  const app = await running(t);
  const cookie = await app.login();
  const result = await app.request('/api/playlist/sync', { cookie, method: 'POST', body: { id: '12' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.complete, true);
  assert.deepEqual(result.body.songs.map(song => song.id), ['1', '2', '3', '4', '5']);
  assert.deepEqual(app.calls.filter(call => call.operation === 'song_detail').map(call => call.parameters.ids), ['1,2', '3,4', '5']);
  assert.equal(result.body.songs[0].title, '歌曲 1');
  assert.equal(result.body.songs[0].duration, 180_000);
  assert.deepEqual(result.body.songs[0].playlistIds, ['12']);
  assert.equal(result.body.playlist.private, true);
  assert.ok(Date.parse(result.body.syncedAt));
});

test('incomplete track IDs and missing song metadata fail without a successful empty snapshot', async t => {
  const truncated = await running(t, { overrides: { playlist_detail: () => ({ body: { code: 200, playlist: { id: 12, trackCount: 5, trackIds: [{ id: 1 }] } } }) } });
  const first = await truncated.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(first.response.status, 502);
  assert.equal(first.body.code, 'INCOMPLETE_SYNC');
  assert.equal(first.body.complete, undefined);
  assert.equal(first.body.songs, undefined);
  assert.equal(truncated.calls.some(call => call.operation === 'song_detail'), false);
  const missing = await running(t, { overrides: { song_detail: () => ({ body: { code: 200, songs: [] } }) } });
  const second = await missing.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(second.response.status, 502);
  assert.equal(second.body.code, 'INCOMPLETE_SYNC');
  assert.equal(second.body.songs, undefined);
});

test('2593 declared tracks plus three unmatched cloud uploads sync only the official catalog', async t => {
  const app = await running(t, { batchSize: 200, overrides: {
    playlist_detail: () => ({ body: { code: 200, playlist: { id: 12, trackCount: 2593, trackIds: Array.from({ length: 2596 }, (_, index) => ({ id: index + 1 })) } } }),
    song_detail: parameters => ({ body: { code: 200, songs: parameters.ids.split(',').map(id => Number(id) <= 3 ? { id: Number(id), t: 1, name: null } : { id: Number(id), t: 0, name: `歌曲 ${id}` }) } }),
  } });
  const result = await app.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.complete, true);
  assert.equal(result.body.songs.length, 2593);
  assert.equal(result.body.playlist.trackCount, 2593);
  assert.equal(result.body.sync.sourceTrackCount, 2593);
  assert.equal(result.body.sync.returnedTrackCount, 2596);
  assert.equal(result.body.sync.skippedCloudCount, 3);
  assert.equal(result.body.sync.duplicateCount, 0);
  assert.ok(result.body.songs.every(song => Number(song.id) > 3));
  assert.match(result.body.warnings.join(' '), /已跳过 3 首/);
});

test('explicit cloud metadata can identify an upload omitted by song detail without hiding unknown missing songs', async t => {
  const app = await running(t, { overrides: {
    playlist_detail: () => ({ body: { code: 200, playlist: { id: 12, trackCount: 2, trackIds: [{ id: 1 }, { id: 2 }], tracks: [{ id: 2, t: 1, name: null }] } } }),
    song_detail: () => ({ body: { code: 200, songs: [{ id: 1, t: 0, name: '官方歌' }] } }),
  } });
  const result = await app.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.songs.map(song => song.id), ['1']);
  assert.equal(result.body.playlist.trackCount, 1);
  assert.equal(result.body.playlist.sourceTrackCount, 2);
  assert.equal(result.body.playlist.skippedCloudCount, 1);
});

test('matched uploads use the official song ID, deduplicate aliases, and preserve paid catalog songs', async t => {
  const requested = [];
  const records = { 1: { id: 1, t: 2, s_id: 99, name: '云盘版本' }, 2: { id: 2, t: 2, s_id: 99, name: '另一个云盘版本' }, 3: { id: 3, t: 0, name: '会员官方歌', fee: 1, st: -200, pc: {} }, 99: { id: 99, t: 0, name: '匹配到的官方歌', fee: 4 } };
  const app = await running(t, { overrides: {
    playlist_detail: () => ({ body: { code: 200, playlist: { id: 12, trackCount: 3, trackIds: [{ id: 1 }, { id: 2 }, { id: 3 }] } } }),
    song_detail: parameters => { requested.push(parameters.ids); return { body: { code: 200, songs: parameters.ids.split(',').map(id => records[id]) } }; },
  } });
  const result = await app.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.songs.map(song => song.id), ['99', '3']);
  assert.ok(requested.includes('99'));
  assert.equal(result.body.sync.matchedCloudCount, 2);
  assert.equal(result.body.sync.skippedCloudCount, 0);
  assert.equal(result.body.sync.duplicateCount, 1);
});

test('stale lower summary counts do not discard fully returned official songs', async t => {
  const app = await running(t, { overrides: {
    playlist_detail: () => ({ body: { code: 200, playlist: { id: 12, trackCount: 3, trackIds: [1, 2, 3, 4, 5].map(id => ({ id })) } } }),
  } });
  const result = await app.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.songs.length, 5);
  assert.equal(result.body.playlist.trackCount, 5);
  assert.equal(result.body.sync.skippedCloudCount, 0);
  assert.equal(result.body.sync.sourceTrackCount, 3);
  assert.match(result.body.warnings.join(' '), /标注 3 首.*返回 5/);
});

test('playlist addition dates and source positions survive official alias normalization', async t => {
  const records = { 1: { id: 1, t: 2, s_id: 99, name: '云盘版本' }, 2: { id: 2, t: 0, name: '官方歌' }, 99: { id: 99, t: 0, name: '官方对应' } };
  const app = await running(t, { overrides: {
    playlist_detail: () => ({ body: { code: 200, playlist: { id: 12, trackCount: 3, trackIds: [{ id: 1, at: 1760000000 }, { id: 2, at: 0 }, { id: 99, at: 1761000000000 }] } } }),
    song_detail: parameters => ({ body: { code: 200, songs: parameters.ids.split(',').map(id => records[id]) } }),
  } });
  const result = await app.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.songs[0].id, '99');
  assert.equal(result.body.songs[0].addedAt, 1761000000000);
  assert.equal(result.body.songs[0].playlistOrder, 0);
  assert.equal(result.body.songs[1].addedAt, null);
  assert.equal(result.body.songs[1].playlistOrder, 1);
});

test('unmatched or cyclic cloud aliases can produce an explicitly filtered empty snapshot', async t => {
  const app = await running(t, { overrides: {
    playlist_detail: () => ({ body: { code: 200, playlist: { id: 12, trackCount: 3, trackIds: [{ id: 1 }, { id: 2 }, { id: 3 }] } } }),
    song_detail: parameters => ({ body: { code: 200, songs: parameters.ids.split(',').map(id => ({ id: Number(id), t: Number(id) === 1 ? 1 : 2, s_id: Number(id) === 2 ? 0 : Number(id) })) } }),
  } });
  const result = await app.request('/api/playlist/sync', { method: 'POST', body: { id: '12' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.complete, true);
  assert.equal(result.body.playlist.trackCount, 0);
  assert.deepEqual(result.body.songs, []);
  assert.equal(result.body.sync.skippedCloudCount, 3);
  assert.equal(result.body.sync.duplicateCount, 0);
});

test('a second browser cannot poll another browser QR or inherit login credentials', async t => {
  const app = await running(t);
  const first = await app.request('/api/login/qr', { method: 'POST', body: {} });
  const other = await app.request('/api/status');
  const stolen = await app.request(`/api/login/check?key=${first.body.key}`, { cookie: other.cookie });
  assert.equal(stolen.response.status, 400);
  assert.equal(stolen.body.code, 'INVALID_QR');
  const confirmation = await app.request(`/api/login/check?key=${first.body.key}`, { cookie: first.cookie });
  assert.equal(confirmation.body.loggedIn, true);
  const privateAccess = await app.request('/api/playlists', { cookie: other.cookie });
  assert.equal(privateAccess.response.status, 401);
  const logout = await app.request('/api/logout', { cookie: first.cookie, method: 'POST', body: {} });
  assert.equal(logout.body.loggedIn, false);
  const expired = await app.request('/api/playlists', { cookie: first.cookie });
  assert.equal(expired.response.status, 401);
});

test('cross-origin requests, DNS rebinding hosts, and non-JSON writes are rejected', async t => {
  const app = await running(t);
  const origin = await app.request('/api/login/qr', { method: 'POST', body: {}, headers: { Origin: 'https://malicious.example' } });
  assert.equal(origin.response.status, 403);
  assert.equal(origin.body.code, 'CROSS_ORIGIN');
  const crossSite = await app.request('/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.response.status, 403);
  const host = await new Promise((resolve, reject) => {
    const request = httpRequest(`${app.base}/api/status`, { headers: { Host: `attacker.example:${app.server.address().port}` } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.once('error', reject);
    request.end();
  });
  assert.equal(host.status, 403);
  assert.equal(host.body.code, 'INVALID_HOST');
  const nonJson = await app.request('/api/login/qr', { method: 'POST' });
  assert.equal(nonJson.response.status, 415);
  assert.equal(app.calls.length, 0);
});

test('NetEase Android share short links resolve only through the HTTPS allowlist', async t => {
  const targets = [];
  const app = await running(t, { fetchImpl: async (url, options) => {
    targets.push({ url: String(url), options });
    return new Response(null, { status: 302, headers: { Location: 'https://y.music.163.com/m/playlist?app_version=9&id=12&userid=999' } });
  } });
  const result = await app.request('/api/playlist/sync', { method: 'POST', body: { input: '分享歌单 http://163cn.tv/zoIxm3' } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.playlist.id, '12');
  assert.equal(targets[0].url, 'https://163cn.tv/zoIxm3');
  assert.equal(targets[0].options.redirect, 'manual');
  assert.equal(targets[0].options.headers.Cookie, undefined);
  const blocked = await running(t, { fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } }) });
  const unsafe = await blocked.request('/api/playlist/sync', { method: 'POST', body: { input: 'https://163cn.tv/example' } });
  assert.equal(unsafe.response.status, 400);
  assert.equal(unsafe.body.code, 'UNSAFE_LINK');
});

test('playback requests selected authorized quality, reports the actual result and refuses paid trial fragments', async t => {
  const app = await running(t);
  const result = await app.request('/api/preview', { method: 'POST', body: { id: '1' } });
  assert.equal(result.response.status, 200);
  assert.match(result.body.url, /^https:\/\/m7\.music\.126\.net\//);
  const call = app.calls.find(entry => entry.operation === 'song_url_v1');
  assert.equal(call.parameters.unblock, 'false');
  assert.equal(call.parameters.level, 'exhigh');
  assert.equal(result.body.bitrate, 128000);
  assert.equal(result.body.requestedQuality, 'exhigh');
  assert.equal(result.body.actualLevel, 'standard');
  const invalid = await app.request('/api/preview', { method: 'POST', body: { id: '1', quality: 'unlock' } });
  assert.equal(invalid.response.status, 400);
  const trial = await running(t, { overrides: { song_url_v1: () => ({ body: { code: 200, data: [{ id: 1, code: 200, url: 'https://m7.music.126.net/trial.mp3', freeTrialInfo: { start: 0, end: 30 } }] } }) } });
  const denied = await trial.request('/api/preview', { method: 'POST', body: { id: '1' } });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, 'PLAYBACK_UNAVAILABLE');
  assert.equal(denied.body.url, undefined);
});

test('static serving never exposes server sources or dependencies', async t => {
  const app = await running(t);
  for (const pathname of ['/server.mjs', '/src/netease.mjs', '/node_modules/qrcode/package.json', '/..%5cserver.mjs']) {
    const response = await fetch(`${app.base}${pathname}`);
    assert.equal(response.status, 404);
  }
  const module = await fetch(`${app.base}/src/shuffle.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
  const playback = await fetch(`${app.base}/src/playback.mjs`);
  assert.equal(playback.status, 200);
});

test('each selected quality reaches the upstream without an unlock or fallback substitution', async t => {
  const app = await running(t);
  for (const quality of ['standard', 'higher', 'exhigh', 'lossless']) {
    const result = await app.request('/api/preview', { method: 'POST', body: { id: '1', quality } });
    assert.equal(result.body.requestedQuality, quality);
    assert.equal(result.body.actualLevel, 'standard');
    assert.equal(app.calls.at(-1).parameters.level, quality);
    assert.equal(app.calls.at(-1).parameters.unblock, 'false');
  }
});

test('playback refuses unexpected media destinations and wrong song identifiers', async t => {
  for (const track of [
    { id: 2, url: 'https://m7.music.126.net/a.mp3' },
    { id: 1, url: 'https://evil.example/a.mp3' },
    { id: 1, url: 'https://user:secret@m7.music.126.net/a.mp3' },
    { id: 1, url: 'https://m7.music.126.net:8080/a.mp3' },
  ]) {
    const app = await running(t, { overrides: { song_url_v1: () => ({ body: { code: 200, data: [{ code: 200, ...track }] } }) } });
    assert.equal((await app.request('/api/preview', { method: 'POST', body: { id: '1' } })).response.status, 403);
  }
});

test('lyrics API returns normalized timestamps and shared frontend modules are available under CSP', async t => {
  const app = await running(t, { overrides: { lyric: () => ({ body: { code: 200, lrc: { lyric: '[00:01]合成一句\n[00:03]合成二句' } } }) } });
  const result = await app.request('/api/lyrics', { method: 'POST', body: { id: '1' } });
  assert.equal(result.response.status, 200); assert.equal(result.body.status, 'timed'); assert.equal(result.body.lines[1].time, 3);
  const invalid = await app.request('/api/lyrics', { method: 'POST', body: { id: 'bad' } }); assert.equal(invalid.response.status, 400);
  for (const path of ['/src/classify.mjs', '/src/library.mjs', '/src/lyrics.mjs', '/src/search.mjs', '/src/appearance.mjs', '/src/avatar.mjs', '/src/plugins.mjs', '/avatar-upload.mjs', '/overlay-view.mjs', '/experience.css', '/appearance.css', '/boot.js']) assert.equal((await fetch(`${app.base}${path}`)).status, 200);
  const html = await (await fetch(app.base)).text(); assert.ok(html.includes('src="/boot.js"')); assert.equal(/<script>/.test(html), false);
});
