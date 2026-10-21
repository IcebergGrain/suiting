import { isPlayableSongId } from '../src/song-id.mjs';
import { normalizePlaybackPreferences, shuffledPlaybackIds } from '../src/playback.mjs';
import { playableSongs, songArtists } from '../src/library.mjs';

export function createQueuePlayer({ audio, loadTrack, preferences, getBlockedArtists = () => null, onChange = () => {}, onTick = () => {}, onHeard = () => {}, now = Date.now, random = Math.random }) {
  const settings = normalizePlaybackPreferences(preferences);
  const state = { song: null, queueId: '', index: -1, count: 0, paused: true, loading: false, ended: false, currentTime: 0, duration: 0, error: '', info: null, ...settings };
  let queue = [];
  let shuffleOrder = [];
  let blockedIds = [];
  let blockedArtists = {};
  let generation = 0;
  let heardSeconds = 0;
  let recorded = false;
  let lastPosition = 0;
  let lastClock = now();
  audio.volume = settings.volume;
  const changed = () => onChange({ ...state });
  const shuffledIndex = direction => {
    if (!queue.length) return -1;
    if (!shuffleOrder.includes(state.song?.id)) shuffleOrder = shuffledPlaybackIds(queue.map(song => song.id), state.song?.id, random);
    const position = shuffleOrder.indexOf(state.song?.id);
    const nextId = shuffleOrder[(position + direction + shuffleOrder.length) % shuffleOrder.length];
    return queue.findIndex(song => song.id === nextId);
  };
  const resetClock = () => { lastClock = now(); lastPosition = audio.currentTime || 0; };
  const sample = () => {
    const position = audio.currentTime || 0;
    const clock = now();
    if (!audio.paused && !audio.seeking && !state.loading && !recorded) {
      heardSeconds += Math.max(0, Math.min(position - lastPosition, (clock - lastClock) / 1000, 2));
      if (heardSeconds >= 15 && state.song) { recorded = true; onHeard({ songId: state.song.id, playedAt: clock, source: 'web-player' }); }
    }
    lastPosition = position; lastClock = clock;
    state.currentTime = position;
    state.duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    onTick({ ...state });
  };
  async function open(index, position = 0, resume = true, preserveHeard = false) {
    if (index < 0 || index >= queue.length) return;
    const token = ++generation;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    Object.assign(state, { song: queue[index], index, count: queue.length, paused: !resume, loading: true, ended: false, currentTime: position, duration: 0, error: '', info: null });
    if (!preserveHeard) { heardSeconds = 0; recorded = false; }
    resetClock(); changed();
    try {
      const info = await loadTrack(state.song.id, state.quality);
      if (token !== generation) return;
      if (!info?.url) throw new Error('没有可播放音频，请在网易云检查账号授权。');
      state.info = { requestedQuality: info.requestedQuality, actualLevel: info.actualLevel, bitrate: info.bitrate, format: info.format };
      audio.src = info.url;
      const seekLoaded = () => { if (token === generation && position > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(position, audio.duration); };
      audio.addEventListener('loadedmetadata', seekLoaded, { once: true });
      audio.load();
      if (resume && !state.paused) await audio.play();
      if (token !== generation) return;
      state.loading = false; resetClock(); changed();
    } catch (error) {
      if (token !== generation) return;
      audio.pause(); state.loading = false; state.paused = true; state.error = error.message || '音频加载失败，请重试或切下一首。'; changed();
    }
  }
  audio.addEventListener('timeupdate', sample);
  audio.addEventListener('durationchange', sample);
  audio.addEventListener('seeking', resetClock);
  audio.addEventListener('seeked', resetClock);
  audio.addEventListener('pause', () => { if (!state.loading) state.paused = true; resetClock(); changed(); });
  audio.addEventListener('playing', () => { state.paused = false; state.loading = false; resetClock(); changed(); });
  audio.addEventListener('waiting', () => { state.loading = true; resetClock(); changed(); });
  audio.addEventListener('ended', () => {
    sample();
    if (state.mode === 'shuffle') open(shuffledIndex(1));
    else if (state.mode === 'single') open(state.index);
    else if (state.index + 1 < queue.length) open(state.index + 1);
    else if (state.mode === 'loop' && queue.length) open(0);
    else { state.paused = true; state.ended = true; changed(); }
  });
  audio.addEventListener('error', () => {
    if (!state.song || !audio.getAttribute('src')) return;
    state.loading = false; state.paused = true; state.error = '音频加载或解码失败，请重试、切下一首或在网易云打开。'; changed();
  });
  const controller = {
    snapshot: () => ({ ...state, canNext: queue.length > 0 && (state.mode === 'shuffle' || state.mode === 'loop' || state.index + 1 < queue.length) }),
    start: async (songs, index, { autoplay = true, queueId = '' } = {}) => {
      const requested = songs[index]?.id;
      const valid = playableSongs(songs, blockedIds, getBlockedArtists() || blockedArtists);
      const selected = index === undefined ? 0 : valid.findIndex(song => song.id === requested);
      if (selected < 0 || !valid.length) return false;
      queue = valid.map(song => ({ id: String(song.id), title: song.title, artist: song.artist, cover: song.cover, ...(song.artists?.length ? { artists: songArtists(song) } : {}) }));
      shuffleOrder = shuffledPlaybackIds(queue.map(song => song.id), queue[selected].id, random);
      state.queueId = String(queueId);
      await open(selected, 0, autoplay);
      return true;
    },
    play: async () => {
      if (!state.song) return;
      if (state.error) return open(state.index, state.currentTime, true, true);
      state.paused = false;
      if (state.loading && !audio.getAttribute('src')) { changed(); return; }
      if (state.ended) { audio.currentTime = 0; state.ended = false; heardSeconds = 0; recorded = false; }
      try { await audio.play(); } catch (error) { state.paused = true; state.error = error.message; changed(); }
    },
    pause: async () => { state.paused = true; audio.pause(); changed(); },
    next: () => open(state.mode === 'shuffle' ? shuffledIndex(1) : state.index + 1 < queue.length ? state.index + 1 : state.mode === 'loop' ? 0 : queue.length),
    previous: () => state.mode === 'shuffle' ? open(shuffledIndex(-1)) : state.index > 0 ? open(state.index - 1) : state.mode === 'loop' && queue.length ? open(queue.length - 1) : (audio.currentTime = 0),
    setMode: async mode => { const normalized = normalizePlaybackPreferences({ mode }).mode; if (normalized === 'shuffle' && state.mode !== 'shuffle') shuffleOrder = shuffledPlaybackIds(queue.map(song => song.id), state.song?.id, random); state.mode = normalized; changed(); },
    syncBlacklist: async ids => {
      blockedIds = ids.map(String);
      if (!queue.length) return;
      const current = state.song?.id;
      const previousIndex = state.index;
      const remaining = playableSongs(queue, blockedIds, getBlockedArtists() || blockedArtists);
      if (remaining.length === queue.length) return;
      queue = remaining;
      shuffleOrder = shuffleOrder.filter(id => remaining.some(song => song.id === id));
      if (!remaining.length) return controller.stop();
      const nextIndex = queue.findIndex(song => song.id === current);
      if (nextIndex >= 0) { state.index = nextIndex; state.count = queue.length; changed(); }
      else await open(Math.min(previousIndex, queue.length - 1), 0, !state.paused);
    },
    syncArtistBlacklist: async artists => { blockedArtists = artists; await controller.syncBlacklist(blockedIds); return true; },
    seek: async seconds => { if (state.duration > 0 && Number.isFinite(seconds)) { audio.currentTime = Math.max(0, Math.min(state.duration, seconds)); resetClock(); sample(); } },
    setQuality: async quality => { const normalized = normalizePlaybackPreferences({ quality }).quality; if (normalized === state.quality) return; state.quality = normalized; if (state.song) await open(state.index, state.currentTime, !state.paused, true); else changed(); },
    setVolume: async volume => { state.volume = normalizePlaybackPreferences({ volume }).volume; audio.volume = state.volume; onTick({ ...state }); },
    stop: async () => { ++generation; audio.pause(); audio.removeAttribute('src'); audio.load(); queue = []; shuffleOrder = []; Object.assign(state, { song: null, queueId: '', index: -1, count: 0, paused: true, loading: false, ended: false, currentTime: 0, duration: 0, error: '', info: null }); changed(); return true; },
  };
  return controller;
}

export function createNativeQueuePlayer({ request, preferences, getBlockedIds = () => [], getBlockedArtists = () => ({}), onRestoreBlacklist = () => {}, onRestoreArtistBlacklist = () => {}, onChange = () => {}, onTick = () => {}, onHeard = () => false, onLikesChanged = () => {} }) {
  let state = { song: null, queueId: '', index: -1, count: 0, paused: true, loading: false, ended: false, currentTime: 0, duration: 0, error: '', info: null, ...normalizePlaybackPreferences(preferences) };
  let revision = 0;
  let polling = false;
  let pendingCommands = 0;
  let eventTail = Promise.resolve();
  function accept(result) {
    const likesChanged = Number.isSafeInteger(state.likesVersion) && Number.isSafeInteger(result.likesVersion) && state.likesVersion !== result.likesVersion;
    const changed = JSON.stringify([state.song, state.queueId, state.index, state.count, state.paused, state.loading, state.ended, state.error, state.info, state.quality, state.mode, state.overlay?.enabled, state.overlay?.permission]) !== JSON.stringify([result.song, result.queueId, result.index, result.count, result.paused, result.loading, result.ended, result.error, result.info, result.quality, result.mode ?? state.mode, result.overlay?.enabled, result.overlay?.permission]);
    const { heard, ...safe } = result;
    state = { ...state, ...safe, mode: safe.mode ?? state.mode };
    if (changed) onChange({ ...state }); else onTick({ ...state });
    if (likesChanged) onLikesChanged();
    if (heard?.length) eventTail = eventTail.catch(() => {}).then(async () => {
      if (await onHeard(heard)) await request('player_ack', { ids: heard.map(event => event.eventId) });
    }).catch(() => {});
  }
  async function command(operation, parameters = {}) {
    const token = ++revision;
    pendingCommands++;
    try { const result = await request(operation, parameters); if (token !== revision) return false; accept(result); return true; }
    catch (error) { if (token === revision) { state.error = error.message; onChange({ ...state }); } return false; }
    finally { pendingCommands--; }
  }
  async function refresh() {
    if (polling || pendingCommands) return;
    polling = true;
    const token = revision;
    try { const result = await request('player_status'); if (token === revision) accept(result); }
    catch { }
    finally { polling = false; }
  }
  const controller = {
    snapshot: () => ({ ...state }), refresh,
    start: async (songs, index, { autoplay = true, queueId = '' } = {}) => {
      const requested = songs[index]?.id;
      const queue = playableSongs(songs, getBlockedIds(), getBlockedArtists()).map(song => ({ id: String(song.id), title: String(song.title || '').slice(0, 300), artist: String(song.artist || '').slice(0, 300), cover: String(song.cover || '').slice(0, 1000), ...(song.artists?.length ? { artists: songArtists(song) } : {}) }));
      const selected = index === undefined ? 0 : queue.findIndex(song => song.id === requested);
      if (selected >= 0 && queue.length) return command('player_queue', { queue, index: selected, quality: state.quality, autoplay, queueId });
      return false;
    },
    play: () => command('player_play'), pause: () => command('player_pause'),
    next: () => command('player_next'), previous: () => command('player_previous'),
    seek: seconds => command('player_seek', { seconds }),
    setQuality: quality => command('player_quality', { quality }),
    setVolume: volume => command('player_volume', { volume }),
    setMode: mode => command('player_mode', { mode }),
    syncBlacklist: ids => command('player_blocklist', { ids: ids.filter(isPlayableSongId) }),
    syncArtistBlacklist: artists => command('player_artist_blocklist', { artists: Object.values(artists) }),
    stop: () => command('player_stop'),
    clearHistory: async () => { await eventTail; await command('player_clear_history'); },
    initialize: async () => {
      const result = await request('player_status'); accept(result);
      const stored = await request('player_blocked');
      await onRestoreBlacklist(stored.ids || []);
      const artistRules = await request('player_blocked_artists');
      await onRestoreArtistBlacklist(artistRules.artists || []);
      await controller.syncArtistBlacklist(getBlockedArtists());
      await controller.syncBlacklist(getBlockedIds());
      if (!result.count) { await command('player_quality', { quality: normalizePlaybackPreferences(preferences).quality }); await command('player_volume', { volume: normalizePlaybackPreferences(preferences).volume }); await controller.setMode(normalizePlaybackPreferences(preferences).mode); }
    },
  };
  return controller;
}
