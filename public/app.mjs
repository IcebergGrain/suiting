import { createExtensionHost } from '/src/extension-host.mjs';
import { normalizeFeatures, canUseSong } from '/src/features.mjs';
import { isLocalSongId, isPlayableSongId } from '/src/song-id.mjs';
import { mergeLocalLibrary, parseLocalLyrics } from '/src/local-library.mjs';
import { normalizeLyrics } from '/src/lyrics.mjs';
import { createLocalFiles } from './local-files.mjs';
import { renderLocalImport, renderFeatureSettings, renderListeningWelcome } from './public-view.mjs';
import { easterSearchTrigger } from '/src/easter.mjs';
import { createEasterEggs } from './easter-eggs.mjs';
import { generateQueue, mergePlaylistSnapshot, getRecentSongs, getClassificationCoverage, getTagCatalog, parseTags, normalizeQueueOptions, moodDefinitions, genreDefinitions, songMoods, songGenres, isExcludedByOptions } from '/src/shuffle.mjs';
import { songLanguages, languageDefinitions, languageFilterDefinitions, languageMatches, normalizeLanguages, needsLanguageLookup } from '/src/languages.mjs';
import { renderLanguageControls, renderLanguageEditor } from './language-view.mjs';
import { renderListeningFilters, renderTrackExplanation } from './listening-view.mjs';
import { renderSyncPage } from './sync-view.mjs';
import { demoPlaylist, demoSongs } from './demo.mjs';
import { qualityDefinitions, playbackModes, normalizePlaybackPreferences, formatTime, qualityDescription } from '/src/playback.mjs';
import { activeLyricIndex } from '/src/lyrics.mjs';
import { normalizeBlacklist, applyBlacklist, songArtists, normalizeArtistBlacklist, artistBlacklistMatcher } from '/src/library.mjs';
import { classificationNeedsUpdate, applyAutoClassification, AUTO_VERSION } from '/src/classify.mjs';
import { dailyCollectionId, isRemoteSource, collectedSongIds, collectRecommendation } from '/src/collection.mjs';
import { renderDaily, renderPersonal } from './day-personal.mjs';
import { matchesSearch, createSearchInput } from '/src/search.mjs';
import { normalizeAppearance, resolvedAppearance } from '/src/appearance.mjs';
import { builtinPlugins, normalizePlugin, restorePlugins, applyQueuePlugins, applyQueueProviders } from '/src/plugins.mjs';
import { normalizeAvatar } from '/src/avatar.mjs';
import { readAvatar } from './avatar-upload.mjs';
import { renderOverlaySettings } from './overlay-view.mjs';
import { renderCustomization } from './extensions-view.mjs';
import { queueProviders } from './plugins/registry.mjs';
import { renderLyricsPanel, lyricFollowPresentation } from './lyrics-view.mjs';
import { loadGeneratedQueue } from '/src/queue-session.mjs';
import { createQueuePlayer, createNativeQueuePlayer } from './queue-player.mjs';
import { createListeningSession, normalizePlayingQueue } from '/src/listening-session.mjs';
import { renderMiniPlayer, renderPlayingQueue, renderCompactEmpty } from './compact-player-view.mjs';
import { renderExclusions, renderArtistActions } from './exclusions-view.mjs';
import { createLikeStore, createLikesController, effectiveLike } from '/src/likes-journal.mjs';
const mobileRuntime = window.SuiTingMobileRuntime || null;

const localFiles = mobileRuntime ? null : createLocalFiles();
const storageKey = 'suiting.public.library.v1';
const moodNames = { all: '不限氛围', ...Object.fromEntries(Object.entries(moodDefinitions).map(([key, value]) => [key, value.name])) };
const moodColors = { all: '#66836c', ...Object.fromEntries(Object.entries(moodDefinitions).map(([key, value]) => [key, value.color])) };
const countPresets = [10, 20, 30, 50, 100, 200, 500, 1000];
const root = document.querySelector('#app');
const surface = document.querySelector('#experience');
const audio = document.querySelector('#audio');
const saved = loadSaved();
const state = {
  guideSeen: saved.guideSeen === true, guideOpen: saved.guideSeen !== true, playerExpanded: false, playerTab: 'now', playingQueueVisible: 60,
  activeQueue: normalizePlayingQueue(saved.activeQueue), activeQueueId: typeof saved.activeQueueId === 'string' ? saved.activeQueueId : '',
  localAvatar: normalizeAvatar(saved.localAvatar), avatarBusy: false, avatarError: '', appearance: normalizeAppearance(saved.appearance), plugins: restorePlugins(saved.plugins), enabledPlugins: Array.isArray(saved.enabledPlugins) ? saved.enabledPlugins.filter(id => typeof id === 'string') : [], providerConsents: saved.providerConsents || {}, nativeDevice: null,
  features: { ...normalizeFeatures(saved.features), netease:false }, lyricImportId: '', tab: 'workspace', sources: saved.sources || [], references: saved.references || [], edits: saved.edits || {}, history: saved.history || [],
  options: normalizeQueueOptions(saved.options),
  playback: normalizePlaybackPreferences(saved.playback),
  blacklist: normalizeBlacklist(saved.blacklist), artistBlacklist: normalizeArtistBlacklist(saved.artistBlacklist), exclusionsOpen: false, libraryCategory: 'recent', libraryPlaylist: null, libraryVisits: saved.libraryVisits || {}, remoteOpen: saved.remoteOpen || { own: true, saved: false },
  profileSection: 'home', profileSearch: '', profileVisible: 60, overlayOpen: false, overlay: null, overlayError: '', overlayBusy: false,
  daily: null, dailyLoading: false, dailyError: '', dailySection: 'songs', dailyVisible: 60,
  likes: { accountId: '', ids: [], loaded: false }, likesLoading: false, likesError: '', likePending: {}, likeJournal: null, likeSyncBusy: false,
  exportScope: saved.exportScope === 'collection' ? 'collection' : 'queue',
  advancedOpen: false, filtersOpen: false, lyricsOpen: true, lyrics: { id: null, status: 'idle', lines: [], plain: [] }, classifyPaused: Boolean(saved.classifyPaused), undoBlacklist: null,
  selectionReport: saved.selectionReport || null, queueSettings: saved.queueSettings || null,
  queueBatchId: typeof saved.queueBatchId === 'string' ? saved.queueBatchId : '', queueLoading: false, queueLoadError: '', lyricFollow: saved.lyricFollow !== false,
  queue: saved.queue || [], warnings: saved.options?.classificationPolicy === 3 ? saved.warnings || [] : [], eligibleCount: saved.eligibleCount || 0, autoSync: saved.autoSync || false,
  busy: false, busyText: '', error: '', unsaved: false, status: { loggedIn: false }, remote: [], qr: null,
  qrMessage: '', search: '', editingId: null, visibleCount: 60, queueVisible: 60, playingId: null, lastSync: saved.lastSync || null,
  scopeImportOpen: false, recentOpen: false, referenceOpen: false, playerOpen: false, exportOpen: Boolean(saved.exportJob), classifyOpen: false, classifyProgress: null,
  exportDraft: { name: '随听 · 本次随机', privacy: 10 }, exportJob: saved.exportJob || null, exportResult: saved.exportResult || null
};
state.enabledPlugins = state.enabledPlugins.filter(id => {
  const provider = queueProviders.find(item => item.id === id);
  return provider ? state.providerConsents[id] === providerConsentKey(provider) : [...builtinPlugins, ...state.plugins].some(plugin => plugin.id === id);
});
const sourceHost=createExtensionHost({
  isEnabled:id=>id==='suiting.local' || id==='suiting.netease' && state.features.netease,
  plugins:[
    {id:'suiting.local',name:'本地音乐',kind:'source',network:false,methods:{request:({path,options})=>sourceApi(path,options)}},
    {id:'suiting.netease',name:'网易云连接',kind:'source',network:true,methods:{request:({path,options})=>sourceApi(path,options)}},
  ],
});
let systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let renderPending = false;
const searchInputs = Object.fromEntries([['search', 'search'], ['profile-search', 'profileSearch']].map(([id, key]) => [id, createSearchInput({
  update: value => { state[key] = value; state.visibleCount = 60; state.profileVisible = 60; },
  render: () => renderSearchResults(id),
})]));
let qrTimer;
let toastTimer;
let undoTimer;
let accountEpoch = 0;
let likesRevision = 0;
let nativeLikesDirty = false;
let lastVisibilitySync = 0;
let draggingProgress = false;
let classifyEpoch = 0;
let languageEpoch = 0;
state.languageProgress = null; state.languagePickerOpen = false;
const classificationQueue = new Set();
const lyricCache = new Map();
let queueGeneration = 0;
let queueLoadRevision = 0;
const likesController = createLikesController({
  store: createLikeStore({ storage: localStorage, request: mobileRuntime?.requestNative }), api,
  account: () => state.features.netease && state.status.loggedIn ? state.status.profile?.userId : '',
});
const player = (mobileRuntime ? createNativeQueuePlayer : createQueuePlayer)({
  audio, request: mobileRuntime?.requestNative, preferences: state.playback,
  getBlockedIds: () => Object.keys(state.blacklist), getBlockedArtists: () => state.artistBlacklist,
  onRestoreArtistBlacklist: artists => { state.artistBlacklist = normalizeArtistBlacklist([...artists, ...Object.values(state.artistBlacklist)]); state.queue = state.queue.filter(song => !isBlockedSong(song)); state.activeQueue = state.activeQueue.filter(song => !isBlockedSong(song)); persist(); },
  onRestoreBlacklist: ids => {
    const songs = new Map(allSongs().map(song => [song.id, song]));
    for (const id of ids) if (!state.blacklist[id]) state.blacklist[id] = { ...(songs.get(id) || { id, title: '已拉黑歌曲', artist: '' }), blockedAt: Date.now() };
    state.queue = state.queue.filter(song => !isBlockedSong(song)); persist();
  },
  loadTrack: (id, quality) => api('/api/preview', { method: 'POST', body: JSON.stringify({ id, quality }) }),
  onChange: view => { updatePlaybackPreferences(view); if (view.overlay) state.overlay = view.overlay; state.playingId = view.song && !view.paused && !view.ended ? view.song.id : null; render(); if (state.lyricsOpen) ensureLyrics(view); },
  onTick: view => { updatePlaybackPreferences(view); updatePlayerProgress(view); },
  onLikesChanged: onNativeLikesChanged,
  onHeard: events => {
    const entries = Array.isArray(events) ? events : [events];
    const existing = new Set(state.history.map(event => event.eventId).filter(Boolean));
    for (const entry of entries) if (!entry.eventId || !existing.has(entry.eventId)) { state.history.push(entry); if (entry.eventId) existing.add(entry.eventId); }
    return persist();
  },
});

const listeningSession = createListeningSession({
  player, getBlockedIds: () => Object.keys(state.blacklist), getBlockedArtists: () => state.artistBlacklist,
  onQueue: ({ id, songs }) => { state.activeQueue = songs; state.activeQueueId = id; state.playingQueueVisible = 60; persist(); render(); },
});

const easterEggs = createEasterEggs({
  player, songs: allSongs, escape,
  stream: id => api('/api/preview', { method: 'POST', body: JSON.stringify({ id, quality: state.playback.quality }) }),
  search: keywords => api('/api/search', { method: 'POST', body: JSON.stringify({ keywords }) }),
  blocked: (id, song) => isBlockedSong(song || findSong(id) || { id }), canPlay: song => !song.demo && canUseSong(song, state.features),
  onBlacklist: song => setSongBlocked(song.id, true, song),
});

function updatePlaybackPreferences(view) {
  const preferences = normalizePlaybackPreferences(view);
  if (preferences.quality !== state.playback.quality || preferences.volume !== state.playback.volume || preferences.mode !== state.playback.mode) { state.playback = preferences; persist(); }
}

function updatePlayerProgress(view) {
  const miniProgress = document.querySelector('.mini-progress');
  if (miniProgress) miniProgress.style.setProperty('--progress', String(view.duration > 0 ? Math.max(0, Math.min(100, (view.currentTime || 0) / view.duration * 100)) : 0));
  const progress = document.querySelector('#player-progress');
  if (progress && !draggingProgress) { progress.value = view.duration ? Math.round(view.currentTime / view.duration * 1000) : 0; progress.setAttribute('aria-valuetext', `${formatTime(view.currentTime)} / ${formatTime(view.duration)}`); }
  const elapsed = document.querySelector('#player-elapsed');
  const duration = document.querySelector('#player-duration');
  if (elapsed && !draggingProgress) elapsed.textContent = formatTime(view.currentTime);
  if (duration) duration.textContent = formatTime(view.duration);
  if (progress) progress.disabled = !view.duration;
  updateLyricProgress(view);
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; }
  catch { return {}; }
}

function persist() {
  const settingsNote = document.querySelector('#queue-settings-note');
  if (settingsNote) settingsNote.hidden = !state.queue.length || state.queueSettings === queueSettingsSignature();
  const wasUnsaved = state.unsaved;
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 1, features: state.features, guideSeen: state.guideSeen, activeQueue: state.activeQueue, activeQueueId: state.activeQueueId, queueBatchId: state.queueBatchId, lyricFollow: state.lyricFollow, localAvatar: state.localAvatar, appearance: state.appearance, plugins: state.plugins, enabledPlugins: state.enabledPlugins, providerConsents: state.providerConsents, sources: state.sources, references: state.references, edits: state.edits, history: state.history.slice(-10000),
      options: state.options, playback: state.playback, blacklist: state.blacklist, artistBlacklist: state.artistBlacklist, libraryVisits: state.libraryVisits, remoteOpen: state.remoteOpen, classifyPaused: state.classifyPaused, queue: state.queue.map(song => ({ id: song.id, reason: song.reason, unknown: song.unknown, inRecentPool: song.inRecentPool, classificationKind: song.classificationKind })), selectionReport: state.selectionReport, queueSettings: state.queueSettings, warnings: state.warnings, eligibleCount: state.eligibleCount, autoSync: state.autoSync, lastSync: state.lastSync, exportScope: state.exportScope, exportJob: state.exportJob, exportResult: state.exportResult
    }));
    state.unsaved = false;
    if (wasUnsaved) queueMicrotask(render);
    return true;
  } catch {
    state.unsaved = true;
    toast('未保存到浏览器：存储空间不足或不可用。请先导出备份。');
    queueMicrotask(render);
    return false;
  }
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function icon(name) {
  const paths = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    lyrics: '<path d="M4 5h16M4 10h12M4 15h16M4 20h10"/>',
    tune: '<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    library: '<path d="M4 4v16M8 4v16M13 5l4-1 4 15-4 1z"/>',
    sync: '<path d="M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    shuffle: '<path d="M3 5h3c5 0 7 14 12 14h3m-4-4 4 4-4 3M3 19h3c2 0 4-3 5-6m2-2c2-4 3-6 5-6h3m-4-3 4 3-4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    previous: '<path d="M5 5v14m14-14L8 12l11 7z"/>',
    next: '<path d="M19 5v14M5 5l11 7-11 7z"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    tag: '<path d="M20 13 13 20a2 2 0 0 1-3 0L2 12V3h9l9 8a2 2 0 0 1 0 2Z"/><circle cx="7" cy="8" r="1"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    qr: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6v-3m6-6v3M12 3v2m0 4v3H8m-5 0h2m7 3v6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>'
    , block: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>'
    , chevron: '<path d="m9 5 7 7-7 7"/>'
    , repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.music}</svg>`;
}

function safeImage(url) {
  if (!state.features.netease) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /(^|\.)((music\.)?126\.net|music\.163\.com|netease\.com)$/.test(parsed.hostname) ? parsed.href : '';
  } catch { return ''; }
}

function songLink(song) {
  if (!state.features.netease) return '';
  return /^\d+$/.test(song.id) ? `https://music.163.com/song?id=${encodeURIComponent(song.id)}` : '';
}

function activeSources() { return state.sources.filter(source => source.local || source.demo || state.features.netease); }

function allSongs() {
  const merged = new Map();
  for (const source of activeSources()) {
    for (const [index, song] of (source.songs || []).entries()) {
      const id = String(song.id);
      const existing = merged.get(id);
      merged.set(id, {
        ...existing, ...song, id, playlistIds: [...new Set([...(existing?.playlistIds || []), String(source.id)])],
        addedAtByPlaylist: { ...existing?.addedAtByPlaylist, [source.id]: song.addedAt ?? null },
        observedAtByPlaylist: { ...existing?.observedAtByPlaylist, [source.id]: song.observedAddedAt ?? null },
        orderByPlaylist: { ...existing?.orderByPlaylist, [source.id]: song.playlistOrder ?? index },
        ...state.edits[id],
      });
    }
  }
  return applyBlacklist([...merged.values()], state.blacklist, state.artistBlacklist);
}

function selectedSongs(ignoreLanguage = false) {
  const selected = state.options.playlistIds;
  return allSongs().filter(song => (ignoreLanguage || languageMatches(song, state.options.languages)) && (!selected.length || song.playlistIds.some(id => selected.includes(id))));
}

function selectedReferenceSongs() {
  if (!state.features.netease) return [];
  return state.references.filter(reference => reference.enabled !== false).flatMap(reference => reference.songs.map(song => ({ ...song, ...state.edits[song.id] })).filter(song => !isBlockedSong(song)));
}

function effectiveMood(song) {
  return songMoods(song)[0] || '';
}
function effectiveGenre(song) {
  return songGenres(song)[0] || '';
}

let artistRulesSource;
let artistRuleMatch = () => null;
function isBlockedSong(song) {
  if (artistRulesSource !== state.artistBlacklist) { artistRulesSource = state.artistBlacklist; artistRuleMatch = artistBlacklistMatcher(state.artistBlacklist); }
  return Boolean(song && (song.blocked || state.blacklist[song.id] || artistRuleMatch(song)));
}
async function setArtistBlocked(key, blocked, songId) {
  const artist = blocked ? songArtists(findSong(songId) || {}).find(entry => entry.key === key) : state.artistBlacklist[key];
  if (!artist) return;
  const rules = { ...state.artistBlacklist };
  if (blocked) rules[artist.key] = { ...artist, blockedAt: Date.now() };
  else delete rules[key];
  state.artistBlacklist = normalizeArtistBlacklist(rules);
  ++queueGeneration; ++queueLoadRevision; state.queueLoading = false;
  state.queue = state.queue.filter(song => !isBlockedSong(song));
  state.activeQueue = state.activeQueue.filter(song => !isBlockedSong(song));
  state.selectionReport = null; persist(); render();
  const success = await player.syncArtistBlacklist(state.artistBlacklist);
  if (success === false) { await player.pause(); state.error = '歌手黑名单已保存，但后台队列未确认更新。请停止播放后重新载入队列。'; render(); }
  toast(blocked ? `已屏蔽 ${artist.name} 的署名歌曲，包含合唱。` : '已解除歌手屏蔽；单独拉黑的歌曲仍保留，队列不会自动恢复。');
}
function blacklistButton(song) {
  const blocked = Boolean(state.blacklist[song.id]);
  return `<button class="button quiet small blacklist-action" data-action="${blocked ? 'unblock-song' : 'block-song'}" data-id="${escape(song.id)}" aria-label="${blocked ? '移出黑名单' : '拉黑'} ${escape(song.title)}">${icon(blocked ? 'check' : 'block')}<span>${blocked ? '恢复' : '拉黑'}</span></button>${renderArtistActions(song, state.artistBlacklist, escape)}`;
}

async function setSongBlocked(id, blocked, suppliedSong = null) {
  const song = findSong(id) || suppliedSong;
  if (!song) return;
  clearTimeout(undoTimer);
  if (blocked) {
    state.blacklist[id] = { id, title: song.title, artist: song.artist, cover: song.cover || '', blockedAt: Date.now() };
    state.undoBlacklist = id;
    undoTimer = setTimeout(() => { state.undoBlacklist = null; document.querySelector('.snackbar')?.remove(); }, 6000);
    const toastElement = document.querySelector('#toast');
    if (toastElement) toastElement.hidden = true;
  } else { delete state.blacklist[id]; state.undoBlacklist = null; }
  state.queue = state.queue.filter(item => !isBlockedSong(item));
  state.activeQueue = state.activeQueue.filter(item => !isBlockedSong(item));
  state.selectionReport = null; classificationQueue.delete(id);
  persist(); render();
  const success = await player.syncBlacklist(Object.keys(state.blacklist));
  if (success === false) { await player.pause(); state.error = '黑名单已保存，但后台队列未确认更新。请停止播放后重新载入队列。'; render(); }
  if (!blocked) toast('已恢复，可重新生成或载入播放。');
}
async function ensureLyrics(view = player.snapshot(), retry = false) {
  const id = view.song?.id;
  if (!id || !isPlayableSongId(id) || !state.features.lyrics) return;
  if (!retry && state.lyrics.id === id && state.lyrics.status !== 'error') return;
  if (!retry && lyricCache.has(id)) { state.lyrics = { id, ...lyricCache.get(id) }; render(); return; }
  state.lyrics = { id, status: 'loading', lines: [], plain: [] }; render();
  try {
    const result = await api('/api/lyrics', { method: 'POST', body: JSON.stringify({ id }) });
    if (String(result.id) !== id) throw new Error('歌词与当前歌曲不一致。');
    if (lyricCache.size >= 20) lyricCache.delete(lyricCache.keys().next().value);
    lyricCache.set(id, result);
    if (state.lyrics.id !== id || player.snapshot().song?.id !== id) return;
    state.lyrics = { ...result, id };
  } catch {
    if (state.lyrics.id !== id || player.snapshot().song?.id !== id) return;
    state.lyrics = { id, status: 'error', lines: [], plain: [] };
  }
  render();
}

function lyricsPanel(view) {
  if (!state.features.lyrics || !state.lyricsOpen || !view.song) return '';
  const lyrics = state.lyrics.id === view.song.id ? state.lyrics : { status: 'loading', lines: [], plain: [] };
  return renderLyricsPanel({ lyrics, view, follow: state.lyricFollow }, { escape, icon });
}

function setLyricFollow(value) {
  if (state.lyricFollow !== value) { state.lyricFollow = value; persist(); }
  const button = document.querySelector('.lyric-follow');
  const presentation = lyricFollowPresentation(value, state.lyrics.lines.length > 0);
  if (button) {
    button.setAttribute('aria-pressed', String(presentation.active));
    button.classList.toggle('is-active', presentation.active);
    button.innerHTML = icon(presentation.active ? 'check' : 'pause') + '<span>' + presentation.label + '</span>';
  }
  const status = document.querySelector('.lyric-follow-status');
  if (status) status.textContent = presentation.description;
  if (value) updateLyricProgress(player.snapshot(), true);
}

async function replaceCurrentBatch(autoplay = false) {
  const revision = ++queueLoadRevision;
  if (!state.queueBatchId) { state.queueBatchId = globalThis.crypto?.randomUUID?.() || `batch-${Date.now()}-${revision}`; persist(); }
  const queueId = state.queueBatchId;
  state.queueLoading = true; state.queueLoadError = ''; render();
  try {
    const songs = [...state.queue];
    const result = await loadGeneratedQueue({ start: listeningSession.start, snapshot: player.snapshot }, songs, queueId, autoplay);
    if (revision !== queueLoadRevision) return false;
    state.queueLoadError = result.loaded ? '' : result.reason;
    return result.loaded;
  } catch (error) {
    if (revision === queueLoadRevision && queueId === state.queueBatchId) state.queueLoadError = error.message;
    return false;
  } finally { if (revision === queueLoadRevision) { state.queueLoading = false; render(); } }
}

async function clearQueue() {
  ++queueLoadRevision; state.queueLoading = false;
  const stopped = await listeningSession.stop();
  if (stopped === false) { state.queueLoadError = '停止没有确认成功，请重试。'; render(); return; }
  state.queueLoadError = ''; persist(); render(); toast('播放列表已清空，生成候选仍保留。');
}

function clearCandidates() {
  ++queueGeneration;
  state.queue = []; state.queueBatchId = ''; state.queueSettings = null;
  state.selectionReport = null; state.warnings = []; persist(); render();
  toast('候选已清空，当前音乐继续播放。');
}

function updateLyricProgress(view, force = false) {
  if (!state.lyricsOpen || state.lyrics.id !== view.song?.id) return;
  const container = document.querySelector('.lyrics-lines');
  if (!container) return;
  const index = activeLyricIndex(state.lyrics.lines, view.currentTime);
  const previous = container.querySelector('[aria-current="true"]');
  const current = container.querySelector(`[data-line="${index}"]`);
  if (previous === current && !force) return;
  if (previous) { previous.classList.remove('active'); previous.removeAttribute('aria-current'); }
  if (current) {
    current.classList.add('active'); current.setAttribute('aria-current', 'true');
    if (state.lyricFollow) container.scrollTo({ top: Math.max(0, current.offsetTop - container.clientHeight / 2 + current.clientHeight / 2), behavior: 'instant' });
  }
}
function autoLabel(song) {
  if (!song.autoSource) return '';
  const parts = [genreDefinitions[song.autoGenre], moodNames[song.autoMood]].filter(Boolean);
  if (!parts.length) parts.push('百科有数据');
  return parts.join(' · ');
}
function isAutoOnly(song) {
  const manual = (song.localMood === undefined ? song.mood : song.localMood) || (song.localGenre === undefined ? song.genre : song.localGenre);
  return Boolean(song.autoSource) && !manual;
}

function playlistLinkForm(role) {
  const reference = role === 'reference';
  return `<form id="${reference ? 'reference-import-form' : 'scope-import-form'}" class="playlist-link-form"><label for="${role}-input">${reference ? '现成的网易云参考歌单链接' : '网易云歌单链接或整段分享文字'}</label><input id="${role}-input" class="text-input" placeholder="粘贴网易云歌单分享链接" aria-label="${reference ? '参考歌单链接' : '范围歌单链接'}" maxlength="3000" required ${state.busy ? 'disabled' : ''}><button class="button small ${reference ? '' : 'primary'}" type="submit" ${state.busy ? 'disabled' : ''}>${reference ? '导入参考歌单' : '导入随机范围'}</button></form>`;
}

function recentControls(songs) {
  const recent = getRecentSongs(songs, state.options);
  const basis = recent.basis === 'added-at' ? '池内均有添加时间或同步新增记录' : recent.basis === 'mixed' ? '只有部分有时间记录，其余是顺序代用' : '没有可用时间，不能确认真正最近添加';
  return `<details class="advanced-control" data-detail="recent" ${state.recentOpen ? 'open' : ''}><summary>近期 100 首与老歌比例<span>近期占比 ${state.options.recentPriority}% · 口味强度 ${state.options.recentTaste}%</span></summary><div class="advanced-body"><p class="tiny-note">近期池 ${recent.count} 首，${recent.knownDateCount} 首有时间记录。${basis}。</p><label class="slider-label" for="recent-fallback">缺少添加时间时</label><select id="recent-fallback">${[['head', '按歌单前部补足（不保证是最新）'], ['tail', '按歌单后部补足（适合旧歌在前）'], ['dated-only', '只用有时间记录的歌，不按顺序猜']].map(([value, name]) => `<option value="${value}" ${state.options.recentFallback === value ? 'selected' : ''}>${name}</option>`).join('')}</select><details class="recent-preview"><summary>核对近期池的 ${recent.count} 首</summary><ol>${recent.songs.map(song => `<li><span>${escape(song.title)} · ${escape(song.artist)}</span>${blacklistButton(song)}<small>${song.recentEvidence === 'added-at' ? `添加记录 ${escape(formatDate(song.recentDate))}` : song.recentEvidence === 'observed' ? `同步观察新增 ${escape(formatDate(song.recentDate))}` : '歌单顺序代用 · 日期未知'}</small></li>`).join('') || '<li>没有可用歌曲，请更换时间策略或同步歌单。</li>'}</ol></details><label class="slider-label" for="recent-priority">队列中来自近期池的目标占比 <span id="recent-priority-value">${state.options.recentPriority}%</span></label><input id="recent-priority" type="range" min="0" max="100" value="${state.options.recentPriority}"><p class="tiny-note">100% 只选近期，0% 只选老歌；中间值按比例分配，某池不够才由另一池补足。</p><label class="slider-label" for="recent-taste">近期口味引导强度（不是首数占比） <span id="recent-taste-value">${state.options.recentTaste}%</span></label><input id="recent-taste" type="range" min="0" max="100" value="${state.options.recentTaste}"><p class="tiny-note">0 不参考，越高越偏向近期听过的歌手与氛围。</p></div></details>`;
}

function queueSettingsSignature() {
  return JSON.stringify([state.options, state.edits, Object.keys(state.blacklist), Object.keys(state.artistBlacklist), state.sources.map(source => [source.id, source.syncedAt, source.songs.length]), state.references.map(source => [source.id, source.syncedAt, source.enabled]), state.history.length, state.history[state.history.length - 1], state.plugins, state.enabledPlugins]);
}

function selectionReport() {
  const report = state.selectionReport;
  if (!report || !state.queue.length) return '';
  if (report.selectedRecent + report.selectedOlder !== state.queue.length) return '<p class="notice">队列已随曲库变化，请重新生成后核对组成。</p>';
  const classification = report.classification;
  const classificationText = classification ? classification.filtered ? `所选分类：精确匹配 ${classification.exact} 首 · 相近补充 ${classification.related} 首 · 待分类补位 ${classification.unclassified} 首（补位不等于已判定符合）` : '本批未设置氛围／风格条件，没有声称已按分类匹配。' : '旧版队列，请重新生成查看分类依据。';
  return `<section class="selection-report" aria-label="本批规则核对"><h3>本批规则核对</h3><p>近期池 <strong>${report.selectedRecent}</strong> 首 + 老歌 <strong>${report.selectedOlder}</strong> 首 · 实际近期 <strong>${report.actualRecentPercent}%</strong>${report.requestedRecent === null ? '' : `（目标 ${report.requestedRecent} / ${report.requestedCount} 首）`}</p><p>${classificationText}</p><p>已知氛围 ${report.knownMoodCount} / ${state.queue.length} · 已知风格 ${report.knownGenreCount} / ${state.queue.length} · 已知能量 ${report.knownEnergyCount} / ${state.queue.length}</p><p>近期池 ${report.recentPoolCount} 首，其中 ${report.knownDateCount} 首有时间记录；${report.recencyBasis === 'added-at' ? '没有用未知日期补池。' : '含顺序代用，不能等同真实最近添加。'}</p></section>`;
}

function classificationControls(coverage) {
  const strict = state.options.classificationMode === 'strict';
  return `<div class="classification-settings"><label class="slider-label" for="classification-mode">分类匹配方式</label><select id="classification-mode"><option value="balanced" ${strict ? '' : 'selected'}>智能宽松：先匹配，再补位</option><option value="strict" ${strict ? 'selected' : ''}>严格：只要精确标签</option></select><label class="compact-check"><input id="include-unknown" type="checkbox" ${!strict && state.options.includeUnknown ? 'checked' : ''} ${strict ? 'disabled' : ''}>优先候选不足时，用待分类歌曲补位</label><p class="tiny-note">智能宽松按精确匹配 → 相近类别 → 待分类依次选择，不混入已知冲突；相近只是类别邻近，补位不保证符合。严格模式只取精确标签。范围、冷却和近期比例始终不变。</p><p class="tiny-note">范围内 ${coverage.total} 首：氛围有标签 ${coverage.moodKnown} 首，风格有标签 ${coverage.genreKnown} 首。${coverage.hasFilters ? `按所选条件可判断：精确 ${coverage.exactCount} · 相近 ${coverage.relatedCount} · 待判定 ${coverage.unclassifiedCount} · 已知冲突 ${coverage.conflictCount}（尚未计算冷却与近期配额）。` : '未选择分类时，不因标签缺失排除歌曲。'}缺标签不等于不匹配，本版尚无自动听音分类。</p></div>`;
}

function autoClassifyPanel(songs) {
  if (!state.features.netease) return '<p class="public-note">本地歌曲优先使用内嵌文件信息，也可在曲库编辑分类；不按文件名或歌手国籍猜氛围和语种。</p>';
  const real = songs.filter(song => !song.demo && !song.blocked && /^[1-9][0-9]{0,17}$/.test(String(song.id)));
  const marked = real.filter(song => song.autoSource).length;
  const pending = real.filter(song => classificationNeedsUpdate(song)).length;
  const empty = real.filter(song => song.autoStatus === 'empty').length;
  const progress = state.classifyProgress;
  return `<details class="advanced-control" data-detail="classify" ${state.classifyOpen ? 'open' : ''}><summary>网易云百科自动分类<span>氛围 ${real.filter(song => songMoods(song).length).length} / ${real.length} 首</span></summary><div class="advanced-body"><p class="tiny-note">按歌曲百科逐首补全，多种氛围共同参与筛选。不会覆盖手工值；无数据保持未知，不按歌名猜测。</p>${progress ? `<div class="classify-progress" role="status"><progress value="${progress.done}" max="${progress.total}"></progress><span>已处理 ${progress.done} / ${progress.total}</span></div><button class="button small" data-action="pause-classify">处理完当前 5 首后暂停</button>` : ''}<p class="classify-stats">待补齐 ${pending} 首 · 百科有结果 ${marked} 首 · 暂无数据 ${empty} 首</p><div class="actions"><button class="button primary small" data-action="auto-classify" ${progress || !pending ? 'disabled' : ''}>${state.classifyPaused ? '继续补齐' : '补齐分类'}</button>${empty && !progress ? '<button class="button small" data-action="retry-classify">重查暂无数据</button>' : ''}${marked && !progress ? '<button class="button quiet small" data-action="clear-auto-classify">清除自动分类</button>' : ''}</div><p class="tiny-note">每批 5 首，进度随批次保存，不再只处理前 300 首。暂无数据缓存 7 天，失败稍后可重试；暂停后点继续。关闭页面会停止，已完成部分保留。</p></div></details>`;
}

async function runAutoClassify(onlyIds = null, force = false) {
  const candidates = Array.isArray(onlyIds) ? allSongs().filter(song => onlyIds.includes(song.id)) : selectedSongs();
  for (const song of candidates) if (classificationNeedsUpdate(song, Date.now(), force)) classificationQueue.add(String(song.id));
  if (state.classifyProgress) { state.classifyProgress.total = state.classifyProgress.done + classificationQueue.size; return; }
  if (!classificationQueue.size) { toast('当前范围无需重复分类，可重查暂无数据的歌曲。'); return; }
  state.classifyPaused = false;
  const epoch = ++classifyEpoch;
  let done = 0;
  let classified = 0;
  let empty = 0;
  let failed = 0;
  state.classifyProgress = { done, total: classificationQueue.size };
  persist(); render();
  try {
    while (classificationQueue.size && !state.classifyPaused && epoch === classifyEpoch) {
      const songs = new Map(allSongs().map(song => [song.id, song]));
      const chunk = [...classificationQueue].filter(id => songs.has(id) && !songs.get(id).blocked).slice(0, 5);
      if (!chunk.length) { classificationQueue.clear(); break; }
      for (const id of chunk) classificationQueue.delete(id);
      const result = await api('/api/classify', { method: 'POST', body: JSON.stringify({ ids: chunk, refresh: force }) });
      if (epoch !== classifyEpoch) return;
      const attempted = Date.now();
      for (const item of result.items || []) {
        if (!chunk.includes(String(item.id))) continue;
        const previous = state.edits[item.id] || {};
        if (item.classified) {
          state.edits[item.id] = { ...applyAutoClassification(previous, item), autoAttemptAt: attempted, autoStatus: 'ready' };
          classified++;
        } else {
          const failure = item.reason === 'request-failed';
          state.edits[item.id] = { ...previous, autoVersion: AUTO_VERSION, autoAttemptAt: attempted, autoStatus: failure ? 'failed' : 'empty' };
          if (failure) failed++; else empty++;
        }
      }
      done += chunk.length;
      state.classifyProgress = { done, total: done + classificationQueue.size };
      persist(); render();
      if (Number(result.failed) === chunk.length) { state.classifyPaused = true; state.error = '本批分类请求均未成功，已暂停，避免反复请求。网络恢复后可继续。'; }
    }
  } catch (error) {
    if (epoch === classifyEpoch) { state.classifyPaused = true; state.error = error.message || '自动分类暂时中断，已完成结果保留。'; }
  } finally {
    if (epoch === classifyEpoch) { state.classifyProgress = null; persist(); render(); }
  }
  if (epoch === classifyEpoch) toast(`${state.classifyPaused ? '分类已暂停' : '分类完成'}：${classified} 首有结果，${empty} 首暂无数据，${failed} 首失败。`);
}

async function runLanguageScan() {
  if (state.languageProgress || state.classifyProgress) return;
  const pending = selectedSongs(true).filter(song => /^(?:[1-9]\d{0,17}|qq-[A-Za-z0-9]{5,40})$/u.test(String(song.id)) && needsLanguageLookup(song));
  if (!pending.length) { toast('没有新的待识别语种。无资料缓存7天、失败缓存10分钟，可在曲库手工修正。'); return; }
  const epoch = ++languageEpoch;
  let identified = 0, empty = 0, failed = 0;
  state.languagePaused = false; state.languageProgress = { done: 0, total: pending.length }; render();
  try {
    for (let offset = 0; offset < pending.length && !state.languagePaused; offset += 5) {
      const ids = pending.slice(offset, offset + 5).map(song => song.id);
      const result = await api('/api/languages', { method: 'POST', body: JSON.stringify({ ids }) });
      if (epoch !== languageEpoch) return;
      const present = new Set(allSongs().map(song => song.id));
      let failures = 0;
      for (const id of ids) {
        if (!present.has(id)) continue;
        const item = result.items?.find(entry => String(entry.id) === id);
        if (!item || item.failed) failures++;
        const keys = normalizeLanguages(item?.languages);
        if (!item || item.failed) failed++; else if (keys.length) identified++; else empty++;
        state.edits[id] = { ...state.edits[id], ...(keys.length ? { autoLanguageKeys: keys, autoLanguageSource: item.source } : {}), autoLanguageAttemptAt: Date.now(), autoLanguageStatus: !item || item.failed ? 'failed' : keys.length ? 'ready' : 'empty' };
      }
      state.languageProgress = { done: Math.min(offset + 5, pending.length), total: pending.length };
      persist(); render();
      if (failures === ids.length) { state.languagePaused = true; state.error = '本批语种资料暂不可用，已暂停。请检查网络或网易云授权；已有分类保留。'; }
    }
  } catch (error) { if (epoch === languageEpoch) state.error = error.message; }
  finally { if (epoch === languageEpoch) { state.languageProgress = null; persist(); render(); toast(`${state.languagePaused ? '语种补齐已暂停' : '语种补齐完成'}：${identified} 首已识别，${empty} 首无资料，${failed} 首失败。手工分类保留。`); } }
}

function clearAutoClassificationEdits() {
  ++languageEpoch; state.languageProgress = null;
  ++classifyEpoch; classificationQueue.clear(); state.classifyProgress = null; state.classifyPaused = true;
  for (const [id, edit] of Object.entries(state.edits)) {
    const next = { ...edit };
    for (const key of Object.keys(next)) if (key.startsWith('auto')) delete next[key];
    if (Object.keys(next).length) state.edits[id] = next; else delete state.edits[id];
  }
  persist(); render(); toast('已清除自动分类，手工分类不受影响。');
}

function classificationRecovery() {
  if (!state.options.moods.length && !state.options.genres.length) return '';
  if (state.queue.length) return '';
  return `<div class="classification-recovery">${state.options.classificationMode === 'strict' || !state.options.includeUnknown ? '<button class="button small" data-action="relax-classification">智能补位并重选</button>' : ''}<button class="button quiet small" data-action="skip-classification">本次不按氛围与风格重选</button><p class="tiny-note">只调整分类条件；不放宽范围、冷却、标签或近期比例。</p></div>`;
}


function genreControls() {
  const selected = state.options.genres;
  return `<details class="genre-picker" data-detail="genre-picker" ${state.genrePickerOpen ? 'open' : ''}><summary><strong>音乐风格</strong><span>${selected.length ? escape(selected.map(value => genreDefinitions[value]).join(' / ')) : '不限风格 · 点开可多选'}</span></summary><div class="genre-chips" role="group" aria-label="音乐风格多选"><button class="chip ${!selected.length ? 'selected' : ''}" data-action="genre" data-genre="all" aria-pressed="${!selected.length}">不限风格</button>${Object.entries(genreDefinitions).map(([value, name]) => `<button class="chip ${selected.includes(value) ? 'selected' : ''}" data-action="genre" data-genre="${value}" aria-pressed="${selected.includes(value)}">${name}</button>`).join('')}</div></details>`;
}

function tagFilterStatus() {
  const tag = state.options.tag.trim().toLowerCase();
  const match = getTagCatalog(allSongs(), state.options).find(item => item.label.toLowerCase() === tag);
  return !tag ? '只筛选已保存到歌曲上的标签；输入筛选词不会自动给歌曲贴标签。' : match ? `当前范围 ${match.count} 首保存了此标签；冷却和其他条件还会进一步筛选。` : '当前范围 0 首保存了此标签。请先在曲库编辑歌曲并保存标签，或清除此筛选；不会按关键词自动猜测。';
}

function tagControls() {
  const catalog = getTagCatalog(allSongs(), state.options);
  return `<label class="slider-label" for="custom-tag">按已保存的自定义标签筛选</label><input id="custom-tag" class="text-input" placeholder="例如：先给歌曲标注“夜跑”，再选它" maxlength="40" value="${escape(state.options.tag)}"><p id="tag-filter-status" class="tiny-note" role="status">${escape(tagFilterStatus())}</p>${catalog.length ? `<div class="tag-catalog" role="group" aria-label="当前范围已有标签">${catalog.slice(0, 20).map(item => `<button class="chip ${item.label.toLowerCase() === state.options.tag.toLowerCase() ? 'selected' : ''}" data-action="filter-tag" data-tag="${escape(item.label)}">${escape(item.label)} · ${item.count}</button>`).join('')}</div>` : ''}<div class="tag-links"><button class="text-button" data-tab="library">去曲库编辑歌曲标签</button>${state.options.tag ? '<button class="text-button" data-action="clear-tag-filter">清除标签并重选</button>' : ''}</div>`;
}

function referenceControls() {
  if (!state.features.netease) return '';
  return `<details class="advanced-control" data-detail="reference" ${state.referenceOpen ? 'open' : ''}><summary>网易云歌单参考<span>${state.references.filter(reference => reference.enabled !== false).length} 个启用</span></summary><div class="advanced-body">${playlistLinkForm('reference')}<p class="tiny-note">可以直接导入别人做好的歌单。只参考共同歌曲、歌手和已有分类，不自动把参考歌曲加入你的随机范围。</p>${state.references.map(reference => `<div class="reference-row"><label><input type="checkbox" data-reference-id="${escape(reference.id)}" ${reference.enabled !== false ? 'checked' : ''}><span>${escape(reference.name)}<small>${reference.songs.length} 首 · ${escape(formatDate(reference.syncedAt))}</small></span></label><div class="reference-actions"><button class="text-button" data-action="reference-as-source" data-id="${escape(reference.id)}" ${state.busy ? 'disabled' : ''}>加入范围</button><button class="text-button" data-action="sync-reference" data-id="${escape(reference.id)}" ${state.busy ? 'disabled' : ''}>更新</button><button class="text-button" data-action="remove-reference" data-id="${escape(reference.id)}">移除</button></div></div>`).join('')}<label class="slider-label" for="reference-strength">参考歌单引导强度（不是首数占比） <span id="reference-strength-value">${state.options.referenceStrength}%</span></label><input id="reference-strength" type="range" min="0" max="100" value="${state.options.referenceStrength}" ${state.references.some(reference => reference.enabled !== false) ? '' : 'disabled'}><p class="tiny-note">没有启用的参考歌单时，此项不生效。0 不参考；高强度先进入匹配池，避免被大量无关歌曲稀释，池内相似度也会强力区分。100% 不走无偏通道；若近期口味也开100%，两种有可用匹配的引导各一半。始终不越过近期配额、范围、分类或冷却。</p></div></details>`;
}

function exportedPlaylistLink() {
  const id = String(state.exportResult?.playlist?.id || '');
  return /^[1-9]\d{0,19}$/.test(id) ? `https://music.163.com/playlist?id=${id}` : '';
}

function queueSaver() {
  if (!state.exportOpen) return '';
  const job = state.exportJob;
  const result = state.exportResult;
  const link = exportedPlaylistLink();
  const savedScope = job?.scope || (job ? 'queue' : state.exportScope);
  const scopeMismatch = job && savedScope !== state.exportScope;
  const realQueue = exportSongs().length > 0 && exportSongs().every(song => !song.demo && /^[1-9]\d{0,19}$/.test(song.id));
  return `<section class="queue-save" aria-label="保存到网易云"><h3>${job ? savedScope === 'collection' ? '日推收藏的保存任务' : '随机队列的保存任务' : state.exportScope === 'collection' ? '把日推收藏另存为网易云歌单' : '把这次随机存成网易云歌单'}</h3>${scopeMismatch ? '<p class="notice">这里保留的是上次保存任务，不是当前选择的歌曲。请先核对结果，再点「新建另一张」保存当前内容；检查结果不会重复新建。</p>' : ''}<p class="tiny-note">仅在你确认后新建一张歌单，不修改源歌单。要保留编排的衔接，请在网易云选择顺序播放。</p>${job ? `<div class="save-result" role="status"><p>${escape(job.name)} · ${job.count} 首${result ? result.complete ? ' · 歌曲已全部回读确认' : ' · 结果需核对' : ' · 创建结果待确认'}</p>${result?.complete && result.orderConfirmed ? '<p class="caption">已确认网易云中的顺序与本次队列一致。</p>' : ''}${(result?.warnings || []).map(warning => `<p class="tiny-note">${escape(warning)}</p>`).join('')}${link ? `<label for="created-playlist-link">网易云歌单链接</label><input class="text-input" id="created-playlist-link" value="${escape(link)}" readonly><div class="actions"><a class="button small primary" href="${link}" target="_blank" rel="noopener noreferrer">在网易云打开</a><button class="button small" data-action="copy-playlist-link">复制链接</button></div><p class="tiny-note">${job.privacy === 10 ? '申请创建为仅自己可见；需登录同一账号，链接不保证其他人能访问。' : '申请创建为公开歌单；其他人能否访问仍以网易云审核及权限为准。'}</p>` : '<p class="tiny-note">不要直接重复新建。先去官方 App 的“我创建的歌单”检查。</p>'}<div class="actions">${!result ? `<button class="button small" data-action="check-created-playlist" ${state.busy || !state.status.loggedIn ? 'disabled' : ''}>检查本次结果（不重复新建）</button>` : ''}<button class="text-button" data-action="new-playlist-export" ${state.busy ? 'disabled' : ''}>新建另一张${result?.complete ? '' : '（先核对已有歌单）'}</button></div></div>` : `<form id="create-playlist-form"><p class="tiny-note">${state.status.loggedIn ? `将写入账号：${escape(state.status.profile?.nickname || '当前网易云账号')} · ${state.exportScope === 'collection' ? '日推收藏' : '当前队列'} ${exportSongs().length} 首` : '请先连接网易云账号，再回来确认创建。'}</p><label for="export-name">新歌单名称</label><input class="text-input" id="export-name" value="${escape(state.exportDraft.name)}" maxlength="40" required ${state.busy ? 'disabled' : ''}><label for="export-privacy">歌单可见性</label><select id="export-privacy" ${state.busy ? 'disabled' : ''}><option value="10" ${state.exportDraft.privacy === 10 ? 'selected' : ''}>仅自己可见（默认）</option><option value="0" ${state.exportDraft.privacy === 0 ? 'selected' : ''}>公开，允许其他人访问</option></select>${!realQueue ? '<p class="tiny-note">需要先生成真实歌曲队列；合成示例不能写入网易云。</p>' : ''}<div class="actions"><button class="button primary small" type="submit" ${state.busy || !state.status.loggedIn || !realQueue ? 'disabled' : ''}>确认创建${state.exportDraft.privacy === 10 ? '私密' : '公开'}歌单</button>${!state.status.loggedIn ? '<button class="button small" type="button" data-tab="sync">连接网易云</button>' : ''}</div></form>`}</section>`;
}
function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未同步';
}

function ownerName(owner) {
  return typeof owner === 'object' && owner ? owner.nickname || '网易云用户' : owner || '';
}


function clearAccountViews() {
  ++accountEpoch; ++likesRevision;
  state.daily = null; state.dailyLoading = false; state.dailyError = '';
  state.likes = { accountId: '', ids: [], loaded: false }; state.likesLoading = false; state.likesError = ''; state.likePending = {}; state.likeJournal = null; state.likeSyncBusy = false;
}

function dailySongs() {
  if (!state.status.loggedIn || state.daily?.accountId !== String(state.status.profile?.userId)) return [];
  return applyBlacklist(state.daily.songs.map(song => ({ ...song, ...state.edits[song.id] })), state.blacklist, state.artistBlacklist);
}

function collectionSongs() {
  return allSongs().filter(song => song.playlistIds.includes(dailyCollectionId));
}

function findSong(id) {
  return allSongs().find(song => song.id === id) || state.activeQueue.find(song => song.id === id) || dailySongs().find(song => song.id === id) || state.references.flatMap(reference => reference.songs).find(song => song.id === id) || (player.snapshot().song?.id === id ? player.snapshot().song : null) || state.blacklist[id] || state.likeJournal?.records.find(record => record.id === id);
}

function collectionButton(song) {
  if (!song || song.demo || !isPlayableSongId(song.id)) return '';
  const collected = collectedSongIds(state.sources).has(song.id);
  return `<button class="button quiet small song-save-action" data-action="collect-song" data-id="${escape(song.id)}" aria-label="${collected ? '取消随听收藏' : '收藏到随听'} ${escape(song.title)}" aria-pressed="${collected}">${icon(collected ? 'check' : 'plus')}${collected ? '已收藏' : '收藏'}</button>`;
}

function officialLikeButton(song) {
  if (!state.features.netease || isLocalSongId(song?.id)) return '';
  if (!song || song.demo || !/^[1-9]\d{0,17}$/.test(song.id)) return '';
  const journal = state.likeJournal?.accountId === String(state.status.profile?.userId) ? state.likeJournal : null;
  const liked = effectiveLike(journal, song.id);
  const pending = journal?.records.find(record => record.id === song.id && record.pending);
  return `<button class="button quiet small official-like ${liked ? 'active' : ''}" data-action="official-like" data-id="${escape(song.id)}" ${!state.status.loggedIn || state.likePending[song.id] ? 'disabled' : ''} aria-pressed="${liked}">${icon('heart')}${state.likePending[song.id] ? '正在本机保存…' : !state.status.loggedIn ? '登录后可暂存喜欢' : pending ? liked ? '已暂存喜欢 · 待同步' : '暂存取消 · 待同步' : liked ? '已喜欢 · 点按暂存取消' : '暂存喜欢'}</button>`;
}

function toggleCollection(id) {
  const song = findSong(id);
  if (!song) return;
  const collected = !collectedSongIds(state.sources).has(id);
  state.sources = collectRecommendation(state.sources, song, collected);
  persist(); render();
  toast(collected ? '已收藏到随听，可在个人主页查看；未写入网易云。' : '已从随听收藏移除，网易云红心不变。');
  if (collected && !state.classifyPaused) runAutoClassify([id]).catch(() => {});
}

async function navigate(tab) {
  if (!['workspace', 'library', 'daily', 'sync', 'profile'].includes(tab)) return;
  state.tab = tab; if (tab === 'profile') { state.profileSection = 'home'; state.overlayOpen = false; } state.error = ''; render(); window.scrollTo({ top: 0, behavior: 'instant' });
  if (tab === 'daily' && state.status.loggedIn) {
    await Promise.all([loadDaily(false), state.likes.loaded ? Promise.resolve() : loadLikes()]);
  }
}

async function loadDaily(refresh = false) {
  if (!state.status.loggedIn || state.dailyLoading) return;
  const epoch = accountEpoch;
  const accountId = String(state.status.profile?.userId);
  state.dailyLoading = true; state.dailyError = ''; render();
  try {
    const result = await api('/api/daily', { method: 'POST', body: JSON.stringify({ refresh }) });
    if (epoch !== accountEpoch) return;
    if (result.accountId !== accountId) throw new Error('推荐账号已变化，请重新连接账号。');
    state.daily = result; state.dailyVisible = 60;
  } catch (error) { if (epoch === accountEpoch) state.dailyError = error.message; }
  finally { if (epoch === accountEpoch) { state.dailyLoading = false; render(); } }
}

async function loadLikes() {
  if (!state.features.netease || !state.status.loggedIn) { toast('请先连接网易云账号。'); return; }
  if (state.likesLoading || state.likeSyncBusy || Object.values(state.likePending).some(Boolean)) return;
  const epoch = accountEpoch;
  const accountId = String(state.status.profile?.userId);
  const revision = likesRevision;
  state.likesLoading = true; state.likesError = ''; render();
  try {
    const result = await likesController.check();
    if (epoch !== accountEpoch) return;
    if (revision !== likesRevision) return;
    if (result.accountId !== accountId) throw new Error('喜欢列表账号已变化，请重新连接。');
    acceptLikeJournal(result);
  } catch (error) {
    if (epoch === accountEpoch && revision === likesRevision) { state.likesError = `网易云喜欢状态未确认：${error.message}`; state.likes.loaded = false; toast(state.likesError); }
  } finally { if (epoch === accountEpoch) { state.likesLoading = false; render(); refreshNativeLikes(); } }
}

function onNativeLikesChanged() {
  if (!state.features.netease || !state.status.loggedIn) return;
  ++likesRevision; nativeLikesDirty = true;
  refreshNativeLikes();
}

function refreshNativeLikes() {
  if (!state.features.netease || !nativeLikesDirty || !state.status.loggedIn || state.likesLoading || state.likeSyncBusy || Object.values(state.likePending).some(Boolean)) return;
  nativeLikesDirty = false;
  void loadLocalLikes();
}

function acceptLikeJournal(journal) {
  if (journal.accountId !== String(state.status.profile?.userId)) return;
  state.likeJournal = journal;
  state.likes = { accountId: journal.accountId, ids: journal.remoteIds, loaded: journal.remoteKnown };
}

async function loadLocalLikes() {
  const epoch = accountEpoch;
  const revision = likesRevision;
  if (!state.features.netease || !state.status.loggedIn) return;
  try {
    const journal = await likesController.local();
    if (epoch === accountEpoch && revision === likesRevision) { acceptLikeJournal(journal); render(); }
  } catch (error) { if (epoch === accountEpoch) { state.likesError = error.message; render(); } }
}

async function setOfficialLike(id) {
  if (!state.features.netease || !state.status.loggedIn || isLocalSongId(id) || state.likePending[id]) return;
  const song = findSong(id);
  if (!song) return;
  ++likesRevision;
  const epoch = accountEpoch;
  state.likePending[id] = true; state.likesError = ''; render();
  try {
    const current = await likesController.local();
    if (epoch !== accountEpoch) return;
    const journal = await likesController.stage(song, !effectiveLike(current, id));
    if (epoch !== accountEpoch) return;
    acceptLikeJournal(journal);
    toast('已保存到本机，未写入网易云。到「我的 → 喜欢同步」手动同步或核对。');
  } catch (error) { if (epoch === accountEpoch) { state.likesError = `本机喜欢未保存：${error.message}`; toast(state.likesError); } }
  finally { if (epoch === accountEpoch) { delete state.likePending[id]; render(); refreshNativeLikes(); } }
}

async function syncLikes() {
  if (!state.features.netease || state.likeSyncBusy || state.likesLoading || !state.status.loggedIn) return;
  const epoch = accountEpoch;
  state.likeSyncBusy = true; state.likesError = ''; render();
  try {
    const { journal, failures } = await likesController.sync();
    if (epoch !== accountEpoch) return;
    acceptLikeJournal(journal);
    state.likesError = failures.length ? `同步已暂停：${failures[0].message} 未确认的操作仍保留；请先核对，不自动重试。` : '';
    const remaining = journal.records.filter(record => record.pending).length;
    toast(remaining ? `已核对，仍有 ${remaining} 首待同步。` : '待同步操作已核对一致。');
    const source = state.sources.find(item => isRemoteSource(item) && String(item.owner?.id || item.owner?.userId || '') === journal.accountId && (item.isLiked || item.specialType === 5));
    if (source) {
      try { await syncOne(source.id); }
      catch { if (epoch === accountEpoch) state.likesError += ' 本机「我喜欢」歌单快照未更新，请到同步页重试。'; }
    }
  } catch (error) { if (epoch === accountEpoch) state.likesError = `同步未确认：${error.message} 本机记录仍保留。`; }
  finally { if (epoch === accountEpoch) { state.likeSyncBusy = false; render(); refreshNativeLikes(); } }
}

function blacklistSnackbar() {
  const id = state.undoBlacklist;
  if (!id || !state.blacklist[id]) return '';
  return `<div class="snackbar" role="status"><span>已拉黑「${escape(state.blacklist[id].title)}」</span><button class="text-button" data-action="unblock-song" data-id="${escape(id)}">撤销</button><button class="snackbar-close" data-action="dismiss-undo" aria-label="关闭提示">${icon('close')}</button></div>`;
}

function overlayPanel() {
  return renderOverlaySettings({ open: state.overlayOpen, native: Boolean(mobileRuntime), overlay: state.overlay, busy: state.overlayBusy, error: state.overlayError, device: state.nativeDevice }, { escape });
}
async function refreshOverlay() {
  if (!mobileRuntime) return;
  try { state.overlay = await mobileRuntime.requestNative('overlay_status'); state.overlayError = ''; }
  catch (error) { state.overlayError = error.message; }
  if (state.tab === 'profile') render(); else renderChrome();
}

async function overlayCommand(command, payload = {}) {
  if (!mobileRuntime || state.overlayBusy) return;
  state.overlayBusy = true; state.overlayError = ''; render();
  try { state.overlay = await mobileRuntime.requestNative(command, payload); }
  catch (error) { state.overlayError = error.message; }
  finally { state.overlayBusy = false; render(); }
}

function exportSongs() {
  return (state.exportScope === 'collection' ? collectionSongs() : state.queue).filter(song => !isBlockedSong(song));
}


function providerConsentKey(provider) {
  return JSON.stringify([provider.version, Boolean(provider.network), provider.endpoint || '']);
}

function allPlugins() {
  return [...builtinPlugins, ...state.plugins];
}

function applyAppearance(sendNative = true) {
  document.documentElement.dataset.theme = resolvedAppearance(state.appearance, systemTheme);
  if (sendNative && mobileRuntime) mobileRuntime.requestNative('appearance', { theme: state.appearance }).catch(() => {});
}

function activeSearchInput() {
  const id = document.activeElement?.id;
  return id === 'search' && state.tab === 'library' || id === 'profile-search' && state.tab === 'profile' ? id : null;
}

function openSongMenuIds(container) {
  return [...(container?.querySelectorAll('.song-more[open]') || [])].map(menu => menu.closest('[data-song]')?.dataset.song);
}

function restoreSongMenus(container, ids) {
  for (const menu of container.querySelectorAll('.song-more')) if (ids.includes(menu.closest('[data-song]')?.dataset.song)) menu.open = true;
}

function renderSearchResults(id) {
  if (searchInputs[id]?.composing) return;
  const selector = id === 'search' ? '#library-results' : '#profile-results';
  const current = document.querySelector(selector);
  if (!current || id === 'search' && state.tab !== 'library' || id === 'profile-search' && state.tab !== 'profile') return;
  const template = document.createElement('template');
  template.innerHTML = id === 'search' ? library() : renderPersonal({ state, songs: allSongs(), native: Boolean(mobileRuntime), helpers: { escape, icon, safeImage, trackRow, overlayPanel, queueSaver } });
  const next = template.content.querySelector(selector);
  if (next) { restoreSongMenus(next, openSongMenuIds(current)); current.replaceWith(next); }
}

function nav(mobile = false) {
  return `<nav ${mobile ? 'class="mobile-nav" aria-label="主导航"' : 'aria-label="主导航"'}>${[
    ['workspace', 'tune', '随机工作台'], ['sync', 'sync', '连接音乐'], ['library', 'library', '我的曲库'], ...(state.features.netease ? [['daily', 'sun', '日推']] : []), ['profile', 'user', '我的']
  ].map(([tab, glyph, label]) => `<button class="nav-button ${state.tab === tab ? 'active' : ''}" data-tab="${tab}" aria-label="${label}" ${state.tab === tab ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>`;
}

function render() {
  if (globalThis.__suitingBootTimer) { clearTimeout(globalThis.__suitingBootTimer); globalThis.__suitingBootTimer = 0; }
  if (activeSearchInput()) {
    renderPending = true;
    renderChrome();
    return;
  }
  renderPending = false;
  const openMenus = document.querySelector('.main')?.classList.contains(`surface-${state.tab}`) ? openSongMenuIds(root) : [];
  const lyricScroll = document.querySelector('.lyrics-lines')?.scrollTop || 0;
  draggingProgress = false;
  const headings = { workspace: ['今天想怎么听？', '选范围，挑氛围，生成下一批。'], library: ['我的音乐', '收藏的歌单，熟悉的打开方式。'], sync: ['连接你的音乐', '连接账号 → 同步歌单 → 回到工作台开始听。'], daily: ['日推', '网易云推荐，喜欢就留下。'], profile: ['个人主页', '收藏、黑名单与桌面歌词。'] };
  const [title, subtitle] = headings[state.tab];
  root.innerHTML = `<div class="shell"><aside class="rail"><a href="#" class="brand" data-tab="workspace"><img src="/icon.svg" alt=""><span>随听 <span class="gpt-label">自由调频</span><small>SUI TING</small></span></a>${nav()}<div class="rail-foot">${icon('shield')}<p>随听 · 0.1.4<br>本地音乐 · 自由调频</p></div></aside><main class="main surface-${state.tab}" aria-busy="${state.busy}"><header class="topbar"><div class="top-title"><h1>${title}</h1><p>${subtitle}</p></div><div class="topbar-actions"><button class="button guide-button" data-action="open-guide">指南</button><button class="button connection-button" data-action="connect-netease" ${state.busy ? 'disabled' : ''}>${icon('music')}${state.status.loggedIn && state.features.netease ? '网易云 · 已连接' : '连接网易云'}</button><button class="button sync-button" ${!state.features.netease ? 'hidden' : ''} data-action="sync-all" ${state.busy || !state.sources.some(isRemoteSource) ? 'disabled' : ''}>${icon('sync')}同步</button><button class="button account-button" data-tab="profile" aria-label="个人主页"><span class="my-avatar">${state.localAvatar ? `<img src="${escape(state.localAvatar)}" alt="">` : icon('user')}</span><span class="my-label">我的</span></button></div></header>
  ${state.unsaved ? '<div class="notice error" role="alert">本次更改尚未保存，请先导出备份。<button class="text-button" data-action="export-backup">立即导出</button></div>' : ''}
  ${state.error ? `<div class="notice error" role="alert">${escape(state.error)} <button class="text-button" data-action="dismiss-error">收起</button></div>` : ''}
  ${state.busy ? `<div class="notice" role="status">${escape(state.busyText)}</div>` : ''}
  ${state.classifyProgress ? `<div class="background-progress" role="status">自动分类 ${state.classifyProgress.done} / ${state.classifyProgress.total}<button class="text-button" data-action="pause-classify">${state.classifyPaused ? '当前批结束后暂停' : '暂停'}</button></div>` : ''}

  ${state.tab === 'workspace' ? workspace() : state.tab === 'library' ? library() : state.tab === 'daily' ? renderDaily({ state, songs: dailySongs(), helpers: { escape, icon, trackRow, libraryPlaylistRow } }) : state.tab === 'profile' ? renderPersonal({ state, songs: allSongs(), native: Boolean(mobileRuntime), helpers: { escape, icon, safeImage, trackRow, overlayPanel, queueSaver, renderCustomization: () => (state.profileSection === 'plugins' ? renderFeatureSettings({state,escape}) : '') + renderCustomization({ state, plugins: allPlugins(), providers: queueProviders, helpers: { escape, icon } }) } }) : syncPage()}</main>${nav(true)}${blacklistSnackbar()}<input class="file-input" type="file" id="local-audio-files" accept="audio/*,.mp3,.flac,.m4a,.wav,.ogg,.opus,.aac" multiple><input class="file-input" type="file" id="local-lyrics-file" accept="text/plain,.lrc,.txt"></div>`;
  restoreSongMenus(root, openMenus);
  renderChrome();
  const settings = document.querySelector('.player-settings');
  if (settings) settings.open = state.playerOpen;
  const container = document.querySelector('.lyrics-lines');
  if (container && !state.lyricFollow) container.scrollTop = lyricScroll;
  else updateLyricProgress(player.snapshot(), true);
}


function currentPlayingSongs() {
  const view = player.snapshot();
  return view.queueId && view.queueId === state.activeQueueId ? normalizePlayingQueue(state.activeQueue.filter(song => canUseSong(song, state.features)), Object.keys(state.blacklist), state.artistBlacklist) : [];
}

function dismissGuide() {
  state.guideOpen = false; state.guideSeen = true; persist(); renderChrome();
  document.querySelector('[data-action="open-guide"]')?.focus({ preventScroll: true });
}

function closePlayer() {
  state.playerExpanded = false; renderChrome();
  document.querySelector('[data-action="open-player"]')?.focus({ preventScroll: true });
}

function renderChrome() {
  const view = player.snapshot();
  document.querySelector('#mini-player-host').innerHTML = renderMiniPlayer({ view, candidateCount: state.queue.length, loading: state.queueLoading, native: Boolean(mobileRuntime), overlay: state.overlay, helpers: { escape, icon, safeImage } });
  const dialog = document.querySelector('#player-dialog');
  const body = document.querySelector('#player-sheet-body');
  if (state.playerExpanded) {
    const active = body.contains(document.activeElement) ? document.activeElement : null;
    const action = active?.dataset.action;
    const focusedId = active?.id;
    const songId = active?.dataset.id;
    const scroll = body.scrollTop;
    const lyricScroll = body.querySelector('.lyrics-lines')?.scrollTop || 0;
    body.innerHTML = state.playerTab === 'queue'
      ? renderPlayingQueue({ view, songs: currentPlayingSongs(), visibleCount: state.playingQueueVisible, helpers: { escape, icon, blacklistButton } })
      : playerPanel() + (mobileRuntime ? `<div class="player-overlay-shortcuts"><button class="button" data-action="quick-overlay" ${state.overlayBusy ? 'disabled' : ''}>${state.overlay?.enabled ? '关闭桌面歌词' : '开启桌面歌词'}</button><button class="button" data-action="overlay-options">歌词样式与权限</button></div>${state.overlayError ? `<p class="notice error" role="alert">${escape(state.overlayError)}</p>` : ''}${overlayPanel()}` : '');
    body.scrollTop = scroll;
    const settings = body.querySelector('.player-settings');
    if (settings) settings.open = state.playerOpen;
    const lines = body.querySelector('.lyrics-lines');
    if (lines && !state.lyricFollow) lines.scrollTop = lyricScroll;
    const selector = focusedId ? '#' + CSS.escape(focusedId) : action ? `[data-action="${CSS.escape(action)}"]${songId ? `[data-id="${CSS.escape(songId)}"]` : ''}` : '';
    if (selector) body.querySelector(selector)?.focus({ preventScroll: true });
    for (const button of document.querySelectorAll('[data-action="player-tab"]')) button.setAttribute('aria-pressed', String(button.dataset.section === state.playerTab));
    if (!dialog.open) dialog.showModal();
    updateLyricProgress(view, true);
  } else if (dialog.open) dialog.close();
  const guide = document.querySelector('#guide-dialog');
  if (state.guideOpen) {
    document.querySelector('#guide-body').innerHTML = renderListeningWelcome({ state, songCount: allSongs().length, escape });
    if (!guide.open) guide.showModal();
  } else if (guide.open) guide.close();
}

async function quickOverlay() {
  if (!state.features.lyrics || !state.features.desktopLyrics) { toast('请先在功能插件中开启「歌词与翻译」及「桌面歌词」。'); return; }
  if (!mobileRuntime || state.overlayBusy) return;
  await refreshOverlay();
  if (!state.overlay?.permission) {
    state.playerExpanded = true; state.playerTab = 'now'; state.overlayOpen = true;
    state.overlayError = '首次使用需要系统「显示在其他应用上层」权限。授权后，返回这里即可一键开关。';
    renderChrome(); document.querySelector('.player-dialog .overlay-panel')?.scrollIntoView({ block: 'start' }); return;
  }
  await overlayCommand('overlay_enable', { enabled: !state.overlay.enabled });
}

document.querySelector('#guide-dialog').addEventListener('cancel', event => { event.preventDefault(); dismissGuide(); });
document.querySelector('#player-dialog').addEventListener('cancel', event => { event.preventDefault(); closePlayer(); });

function playerPanel() {
  const view = player.snapshot();
  const available = state.queue.some(song => !song.demo && !isBlockedSong(song) && canUseSong(song,state.features) && isPlayableSongId(song.id));
  if (!view.song) return `<section class="queue-player player-idle" aria-label="队列播放器">${state.queueLoadError ? `<p class="notice error" role="alert">${escape(state.queueLoadError)}</p>` : ''}<div>${icon('music')}<span>${available ? '队列已准备好，按顺序接着听' : '生成队列后，在这里连续播放'}</span></div><div><button class="button quiet small" data-action="player-mode">${icon('repeat')}${playbackModes[view.mode || 'order']}</button><button class="button primary" data-action="play-queue" ${!available ? 'disabled' : ''}>${icon('play')}播放</button></div></section>`;
  const cover = safeImage(view.song?.cover);
  const loadedBatch = Boolean(state.queueBatchId && view.queueId === state.queueBatchId && view.count);
  const mode = view.mode || 'order';
  const canNext = view.canNext ?? (view.index + 1 < view.count || mode === 'loop' && view.count > 0);
  return `<section class="queue-player" aria-label="队列播放器"><div class="player-stage"><div class="player-heading"><div class="player-art">${cover ? `<img src="${escape(cover)}" alt="" referrerpolicy="no-referrer">` : icon('music')}</div><div class="player-track"><h2>${escape(view.song?.title || '随听播放器')}</h2><p>${escape(view.song?.artist || '选好一批歌，按自己的节奏听。')}</p><span>${view.count ? `${view.index + 1} / ${view.count} 首 · ${view.error ? '播放中断' : view.loading ? '正在连接' : view.ended ? '本批已播完' : view.paused ? '已暂停' : '播放中'}` : '尚未载入队列'}</span></div></div>${state.features.lyrics && state.lyricsOpen ? lyricsPanel(view) : '<p class="lyric-hidden">可在功能插件开启歌词，再导入 LRC 或读取平台歌词。</p>'}</div>
  <div class="player-timeline"><label class="sr-only" for="player-progress">播放进度</label><input id="player-progress" type="range" min="0" max="1000" value="${view.duration ? Math.round(view.currentTime / view.duration * 1000) : 0}" aria-valuetext="${formatTime(view.currentTime)} / ${formatTime(view.duration)}" ${!view.duration ? 'disabled' : ''}><div class="player-time"><span id="player-elapsed">${formatTime(view.currentTime)}</span><span id="player-duration">${formatTime(view.duration)}</span></div></div>
  <div class="player-transport"><button class="icon-button" data-action="player-previous" aria-label="上一首" ${!view.song ? 'disabled' : ''}>${icon('previous')}</button><button class="button primary player-toggle" data-action="player-toggle" aria-label="${view.paused || view.ended ? '播放' : '暂停'}" ${!view.song && !available ? 'disabled' : ''}>${icon(view.paused || view.ended ? 'play' : 'pause')}<span>${view.paused || view.ended ? '播放' : '暂停'}</span></button><button class="icon-button" data-action="player-next" aria-label="下一首" ${!canNext ? 'disabled' : ''}>${icon('next')}</button></div>
  <div class="player-secondary"><button class="button quiet small" data-action="player-mode" aria-label="切换播放模式，当前${playbackModes[mode]}">${icon(mode === 'shuffle' ? 'shuffle' : 'repeat')}${playbackModes[mode]}</button><button class="button quiet small" data-action="toggle-lyrics" aria-expanded="${state.lyricsOpen}" ${!view.song || !state.features.lyrics ? 'disabled' : ''}>歌词</button>${collectionButton(view.song)}${officialLikeButton(view.song)}${blacklistButton(view.song)}<button class="button quiet small queue-load-action" data-action="play-queue" ${!available || state.queueLoading || loadedBatch ? 'disabled' : ''}>${state.queueLoading ? '正在替换…' : loadedBatch ? '本批已载入' : '替换并播放本批'}</button><button class="button quiet small" data-action="clear-queue">停止并清空播放列表</button></div>
  <p class="queue-session-note" role="status">${loadedBatch ? `播放器正使用这批 ${view.count} 首，生成新候选不会打断它。` : '播放器仍使用原列表；新候选需要手动点击播放才替换。'}</p>${state.queueLoadError ? `<p class="notice error" role="alert">${escape(state.queueLoadError)}</p>` : ''}
  ${view.error ? `<p class="notice error" role="alert">${escape(view.error)}</p>` : ''}
  <details class="player-settings"><summary>音质与播放设置<span>${escape(isLocalSongId(view.song?.id) ? '原文件' : qualityDefinitions[view.quality]?.name.split(' · ')[0] || '极高')}</span></summary><div class="player-settings-body"><div><label for="player-quality">平台音质请求（本地使用原文件）</label><select id="player-quality" ${isLocalSongId(view.song?.id) ? 'disabled' : ''}>${Object.entries(qualityDefinitions).map(([value, item]) => `<option value="${value}" ${view.quality === value ? 'selected' : ''}>${item.name}</option>`).join('')}</select><p class="player-quality-actual">${escape(qualityDescription(view.info))}</p></div><div><label for="player-volume">应用音量</label><input id="player-volume" type="range" min="0" max="100" value="${Math.round(view.volume * 100)}" aria-valuetext="${Math.round(view.volume * 100)}%"></div><p class="tiny-note player-explanation">音质独立于网易云设置，以实际返回与账号权限为准，不保证设备输出无损。歌词缺失不影响播放。顺序播放到末尾从第一首继续，单曲循环重复当前歌，列表循环整批重播；随机播放只洗牌已载入的队列，每轮不重复，循环使用该随机顺序。切歌按钮仍可手动切歌。</p><p class="tiny-note player-explanation">生成只更新候选；点击「播放这批」才替换当前列表。拉黑会立即移出播放队列。实际播放满 15 秒计入冷却，拖动进度不算。</p></div></details></section>`;
}
function workspace() {
  if (!allSongs().length) return renderCompactEmpty();
  const songs = selectedSongs();
  const selectedMoods = state.options.moods;
  const moodTitle = selectedMoods.length ? `${selectedMoods.slice(0, 3).map(mood => moodNames[mood]).join(' · ')}，一起听。` : '你的下一批好歌';
  const demo = state.sources.length && state.sources.every(source => source.demo);
  const coverage = getClassificationCoverage(songs, state.options);
  const selected = state.options.playlistIds;
  const available = songs.filter(song => !song.blocked).length;
  return `<div class="source-strip">${icon('library')}<span>${activeSources().length} 个歌单 · 可选 ${available} 首</span><button class="text-button" data-tab="sync">管理同步</button></div>
  <div class="workspace"><section class="tuning" aria-label="随机设置"><div class="tuning-head"><h2>随机设置</h2></div>
  <div class="control-group"><details class="scope-picker" data-detail="scope-picker" ${state.scopePickerOpen || state.scopeImportOpen ? 'open' : ''}><summary><strong>从哪里挑歌</strong><span>${selected.length ? escape(state.sources.filter(item => selected.includes(String(item.id))).map(item => item.name).join(' / ')) : '全部曲库'} · ${available} 首可选</span></summary><div class="scopes"><button class="chip ${!selected.length ? 'selected' : ''}" data-action="scope-all" aria-pressed="${!selected.length}">全部曲库</button>${activeSources().map(item => `<button class="chip ${selected.includes(String(item.id)) ? 'selected' : ''}" data-action="scope" data-id="${escape(item.id)}" aria-pressed="${selected.includes(String(item.id))}"><span>${escape(item.name)}</span></button>`).join('')}<button class="chip add" data-action="local-import">${icon('plus')}本地音乐</button>${state.features.netease ? '<button class="chip add" data-action="toggle-scope-import">网易云歌单</button>' : ''}</div>${state.scopeImportOpen ? playlistLinkForm('scope') : ''}</details></div>
  <div class="control-group"><div class="control-title"><strong>此刻的氛围</strong><span>可多选</span></div><div class="moods" role="group" aria-label="氛围多选">${Object.entries(moodNames).map(([mood, name]) => { const active = mood === 'all' ? !selectedMoods.length : selectedMoods.includes(mood); return `<button class="mood ${mood === 'all' ? 'all' : ''} ${active ? 'selected' : ''}" data-action="mood" data-mood="${mood}" aria-pressed="${active}"><span class="mood-dot" style="--mood:${moodColors[mood]}"></span>${mood === 'all' ? '不限氛围' : name}</button>`; }).join('')}</div></div>
  <div class="control-group">${renderExclusions({ state, moodNames, genreDefinitions, languageDefinitions, escape })}</div>
  <div class="control-group">${renderListeningFilters({ state, escape, content: genreControls() + renderLanguageControls({ state, songs: selectedSongs(true).filter(song => !song.blocked), escape }) })}</div>
  <div class="control-group"><div class="select-pair"><div><label for="count">这次听几首</label><select id="count">${countPresets.map(count => `<option value="${count}" ${state.options.countMode === 'preset' && Number(state.options.count) === count ? 'selected' : ''}>${count} 首</option>`).join('')}<option value="custom" ${state.options.countMode === 'custom' ? 'selected' : ''}>自定义数量</option><option value="all" ${state.options.countMode === 'all' ? 'selected' : ''}>范围内全部</option></select></div><div><label for="cooldown">最近听过的</label><select id="cooldown">${[[0, '不避开'], [1, '避开 1 天'], [3, '避开 3 天'], [7, '避开 7 天']].map(([days, text]) => `<option value="${days}" ${Number(state.options.cooldownDays) === days ? 'selected' : ''}>${text}</option>`).join('')}</select></div></div>${state.options.countMode === 'custom' ? `<label class="slider-label" for="custom-count">自定义数量（1–5000）</label><input id="custom-count" class="text-input" type="number" min="1" max="5000" step="1" required value="${state.options.count}">` : ''}</div>
  <div class="control-group advanced-group"><details class="workbench-advanced" data-detail="advanced" ${state.advancedOpen ? 'open' : ''}><summary>精细调频与分类<span>近期比例 · 参考歌单 · 标签 · 分类</span></summary><div class="advanced-settings"><div class="range-control"><div class="control-title"><label for="variation">听感变化</label><span id="variation-value">${state.options.variation}%</span></div><input id="variation" type="range" min="0" max="100" value="${state.options.variation}"><div class="range-labels"><span>更连贯</span><span>更有惊喜</span></div></div>${recentControls(songs)}${referenceControls()}${tagControls()}${classificationControls(coverage)}${autoClassifyPanel(songs)}</div></details></div>
  <div class="control-group generate-group"><button class="button primary generate" data-action="generate" ${!available || state.busy ? 'disabled' : ''}>${icon('shuffle')}生成随机队列${icon('arrow')}</button><div class="classification-brief"><span>氛围可用 ${coverage.moodKnown} / ${coverage.total} 首</span><button class="text-button" data-action="show-classification">${state.classifyProgress ? `正在分类 ${state.classifyProgress.done}/${state.classifyProgress.total}` : '补全分类'}</button></div><p class="extension-status">${state.enabledPlugins.length ? `已启用 ${state.enabledPlugins.length} 个重排扩展；只影响下次生成。` : '生成只更新候选；点击「播放这批」才切换播放列表。'}</p></div>
  </section><section class="queue" aria-label="随机结果"><p class="queue-context">${selectedMoods.length ? escape(moodTitle) : '候选不会打断正在播放的歌'}${demo ? ' · 示例无音频' : ''}</p>
    <div class="queue-toolbar"><div class="queue-heading"><h2>下一批候选</h2><span>${state.queue.length ? `${state.queue.length} 首` : '等待调频'}</span></div><div class="queue-tools"><button class="button quiet small" data-action="reorder" ${!state.queue.length || state.busy ? 'disabled' : ''}>${icon('shuffle')}换顺序</button><button class="button small" data-action="generate" ${!songs.length || state.busy ? 'disabled' : ''}>换一批${icon('sync')}</button><button class="button small" data-action="toggle-playlist-export" ${!state.queue.length || state.busy || !state.features.netease ? 'disabled' : ''}>${icon('plus')}保存到网易云</button></div></div>
    <button class="button primary candidate-play" data-action="play-queue" ${state.queueLoading || !state.queue.some(song => !song.demo) ? 'disabled' : ''}>${icon('play')}${player.snapshot().song && player.snapshot().queueId !== state.queueBatchId ? '替换播放列表并播放' : '播放这批'}</button><div class="queue-batch-actions"><span class="tiny-note">${player.snapshot().queueId === state.queueBatchId && player.snapshot().song ? '播放器正在使用这一批' : '只生成候选，不打断正在播放的音乐'}</span><button class="button quiet small" data-action="clear-candidates" ${!state.queue.length ? 'disabled' : ''}>清空候选</button></div>${queueSaver()}
    <p id="queue-settings-note" class="notice" role="status" ${!state.queue.length || state.queueSettings === queueSettingsSignature() ? 'hidden' : ''}>设置或曲库已改变，当前仍是旧队列。请点「生成」或「换一批」应用；「换顺序」不会重新选歌。</p>
    <details class="selection-details"><summary>本批规则与匹配说明</summary>${selectionReport()}${state.warnings.map(warning => `<p class="notice">${escape(warning)}</p>`).join('')}</details>
    ${classificationRecovery()}
    ${state.queue.length ? `<div class="track-list">${state.queue.slice(0, state.queueVisible).map((song, index) => trackRow({ ...song, ...state.edits[song.id] }, index)).join('')}</div>${state.queue.length > state.queueVisible ? `<div class="section-foot"><button class="button small" data-action="show-more-queue">显示更多（${state.queueVisible} / ${state.queue.length} 首）</button></div>` : ''}<div class="section-foot"><button class="button quiet" data-action="export-queue">${icon('download')}导出完整队列文字与链接</button></div>` : `<div class="empty-state queue-empty">${icon('music')}<h3>${songs.length ? '把下一首，交给好奇心。' : '先把喜欢的歌带过来'}</h3><p>${songs.length ? '选好范围和氛围，点一下生成。<br>歌不够时会说明原因，不偷偷放宽规则。' : '导入本地音乐，或按需启用网易云，<br>或者先用示例曲库试试随机的感觉。'}</p>${!songs.length ? '<div class="empty-links"><button class="button primary" data-tab="sync">连接我的歌单</button><button class="button" data-action="demo">先体验示例</button></div>' : ''}</div>`}
    <p class="disclosure">${icon('clock')} 冷却记录来自本原型内的试听和手动“标记听过”，不包含网易云 App 的完整播放历史。此版暂不接管官方 App 的播放队列。</p>
  </section></div>`;
}
function trackRow(entry, index, inLibrary = false) {
  const song = { ...entry };
  const blocked = isBlockedSong(song);
  const cover = safeImage(song.cover);
  const link = songLink(song);
  return `<article class="track ${blocked ? 'blocked-track' : ''} ${state.editingId === song.id ? 'focus-song' : ''}" data-song="${escape(song.id)}"><span class="track-number">${String(index + 1).padStart(2, '0')}</span><div class="cover">${cover ? `<img src="${escape(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('music')}</div><div class="song-info"><div class="song-title"><strong>${escape(song.title)}</strong>${blocked ? '<span class="tag">已拉黑</span>' : inLibrary && song.autoSource ? '<span class="tag auto">百科</span>' : ''}</div><p class="song-meta">${escape(song.artist || '未知歌手')}${song.demo ? ' · 合成示例' : isLocalSongId(song.id) ? ' · 本地' : ' · 网易云'}${effectiveGenre(song) ? ` · ${genreDefinitions[effectiveGenre(song)]}` : ''}</p>${inLibrary ? `<p class="song-classification">${escape(songMoods(song).map(mood => moodNames[mood]).join(' / ') || '氛围待分类')} · ${escape(songLanguages(song).map(key => languageDefinitions[key]).join(' / ') || '语种待识别')}</p>` : ''}${!inLibrary && song.reason ? `<details class="track-explanation"><summary>为什么选这首</summary><p class="track-reason">${escape(song.reason)}</p></details>` : ''}</div><div class="song-actions"><button class="icon-button" data-action="preview" data-id="${escape(song.id)}" ${song.demo || blocked ? 'disabled' : ''} aria-label="播放 ${escape(song.title)}">${icon(state.playingId === song.id ? 'pause' : 'play')}</button>${collectionButton(song)}<details class="song-more"><summary aria-label="更多：${escape(song.title)}">${icon('more')}</summary><div class="song-menu">${officialLikeButton(song)}${isLocalSongId(song.id) && state.features.lyrics ? `<button class="button quiet" data-action="local-lyrics" data-id="${escape(song.id)}">${icon('lyrics')}导入 LRC 歌词</button>` : ''}${inLibrary ? `<button class="button quiet" data-action="edit" data-id="${escape(song.id)}">${icon('tag')}编辑分类</button>` : !song.dailyRecommendation ? `<button class="button quiet mark-heard" data-action="heard" data-id="${escape(song.id)}">${icon('check')}标记听过</button>` : ''}${blacklistButton(song)}${link ? `<a class="button quiet open-link" href="${link}" target="_blank" rel="noopener noreferrer">${icon('external')}在网易云打开</a>` : ''}</div></details></div></article>${inLibrary && state.editingId === song.id ? tagEditor(song) : ''}`;
}
function tagEditor(song) {
  return `<section class="tag-editor" aria-label="编辑 ${escape(song.title)} 的分类"><div class="tag-editor-grid"><div><label for="edit-mood">这首歌的氛围</label><select id="edit-mood"><option value="">待分类</option>${Object.entries(moodNames).filter(([mood]) => mood !== 'all').map(([mood, name]) => `<option value="${mood}" ${effectiveMood(song) === mood ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div><label for="edit-genre">这首歌的风格</label><select id="edit-genre"><option value="">待分类</option>${Object.entries(genreDefinitions).map(([genre, name]) => `<option value="${genre}" ${effectiveGenre(song) === genre ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="energy-field"><label for="edit-energy">能量感 <span id="energy-value">${song.localEnergy ?? song.energy ?? 50}</span> / 100</label><input id="edit-energy" type="range" min="0" max="100" value="${song.localEnergy ?? song.energy ?? 50}"></div></div>${renderLanguageEditor(song, escape)}<label for="edit-tags">自己的标签（逗号分隔）</label><input class="text-input" id="edit-tags" placeholder="比如：散步、夜里、不想被打扰" value="${escape((song.localTags || []).join('，'))}" maxlength="200"><p class="caption">分类只保存在本原型中，同步更新时会保留。</p>${song.autoSource ? `<p class="tiny-note">网易云百科自动分类：${escape(autoLabel(song))}${song.autoTags?.length ? ` · 标签 ${escape(song.autoTags.join(' / '))}` : ''}${song.autoBpm ? ` · BPM ${song.autoBpm}` : ''}。这是待确认数据，你保存自己的分类后以手工值为准。</p>` : ''}<div class="actions"><button class="button quiet small" data-action="cancel-edit">取消</button><button class="button primary small" data-action="save-edit" data-id="${escape(song.id)}">保存分类</button></div></section>`;
}

function sourceRow(source) {
  const skipped = Number(source.skippedCloudCount) || 0;
  const matched = Number(source.matchedCloudCount) || 0;
  const filtering = `${skipped ? ` · 已跳过 ${skipped} 首云盘/未收录歌曲` : ''}${matched ? ` · ${matched} 首使用官方版本` : ''}`;
  const declared = Number.isSafeInteger(source.sourceTrackCount) && source.sourceTrackCount !== source.songs.length ? `（歌单标注 ${source.sourceTrackCount} 首）` : '';
  return `<div class="source-row"><div><h3>${escape(source.name)} ${source.demo ? '<span class="tag">合成示例</span>' : `${source.local ? '<span class="tag">本机收藏</span>' : source.owned ? '<span class="tag">自建</span>' : '<span class="tag">收藏</span>'}${source.private ? '<span class="tag">私密</span>' : ''}`}</h3><p>${source.songs.length} 首${escape(declared)}${source.demo ? ' · 用于体验规则，不含音频' : ` · ${escape(formatDate(source.syncedAt))} 同步${source.lastChange ? ` · 新增 ${source.lastChange.added} / 移除 ${source.lastChange.removed}` : ''}${filtering}`}</p></div><div class="actions">${isRemoteSource(source) ? `<button class="button small" data-action="sync-one" data-id="${escape(source.id)}" ${state.busy ? 'disabled' : ''}>${icon('sync')}更新</button>` : ''}<button class="icon-button" data-action="remove-source" data-id="${escape(source.id)}" aria-label="移除本机歌单 ${escape(source.name)}" title="仅移除本机快照">${icon('close')}</button></div></div>`;
}

function libraryPlaylistRow(source) {
  const cover = safeImage(source.cover || source.songs?.find(song => safeImage(song.cover))?.cover);
  const liked = source.isLiked || source.specialType === 5;
  return `<article class="library-playlist"><button class="playlist-open" data-action="${source.recommended ? 'import-daily-playlist' : 'open-library'}" data-id="${escape(source.id)}" ${source.recommended && state.busy ? 'disabled' : ''}><span class="playlist-cover ${liked ? 'liked-cover' : ''}">${cover ? `<img src="${escape(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon(liked ? 'heart' : 'music')}</span><span class="playlist-copy"><strong>${escape(source.name)}</strong><small>${source.recommended ? Number(source.trackCount) || 0 : source.songs.length} 首 · ${escape(source.origin === 'files' ? '本地音频' : source.local ? '本机收藏' : ownerName(source.owner) || (source.owned ? '我创建的歌单' : '网易云歌单'))}${source.recommended ? ' · 点按只读同步' : source.private ? ' · 私密' : ''}</small></span>${icon(source.recommended ? 'plus' : 'chevron')}</button></article>`;
}
function library() {
  const songs = allSongs();
  const blocked = Object.values(state.blacklist).sort((left, right) => right.blockedAt - left.blockedAt);
  const owned = activeSources().filter(source => source.owned || source.isLiked || source.specialType === 5);
  const savedLists = activeSources().filter(source => !owned.includes(source));
  const source = activeSources().find(item => item.id === state.libraryPlaylist);
  const categories = [['recent', '近期', state.sources.length], ['created', '创建', owned.length], ['saved', '收藏', savedLists.length], ['songs', '全部歌曲', songs.length]];
  const tabs = `<div class="library-tabs" role="group" aria-label="曲库分类">${categories.map(([key, name, count]) => `<button data-action="library-category" data-category="${key}" class="library-tab ${state.libraryCategory === key && !source ? 'active' : ''}" aria-pressed="${state.libraryCategory === key && !source}">${name}<small>${count}</small></button>`).join('')}</div>`;
  const keyword = state.search.trim().toLowerCase();
  const showSongs = source || ['songs', 'blacklist'].includes(state.libraryCategory) || keyword;
  const selected = state.libraryCategory === 'blacklist' && !source ? blocked.map(song => ({ ...song, blocked: true })) : source ? songs.filter(song => song.playlistIds.includes(source.id)) : songs;
  const matches = selected.filter(song => matchesSearch([song.title, song.artist, song.album, ...songMoods(song).map(mood => moodNames[mood]), ...songLanguages(song).map(key => languageDefinitions[key]), ...(song.localTags || [])], keyword));
  const lists = state.libraryCategory === 'created' ? owned : state.libraryCategory === 'saved' ? savedLists : [...activeSources()].sort((left, right) => (state.libraryVisits[right.id] || 0) - (state.libraryVisits[left.id] || 0) || Number(Boolean(right.isLiked || right.specialType === 5)) - Number(Boolean(left.isLiked || left.specialType === 5)));
  return `<section class="library-home" aria-label="我的曲库">${tabs}<div class="library-tools"><label class="sr-only" for="search">搜索曲库</label><input id="search" class="text-input" type="search" placeholder="搜索歌曲、歌手或标签" aria-label="搜索曲库" value="${escape(state.search)}"><button class="button small" data-action="local-import">${icon('plus')}导入音乐</button></div>
  ${source ? `<div class="library-playlist-heading"><button class="button quiet small" data-action="library-back">返回歌单</button><h2>${escape(source.name)}</h2><span>${source.songs.length} 首</span><button class="button primary small" data-action="play-library" data-id="${escape(source.id)}">${icon('play')}播放歌单</button><button class="button small" data-action="use-library-scope" data-id="${escape(source.id)}">用它随机</button></div>` : ''}
  <div id="library-results" aria-live="polite">${showSongs ? `<div class="library-head"><h2>${state.libraryCategory === 'blacklist' && !source ? '黑名单' : source ? '歌单歌曲' : '所有歌曲'} <span class="caption">${matches.length} 首</span></h2>${state.libraryCategory === 'blacklist' ? '<p class="blacklist-note">仅在随听排除，不删除网易云歌曲。恢复后可再次参与随机。</p>' : ''}</div><div class="library-rows">${matches.slice(0, state.visibleCount).map((song, index) => trackRow(song, index, true)).join('') || '<div class="empty-state"><p>这里暂时没有歌曲。</p></div>'}</div>${matches.length > state.visibleCount ? '<button class="button" data-action="show-more">再显示 60 首</button>' : ''}` : `<div class="playlist-browser">${lists.map(libraryPlaylistRow).join('') || '<div class="empty-state"><h3>这里还没有歌单</h3><p>到同步页把你的收藏带过来。</p><button class="button primary" data-tab="sync">导入音乐／管理来源</button></div>'}</div>`}</div></section>`;
}
function remoteRow(playlist) {
  const connected = state.sources.some(source => source.id === String(playlist.id));
  return `<div class="remote-playlist"><div><h3>${escape(playlist.name)} ${playlist.isLiked || playlist.specialType === 5 ? '<span class="tag">我喜欢</span>' : playlist.owned ? '<span class="tag">自建</span>' : '<span class="tag">收藏</span>'} ${playlist.private ? '<span class="tag">私密</span>' : ''}</h3><p>${playlist.trackCount} 首${playlist.owner ? ` · ${escape(playlist.owner)}` : ''}${connected ? ' · 已连接' : ''}</p></div><button class="button small" data-action="sync-one" data-id="${escape(playlist.id)}" ${state.busy ? 'disabled' : ''}>${connected ? '更新' : '同步'}</button></div>`;
}

function remoteGroups() {
  const own = state.remote.filter(playlist => playlist.owned || playlist.isLiked || playlist.specialType === 5);
  const savedLists = state.remote.filter(playlist => !own.includes(playlist));
  return [['own', '我创建的', own], ['saved', '我收藏的', savedLists]].map(([key, title, items]) => `<details class="playlist-group" data-remote-group="${key}" ${state.remoteOpen[key] ? 'open' : ''}><summary><strong>${title}</strong><span>${items.length} 个歌单</span>${icon('chevron')}</summary><div class="remote-group-body">${items.map(remoteRow).join('') || '<p class="empty-group">暂无歌单</p>'}</div></details>`).join('');
}

function syncPage() {
  if (!state.features.netease) return renderLocalImport({ busy: state.busy, native: Boolean(mobileRuntime), escape }) + publicDataPanel();
  return renderSyncPage({ state, native: Boolean(mobileRuntime), helpers: { escape, icon, safeImage, remoteGroups, sourceRow, formatDate, isRemoteSource } });
}

function publicDataPanel() {
  return '<section class="panel"><h2>本机资料与备份</h2><p class="public-note">JSON 保存曲库清单、分类、规则和黑名单，不含音频、文件授权或账号凭据。公开版与两个私用版本独立存储。</p><div class="actions"><button class="button" data-action="export-backup">导出资料备份</button><button class="button" data-action="import-backup">导入资料备份</button><button class="button danger" data-action="clear-data">清空本机资料</button></div><input type="file" id="backup-file" class="file-input" accept="application/json,.json"></section>';
}
async function reloadLocalFiles() {
  const result=await api('/api/local');
  state.sources=mergeLocalLibrary(state.sources,result.songs || [],Date.now(),true);
  state.options.playlistIds=state.options.playlistIds.filter(id=>activeSources().some(source=>String(source.id)===id));
  if(!state.sources.find(source=>source.id==='local-library')?.songs.length) state.sources=state.sources.filter(source=>source.id!=='local-library');
  persist();render();
}
async function initializePublic() {
  try {const confirmed=normalizeFeatures(await api('/api/features'));state.features=mobileRuntime ? confirmed : {...normalizeFeatures(saved.features),netease:confirmed.netease};await reloadLocalFiles();if(state.features.netease) await refreshStatus();}
  catch(error) {state.error=error.message;render();}
}
async function removeLocalFiles() {
  const result=await api('/api/local');const ids=(result.songs || []).map(song=>song.id);
  if(ids.length) await api('/api/local/remove',{method:'POST',body:JSON.stringify({ids})});
}
async function importLocalFiles(files) {
  await perform('正在导入本地音乐，不上传音频…',async()=>{
    const result=mobileRuntime ? await api('/api/local/import',{method:'POST',body:'{}'}) : await localFiles.importFiles(files);
    if(result.cancelled) return;
    state.sources=mergeLocalLibrary(state.sources,result.songs || []);
    state.tab='library';state.libraryPlaylist='local-library';persist();
    toast('已导入 '+(result.songs?.length || 0)+' 首，'+(result.failed || 0)+' 首未导入。'+(result.temporary?'部分文件只获临时授权，重启后需重新选择。':'原音频未修改。'));
  });
}
async function toggleFeature(id) {
  const enabled=!state.features[id];
  if(id==='netease' && enabled && !confirm('开启后将连接网易云第一方服务；登录与歌单读取由你本人确认。本地音频不上传。可以随时关闭并断开账号。继续？')) return;
  if(id==='desktopLyrics' && enabled && !state.features.lyrics) {toast('请先开启「歌词与翻译」插件。');return;}
  await perform('正在保存功能开关…',async()=>{
    state.features=normalizeFeatures(await api('/api/features',{method:'POST',body:JSON.stringify({id,enabled})}));
    if (id === 'easterEggs' && !enabled || id === 'netease' && !enabled) easterEggs.close();
    if(id==='netease' && !enabled) {
      ++accountEpoch;clearTimeout(qrTimer);++classifyEpoch;classificationQueue.clear();state.classifyProgress=null;++languageEpoch;state.languageProgress=null;
      if (player.snapshot().song && !canUseSong(player.snapshot().song, state.features)) await listeningSession.stop(); else await player.syncBlacklist(Object.keys(state.blacklist)); state.queue=state.queue.filter(song=>canUseSong(song,state.features)); state.activeQueue=state.activeQueue.filter(song=>canUseSong(song,state.features));
      state.status={loggedIn:false};state.qr=null;state.remote=[];clearAccountViews();state.options.playlistIds=state.options.playlistIds.filter(id=>activeSources().some(source=>String(source.id)===id));
    }
    if(id==='lyrics') {lyricCache.clear();state.lyrics={id:null,status:'idle',lines:[],plain:[]};state.lyricsOpen=enabled;}
    if(id==='desktopLyrics' && !enabled) state.overlayOpen=false;
    persist();
    if(id==='netease' && enabled) await refreshStatus();
  });
}

async function api(path,options={}) {
  if(path==='/api/features') return sourceApi(path,options);
  const body=options.body ? JSON.parse(options.body) : {};
  const local=path.startsWith('/api/local') || isLocalSongId(body.id) && ['/api/preview','/api/lyrics'].includes(path);
  if(path==='/api/status' && !state.features.netease) return {loggedIn:false,profile:null};
  return sourceHost.invoke(local ? 'suiting.local' : 'suiting.netease','request',{path,options});
}
async function sourceApi(path, options = {}) {
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === '/api/lyrics' && !state.features.lyrics) throw new Error('歌词插件已关闭。');
  if (!mobileRuntime) {
    if (path === '/api/local') return {songs:await localFiles.list()};
    if (path === '/api/local/lyrics') return localFiles.saveLyrics(body.id,body.text);
    if (path === '/api/local/remove') {await localFiles.remove(body.ids);return {removed:true};}
    if (isLocalSongId(body.id) && path === '/api/preview') return localFiles.preview(body.id);
    if (isLocalSongId(body.id) && path === '/api/lyrics') return localFiles.lyrics(body.id);
  }
  const localRoute=path.startsWith('/api/local') || path === '/api/features' || isLocalSongId(body.id) && ['/api/preview','/api/lyrics'].includes(path);
  if (!localRoute && !state.features.netease) {
    if (path === '/api/status') return {loggedIn:false,profile:null};
    throw new Error('网易云连接插件已关闭，可在「我的→扩展与DIY」开启。');
  }
  if (mobileRuntime) return mobileRuntime.api(path, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path === '/api/playlist/create' ? 180000 : path.includes('/sync') || path === '/api/languages' ? 120000 : 30000);
  try {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: controller.signal, credentials: 'same-origin' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求未成功，请重试。');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(path === '/api/playlist/create' ? '创建结果待确认，请先检查本次结果或去网易云查看，不要重复新建。' : '请求超时，原有歌单未被覆盖。请稍后重试。');
    throw error;
  } finally { clearTimeout(timer); }
}

async function perform(message, operation) {
  if (state.busy) return;
  state.busy = true; state.busyText = message; state.error = ''; render();
  try { await operation(); }
  catch (error) { state.error = error.message || '操作未成功，请重试。'; }
  finally { state.busy = false; state.busyText = ''; render(); }
}

function toast(message) {
  if (state.unsaved) message = '本次更改尚未保存到浏览器，请先导出备份。';
  const element = document.querySelector('#toast');
  element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

function computeQueue(payload) {
  if (typeof Worker === 'undefined') return Promise.resolve(generateQueue(payload));
  return new Promise((resolve, reject) => {
    const worker = new Worker('/shuffle-worker.mjs', { type: 'module' });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('本次生成超过30秒，请减少首数或缩小范围后重试。')), 30000);
    worker.onmessage = event => event.data.ok ? finish(null, event.data.result) : finish(new Error(event.data.error));
    worker.onerror = () => finish(new Error('随机计算未完成，请刷新页面后重试。'));
    worker.postMessage(payload);
  });
}

async function generate(mode = 'new') {
  const generation = ++queueGeneration;
  const customInput = document.querySelector('#custom-count');
  if (mode !== 'reorder' && customInput && !customInput.reportValidity()) return;
  const count = state.options.countMode === 'all' ? selectedSongs().length : state.options.count;
  if (mode !== 'reorder' && (!Number.isInteger(count) || count < 1 || (state.options.countMode !== 'all' && count > 5000))) { state.error = '请输入 1–5000 之间的整数首数。'; render(); return; }
  const payload = { songs: allSongs(), history: state.history, previousQueue: state.queue, referenceSongs: selectedReferenceSongs(), options: { ...state.options, count, refreshMode: mode } };
  const settings = queueSettingsSignature();
  const plugins = allPlugins(); const enabled = [...state.enabledPlugins];
  await perform('正在按范围、冷却和参考偏好计算队列…', async () => {
    const result = await computeQueue(payload);
    const local = applyQueuePlugins(result.queue, plugins, enabled);
    const provided = await applyQueueProviders(local.queue, queueProviders, enabled);
    if (generation !== queueGeneration) return;
    state.queueBatchId = globalThis.crypto?.randomUUID?.() || `batch-${Date.now()}-${generation}`;
    state.queue = provided.queue.filter(song => !isBlockedSong(song) && !isExcludedByOptions(song, state.options)); state.warnings = [...result.warnings, ...local.warnings, ...provided.warnings];
    if (enabled.length) state.warnings.push('已启用的扩展只重排本批歌曲，不改变选歌数量；衔接可能与原引擎编排不同。'); state.eligibleCount = result.eligibleCount; state.queueVisible = 60;
    if (mode !== 'reorder') { state.selectionReport = result.selectionReport; state.queueSettings = settings; }
    if (state.queue.length !== result.queue.length) { state.selectionReport = null; state.warnings.push('已移除计算期间新拉黑的歌曲，请重新生成以核对比例。'); }
    persist();
    toast(`已生成 ${state.queue.length} 首候选；当前播放列表未改变。`);
  });
}
function useDemo() {
  if (!state.sources.some(source => source.id === 'demo')) state.sources.push({ ...demoPlaylist, songs: JSON.parse(JSON.stringify(demoSongs)) });
  state.options.playlistIds = ['demo']; state.tab = 'workspace'; state.error = '';
  persist(); generate();
}

async function saveQueueToNetEase() {
  await perform('正在创建并回读网易云歌单，请勿重复新建…', async () => {
    if (!state.status.loggedIn) throw new Error('请先连接网易云，再确认创建歌单。');
    if (!state.exportJob) {
      if (!exportSongs().length || exportSongs().some(song => song.demo || !/^[1-9]\d{0,19}$/.test(song.id))) throw new Error('请先生成真实歌曲队列，合成示例不能保存到网易云。');
      const prepared = await api('/api/playlist/create/prepare', { method: 'POST', body: JSON.stringify({ name: state.exportDraft.name, privacy: state.exportDraft.privacy, ids: exportSongs().map(song => song.id), accountId: state.status.profile?.userId }) });
      state.exportJob = { ...prepared, scope: state.exportScope, accountId: state.status.profile?.userId }; state.exportResult = null;
    }
    if (!persist()) throw new Error('创建凭据尚未保存到浏览器，未发起写入。请先释放浏览器存储空间。');
    state.exportResult = await api('/api/playlist/create', { method: 'POST', body: JSON.stringify({ requestId: state.exportJob.requestId }) });
    persist();
    toast(state.exportResult.complete ? '已回读确认歌曲，请打开网易云歌单。' : '本次结果需要核对，请查看保存说明。');
  });
}

async function syncOne(input, role = 'source') {
  const snapshot = await api('/api/playlist/sync', { method: 'POST', body: JSON.stringify({ input: String(input) }) });
  if (!snapshot.complete || !Array.isArray(snapshot.songs) || !snapshot.playlist?.id || snapshot.songs.length !== Number(snapshot.playlist.trackCount)) throw new Error('歌单没有完整读取，已保留旧快照。请稍后重新同步。');
  const id = String(snapshot.playlist.id);
  if (role === 'reference') {
    const previous = state.references.find(reference => reference.id === id);
    const songs = snapshot.songs.map(song => ({ id: String(song.id), title: song.title, artist: song.artist }));
    state.references = state.references.filter(reference => reference.id !== id).concat({ ...snapshot.playlist, id, songs, enabled: previous?.enabled !== false, syncedAt: snapshot.syncedAt || new Date().toISOString() });
    state.referenceOpen = true; persist();
    toast(`已导入参考歌单 ${songs.length} 首，随机范围未扩大。`);
    return;
  }
  const previous = state.sources.find(source => source.id === id);
  const previousIndex = new Map((previous?.songs || []).map(song => [song.id, song]));
  const incoming = snapshot.songs.map(song => {
    const known = previousIndex.get(song.id);
    return { ...song, ...(!song.addedAt && known?.addedAt ? { addedAt: known.addedAt } : {}), ...(previous && !known ? { observedAddedAt: Date.now() } : {}) };
  });
  const merged = mergePlaylistSnapshot(previous?.songs || [], incoming);
  const source = { ...snapshot.playlist, id, songs: merged.songs, sync: snapshot.sync || null, syncedAt: snapshot.syncedAt || new Date().toISOString(), lastChange: { added: merged.added, removed: merged.removed } };
  state.sources = state.sources.filter(item => item.id !== id && !item.demo).concat(source);
  const validIds = new Set(state.sources.map(item => item.id));
  state.options.playlistIds = state.options.playlistIds.filter(item => validIds.has(item));
  const songsById = new Map(allSongs().map(song => [song.id, song]));
  state.queue = state.queue.filter(song => songsById.has(song.id)).map(song => ({ ...song, ...songsById.get(song.id) }));
  state.lastSync = source.syncedAt;
  const skipped = Number(source.skippedCloudCount) || 0;
  persist(); toast(`已同步 ${source.songs.length} 首${skipped ? ` · 已跳过 ${skipped} 首云盘/未收录歌曲` : ''} · 新增 ${merged.added} · 移除 ${merged.removed}`);
  // 新歌自动做一次百科氛围匹配；失败只记录，不打断同步结果。
  const fresh = source.songs.map(song => String(song.id));
  if (fresh.length && !state.classifyPaused) {
    queueMicrotask(() => { runAutoClassify(fresh).catch(() => {}); });
  }
}

async function syncAll() {
  const sources = state.sources.filter(isRemoteSource);
  if (!sources.length) return;
  await perform('正在逐个同步歌单，完整读取后才更新快照…', async () => {
    const failures = [];
    for (const source of sources) {
      state.busyText = `正在同步「${source.name}」…`; render();
      try { await syncOne(source.id); } catch (error) { failures.push(`${source.name}：${error.message}`); }
    }
    if (failures.length) throw new Error(failures.join('；'));
  });
}

async function loadPlaylists() {
  const data = await api('/api/playlists');
  state.remote = (data.playlists || []).map(playlist => ({ ...playlist, owner: ownerName(playlist.owner) }));
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    if (String(status.profile?.userId || '') !== String(state.status.profile?.userId || '') || !status.loggedIn) clearAccountViews();
    state.status = status;
    if (state.status.loggedIn) await Promise.all([loadPlaylists(), loadLocalLikes()]);
    render();
    if (state.autoSync && state.status.loggedIn) await syncAll();
  } catch (error) { state.error = `${mobileRuntime ? '手机接口' : '本机服务'}连接未完成：${error.message}`; render(); }
}

async function startLogin() {
  clearTimeout(qrTimer);
  await perform('正在创建网易云登录二维码…', async () => {
    state.qr = await api('/api/login/qr', { method: 'POST', body: '{}' });
    state.qrMessage = '等待扫码，请在网易云 App 中确认登录。';
    pollQr(state.qr.key, Date.now());
  });
}

function pollQr(key, startedAt) {
  qrTimer = setTimeout(async () => {
    if (!state.qr || state.qr.key !== key) return;
    try {
      const result = await api(`/api/login/check?key=${encodeURIComponent(key)}`);
      if (result.loggedIn) {
        clearAccountViews(); state.status = { loggedIn: true, profile: result.profile };
        state.qr = null; await Promise.all([loadPlaylists(), loadLocalLikes()]); render(); toast('已连接网易云，请选择要同步的歌单。');
        return;
      }
      state.qrMessage = result.message || (Number(result.code) === 802 ? '已扫码，请在网易云确认登录。' : '等待网易云扫码…');
      if (Number(result.code) === 800 || Date.now() - startedAt > 180000) { state.qrMessage = '二维码已过期，请重新生成。'; render(); return; }
      const message = document.querySelector('.login-pending');
      if (message) message.textContent = state.qrMessage;
      pollQr(key, startedAt);
    } catch (error) {
      state.qrMessage = error.message;
      const message = document.querySelector('.login-pending');
      if (message) message.textContent = state.qrMessage;
    }
  }, 2500);
}

async function preview(id) {
  if (isBlockedSong(findSong(id) || { id })) { toast('歌曲或歌手已屏蔽，请到个人主页的黑名单恢复。'); return; }
  const view = player.snapshot();
  if (view.song?.id === id) return view.paused || view.ended ? player.play() : player.pause();
  let songs;
  if (state.tab === 'daily') songs = dailySongs();
  else if (state.tab === 'profile' && state.profileSection === 'collection') songs = collectionSongs();
  else if (state.tab === 'workspace' && state.queue.some(song => song.id === id)) songs = state.queue;
  else songs = allSongs().filter(song => !state.libraryPlaylist || song.playlistIds.includes(state.libraryPlaylist));
  songs = songs.filter(song => !isBlockedSong(song));
  const index = songs.findIndex(song => song.id === id);
  if (index >= 0) await listeningSession.start(songs, index);
}
function markHeard(id) {
  state.history.push({ songId: id, playedAt: Date.now(), source: 'manual' }); persist(); toast('已标记听过，下次生成时遵守冷却设置。');
}

function download(name, content, type = 'application/json') {
  if (mobileRuntime) {
    mobileRuntime.requestNative('export_file', { name, content, mime: type }).catch(error => { state.error = error.message || '手机文件导出未完成。'; render(); });
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restoreBackup(data) {
  if (data.version !== 1 || !Array.isArray(data.sources) || data.sources.length > 200) throw new Error('这不是可识别的随听备份。');
  const references = Array.isArray(data.references) ? data.references : [];
  if (references.length > 200 || [...data.sources, ...references].reduce((count, source) => count + (source.songs?.length || 0), 0) > 30000) throw new Error('备份超过原型支持的歌单或 30000 首上限。');
  const normalize = source => {
    if (!source.id || !Array.isArray(source.songs)) throw new Error('备份中的歌单数据不完整。');
    return { ...source, id: String(source.id), songs: source.songs.map(song => {
      if (!song.id || typeof song.title !== 'string') throw new Error('备份中有无效歌曲。');
      return { ...song, id: String(song.id) };
    }) };
  };
  const sources = data.sources.map(normalize);
  const normalizedReferences = references.map(normalize);
  ++classifyEpoch; classificationQueue.clear(); state.classifyProgress = null;
  ++languageEpoch; state.languageProgress = null;
  await player.stop(); await player.clearHistory?.();
  state.localAvatar = normalizeAvatar(data.localAvatar); state.appearance = normalizeAppearance(data.appearance || state.appearance); state.plugins = restorePlugins(data.plugins || state.plugins); state.enabledPlugins = []; state.providerConsents = {}; applyAppearance();
  state.sources = sources; state.references = normalizedReferences; state.edits = data.edits && typeof data.edits === 'object' ? data.edits : {};
  state.history = Array.isArray(data.history) ? data.history.slice(-10000) : [];
  state.options = normalizeQueueOptions(data.options);
  if (data.blacklist !== undefined) state.blacklist = normalizeBlacklist(data.blacklist);
  if (data.artistBlacklist !== undefined) state.artistBlacklist = normalizeArtistBlacklist(data.artistBlacklist);
  await player.syncArtistBlacklist(state.artistBlacklist);
  await player.syncBlacklist(Object.keys(state.blacklist));
  const sourceIds = new Set(state.sources.map(source => source.id));
  state.options.playlistIds = state.options.playlistIds.filter(id => sourceIds.has(id));
  state.queueSettings = null; state.selectionReport = null;
  state.exportJob = null; state.exportResult = null;
  ++queueGeneration; ++queueLoadRevision; state.queueLoading = false; state.queueBatchId = ''; state.queueLoadError = '';
  state.queue = []; state.activeQueue = []; state.activeQueueId = ''; state.lastSync = data.lastSync || null;
  state.tab = 'library'; persist(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); toast('备份已导入；网易云登录态不会随备份转移。');
}

surface.addEventListener('click', async event => {
  const button = event.target.closest('[data-tab], [data-action]');
  if (!button || button.disabled) return;
  if (button.dataset.tab) { event.preventDefault(); if (state.guideOpen) dismissGuide(); await navigate(button.dataset.tab); return; }
  const action = button.dataset.action;
  if (state.guideOpen && ['local-import', 'connect-netease', 'demo'].includes(action)) dismissGuide();
  const id = button.dataset.id;
  if (action === 'local-import') { if (mobileRuntime) await importLocalFiles(); else document.querySelector('#local-audio-files').click(); }
  else if (action === 'connect-netease') {
    if (!state.features.netease) await toggleFeature('netease');
    if (state.features.netease) await navigate('sync');
  }
  else if (action === 'local-refresh') await perform('正在检查本地曲库…',reloadLocalFiles);
  else if (action === 'toggle-feature') await toggleFeature(button.dataset.feature);
  else if (action === 'local-lyrics') {state.lyricImportId=id;document.querySelector('#local-lyrics-file').click();}
  else if (action === 'block-artist' || action === 'unblock-artist') await setArtistBlocked(button.dataset.key, action === 'block-artist', id);
  else if (action === 'exclude-option') {
    const field = button.dataset.field;
    if (!['excludeGenres', 'excludeMoods', 'excludeLanguages'].includes(field)) return;
    const selected = state.options[field] || [];
    state.options = normalizeQueueOptions({ ...state.options, [field]: selected.includes(button.dataset.value) ? selected.filter(value => value !== button.dataset.value) : [...selected, button.dataset.value] });
    persist(); render();
  }
  else if (action === 'clear-exclusions') { state.options = normalizeQueueOptions({ ...state.options, excludeGenres: [], excludeMoods: [], excludeLanguages: [], excludeUnclassified: false }); persist(); render(); }
  else if (action === 'open-guide') { state.guideOpen = true; renderChrome(); }
  else if (action === 'dismiss-guide') dismissGuide();
  else if (action === 'open-player' || action === 'open-playing-queue') { state.playerExpanded = true; state.playerTab = action === 'open-playing-queue' ? 'queue' : 'now'; renderChrome(); }
  else if (action === 'close-player') closePlayer();
  else if (action === 'player-tab') { state.playerTab = button.dataset.section; renderChrome(); }
  else if (action === 'more-playing') { state.playingQueueVisible += 60; renderChrome(); }
  else if (action === 'play-active') { const songs = currentPlayingSongs(); const index = songs.findIndex(song => song.id === id); if (index >= 0) await listeningSession.start(songs, index, { queueId: state.activeQueueId }); }
  else if (action === 'quick-overlay') await quickOverlay();
  else if (action === 'overlay-options') { state.overlayOpen = !state.overlayOpen; await refreshOverlay(); renderChrome(); }
  else if (action.startsWith('profile-')) {
    if (action === 'profile-sync') await navigate('sync');
    else { state.tab = 'profile'; state.profileSection = action === 'profile-blacklist' ? 'blacklist' : action === 'profile-collection' ? 'collection' : action === 'profile-likes' ? 'likes' : action === 'profile-appearance' ? 'appearance' : action === 'profile-plugins' ? 'plugins' : 'home'; state.profileSearch = ''; state.profileVisible = 60; state.overlayOpen = action === 'profile-overlay'; render(); window.scrollTo({ top: 0, behavior: 'instant' }); if (state.overlayOpen) await refreshOverlay(); if (state.profileSection === 'likes') await loadLocalLikes(); }
  }
  else if (action === 'choose-avatar') document.querySelector('#avatar-file').click();
  else if (action === 'reset-avatar') { state.localAvatar = ''; state.avatarError = ''; persist(); render(); toast('已恢复默认头像，不修改音乐账号头像。'); }
  else if (action === 'import-plugin') document.querySelector('#plugin-file').click();
  else if (action === 'export-plugins') download('随听-我的扩展.json', JSON.stringify({ apiVersion: 1, plugins: state.plugins }, null, 2));
  else if (action === 'toggle-plugin') {
    const enabled = state.enabledPlugins.includes(id);
    const provider = queueProviders.find(item => item.id === id);
    if (!enabled && provider) {
      if (!confirm(provider.network ? `启用「${provider.name}」会将已选歌曲的 ID、歌名和歌手发送至 ${provider.endpoint || '开发者后端'}。该代码扩展非沙箱，请确认来源后继续。` : `「${provider.name}」是源码打包的可信代码扩展，不是沙箱。确认启用，并在下次生成时处理已选歌曲？`)) return;
      state.providerConsents[id] = providerConsentKey(provider);
    }
    if (!allPlugins().some(plugin => plugin.id === id) && !provider) return;
    state.enabledPlugins = enabled ? state.enabledPlugins.filter(value => value !== id) : [...state.enabledPlugins, id];
    persist(); render(); toast('扩展设置已保存；下次生成时应用，不改变正在播放的队列。');
  }
  else if (action === 'remove-plugin') { state.plugins = state.plugins.filter(plugin => plugin.id !== id); state.enabledPlugins = state.enabledPlugins.filter(value => value !== id); persist(); render(); }
  else if (action === 'apply-plugin-preset') { const plugin = allPlugins().find(item => item.id === id && item.kind === 'preset'); if (plugin) { state.options = normalizeQueueOptions({ ...state.options, ...plugin.preset }); persist(); await navigate('workspace'); toast('已填入预设参数，请核对后点击生成。'); } }
  else if (action === 'refresh-daily') await loadDaily(true);
  else if (action === 'daily-songs' || action === 'daily-playlists') { state.dailySection = action === 'daily-songs' ? 'songs' : 'playlists'; render(); }
  else if (action === 'show-more-daily') { state.dailyVisible += 60; render(); }
  else if (action === 'show-more-profile') { state.profileVisible += 60; render(); }
  else if (action === 'play-daily') await listeningSession.start(dailySongs().filter(song => !isBlockedSong(song)));
  else if (action === 'play-collection') await listeningSession.start(collectionSongs().filter(song => !isBlockedSong(song)));
  else if (action === 'collection-scope') { state.options.playlistIds = [dailyCollectionId]; await navigate('workspace'); persist(); }
  else if (action === 'collect-song') toggleCollection(id);
  else if (action === 'official-like') await setOfficialLike(id);
  else if (action === 'load-likes') await loadLikes();
  else if (action === 'sync-likes') await syncLikes();
  else if (action === 'import-daily-playlist') await perform('正在完整读取推荐歌单，只读导入到随听…', async () => { await syncOne(id); state.tab = 'library'; state.libraryPlaylist = id; });
  else if (action === 'export-collection') { const alreadyOpen = state.exportOpen && state.exportScope === 'collection'; state.exportScope = 'collection'; state.exportOpen = !alreadyOpen; if (!state.exportJob) state.exportDraft.name = '随听 · 日推收藏'; render(); }
  else if (action === 'overlay-refresh') await refreshOverlay();
  else if (action === 'overlay-test') await overlayCommand('overlay_test');
  else if (action === 'overlay-app-settings') await overlayCommand('overlay_app_settings');
  else if (action === 'overlay-permission') await overlayCommand('overlay_permission');
  else if (action === 'overlay-enable') await overlayCommand('overlay_enable', { enabled: !state.overlay?.enabled || Boolean(state.overlay?.error) });
  else if (action === 'overlay-lock') await overlayCommand('overlay_style', { locked: !state.overlay?.locked });
  else if (action === 'overlay-reset') await overlayCommand('overlay_style', { resetPosition: true, locked: true });
  else if (action === 'demo') useDemo();
  else if (action === 'block-song') await setSongBlocked(id, true);
  else if (action === 'unblock-song') await setSongBlocked(id, false);
  else if (action === 'dismiss-undo') { clearTimeout(undoTimer); state.undoBlacklist = null; render(); }
  else if (action === 'library-category') { state.tab = 'library'; state.libraryCategory = button.dataset.category; state.libraryPlaylist = null; state.search = ''; state.visibleCount = 60; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (action === 'open-library') { state.libraryPlaylist = id; state.libraryVisits[id] = Date.now(); state.search = ''; state.visibleCount = 60; persist(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (action === 'library-back') { state.libraryPlaylist = null; state.search = ''; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (action === 'play-library') await listeningSession.start(allSongs().filter(song => song.playlistIds.includes(id)));
  else if (action === 'use-library-scope') { state.options.playlistIds = [id]; state.tab = 'workspace'; persist(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  else if (action === 'show-classification') { state.advancedOpen = true; state.classifyOpen = true; render(); document.querySelector('[data-detail="classify"]')?.scrollIntoView({ block: 'center' }); }
  else if (action === 'pause-classify') { state.classifyPaused = true; persist(); render(); }
  else if (action === 'retry-classify') await runAutoClassify(selectedSongs().filter(song => song.autoStatus === 'empty' || song.autoStatus === 'failed').map(song => song.id), true);
  else if (action === 'generate') await generate();
  else if (action === 'genre') { const genre = button.dataset.genre; state.options.genres = genre === 'all' ? [] : state.options.genres.includes(genre) ? state.options.genres.filter(value => value !== genre) : [...state.options.genres, genre]; persist(); render(); }
  else if (action === 'auto-classify') await runAutoClassify();
  else if (action === 'clear-auto-classify') clearAutoClassificationEdits();
  else if (action === 'filter-tag') { state.options.tag = state.options.tag.toLowerCase() === button.dataset.tag.toLowerCase() ? '' : button.dataset.tag; persist(); render(); }
  else if (action === 'clear-tag-filter') { state.options.tag = ''; persist(); await generate(); }
  else if (action === 'relax-classification') { state.options.classificationMode = 'balanced'; state.options.includeUnknown = true; persist(); await generate(); }
  else if (action === 'skip-classification') { state.options.moods = []; state.options.genres = []; state.options.genre = 'all'; persist(); await generate(); }
  else if (action === 'reorder') await generate('reorder');
  else if (action === 'toggle-scope-import') { state.scopeImportOpen = !state.scopeImportOpen; render(); document.querySelector('#scope-input')?.focus(); }
  else if (action === 'scope-all') { state.options.playlistIds = []; persist(); render(); }
  else if (action === 'scope') { const selected = state.options.playlistIds; state.options.playlistIds = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]; persist(); render(); }
  else if (action === 'mood') {
    const mood = button.dataset.mood;
    state.options.moods = mood === 'all' ? [] : state.options.moods.includes(mood) ? state.options.moods.filter(value => value !== mood) : [...state.options.moods, mood];
    persist(); render();
  }
  else if (action === 'toggle-playlist-export') { state.exportScope = 'queue'; state.exportOpen = !state.exportOpen; render(); }
  else if (action === 'check-created-playlist') await saveQueueToNetEase();
  else if (action === 'copy-playlist-link') {
    try { if (mobileRuntime) await mobileRuntime.requestNative('copy_text', { text: exportedPlaylistLink() }); else await navigator.clipboard.writeText(exportedPlaylistLink()); toast('网易云歌单链接已复制。'); }
    catch { state.error = '无法自动复制，请选中歌单链接手动复制。'; render(); }
  }
  else if (action === 'new-playlist-export') {
    if (!state.exportResult?.complete && !confirm('上次创建结果未完全确认，继续可能产生重复歌单。请先在网易云查看已有歌单。确定要开始另一次新建吗？')) return;
    state.exportJob = null; state.exportResult = null; persist(); render();
  }
  else if (action === 'dismiss-error') { state.error = ''; render(); }
  else if (action === 'start-account-login') { await startLogin(); document.querySelector('.login-panel')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  else if (action === 'login') await startLogin();
  else if (action === 'save-qr' && mobileRuntime && state.qr) await perform('正在保存登录二维码…', () => mobileRuntime.requestNative('save_qr', { image: state.qr.image }));
  else if (action === 'open-netease') {
    try {
      const result = await mobileRuntime.requestNative('open_netease');
      toast(result?.opened === 'app' ? '已切到网易云：扫一扫 → 相册，选刚才保存的二维码。' : '没能拉起网易云 App，请手动打开后从相册识码。');
    } catch { state.error = '没有打开网易云，请手动切到 App 再扫码。'; render(); }
  }
  else if (action === 'logout') await perform('正在断开账号…', async () => { await player.stop(); await api('/api/logout', { method: 'POST', body: '{}' }); clearAccountViews(); state.status = { loggedIn: false }; state.remote = []; state.qr = null; clearTimeout(qrTimer); toast('已断开账号，本机资料仍保留。'); });
  else if (action === 'load-playlists') await perform('正在读取你的歌单列表…', loadPlaylists);
  else if (action === 'sync-one') await perform('正在完整读取歌单，分类和旧快照会被保留…', () => syncOne(id));
  else if (action === 'sync-reference') await perform('正在更新网易云参考歌单…', () => syncOne(id, 'reference'));
  else if (action === 'reference-as-source') await perform('正在把参考歌单同步到随机范围…', () => syncOne(id));
  else if (action === 'remove-reference') { state.references = state.references.filter(reference => reference.id !== id); persist(); render(); toast('已移除参考歌单，随机曲库不受影响。'); }
  else if (action === 'sync-all') await syncAll();
  else if (action === 'preview') await preview(id);
  else if (action === 'play-queue') { if (player.snapshot().song && player.snapshot().queueId === state.queueBatchId) await player.play(); else await replaceCurrentBatch(true); }
  else if (action === 'clear-queue') await clearQueue();
  else if (action === 'clear-candidates') clearCandidates();
  else if (action === 'player-toggle') { const view = player.snapshot(); if (!view.song) await replaceCurrentBatch(true); else if (view.paused || view.ended) await player.play(); else await player.pause(); }
  else if (action === 'player-next') await player.next();
  else if (action === 'player-previous') await player.previous();
  else if (action === 'player-stop') await player.stop();
  else if (action === 'player-mode') { const modes = Object.keys(playbackModes); const mode = player.snapshot().mode || 'order'; await player.setMode(modes[(modes.indexOf(mode) + 1) % modes.length]); }
  else if (action === 'toggle-lyrics') { state.lyricsOpen = !state.lyricsOpen; render(); if (state.lyricsOpen) await ensureLyrics(); }
  else if (action === 'lyric-retry') await ensureLyrics(player.snapshot(), true);
  else if (action === 'lyric-follow') setLyricFollow(!state.lyricFollow);
  else if (action === 'lyric-seek') { await player.seek(Number(button.dataset.time)); updateLyricProgress(player.snapshot(), true); }
  else if (action === 'heard') markHeard(id);
  else if (action === 'edit') { state.editingId = state.editingId === id ? null : id; render(); document.querySelector('#edit-mood')?.focus(); }
  else if (action === 'cancel-edit') { state.editingId = null; render(); }
  else if (action === 'language') { const key = button.dataset.language; state.options.languages = key === 'all' ? [] : state.options.languages.includes(key) ? state.options.languages.filter(value => value !== key) : [...state.options.languages, key]; persist(); render(); }
  else if (action === 'auto-language') await runLanguageScan();
  else if (action === 'pause-language') { state.languagePaused = true; render(); }
  else if (action === 'auto-language-value') { if (state.edits[id]) delete state.edits[id].localLanguages; persist(); render(); toast('已恢复平台自动语种。'); }
  else if (action === 'save-edit') {
    const mood = document.querySelector('#edit-mood').value;
    state.edits[id] = { ...state.edits[id], localLanguages: [...document.querySelectorAll('[data-edit-language]:checked')].map(input => input.value), localMood: mood || null, localGenre: document.querySelector('#edit-genre').value || null, localEnergy: Number(document.querySelector('#edit-energy').value), localTags: parseTags(document.querySelector('#edit-tags').value) };
    state.editingId = null; persist(); render(); toast('分类已保存，后续同步会保留。');
  }
  else if (action === 'show-more') { state.visibleCount += 60; render(); }
  else if (action === 'show-more-queue') { state.queueVisible += 60; render(); }
  else if (action === 'remove-source') {
    state.sources = state.sources.filter(source => source.id !== id); state.options.playlistIds = state.options.playlistIds.filter(item => item !== id);
    const valid = new Set(allSongs().map(song => song.id)); state.queue = state.queue.filter(song => valid.has(song.id)); persist(); render(); toast('已移除本机快照，网易云源歌单未改动。');
  }
  else if (action === 'export-queue') download('随听-本次队列.txt', state.queue.map((song, index) => `${index + 1}. ${song.title} — ${song.artist}\n${songLink(song) || '合成示例，无实际音频'}`).join('\n\n'), 'text/plain');
  else if (action === 'export-backup') download(`随听-资料备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, sources: state.sources, references: state.references, edits: state.edits, history: state.history, blacklist: state.blacklist, artistBlacklist: state.artistBlacklist, localAvatar: state.localAvatar, appearance: state.appearance, plugins: state.plugins, options: state.options, lastSync: state.lastSync }, null, 2));
  else if (action === 'import-backup') document.querySelector('#backup-file').click();
  else if (action === 'clear-history') { await player.clearHistory?.(); state.history = []; persist(); toast('已清空本原型的冷却记录。'); }
  else if (action === 'clear-data') {
    if (!confirm('清空当前浏览器的歌单、分类和原型内听歌记录？网易云源歌单不会改变。建议先导出备份。')) return;
    await removeLocalFiles(); ++queueGeneration; ++queueLoadRevision; state.queueLoading = false; state.queueBatchId = ''; state.queueLoadError = '';
    await player.stop(); await player.clearHistory?.();
    ++languageEpoch; state.languageProgress = null; ++classifyEpoch; classificationQueue.clear(); state.classifyProgress = null; state.blacklist = normalizeBlacklist(); state.artistBlacklist = normalizeArtistBlacklist(); await player.syncArtistBlacklist(state.artistBlacklist); await player.syncBlacklist([]);
state.activeQueue = []; state.activeQueueId = ''; state.localAvatar = ''; state.avatarError = ''; state.exportJob = null; state.exportResult = null; state.sources = []; state.references = []; state.edits = {}; state.history = []; state.queue = []; state.warnings = []; state.options.playlistIds = []; state.lastSync = null; persist(); render(); toast('已清空本机资料，账号连接可单独断开。');
  }
});

surface.addEventListener('input', event => {
  if (event.target.id === 'player-progress') { draggingProgress = true; const view = player.snapshot(); document.querySelector('#player-elapsed').textContent = formatTime(view.duration * Number(event.target.value) / 1000); }
  if (event.target.id === 'player-volume') { event.target.setAttribute('aria-valuetext', `${event.target.value}%`); player.setVolume(Number(event.target.value) / 100); }
  if (event.target.id === 'variation') { state.options.variation = Number(event.target.value); document.querySelector('#variation-value').textContent = `${state.options.variation}%`; persist(); }
  if (event.target.id === 'edit-energy') document.querySelector('#energy-value').textContent = event.target.value;
  const sliders = { 'recent-priority': 'recentPriority', 'recent-taste': 'recentTaste', 'reference-strength': 'referenceStrength' };
  if (sliders[event.target.id]) {
    state.options[sliders[event.target.id]] = Number(event.target.value);
    document.querySelector(`#${event.target.id}-value`).textContent = `${event.target.value}%`;
    if (event.target.id.startsWith('recent-')) event.target.closest('details').querySelector('summary span').textContent = `近期占比 ${state.options.recentPriority}% · 口味强度 ${state.options.recentTaste}%`;
    persist();
  }
  if (event.target.id === 'custom-count' && event.target.validity.valid) { state.options.count = Number(event.target.value); persist(); }
  if (event.target.id === 'custom-tag') { state.options.tag = event.target.value.trim(); document.querySelector('#tag-filter-status').textContent = tagFilterStatus(); persist(); }
  if (event.target.id === 'export-name') state.exportDraft.name = event.target.value;
  searchInputs[event.target.id]?.input(event.target.value, event.isComposing);
});

surface.addEventListener('compositionstart', event => searchInputs[event.target.id]?.start());
surface.addEventListener('compositionend', event => searchInputs[event.target.id]?.end(event.target.value));
surface.addEventListener('search', event => { if (searchInputs[event.target.id]) { searchInputs[event.target.id].input(event.target.value); searchInputs[event.target.id].flush(); } });
surface.addEventListener('keydown', event => {
  if (event.target.closest('.lyrics-lines') && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setLyricFollow(false);
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || !searchInputs[event.target.id]) return;
  event.preventDefault(); searchInputs[event.target.id].flush();
  const egg = easterSearchTrigger({ id: event.target.id, value: event.target.value, composing: searchInputs[event.target.id].composing, enabled: state.features.easterEggs });
  if (egg) void easterEggs.open(egg);
});
surface.addEventListener('focusout', event => {
  if (!searchInputs[event.target.id]) return;
  const id = event.target.id; const value = event.target.value;
  setTimeout(() => { if (searchInputs[id].composing) searchInputs[id].end(value); else if (searchInputs[id].pending) searchInputs[id].flush(); if (renderPending && !activeSearchInput()) render(); }, 0);
});

surface.addEventListener('change', async event => {
  if (event.target.id === 'local-audio-files' && event.target.files.length) {const files=[...event.target.files];await importLocalFiles(files);return;}
  if (event.target.id === 'local-lyrics-file' && event.target.files[0]) {
    const file=event.target.files[0], id=state.lyricImportId;
    await perform('正在保存本地歌词…',async()=>{
      if(!/\.(?:lrc|txt)$/iu.test(file.name) || file.size>300000 || !isLocalSongId(id)) throw new Error('请选择小于300 KB的LRC／TXT歌词文件。');
      const text=parseLocalLyrics(await file.text());
      await api('/api/local/lyrics',{method:'POST',body:JSON.stringify({id,text})});
      lyricCache.delete(id);state.lyrics={id:null,status:'idle',lines:[],plain:[]};ensureLyrics(player.snapshot(),true);toast('歌词已绑定这首本地歌曲。');
    });return;
  }
  if (event.target.id === 'exclude-unclassified') { state.options.excludeUnclassified = event.target.checked; persist(); render(); }
  if (event.target.id === 'appearance') { state.appearance = normalizeAppearance(event.target.value); applyAppearance(); persist(); render(); }
  if (event.target.id === 'plugin-file' && event.target.files[0]) {
    try {
      const file = event.target.files[0];
      if (file.size > 65536) throw new Error('扩展文件不能超过64KB。');
      const parsed = JSON.parse(await file.text());
      const incoming = (Array.isArray(parsed.plugins) && parsed.apiVersion === 1 ? parsed.plugins : [parsed]).map(normalizePlugin);
      if (incoming.length > 20 || new Set(incoming.map(plugin => plugin.id)).size !== incoming.length) throw new Error('每次最多20个扩展且ID不能重复。');
      if (incoming.some(plugin => plugin.id.startsWith('suiting.') || queueProviders.some(provider => provider.id === plugin.id))) throw new Error('扩展ID不能覆盖内置或源码扩展。');
      if (incoming.some(plugin => state.plugins.some(existing => existing.id === plugin.id)) && !confirm('同ID扩展已存在，替换并重新关闭这些扩展？')) return;
      const ids = incoming.map(plugin => plugin.id);
      const merged = [...state.plugins.filter(plugin => !ids.includes(plugin.id)), ...incoming];
      if (merged.length > 20) throw new Error('本机最多保留20个导入扩展，请先移除不用的。');
      state.plugins = merged; state.enabledPlugins = state.enabledPlugins.filter(id => !ids.includes(id));
      persist(); render(); toast('扩展已导入，默认关闭；请先查看说明再启用。');
    } catch (error) { state.error = `扩展导入失败：${error.message}`; render(); }
  }
  if (event.target.id === 'avatar-file' && event.target.files[0]) {
    state.avatarBusy = true; state.avatarError = ''; render();
    try { state.localAvatar = await readAvatar(event.target.files[0]); persist(); toast('本机头像已更新，不上传到音乐账号。'); }
    catch (error) { state.avatarError = error.message; }
    finally { state.avatarBusy = false; render(); }
  }
  if (event.target.id === 'overlay-alignment') await overlayCommand('overlay_style', { alignment: event.target.value });
  if (event.target.id === 'overlay-lines') await overlayCommand('overlay_style', { lines: Number(event.target.value) });
  if (event.target.id === 'overlay-translation') await overlayCommand('overlay_style', { showTranslation: event.target.checked });
  if (event.target.id === 'overlay-font') await overlayCommand('overlay_style', { fontSize: Number(event.target.value) });
  if (event.target.id === 'overlay-width') await overlayCommand('overlay_style', { widthPercent: Number(event.target.value) });
  if (event.target.id === 'overlay-opacity') await overlayCommand('overlay_style', { opacity: Number(event.target.value) / 100 });
  if (event.target.id === 'player-progress') { const seconds = player.snapshot().duration * Number(event.target.value) / 1000; draggingProgress = false; await player.seek(seconds); }
  if (event.target.id === 'player-quality') await player.setQuality(event.target.value);
  if (event.target.id === 'export-privacy') { state.exportDraft.privacy = Number(event.target.value); render(); }
  if (event.target.id === 'cooldown') { state.options.cooldownDays = Number(event.target.value); persist(); }
  if (event.target.id === 'count') {
    state.options.countMode = ['custom', 'all'].includes(event.target.value) ? event.target.value : 'preset';
    if (state.options.countMode === 'preset') state.options.count = Number(event.target.value);
    persist(); render(); if (state.options.countMode === 'custom') document.querySelector('#custom-count')?.focus();
  }
  if (event.target.id === 'classification-mode') { state.options.classificationMode = event.target.value === 'strict' ? 'strict' : 'balanced'; persist(); render(); }
  if (event.target.id === 'include-unknown') { state.options.includeUnknown = event.target.checked; persist(); render(); }
  if (event.target.id === 'recent-fallback') { state.options.recentFallback = event.target.value; persist(); render(); }
  if (event.target.dataset.referenceId) {
    const reference = state.references.find(item => item.id === event.target.dataset.referenceId);
    if (reference) reference.enabled = event.target.checked;
    const referenceSlider = document.querySelector('#reference-strength');
    if (referenceSlider) referenceSlider.disabled = !state.references.some(item => item.enabled !== false);
    event.target.closest('details').querySelector('summary span').textContent = `${state.references.filter(item => item.enabled !== false).length} 个启用`;
    persist();
  }
  if (event.target.id === 'auto-sync') { state.autoSync = event.target.checked; persist(); toast(state.autoSync ? '已启用：页面打开或返回时同步。' : '已关闭自动同步。'); }
  if (event.target.id === 'backup-file' && event.target.files[0]) {
    try {
      if (event.target.files[0].size > 25 * 1024 * 1024) throw new Error('备份文件超过 25 MB。');
      const text = await event.target.files[0].text();
      if (state.sources.length && !confirm('导入备份会替换当前本机资料。继续前建议先导出当前备份。')) return;
      await restoreBackup(JSON.parse(text));
    } catch (error) { state.error = `备份导入失败：${error.message}`; render(); }
  }
});

surface.addEventListener('submit', async event => {
  if (event.target.id === 'create-playlist-form') { event.preventDefault(); await saveQueueToNetEase(); return; }
  const forms = { 'import-form': ['playlist-input', 'source'], 'scope-import-form': ['scope-input', 'source'], 'reference-import-form': ['reference-input', 'reference'] };
  const form = forms[event.target.id];
  if (!form) return;
  event.preventDefault();
  const input = document.getElementById(form[0]).value.trim();
  if (!input) return;
  await perform(form[1] === 'reference' ? '正在读取参考歌单，成功后才保存…' : '正在解析歌单并补齐全部歌曲，成功后才保存…', () => syncOne(input, form[1]));
});

surface.addEventListener('toggle', event => {
  if (event.target.dataset.detail === 'scope-picker') state.scopePickerOpen = event.target.open;
  if (event.target.dataset.detail === 'language-picker') state.languagePickerOpen = event.target.open;
  if (event.target.dataset.detail === 'genre-picker') state.genrePickerOpen = event.target.open;
  if (event.target.dataset.detail === 'exclusions') state.exclusionsOpen = event.target.open;
  if (event.target.dataset.detail === 'filters') state.filtersOpen = event.target.open;
  if (event.target.dataset.detail === 'advanced') state.advancedOpen = event.target.open;
  if (event.target.dataset.remoteGroup) { state.remoteOpen[event.target.dataset.remoteGroup] = event.target.open; persist(); }
  if (event.target.classList.contains('player-settings')) state.playerOpen = event.target.open;
  if (event.target.dataset.detail === 'recent') state.recentOpen = event.target.open;
  if (event.target.dataset.detail === 'reference') state.referenceOpen = event.target.open;
  if (event.target.dataset.detail === 'classify') state.classifyOpen = event.target.open;
}, true);

for (const type of ['wheel', 'touchmove', 'pointerdown']) surface.addEventListener(type, event => {
  const container = event.target.closest('.lyrics-lines');
  if (container && (type !== 'pointerdown' || event.target === container)) setLyricFollow(false);
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { player.refresh?.(); if (mobileRuntime) refreshOverlay(); if (mobileRuntime && state.status.loggedIn && state.features.netease) loadLocalLikes(); }
  if (document.visibilityState === 'visible' && state.autoSync && state.status.loggedIn && !state.busy && Date.now() - lastVisibilitySync > 60000) { lastVisibilitySync = Date.now(); syncAll(); }
});

const hydratedSongs = new Map(allSongs().map(song => [song.id, song]));
state.queue = state.queue.filter(song => hydratedSongs.has(song.id) && !isBlockedSong(hydratedSongs.get(song.id))).map(song => ({ ...hydratedSongs.get(song.id), ...song }));
if (mobileRuntime) {
  const receiveShare = text => {
    if (typeof text !== 'string' || text.length > 3000) return;
    state.tab = 'workspace'; state.scopeImportOpen = true; render();
    document.querySelector('#scope-input').value = text;
    document.querySelector('#scope-input').focus();
    toast('已接收分享文字，请确认后导入；尚未读取或改动歌单。');
  };
  window.SuiTingMobile = {
    receiveShare,
    onNativeState: theme => { if (theme === 'dark' || theme === 'light') systemTheme = theme; applyAppearance(false); player.refresh?.(); if (state.overlayOpen) refreshOverlay(); },
    handleBack: () => {
      if (easterEggs.isOpen()) { easterEggs.close(); return true; }
      if (state.guideOpen) { dismissGuide(); return true; }
      if (state.playerExpanded) { closePlayer(); return true; }
      if (state.editingId) state.editingId = null;
      else if (state.libraryPlaylist && state.tab === 'library') state.libraryPlaylist = null;
      else if (state.tab === 'profile' && (state.profileSection !== 'home' || state.overlayOpen)) { state.profileSection = 'home'; state.overlayOpen = false; }
      else if (state.exportOpen) state.exportOpen = false;
      else if (state.tab !== 'workspace') state.tab = 'workspace';
      else return false;
      render(); return true;
    },
    setKeyboardVisible: visible => document.documentElement.classList.toggle('native-keyboard', visible),
  };
  surface.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || !/^https:\/\/(?:[\w-]+\.)?music\.163\.com\//.test(link.href)) return;
    event.preventDefault();
    player.pause();
    mobileRuntime.requestNative('open_link', { url: link.href }).catch(error => { state.error = error.message; render(); });
  });
  mobileRuntime.ready.then(device => { state.nativeDevice = device; if (device.systemTheme) systemTheme = device.systemTheme; applyAppearance(); if (device.sharedText) receiveShare(device.sharedText); }).catch(error => { state.error = error.message; render(); });
}
applyAppearance();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => { if (!mobileRuntime) { systemTheme = event.matches ? 'dark' : 'light'; applyAppearance(false); } });
render();
if (!mobileRuntime) { player.syncArtistBlacklist(state.artistBlacklist); player.syncBlacklist(Object.keys(state.blacklist)); }
if (mobileRuntime) {
  mobileRuntime.ready.then(() => player.initialize()).catch(error => { state.error = error.message; render(); });
  mobileRuntime.ready.then(() => refreshOverlay());
  setInterval(() => { if (document.visibilityState === 'visible') { player.refresh(); if (state.overlayOpen && state.overlay?.locked === false && !state.overlayBusy) refreshOverlay(); } }, 1000);
}
initializePublic();
