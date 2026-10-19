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

export function applyBlacklist(songs, blacklist = {}) {
  return songs.map(song => ({ ...song, blocked: Boolean(song.blocked || Object.hasOwn(blacklist, String(song.id))) }));
}

export function playableSongs(songs, blockedIds = []) {
  const blocked = new Set(blockedIds.map(String));
  const seen = new Set();
  return songs.filter(song => {
    const id = String(song.id);
    if (song.demo || song.blocked || song.excluded || song.localExcluded || blocked.has(id) || seen.has(id) || !isPlayableSongId(id)) return false;
    seen.add(id); return true;
  }).slice(0, 5000);
}
