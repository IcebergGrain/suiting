import { playableSongs, songArtists } from './library.mjs';

export function normalizePlayingQueue(songs, blockedIds = [], blockedArtists = {}) {
  return playableSongs(Array.isArray(songs) ? songs.filter(song => song && typeof song === 'object') : [], blockedIds, blockedArtists).slice(0, 5000).map(song => ({
    id: String(song.id), title: String(song.title || '').slice(0, 300), artist: String(song.artist || '').slice(0, 300), cover: String(song.cover || '').slice(0, 1000),
    ...(Array.isArray(song.artists) && song.artists.length ? { artists: songArtists(song) } : {}),
  }));
}

export function createListeningSession({ player, getBlockedIds = () => [], getBlockedArtists = () => ({}), onQueue = () => {}, newId = () => globalThis.crypto.randomUUID() }) {
  let revision = 0;
  return {
    async start(songs, index, { queueId = '', autoplay = true } = {}) {
      const queue = normalizePlayingQueue(songs, getBlockedIds(), getBlockedArtists());
      const selected = index === undefined ? 0 : queue.findIndex(song => song.id === String(songs[index]?.id));
      if (!queue.length || selected < 0) return false;
      const token = ++revision;
      const id = queueId || `listening-${newId()}`;
      const accepted = await player.start(queue, selected, { queueId: id, autoplay });
      const view = player.snapshot();
      if (token !== revision || accepted === false || view.queueId !== id || view.count !== queue.length) return false;
      onQueue({ id, songs: queue });
      return true;
    },
    async stop() {
      const token = ++revision;
      const stopped = await player.stop();
      if (token !== revision || stopped === false) return false;
      onQueue({ id: '', songs: [] });
      return true;
    },
  };
}
