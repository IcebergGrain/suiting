import { normalizeLanguages } from './languages.mjs';
import { parsePlaylistInput } from './shuffle.mjs';
import { qualityDefinitions } from './playback.mjs';
import { classificationFromWiki, AUTO_SOURCE } from './classify.mjs';
import { normalizeLyrics } from './lyrics.mjs';
import { songArtists } from './library.mjs';

const shareHosts = new Set(['music.163.com', 'y.music.163.com', 'm.music.163.com', '163cn.tv', 'www.163cn.tv']);
const cookieAttributes = new Set(['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite', 'priority', 'partitioned']);

export class AppError extends Error {
  constructor(message, code = 'UPSTREAM_ERROR', status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function upstreamError(code) {
  if ([301, 302, 401, 403].includes(Number(code))) return new AppError('网易云登录已失效，或当前账号没有访问这个歌单的权限。请重新扫码后重试。', 'AUTH_REQUIRED', 401);
  if (Number(code) === 404) return new AppError('没有找到这个网易云歌单或歌曲。', 'NOT_FOUND', 404);
  return new AppError('网易云暂时没有返回可用结果，请稍后重试；原有本地歌单不会被覆盖。');
}

function mergeCookies(session, result) {
  const values = Array.isArray(result.cookie) && result.cookie.length ? result.cookie : typeof result.body?.cookie === 'string' ? [result.body.cookie] : [];
  for (const value of values) {
    for (const part of String(value).split(';')) {
      const separator = part.indexOf('=');
      if (separator < 1) continue;
      const name = part.slice(0, separator).trim();
      const cookieValue = part.slice(separator + 1).trim();
      if (!/^[\w-]+$/.test(name) || cookieAttributes.has(name.toLowerCase())) continue;
      if (cookieValue) session.cookie[name] = cookieValue;
      else delete session.cookie[name];
    }
  }
}

function identifier(value) {
  const result = String(value ?? '');
  if (!/^[1-9]\d{0,19}$/.test(result)) throw new AppError('请提供有效的网易云歌单或歌曲 ID。', 'INVALID_ID', 400);
  return result;
}

function profileFrom(body) {
  const profile = body.data?.profile ?? body.profile;
  if (!profile?.userId) return null;
  return { userId: String(profile.userId), nickname: String(profile.nickname ?? '网易云用户'), avatarUrl: String(profile.avatarUrl ?? '') };
}

function playlistFrom(playlist, userId) {
  const ownerId = String(playlist.creator?.userId ?? playlist.userId ?? '');
  const owned = Boolean(userId && ownerId === String(userId));
  return {
    id: identifier(playlist.id),
    name: String(playlist.name ?? '未命名歌单'),
    cover: String(playlist.coverImgUrl ?? ''),
    trackCount: Number(playlist.trackCount ?? 0),
    owner: { id: ownerId, nickname: String(playlist.creator?.nickname ?? '') },
    private: Number(playlist.privacy) === 10,
    specialType: Number(playlist.specialType ?? 0),
    isLiked: owned && Number(playlist.specialType) === 5,
    owned,
  };
}

function songFrom(song, playlistIds = [], additions = {}) {
  const album = song.al ?? song.album ?? {};
  return {
    id: identifier(song.id),
    title: String(song.name),
    artist: (song.ar ?? song.artists ?? []).map(artist => String(artist.name ?? '')).filter(Boolean).join(' / ') || '未知歌手',
    artists: songArtists({ artists: song.ar ?? song.artists ?? [] }).map(({ id, name }) => ({ id, name })),
    album: String(album.name ?? ''),
    cover: String(album.picUrl ?? ''),
    playlistIds,
    languages: normalizeLanguages(song.language ?? song.languages ?? song.lang),
    duration: Number(song.dt ?? song.duration ?? 0),
    ...additions,
  };
}

function safeShareUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError('网易云分享链接无效。', 'INVALID_LINK', 400);
  }
  if (!shareHosts.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password || parsed.port || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError('分享链接跳转到了网易云白名单以外，已停止访问。', 'UNSAFE_LINK', 400);
  }
  parsed.protocol = 'https:';
  return parsed;
}

export function createNetEaseService({
  upstream,
  qrImage,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  batchSize = 200,
  batchDelayMs = 100,
  playlistPageSize = 1000,
  maxTracks = 20_000,
  syncTimeoutMs = 150_000,
  now = Date.now,
} = {}) {
  async function call(operation, parameters, session, acceptCodes = [200]) {
    let timer;
    const epoch = session.accountEpoch ?? 0;
    const cookieStore = session.cookie;
    const cookies = { ...cookieStore };
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if ((session.accountEpoch ?? 0) !== epoch || session.cookie !== cookieStore) throw accountChanged();
          return upstream[operation]({ ...parameters, cookie: cookies, timeout: timeoutMs });
        }),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            reject(new AppError('网易云响应超时，请稍后重试。', 'UPSTREAM_TIMEOUT', 504));
          }, timeoutMs + 2500);
        }),
      ]);
      const envelope = result.body ?? result;
      const body = operation === 'playlist_tracks' && envelope.body && typeof envelope.body === 'object' ? envelope.body : envelope;
      if ((session.accountEpoch ?? 0) !== epoch || session.cookie !== cookieStore) throw accountChanged();
      const code = Number(body.code ?? body.data?.code ?? result.status ?? 200);
      if (!acceptCodes.includes(code)) throw upstreamError(code);
      mergeCookies(session, result);
      return body;
    } catch (error) {
      if ((session.accountEpoch ?? 0) !== epoch || session.cookie !== cookieStore) throw accountChanged();
      if (error instanceof AppError) throw error;
      throw upstreamError(error?.body?.code ?? error?.status);
    } finally {
      clearTimeout(timer);
    }
  }

  function accountChanged() {
    return new AppError('当前账号已变化，已丢弃旧账号的返回结果。请刷新账号状态后重试。', 'ACCOUNT_CHANGED', 409);
  }

  function invalidateSession(session) {
    session.accountEpoch = (session.accountEpoch ?? 0) + 1;
    session.profile = null;
    session.qr = null;
    session.dailyCache = undefined;
    session.dailyPending = undefined;
    session.playlistCreations = undefined;
    session.likesInProgress = undefined;
  }

  function updateProfile(session, profile) {
    if (String(session.profile?.userId ?? '') !== String(profile?.userId ?? '')) invalidateSession(session);
    session.profile = profile;
  }

  async function status(session) {
    if (!Object.keys(session.cookie).length) {
      updateProfile(session, null);
      return { loggedIn: false, profile: null };
    }
    try {
      const body = await call('login_status', {}, session);
      updateProfile(session, profileFrom(body));
    } catch (error) {
      if (error.code !== 'AUTH_REQUIRED') throw error;
      updateProfile(session, null);
    }
    return { loggedIn: Boolean(session.profile), profile: session.profile };
  }

  async function requireLogin(session) {
    if (!session.profile?.userId) throw new AppError('请先用网易云扫码登录，才能读取「我喜欢的音乐」和私密歌单。', 'AUTH_REQUIRED', 401);
  }

  async function createQr(session) {
    const body = await call('login_qr_key', {}, session);
    const key = body.data?.unikey ?? body.unikey;
    if (typeof key !== 'string' || !/^[\w-]{8,160}$/.test(key)) throw new AppError('网易云没有返回有效二维码，请重新获取。');
    session.qr = { key, createdAt: now() };
    const url = `https://music.163.com/login?codekey=${encodeURIComponent(key)}`;
    const image = await qrImage(url);
    return { key, image, url };
  }

  async function checkQr(session, key) {
    if (!session.qr || key !== session.qr.key) throw new AppError('二维码不属于当前浏览器会话，请重新获取。', 'INVALID_QR', 400);
    if (now() - session.qr.createdAt > 5 * 60_000) return { code: 800, message: '二维码已过期，请重新获取。', loggedIn: false, profile: null };
    const body = await call('login_qr_check', { key }, session, [800, 801, 802, 803]);
    const code = Number(body.code);
    const messages = { 800: '二维码已过期，请重新获取。', 801: '等待网易云扫码。', 802: '已扫码，请在网易云中确认登录。', 803: '登录成功。' };
    if (code === 803) {
      const state = await status(session);
      if (!state.loggedIn) throw new AppError('已确认二维码，但没有取得本人登录会话，请重新扫码。', 'AUTH_REQUIRED', 401);
      session.qr = null;
    }
    return { code, message: messages[code], loggedIn: Boolean(session.profile), profile: session.profile };
  }

  async function playlists(session) {
    await requireLogin(session);
    const result = new Map();
    const deadline = now() + syncTimeoutMs;
    for (let page = 0; page < 100; page += 1) {
      if (now() >= deadline) throw new AppError('读取歌单列表超过本版时限，请稍后重试。', 'SYNC_TIMEOUT', 504);
      const body = await call('user_playlist', { uid: session.profile.userId, limit: playlistPageSize, offset: page * playlistPageSize }, session);
      if (!Array.isArray(body.playlist)) throw new AppError('网易云没有返回完整歌单列表，请重试。', 'INCOMPLETE_SYNC');
      let added = 0;
      for (const playlist of body.playlist) {
        const normalized = playlistFrom(playlist, session.profile.userId);
        if (!result.has(normalized.id)) added += 1;
        result.set(normalized.id, normalized);
      }
      const more = body.more === true || (body.more === undefined && body.playlist.length >= playlistPageSize);
      if (!more) return { playlists: [...result.values()] };
      if (!added) throw new AppError('网易云分页返回了重复或空数据，无法确认歌单是否完整。', 'INCOMPLETE_SYNC');
    }
    throw new AppError('歌单数量超过本版同步上限，已停止，原有数据不会被覆盖。', 'SYNC_LIMIT', 413);
  }

  async function resolvePlaylist(input, explicitId) {
    if (explicitId !== undefined && explicitId !== null && explicitId !== '') return identifier(explicitId);
    let parsed;
    try {
      parsed = parsePlaylistInput(input);
    } catch (error) {
      throw new AppError(error.message, 'INVALID_LINK', 400);
    }
    if (parsed.type === 'playlist') return identifier(parsed.id);
    let current = safeShareUrl(parsed.url);
    for (let redirect = 0; redirect < 5; redirect += 1) {
      let response;
      try {
        response = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mixtape-Local-Prototype/0.1' } });
      } catch {
        throw new AppError('网易云分享短链暂时无法打开，请改用歌单 ID 或完整链接。', 'LINK_UNAVAILABLE');
      }
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new AppError('短链没有返回可识别的歌单跳转，请粘贴完整歌单链接。', 'INVALID_LINK', 400);
      current = safeShareUrl(new URL(location, current).href);
      try {
        const destination = parsePlaylistInput(current.href);
        if (destination.type === 'playlist') return identifier(destination.id);
      } catch {
        if (!shareHosts.has(current.hostname)) throw new AppError('分享链接无效。', 'INVALID_LINK', 400);
      }
    }
    throw new AppError('网易云短链跳转次数过多，请使用完整歌单链接。', 'INVALID_LINK', 400);
  }

  async function syncPlaylist(session, { input, id } = {}) {
    const deadline = now() + syncTimeoutMs;
    const playlistId = await resolvePlaylist(input, id);
    const body = await call('playlist_detail', { id: playlistId, s: 0 }, session);
    const playlist = body.playlist;
    if (playlist && String(playlist.id) !== playlistId) throw new AppError('网易云返回的歌单 ID 与请求不符，已取消同步。', 'INCOMPLETE_SYNC');
    if (!playlist || !Array.isArray(playlist.trackIds) || !Number.isSafeInteger(playlist.trackCount) || playlist.trackCount < 0) {
      throw new AppError('网易云没有返回可核对的完整歌单，已保留原有本地数据。', 'INCOMPLETE_SYNC');
    }
    const ids = [...new Set(playlist.trackIds.map(track => identifier(track.id)))];
    if (ids.length < playlist.trackCount) throw new AppError(`网易云声明有 ${playlist.trackCount} 首，但仅返回 ${ids.length} 个有效歌曲 ID，无法确认歌单是否完整，已保留原有本地数据。`, 'INCOMPLETE_SYNC');
    if (ids.length > maxTracks) throw new AppError(`当前原型每个歌单最多同步 ${maxTracks} 首，已保留原有本地数据。`, 'SYNC_LIMIT', 413);
    const metadata = new Map();
    const cloudHints = new Map((Array.isArray(playlist.tracks) ? playlist.tracks : []).filter(song => [1, 2].includes(Number(song.t))).map(song => [String(song.id), song]));
    async function loadMetadata(requestedIds, allowCloudHints = false) {
      for (let offset = 0; offset < requestedIds.length; offset += batchSize) {
        if (now() >= deadline) throw new AppError('本次歌单同步超过本版时限，原有数据不会被覆盖。', 'SYNC_TIMEOUT', 504);
        const batch = requestedIds.slice(offset, offset + batchSize);
        const response = await call('song_detail', { ids: batch.join(',') }, session);
        if (!Array.isArray(response.songs)) throw new AppError('网易云歌曲详情返回不完整，已取消本次同步。', 'INCOMPLETE_SYNC');
        const requested = new Set(batch);
        for (const song of response.songs) {
          if (requested.has(String(song.id))) metadata.set(String(song.id), song);
        }
        for (const songId of batch) {
          if (!metadata.has(songId) && allowCloudHints && cloudHints.has(songId)) metadata.set(songId, cloudHints.get(songId));
          if (!metadata.has(songId)) throw new AppError('部分官方歌曲详情缺失，无法确认是否完整；原有歌单保持不变，请稍后重试。', 'INCOMPLETE_SYNC');
        }
        if (batchDelayMs > 0 && offset + batchSize < requestedIds.length) await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }
    for (const [songId, hint] of cloudHints) {
      if (Number(hint.t) === 1) metadata.set(songId, hint);
    }
    await loadMetadata(ids.filter(songId => !metadata.has(songId)), true);
    const skippedCloudIds = new Set();
    const matchedCloudIds = new Set();
    const references = [];
    for (const songId of ids) {
      const song = metadata.get(songId);
      if (Number(song.t) === 1) {
        skippedCloudIds.add(songId);
        continue;
      }
      if (Number(song.t) === 2) {
        const officialId = String(song.s_id ?? '');
        if (!/^[1-9]\d{0,19}$/.test(officialId) || officialId === songId) {
          skippedCloudIds.add(songId);
          continue;
        }
        references.push({ sourceId: songId, officialId, matched: true });
      } else references.push({ sourceId: songId, officialId: songId, matched: false });
    }
    const matchedDetails = [...new Set(references.filter(reference => reference.matched && !metadata.has(reference.officialId)).map(reference => reference.officialId))];
    await loadMetadata(matchedDetails);
    const officialIds = new Set();
    const sourceOrder = new Map(ids.map((songId, index) => [songId, index]));
    const sourceDates = new Map();
    for (const track of playlist.trackIds) {
      const value = Number(track.at);
      const addedAt = Number.isFinite(value) && value >= 1_000_000_000 ? value < 100_000_000_000 ? value * 1000 : value : null;
      if (addedAt) sourceDates.set(String(track.id), Math.max(sourceDates.get(String(track.id)) || 0, addedAt));
    }
    const officialAdditions = new Map();
    for (const reference of references) {
      const song = metadata.get(reference.officialId);
      if ([1, 2].includes(Number(song.t))) {
        skippedCloudIds.add(reference.sourceId);
        continue;
      }
      officialIds.add(reference.officialId);
      const previous = officialAdditions.get(reference.officialId);
      officialAdditions.set(reference.officialId, {
        addedAt: Math.max(previous?.addedAt || 0, sourceDates.get(reference.sourceId) || 0) || null,
        playlistOrder: Math.min(previous?.playlistOrder ?? Infinity, sourceOrder.get(reference.sourceId)),
      });
      if (reference.matched) matchedCloudIds.add(reference.sourceId);
    }
    const songs = [...officialIds].map(songId => {
      const song = metadata.get(songId);
      if (!song.name) throw new AppError('部分歌曲没有有效详情，已取消本次同步。', 'INCOMPLETE_SYNC');
      return songFrom(song, [playlistId], officialAdditions.get(songId));
    });
    const sync = {
      policy: 'official-catalog',
      sourceTrackCount: playlist.trackCount,
      returnedTrackCount: ids.length,
      syncedTrackCount: songs.length,
      skippedCloudCount: skippedCloudIds.size,
      matchedCloudCount: matchedCloudIds.size,
      duplicateCount: playlist.trackIds.length - ids.length + references.filter(reference => !skippedCloudIds.has(reference.sourceId)).length - songs.length,
    };
    const warnings = [];
    if (ids.length !== playlist.trackCount) warnings.push(`网易云标注 ${playlist.trackCount} 首，实际返回 ${ids.length} 个歌曲 ID；已按全部返回 ID 核对详情。`);
    if (sync.skippedCloudCount) warnings.push(`已跳过 ${sync.skippedCloudCount} 首未匹配官方曲库或无法确认官方版本的云盘歌曲。`);
    if (sync.matchedCloudCount) warnings.push(`${sync.matchedCloudCount} 首云盘歌曲已使用匹配的官方曲库版本。`);
    return {
      playlist: { ...playlistFrom(playlist, session.profile?.userId), sourceTrackCount: playlist.trackCount, trackCount: songs.length, skippedCloudCount: sync.skippedCloudCount, matchedCloudCount: sync.matchedCloudCount },
      songs, sync, warnings, complete: true, syncedAt: new Date(now()).toISOString(),
    };
  }

  function accountContext(session) {
    return { accountId: String(session.profile.userId), epoch: session.accountEpoch ?? 0 };
  }

  function assertAccount(session, context) {
    if (String(session.profile?.userId ?? '') !== context.accountId || (session.accountEpoch ?? 0) !== context.epoch) throw accountChanged();
  }

  function dailyDay() {
    return new Date(now() + 8 * 60 * 60_000).toISOString().slice(0, 10);
  }

  async function verifiedAccount(session) {
    await requireLogin(session);
    const expected = String(session.profile.userId);
    const verified = await status(session);
    if (!verified.loggedIn) throw new AppError('网易云登录已失效，请重新扫码后使用日推和红心。', 'AUTH_REQUIRED', 401);
    if (String(session.profile.userId) !== expected) throw accountChanged();
    return accountContext(session);
  }

  async function dailySongs(session, rawSongs, warnings) {
    const songs = new Map();
    const matched = new Set();
    const order = [];
    let skipped = 0;
    for (const song of rawSongs) {
      try {
        const songId = identifier(song?.id);
        if (Number(song.t) === 1) { skipped += 1; continue; }
        if (Number(song.t) === 2) {
          const officialId = identifier(song.s_id);
          if (officialId === songId) { skipped += 1; continue; }
          matched.add(officialId);
          order.push(officialId);
        } else if (typeof song.name === 'string' && song.name.trim()) {
          songs.set(songId, songFrom(song));
          order.push(songId);
        }
        else skipped += 1;
      } catch { skipped += 1; }
    }
    const matchedIds = [...matched].filter(songId => !songs.has(songId));
    for (let offset = 0; offset < matchedIds.length; offset += batchSize) {
      const batch = matchedIds.slice(offset, offset + batchSize);
      const response = await call('song_detail', { ids: batch.join(',') }, session);
      if (!Array.isArray(response.songs)) throw new AppError('日推中的云盘匹配版本详情不完整，未替换原有日推。', 'DAILY_INCOMPLETE');
      const requested = new Set(batch);
      for (const song of response.songs) {
        const songId = String(song.id);
        if (requested.has(songId) && ![1, 2].includes(Number(song.t)) && typeof song.name === 'string' && song.name.trim()) songs.set(songId, songFrom(song));
      }
      skipped += batch.filter(songId => !songs.has(songId)).length;
    }
    if (skipped) warnings.push(`已跳过 ${skipped} 首无法确认官方曲库版本或详情不完整的日推歌曲。`);
    return [...new Set(order)].filter(songId => songs.has(songId)).map(songId => songs.get(songId));
  }

  async function daily(session, { refresh = false } = {}) {
    if (typeof refresh !== 'boolean') throw new AppError('刷新参数必须为布尔值。', 'INVALID_DAILY', 400);
    const context = await verifiedAccount(session);
    const day = dailyDay();
    const cached = session.dailyCache;
    if (!refresh && cached?.accountId === context.accountId && cached.day === day) return { ...JSON.parse(JSON.stringify(cached.value)), cached: true };
    const pending = session.dailyPending;
    if (pending?.accountId === context.accountId && pending.day === day && pending.epoch === context.epoch) return pending.promise;
    const job = { ...context, day };
    job.promise = (async () => {
      const warnings = [];
      const body = await call('recommend_songs', { afresh: false, timestamp: now() }, session);
      const rawSongs = body.data?.dailySongs ?? body.recommend;
      if (!Array.isArray(rawSongs) || rawSongs.length > 500) throw new AppError('网易云没有返回可核对的日推歌曲，请稍后刷新。', 'DAILY_INCOMPLETE');
      const songs = await dailySongs(session, rawSongs, warnings);
      let playlists = [];
      try {
        const resources = await call('recommend_resource', { timestamp: now() }, session);
        if (!Array.isArray(resources.recommend) || resources.recommend.length > 200) throw new AppError('推荐歌单列表暂不可用。', 'DAILY_INCOMPLETE');
        const unique = new Map();
        for (const playlist of resources.recommend) {
          try {
            const normalized = playlistFrom({ ...playlist, coverImgUrl: playlist.coverImgUrl ?? playlist.picUrl }, context.accountId);
            unique.set(normalized.id, normalized);
          } catch { warnings.push('一张推荐歌单缺少有效 ID，已跳过。'); }
        }
        playlists = [...unique.values()];
      } catch (error) {
        if (['AUTH_REQUIRED', 'ACCOUNT_CHANGED'].includes(error.code)) throw error;
        warnings.push('日推歌曲已读取，但推荐歌单暂不可用；可以稍后刷新，不影响歌曲使用。');
      }
      assertAccount(session, context);
      if (dailyDay() !== day) throw new AppError('日期已经变化，请刷新读取新一天的日推。', 'DAILY_EXPIRED', 409);
      const result = { accountId: context.accountId, day, fetchedAt: now(), songs, playlists, cached: false, warnings };
      session.dailyCache = { accountId: context.accountId, day, value: JSON.parse(JSON.stringify(result)) };
      return result;
    })().finally(() => { if (session.dailyPending === job) session.dailyPending = undefined; });
    session.dailyPending = job;
    return job.promise;
  }

  async function readLikedIds(session, context) {
    const body = await call('likelist', { uid: context.accountId, timestamp: now() }, session);
    assertAccount(session, context);
    if (!Array.isArray(body.ids) || body.ids.length > 100_000) throw new AppError('网易云红心列表不完整，请稍后刷新。', 'LIKES_INCOMPLETE');
    try { return [...new Set(body.ids.map(value => identifier(value)))]; }
    catch { throw new AppError('网易云红心列表包含无法核验的歌曲 ID，请稍后刷新。', 'LIKES_INCOMPLETE'); }
  }

  async function likes(session) {
    const context = await verifiedAccount(session);
    return { accountId: context.accountId, ids: await readLikedIds(session, context) };
  }

  async function like(session, { id, liked, accountId } = {}) {
    const songId = identifier(id);
    if (typeof liked !== 'boolean') throw new AppError('红心操作必须明确指定喜欢或取消喜欢。', 'INVALID_LIKE', 400);
    await requireLogin(session);
    if (String(accountId ?? '') !== String(session.profile.userId)) throw accountChanged();
    const context = await verifiedAccount(session);
    if (String(accountId) !== context.accountId) throw accountChanged();
    session.likesInProgress ??= new Set();
    if (session.likesInProgress.has(songId)) throw new AppError('这首歌曲的红心操作正在确认，请稍等。', 'LIKE_IN_PROGRESS', 409);
    const writes = session.likesInProgress;
    writes.add(songId);
    try {
      try {
        await call('like', { id: songId, like: liked ? 'true' : 'false', timestamp: now() }, session);
      } catch (error) {
        if (error.code === 'ACCOUNT_CHANGED') throw error;
        throw new AppError('红心操作结果未确认，网易云可能已经更新。请刷新红心状态或到官方 App 检查，不会自动重试。', 'LIKE_UNCERTAIN');
      }
      let ids;
      try { ids = await readLikedIds(session, context); }
      catch (error) {
        if (error.code === 'ACCOUNT_CHANGED') throw error;
        throw new AppError('已提交红心操作，但暂时无法回读确认。请刷新红心状态或到官方 App 检查，不会自动重试。', 'LIKE_UNVERIFIED');
      }
      if (ids.includes(songId) !== liked) throw new AppError('网易云回读的红心状态尚未达到所选状态，请稍后刷新核对，不会自动重复操作。', 'LIKE_UNVERIFIED');
      return { accountId: context.accountId, id: songId, liked, verified: true };
    } finally { writes.delete(songId); }
  }

  async function preview(session, id, quality = 'exhigh') {
    const songId = identifier(id);
    if (!Object.hasOwn(qualityDefinitions, quality)) throw new AppError('请选择支持的音质档位。', 'INVALID_QUALITY', 400);
    const body = await call('song_url_v1', { id: songId, level: quality, crypto: 'eapi', unblock: 'false' }, session);
    const track = Array.isArray(body.data) ? body.data.find(item => String(item.id) === songId) : null;
    if (!track?.url || track.freeTrialInfo || Number(track.code ?? 200) !== 200) throw new AppError('当前账号没有这首歌曲的完整播放权限，或歌曲暂不可用。可在网易云官方 App 中查看。', 'PLAYBACK_UNAVAILABLE', 403);
    let url;
    try {
      url = new URL(track.url);
    } catch {
      throw new AppError('网易云没有返回有效播放地址。', 'PLAYBACK_UNAVAILABLE', 403);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !/(?:^|\.)(?:music\.126\.net|music\.163\.com)$/.test(url.hostname)) throw new AppError('网易云返回了无法识别的播放地址。', 'PLAYBACK_UNAVAILABLE', 403);
    url.protocol = 'https:';
    const bitrate = Number(track.br);
    const format = /^[a-z0-9]{1,12}$/i.test(String(track.type || '')) ? String(track.type).toLowerCase() : null;
    return { id: songId, url: url.href, expiresIn: Number(track.expi ?? 0), requestedQuality: quality, actualLevel: Object.hasOwn(qualityDefinitions, track.level) ? track.level : null, bitrate: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate) : null, format };
  }

  // 逐首读取网易云歌曲百科，得到曲风/推荐标签/BPM。只写「自动分类」字段，不碰用户手工分类。
  const classificationCache = new Map();
  async function classifySongs(session, { ids = [], limit = 200, delayMs = 320, refresh = false } = {}) {
    if (!Array.isArray(ids) || !ids.length) throw new AppError('请先选择要自动分类的歌曲。', 'INVALID_IDS', 400);
    if (ids.length > limit) throw new AppError(`单次最多自动分类 ${limit} 首，请分批进行。`, 'CLASSIFY_LIMIT', 413);
    const unique = [...new Set(ids.map(value => identifier(value)))];
    const items = [];
    const failedIds = [];
    let classified = 0;
    let empty = 0;
    let withStyle = 0;
    for (let index = 0; index < unique.length; index += 1) {
      const songId = unique[index];
      try {
        const cached = classificationCache.get(songId);
        const cacheHit = !refresh && cached && cached.expiresAt > now();
        let classification = cacheHit ? cached.value : classificationFromWiki(await call('song_wiki_info', { id: songId }, session));
        if (!cacheHit) {
          if (classificationCache.size >= 5000) classificationCache.delete(classificationCache.keys().next().value);
          classificationCache.set(songId, { value: classification, expiresAt: now() + (classification ? 30 : 7) * 86400000 });
        }
        if (!classification) {
          empty += 1;
          items.push({ id: songId, classified: false, reason: 'no-wiki' });
        } else {
          classified += 1;
          if (classification.confidence === 'style') withStyle += 1;
          items.push({ id: songId, classified: true, source: AUTO_SOURCE, at: new Date(now()).toISOString(), ...classification });
        }
      } catch (error) {
        if (error instanceof AppError && error.code === 'AUTH_REQUIRED') throw error;
        failedIds.push(songId);
        items.push({ id: songId, classified: false, reason: 'request-failed', detail: error?.code || String(error?.message || 'UPSTREAM_ERROR').slice(0, 60) });
      }
      if (delayMs > 0 && index + 1 < unique.length) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return {
      total: unique.length,
      classified,
      withStyle,
      empty,
      failed: failedIds.length,
      failedIds: failedIds.slice(0, 20),
      items,
      source: AUTO_SOURCE,
      finishedAt: new Date(now()).toISOString(),
    };
  }

  async function preparePlaylist(session, payload) {
    await requireLogin(session);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new AppError('歌单名称需为 1–40 个字符，不能包含换行或控制字符。', 'INVALID_NAME', 400);
    if (![0, 10].includes(payload.privacy)) throw new AppError('请选择仅自己可见或公开歌单。', 'INVALID_PRIVACY', 400);
    if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 5000) throw new AppError('请选择 1–5000 首真实网易云歌曲，示例不能保存到账号。', 'INVALID_TRACKS', 400);
    const ids = [...new Set(payload.ids.map(value => identifier(value)))];
    if (String(payload.accountId) !== session.profile.userId) throw new AppError('当前登录账号已变化，请刷新账号状态后再确认。', 'ACCOUNT_CHANGED', 409);
    session.playlistCreations ??= new Map();
    if (session.playlistCreations.size >= 20) throw new AppError('本次登录已准备过 20 次新建操作，请先在网易云查看已有歌单。', 'CREATE_LIMIT', 429);
    const requestId = globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : [...globalThis.crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    session.playlistCreations.set(requestId, { name, privacy: payload.privacy, ids, accountId: session.profile.userId });
    return { requestId, name, privacy: payload.privacy, count: ids.length };
  }

  async function writeNewPlaylist(session, job) {
    const verified = await status(session);
    if (!verified.loggedIn || session.profile.userId !== job.accountId) throw new AppError('登录已失效或账号已变化，未开始创建。请重新扫码后确认。', 'AUTH_REQUIRED', 401);
    const result = { status: 'uncertain', complete: false, orderConfirmed: false, requestedCount: job.ids.length, savedCount: null, playlist: null, url: null, warnings: [] };
    let playlistId;
    try {
      const created = await call('playlist_create', { name: job.name, privacy: job.privacy, type: 'NORMAL' }, session);
      playlistId = identifier(created.playlist?.id ?? created.id);
      result.playlist = { id: playlistId, name: job.name, private: job.privacy === 10 };
      result.url = `https://music.163.com/playlist?id=${playlistId}`;
    } catch {
      result.warnings.push('创建结果未确认，网易云可能已经建好了歌单。请先在官方 App 的“我创建的歌单”中检查，不要重复新建。本次请求不会自动重试创建。');
      return result;
    }
    const detail = async () => {
      const body = await call('playlist_detail', { id: playlistId, timestamp: now() }, session);
      const playlist = body.playlist;
      if (!playlist || String(playlist.creator?.userId ?? playlist.userId) !== job.accountId || Number(playlist.privacy) !== job.privacy) throw new AppError('无法核实新歌单的所有者或可见性，已停止写入。', 'CREATE_VERIFY_FAILED');
      return playlist;
    };
    try {
      await detail();
    } catch {
      result.status = 'unverified';
      result.warnings.push('已取得新歌单链接，但未核实所有者和可见性，尚未添加歌曲。请在网易云查看；不会修改其他歌单，也不会自动删除这张歌单。');
      return result;
    }
    const deadline = now() + syncTimeoutMs;
    for (let offset = 0; offset < job.ids.length; offset += batchSize) {
      if (now() >= deadline) { result.warnings.push('写入达到本版时限，已停止后续批次。'); break; }
      try {
        await call('playlist_tracks', { op: 'add', pid: playlistId, tracks: job.ids.slice(offset, offset + batchSize).join(',') }, session);
      } catch {
        result.warnings.push('部分批次未确认成功，已停止后续写入，以网易云回读结果为准。');
        break;
      }
      if (batchDelayMs > 0 && offset + batchSize < job.ids.length) await new Promise(resolve => setTimeout(resolve, batchDelayMs));
    }
    try {
      let playlist = await detail();
      const readIds = entry => Array.isArray(entry.trackIds) ? entry.trackIds.map(track => String(track.id)) : null;
      let actual = readIds(playlist);
      if (!actual || Number(playlist.trackCount) > new Set(actual).size) throw new AppError('歌单回读不完整。', 'CREATE_VERIFY_FAILED');
      const requested = new Set(job.ids);
      result.savedCount = new Set(actual.filter(id => requested.has(id))).size;
      result.complete = result.savedCount === job.ids.length && actual.length === job.ids.length;
      if (result.complete && !actual.every((id, index) => id === job.ids[index])) {
        try {
          await call('song_order_update', { pid: playlistId, ids: JSON.stringify(job.ids) }, session);
        } catch {
          result.warnings.push('调整顺序的请求未确认成功，将重新回读；请在官方 App 中查看排列顺序。');
        }
        playlist = await detail();
        actual = readIds(playlist);
        if (!actual || Number(playlist.trackCount) > new Set(actual).size) throw new AppError('排序回读不完整。', 'CREATE_VERIFY_FAILED');
        result.savedCount = new Set(actual.filter(id => requested.has(id))).size;
        result.complete = result.savedCount === job.ids.length && actual.length === job.ids.length;
      }
      result.orderConfirmed = Boolean(result.complete && actual?.every((id, index) => id === job.ids[index]));
      if (result.complete && !result.orderConfirmed) result.warnings.push('歌曲已全部回读确认，但排列顺序与本次队列不同，请在网易云中核对后顺序播放。');
      result.status = result.complete ? 'complete' : 'partial';
      if (!result.complete) result.warnings.push(`回读确认 ${result.savedCount} / ${job.ids.length} 首，请打开歌单核对。不会把部分成功说成全部保存，也不会自动重建或删除。`);
    } catch {
      result.status = 'unverified';
      result.complete = false;
      result.savedCount = null;
      result.orderConfirmed = false;
      result.warnings.push('已尝试写入，但未能完整回读，无法确认实际保存首数。请打开此链接核对；再次检查本次结果不会重新创建。');
    }
    return result;
  }

  async function createPlaylist(session, { requestId }) {
    const job = session.playlistCreations?.get(requestId);
    if (!job) throw new AppError('本次创建凭据已失效（服务重启或登录会话变化）。结果可能已存在，请先在网易云查看，不要直接重复新建。', 'CREATE_TICKET_EXPIRED', 409);
    if (job.promise) return job.promise;
    if (session.creationInProgress) throw new AppError('正在创建另一张歌单，请等待它完成。', 'CREATE_IN_PROGRESS', 409);
    session.creationInProgress = true;
    job.promise = writeNewPlaylist(session, job).finally(() => { session.creationInProgress = false; });
    return job.promise;
  }

  async function lyrics(session, id) {
    const songId = identifier(id);
    const body = await call('lyric', { id: songId, crypto: 'eapi' }, session);
    return { id: songId, ...normalizeLyrics(body) };
  }

  async function searchSongs(session, { keywords }) {
    if (typeof keywords !== 'string' || !keywords.trim() || keywords.length > 100 || /[\u0000-\u001f\u007f]/u.test(keywords)) throw new AppError('搜索关键词应为 1–100 字。', 'INVALID_QUERY', 400);
    const body = await call('cloudsearch', { keywords: keywords.trim(), type: 1, limit: 20, offset: 0 }, session);
    const songs = (body.result?.songs || []).filter(song => /^[1-9]\d{0,17}$/u.test(String(song.id))).slice(0, 20).map(song => songFrom(song));
    return { songs };
  }

  return { status, createQr, checkQr, playlists, syncPlaylist, daily, likes, like, invalidateSession, preview, lyrics, searchSongs, classifySongs, preparePlaylist, createPlaylist };
}

