import { normalizeLyrics } from '../src/lyrics.mjs';
import { lookupLanguages } from '../src/language-service.mjs';
import { AppError, createNetEaseService } from '../src/netease-core.mjs';

export function createNativeRpc(bridge, timeoutMs = 25000) {
  const pending = new Map();
  let sequence = 0;
  bridge.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId); clearTimeout(entry.timer);
    if (message.error) entry.reject(new AppError(message.error.message || '手机接口请求未成功。', message.error.code || 'NATIVE_ERROR', message.error.status || 502));
    else entry.resolve(message.result);
  };
  return (operation, parameters = {}) => new Promise((resolve, reject) => {
    const requestId = `native-${Date.now()}-${++sequence}`;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new AppError('手机连接超时。涉及新建歌单时请先在网易云检查，不要重复新建。', 'NATIVE_TIMEOUT', 504)); }, ['export_file','local_import'].includes(operation) ? 600000 : operation === 'song_wiki_info' ? 20000 : timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    try { bridge.postMessage(JSON.stringify({ requestId, operation, parameters })); }
    catch { clearTimeout(timer); pending.delete(requestId); reject(new AppError('无法连接手机本地接口，请更新 Android System WebView 后重试。', 'NATIVE_UNAVAILABLE')); }
  });
}

export function createMobileApi(request) {
  const session = { cookie: { nativeManaged: 'true' }, profile: null, qr: null };
  const operations = ['login_qr_key', 'login_qr_check', 'login_status', 'user_playlist', 'playlist_detail', 'song_detail', 'song_url', 'song_url_v1', 'song_wiki_info', 'cloudsearch', 'lyric', 'recommend_songs', 'recommend_resource', 'likelist', 'like', 'playlist_create', 'playlist_tracks', 'song_order_update'];
  const upstream = Object.fromEntries(operations.map(operation => [operation, parameters => {
    const { cookie, ...safe } = parameters;
    if (operation === 'like') {
      if (!['true', 'false'].includes(safe.like)) throw new AppError('红心目标状态无效。', 'INVALID_LIKE', 400);
      safe.like = safe.like === 'true';
    }
    return request(operation, safe);
  }]));
  const service = createNetEaseService({
    upstream,
    qrImage: async url => (await request('qr_image', { url })).image,
    fetchImpl: async url => {
      const result = await request('share_redirect', { url: String(url) });
      return { status: result.status, headers: { get: name => name.toLowerCase() === 'location' ? result.location : null } };
    },
  });
  return async (path, options = {}) => {
    const url = new URL(path, 'https://appassets.androidplatform.net');
    if (url.origin !== 'https://appassets.androidplatform.net') throw new AppError('只允许随听本地接口。', 'INVALID_ROUTE', 400);
    const route = `${options.method || 'GET'} ${url.pathname}`;
    const body = options.body ? JSON.parse(options.body) : {};
    if (route === 'GET /api/features') return request('features_get');
    if (route === 'POST /api/features') return request('features_set',body);
    if (route === 'GET /api/local') return request('local_list');
    if (route === 'POST /api/local/import') return request('local_import');
    if (route === 'POST /api/local/lyrics') return request('local_lyrics_save',body);
    if (route === 'POST /api/local/remove') return request('local_remove',body);
    if (String(body.id || '').startsWith('local-') && route === 'POST /api/preview') return request('local_preview',{id:body.id});
    if (String(body.id || '').startsWith('local-') && route === 'POST /api/lyrics') return {id:body.id,...normalizeLyrics(await request('local_lyrics',{id:body.id}))};
    if (route === 'POST /api/languages') return lookupLanguages(body, { netease: ids => service.classifySongs(session, { ids }),  });
    if (route === 'GET /api/status') return service.status(session);
    if (route === 'GET /api/playlists') return service.playlists(session);
    if (route === 'POST /api/daily') return service.daily(session, body);
    if (route === 'GET /api/likes') return service.likes(session);
    if (route === 'POST /api/like') return service.like(session, body);
    if (route === 'POST /api/search') return service.searchSongs(session, body);
    if (route === 'POST /api/lyrics') return service.lyrics(session, body.id);
    if (route === 'POST /api/login/qr') return service.createQr(session);
    if (route === 'GET /api/login/check') return service.checkQr(session, url.searchParams.get('key'));
    if (route === 'POST /api/logout') {
      service.invalidateSession(session);
      await request('logout');
      return { loggedIn: false, profile: null };
    }
    if (route === 'POST /api/playlist/sync') {
      if (session.syncInProgress) throw new AppError('手机正在同步，请等待本次完成。', 'SYNC_IN_PROGRESS', 409);
      session.syncInProgress = true;
      try { return await service.syncPlaylist(session, body); }
      finally { session.syncInProgress = false; }
    }
    if (route === 'POST /api/playlist/create/prepare') return service.preparePlaylist(session, body);
    if (route === 'POST /api/playlist/create') return service.createPlaylist(session, body);
    if (route === 'POST /api/classify') {
      if (session.classifyInProgress) throw new AppError('手机正在自动分类，请等这一批完成。', 'CLASSIFY_IN_PROGRESS', 409);
      session.classifyInProgress = true;
      try { return await service.classifySongs(session, body); }
      finally { session.classifyInProgress = false; }
    }
    if (route === 'POST /api/preview') {
      const result = await service.preview(session, body.id, body.quality);
      const secureUrl = new URL(result.url); secureUrl.protocol = 'https:';
      return { ...result, url: secureUrl.href };
    }
    throw new AppError('没有这个手机接口。', 'NOT_FOUND', 404);
  };
}

export const requestNative = typeof window !== 'undefined' && window.SuiTingNative ? createNativeRpc(window.SuiTingNative) : null;
export const api = requestNative ? createMobileApi(requestNative) : async () => { throw new AppError('手机接口不可用，请更新 Android System WebView 后重试。', 'NATIVE_UNAVAILABLE'); };
export const ready = requestNative ? requestNative('ready') : Promise.resolve({});
