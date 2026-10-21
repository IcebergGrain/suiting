import { isPlayableSongId } from './song-id.mjs';

export function normalizeBlacklist(value = {}) {
  const result = Object.create(null);
  const entries = Array.isArray(value) ? value.map(entry => [String(entry?.id ?? entry), entry]) : Object.entries(value && typeof value === 'object' ? value : {});
  for (const [key, entry] of entries.slice(0, 30000)) {
    if (!/^[\w-]{1,80}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    result[key] = { id: key, title: String(entry?.title || '已拉黑歌曲').slice(0, 300), artist: String(entry?.artist || '').slice(0, 300), cover: String(entry?.cover || '').slice(0, 1000), blockedAt: Number(entry?.blockedAt) || 0 };
  }
  return result;
}

export function applyBlacklist(songs, blacklist = {}, artists = {}) {
  const artistBlocked = artistBlacklistMatcher(artists);
  return songs.map(song => ({ ...song, blocked: Boolean(song.blocked || Object.hasOwn(blacklist, String(song.id)) || artistBlocked(song)) }));
}

export function playableSongs(songs, blockedIds = [], blockedArtists = {}) {
  const blocked = new Set(blockedIds.map(String));
  const artistBlocked = artistBlacklistMatcher(blockedArtists);
  const seen = new Set();
  return songs.filter(song => {
    const id = String(song.id);
    if (song.demo || song.blocked || song.excluded || song.localExcluded || blocked.has(id) || artistBlocked(song) || seen.has(id) || !isPlayableSongId(id)) return false;
    seen.add(id); return true;
  }).slice(0, 5000);
}

const artistNameKey = name => String(name || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

export function songArtists(song = {}) {
  const supplied = Array.isArray(song.artists) ? song.artists : Array.isArray(song.ar) ? song.ar : [];
  const entries = supplied.length ? supplied : String(song.artist || '').split(/\s+\/\s+|、/u);
  const result = new Map();
  for (const entry of entries.slice(0, 100)) {
    const name = String(typeof entry === 'string' ? entry : entry?.name || '').trim().slice(0, 300);
    if (!name || artistNameKey(name) === '未知歌手') continue;
    const rawId = String(typeof entry === 'object' && entry ? entry.id || '' : '');
    const id = /^[1-9]\d{0,17}$/.test(rawId) ? rawId : '';
    const key = id ? `id:${id}` : `name:${artistNameKey(name)}`;
    if (!result.has(key)) result.set(key, { id, name, key });
  }
  return [...result.values()];
}

export function normalizeArtistBlacklist(value = {}) {
  const result = Object.create(null);
  const entries = Array.isArray(value) ? value : Object.values(value && typeof value === 'object' ? value : {});
  for (const entry of entries.slice(0, 10000)) {
    const artist = songArtists({ artists: [entry] })[0];
    if (artist) result[artist.key] = { ...artist, blockedAt: Math.max(0, Number(entry?.blockedAt) || 0) };
  }
  return result;
}

export function artistBlacklistMatcher(value = {}) {
  const entries = Object.values(normalizeArtistBlacklist(value));
  const ids = new Map(entries.filter(entry => entry.id).map(entry => [entry.id, entry]));
  const names = new Map(entries.map(entry => [artistNameKey(entry.name), entry]));
  const fallback = new Map(entries.filter(entry => !entry.id).map(entry => [artistNameKey(entry.name), entry]));
  return song => {
    for (const artist of songArtists(song)) {
      const matched = artist.id ? ids.get(artist.id) || fallback.get(artistNameKey(artist.name)) : names.get(artistNameKey(artist.name));
      if (matched) return matched;
    }
    return null;
  };
}

export function songIsBlocked(song, blacklist = {}, artists = {}) {
  return Boolean(song && (song.blocked || Object.hasOwn(blacklist, String(song.id)) || artistBlacklistMatcher(artists)(song)));
}
