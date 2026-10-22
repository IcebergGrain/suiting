import { normalizeFeatures, updateFeature } from './src/features.mjs';
import { lookupLanguages } from './src/language-service.mjs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError, createNetEaseService } from './src/netease.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const sessionLifetime = 12 * 60 * 60_000;
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function json(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJson(request, maximumBytes = 8192) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new AppError('请求必须使用 JSON 格式。', 'INVALID_BODY', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new AppError('请求内容过长。', 'BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid object');
    return body;
  } catch {
    throw new AppError('请求 JSON 无效。', 'INVALID_BODY', 400);
  }
}

function browserToken(request) {
  const match = /(?:^|;\s*)suiting_public_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '');
  return match?.[1];
}

export function createApp({
  service,
  upstream,
  qrImage,
  fetchImpl,
  host = '127.0.0.1',
  port = 4392,
  publicDirectory = path.join(projectRoot, 'public'),
  now = Date.now,
  requestTimeoutMs = 180_000,
  rateLimit = 150,
  ...serviceOptions
} = {}) {
  const netease = service ?? createNetEaseService({ upstream, qrImage, fetchImpl, now, ...serviceOptions });
  const sessions = new Map();
  const acceptedHosts = new Set(['127.0.0.1', 'localhost', '[::1]', host.toLowerCase()]);
  if (host === '0.0.0.0' || host === '::') {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) acceptedHosts.add(address.family === 'IPv6' ? `[${address.address.toLowerCase()}]` : address.address);
    }
  }

  function validateRequest(request) {
    const hostHeader = request.headers.host;
    let destination;
    try {
      destination = new URL(`http://${hostHeader}`);
    } catch {
      throw new AppError('本机请求地址无效。', 'INVALID_HOST', 403);
    }
    const listeningPort = server.address()?.port ?? port;
    if (!hostHeader || !acceptedHosts.has(destination.hostname.toLowerCase()) || destination.username || destination.password || destination.pathname !== '/' || Number(destination.port || 80) !== Number(listeningPort)) {
      throw new AppError('服务只接受指定的本机地址。', 'INVALID_HOST', 403);
    }
    const expectedOrigin = destination.origin;
    if ((request.headers.origin && request.headers.origin !== expectedOrigin) || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) {
      throw new AppError('已拒绝其他网页发起的跨来源请求。', 'CROSS_ORIGIN', 403);
    }
    const requestUrl = new URL(request.url, expectedOrigin);
    if (requestUrl.origin !== expectedOrigin) throw new AppError('请求地址无效。', 'INVALID_HOST', 403);
    return requestUrl;
  }

  function sessionFor(request, response) {
    const time = now();
    for (const [token, session] of sessions) {
      if (time - session.touchedAt > sessionLifetime) sessions.delete(token);
    }
    let token = browserToken(request);
    let session = sessions.get(token);
    if (!session) {
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      token = randomBytes(32).toString('hex');
      session = { features: normalizeFeatures(), cookie: Object.create(null), profile: null, qr: null, touchedAt: time, rateStart: time, rateCount: 0, syncInProgress: false };
      sessions.set(token, session);
      response.setHeader('Set-Cookie', `suiting_public_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`);
    }
    session.touchedAt = time;
    if (time - session.rateStart >= 60_000) {
      session.rateStart = time;
      session.rateCount = 0;
    }
    session.rateCount += 1;
    if (session.rateCount > rateLimit) throw new AppError('操作太频繁，请稍等一分钟再试。', 'RATE_LIMIT', 429);
    return { session, token };
  }

  async function staticFile(request, response, requestUrl) {
    if (!['GET', 'HEAD'].includes(request.method)) throw new AppError('这个地址不支持当前请求方式。', 'METHOD_NOT_ALLOWED', 405);
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      throw new AppError('文件地址无效。', 'NOT_FOUND', 404);
    }
    const sourceModule = ['/src/easter.mjs', '/src/shuffle.mjs', '/src/playback.mjs', '/src/classify.mjs', '/src/languages.mjs', '/src/extension-host.mjs', '/src/song-id.mjs', '/src/features.mjs', '/src/local-library.mjs', '/src/lyrics.mjs', '/src/library.mjs', '/src/queue-session.mjs', '/src/listening-session.mjs', '/src/likes-journal.mjs', '/src/collection.mjs', '/src/search.mjs', '/src/appearance.mjs', '/src/avatar.mjs', '/src/plugins.mjs'].includes(pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filename = sourceModule ? path.join(projectRoot, 'src', path.basename(pathname)) : path.resolve(publicDirectory, relative);
    if (!sourceModule && (!filename.startsWith(`${path.resolve(publicDirectory)}${path.sep}`) || pathname.includes('\0') || pathname.includes('\\'))) throw new AppError('没有找到这个文件。', 'NOT_FOUND', 404);
    try {
      const content = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] ?? 'application/octet-stream', 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('没有找到这个文件。', 'NOT_FOUND', 404);
    }
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https: http://p1.music.126.net http://p2.music.126.net http://p3.music.126.net http://p4.music.126.net; media-src 'self' blob: https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const deadline = setTimeout(() => json(response, 504, { error: request.url.startsWith('/api/playlist/create') ? '创建结果仍待确认，请检查本次结果或在网易云查看，不要重复新建。' : '本次同步超过时限，已停止等待。原有本地歌单不会被覆盖。', code: 'REQUEST_TIMEOUT' }), requestTimeoutMs);
    response.once('close', () => clearTimeout(deadline));
    try {
      const requestUrl = validateRequest(request);
      if (!requestUrl.pathname.startsWith('/api/')) {
        await staticFile(request, response, requestUrl);
        return;
      }
      const { session, token } = sessionFor(request, response);
      const route = `${request.method} ${requestUrl.pathname}`;
      let result;
      if (route === 'GET /api/features') { json(response,200,normalizeFeatures(session.features));return; }
      if (route === 'POST /api/features') {
        const body=await readJson(request);
        session.features=updateFeature(session.features,body.id,body.enabled);
        if(!session.features.netease) { netease.invalidateSession?.(session);session.cookie=Object.create(null);session.profile=null;session.qr=null; }
        json(response,200,session.features);return;
      }
      if(!normalizeFeatures(session.features).netease) {
        if(route==='GET /api/status') {json(response,200,{loggedIn:false,profile:null});return;}
        throw new AppError('网易云插件已关闭，请在功能插件里明确开启。','PLUGIN_DISABLED',403);
      }
      if (route === 'POST /api/lyrics' && !normalizeFeatures(session.features).lyrics) throw new AppError('歌词插件已关闭。','PLUGIN_DISABLED',403);
      if (route === 'GET /api/status') result = await netease.status(session);
      else if (route === 'POST /api/login/qr') {
        await readJson(request);
        result = await netease.createQr(session);
      } else if (route === 'GET /api/login/check') result = await netease.checkQr(session, requestUrl.searchParams.get('key'));
      else if (route === 'POST /api/logout') {
        await readJson(request);
        session.features = normalizeFeatures(session.features);
        netease.invalidateSession?.(session);
        session.cookie = Object.create(null);
        session.profile = null;
        session.qr = null;
        response.setHeader('Set-Cookie', `suiting_public_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`);
        result = { loggedIn: false, profile: null };
      } else if (route === 'GET /api/playlists') result = await netease.playlists(session);
      else if (route === 'POST /api/daily') result = await netease.daily(session, await readJson(request));
      else if (route === 'GET /api/likes') result = await netease.likes(session);
      else if (route === 'POST /api/like') result = await netease.like(session, await readJson(request));
      else if (route === 'POST /api/playlist/sync') {
        const body = await readJson(request);
        if (session.syncInProgress) throw new AppError('当前会话正在同步，请等待本次完成。', 'SYNC_IN_PROGRESS', 409);
        session.syncInProgress = true;
        try {
          result = await netease.syncPlaylist(session, body);
        } finally {
          session.syncInProgress = false;
        }
      } else if (route === 'POST /api/playlist/create/prepare') result = await netease.preparePlaylist(session, await readJson(request, 128_000));
      else if (route === 'POST /api/playlist/create') result = await netease.createPlaylist(session, await readJson(request));
      else if (route === 'POST /api/preview') { const body = await readJson(request); result = await netease.preview(session, body.id, body.quality); }
      else if (route === 'POST /api/lyrics') { const body = await readJson(request); result = await netease.lyrics(session, body.id); }
      else if (route === 'POST /api/search') result = await netease.searchSongs(session, await readJson(request));
      else if (route === 'POST /api/languages') result = await lookupLanguages(await readJson(request), { netease: ids => netease.classifySongs(session, { ids }),  });
      else if (route === 'POST /api/classify') {
        const body = await readJson(request, 256_000);
        if (session.classifyInProgress) throw new AppError('正在自动分类，请等这一批完成。', 'CLASSIFY_IN_PROGRESS', 409);
        session.classifyInProgress = true;
        try { result = await netease.classifySongs(session, body); }
        finally { session.classifyInProgress = false; }
      }
      else throw new AppError('没有这个接口。', 'NOT_FOUND', 404);
      json(response, 200, result);
    } catch (error) {
      const known = error instanceof AppError;
      json(response, known ? error.status : 500, { error: known ? error.message : '本机服务遇到错误，请重试。原有本地数据不会被覆盖。', code: known ? error.code : 'INTERNAL_ERROR' });
    } finally {
      clearTimeout(deadline);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4392);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数。');
  const server = createApp({ host, port });
  server.once('error', error => {
    process.stderr.write(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请关闭已有实例或修改 PORT。\n` : '本机服务启动失败，请检查 HOST 和 PORT。\n');
    process.exitCode = 1;
  });
  server.listen(port, host, () => process.stdout.write(`随听已启动：http://${host}:${port}\n登录凭证仅保留在当前服务内存中，关闭后需要重新扫码。\n`));
}
