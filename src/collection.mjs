import { isPlayableSongId } from './song-id.mjs';

export const dailyCollectionId = 'local-daily-favorites';

export function isRemoteSource(source) {
  return !source.demo && !source.local && /^[1-9]\d{0,19}$/.test(String(source.id));
}

export function collectedSongIds(sources) {
  return new Set((sources.find(source => source.id === dailyCollectionId)?.songs || []).map(song => String(song.id)));
}

export function collectRecommendation(sources, song, collected = true, now = Date.now()) {
  const id = String(song?.id || '');
  if (!isPlayableSongId(id) || song.demo || !song.title) throw new Error('只能收藏有明确来源的本地或平台歌曲。');
  const previous = sources.find(source => source.id === dailyCollectionId);
  const existing = previous?.songs || [];
  if (collected && existing.some(entry => String(entry.id) === id)) return sources;
  const remaining = existing.filter(entry => String(entry.id) !== id);
  const next = collected ? [{ id, title: String(song.title).slice(0, 300), artist: String(song.artist || '').slice(0, 300), album: String(song.album || '').slice(0, 300), cover: String(song.cover || '').slice(0, 1000), duration: Number(song.duration) || 0, collectedAt: now, observedAddedAt: now, addedAt: null }, ...remaining] : remaining;
  if (next.length > 5000) throw new Error('本机收藏已达 5000 首，请先整理后再收藏。');
  const source = { id: dailyCollectionId, name: '我的收藏', local: true, origin: 'daily', provider: 'netease', owned: true, owner: { nickname: '仅此设备' }, songs: next, trackCount: next.length, syncedAt: new Date(now).toISOString() };
  return sources.filter(entry => entry.id !== dailyCollectionId).concat(source);
}
