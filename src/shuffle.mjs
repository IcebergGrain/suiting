import { languageMatches, normalizeLanguages, songLanguages } from './languages.mjs';

export const moodDefinitions = {
  gentle: { name: '温柔', energy: 25, color: '#789b8b' },
  bright: { name: '轻快', energy: 55, color: '#bd994b' },
  sad: { name: '伤感', energy: 30, color: '#7d8baa' },
  healing: { name: '治愈', energy: 32, color: '#7b9e72' },
  romantic: { name: '浪漫', energy: 42, color: '#b78491' },
  calm: { name: '安静', energy: 15, color: '#81959c' },
  dreamy: { name: '梦幻', energy: 35, color: '#9a86af' },
  nostalgic: { name: '怀旧', energy: 40, color: '#a08a62' },
  energetic: { name: '热血', energy: 80, color: '#ba8066' },
  intense: { name: '躁动', energy: 92, color: '#ae6963' },
  focused: { name: '专注', energy: 24, color: '#6f8a93' },
  laidback: { name: '慵懒', energy: 22, color: '#9b9471' },
};
export const genreDefinitions = {
  pop: '流行', folk: '民谣', rock: '摇滚', hiphop: '说唱', rnb: 'R&B / 灵魂',
  electronic: '电子', jazz: '爵士', classical: '古典', instrumental: '纯音乐',
  ambient: '氛围音乐', acg: '动漫 / 游戏', traditional: '国风 / 戏曲', metal: '金属', other: '其他',
};
const moods = new Set(Object.keys(moodDefinitions));
const genres = new Set(Object.keys(genreDefinitions));
const targetEnergy = Object.fromEntries(Object.entries(moodDefinitions).map(([key, value]) => [key, value.energy]));
const dayMilliseconds = 86_400_000;
const moodNeighbors = [
  ['gentle', 'healing', 'calm', 'laidback', 'dreamy'],
  ['calm', 'focused', 'laidback'], ['romantic', 'gentle', 'dreamy'],
  ['romantic', 'bright'], ['bright', 'healing'], ['sad', 'nostalgic', 'calm'],
  ['energetic', 'intense'], ['energetic', 'bright'],
];
const genreNeighbors = [
  ['pop', 'folk'], ['pop', 'rnb'], ['pop', 'rock'], ['pop', 'acg'],
  ['folk', 'traditional'], ['folk', 'instrumental'], ['rock', 'metal'],
  ['hiphop', 'rnb'], ['hiphop', 'electronic'], ['electronic', 'ambient'],
  ['instrumental', 'classical'], ['instrumental', 'ambient'], ['instrumental', 'jazz'],
];

function dimensionMatch(value, selected, neighbors) {
  if (!selected.size) return 0;
  if (Array.isArray(value)) return value.length ? Math.min(...value.map(candidate => dimensionMatch(candidate, selected, neighbors))) : 2;
  if (value === null) return 2;
  if (selected.has(value)) return 0;
  return neighbors.some(group => group.includes(value) && group.some(candidate => selected.has(candidate))) ? 1 : 3;
}

function classificationMatch(song, selectedMoods, selectedGenres) {
  const moodTier = dimensionMatch(songMoods(song), selectedMoods, moodNeighbors);
  const genreTier = dimensionMatch(songGenres(song), selectedGenres, genreNeighbors);
  return { moodTier, genreTier, tier: Math.max(moodTier, genreTier) };
}

function identifier(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return String(value).trim();
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function songMood(song) {
  return songMoods(song)[0] || null;
}

export function songMoods(song) {
  if (song.localMood !== undefined) return moods.has(song.localMood) ? [song.localMood] : [];
  if (moods.has(song.mood)) return [song.mood];
  return [...new Set([...(song.autoMoods || []), song.autoMood].filter(value => moods.has(value)))];
}

function songEnergy(song) {
  const isLocal = song.localEnergy !== undefined;
  const value = isLocal ? song.localEnergy : song.energy;
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  return !isLocal && number <= 1 ? number * 100 : number;
}

function songGenre(song) {
  return songGenres(song)[0] || null;
}

export function songGenres(song) {
  if (song.localGenre !== undefined) return genres.has(song.localGenre) ? [song.localGenre] : [];
  if (genres.has(song.genre)) return [song.genre];
  return [...new Set([...(song.autoGenreKeys || []), song.autoGenre].filter(value => genres.has(value)))];
}

export function isExcludedByOptions(song, options = {}) {
  const dimensions = [[songMoods(song), options.excludeMoods], [songGenres(song), options.excludeGenres], [songLanguages(song), options.excludeLanguages]];
  return dimensions.some(([known, excluded]) => Array.isArray(excluded) && excluded.length && (known.some(value => excluded.includes(value)) || options.excludeUnclassified === true && !known.length));
}

function features(song) {
  return {
    mood: songMood(song), genre: songGenre(song), moods: songMoods(song), genres: songGenres(song),
    artists: String(song.artist || '').split(/\s+\/\s+|、/).map(value => value.trim().toLowerCase()).filter(value => value && value !== '未知歌手'),
    tags: parseTags(Array.isArray(song.localTags) ? song.localTags : song.tags).map(value => value.toLowerCase()),
  };
}

function inScope(song, playlists) {
  const memberships = Array.isArray(song.playlistIds) ? song.playlistIds : [song.playlistId];
  return !playlists.size || memberships.some(playlistId => playlists.has(identifier(playlistId)));
}

export function getRecentSongs(songs, options = {}) {
  const playlists = new Set((options.playlistIds || []).map(identifier));
  const fallback = ['head', 'tail', 'dated-only'].includes(options.recentFallback) ? options.recentFallback : 'head';
  const values = uniqueSongs(songs).filter(song => inScope(song, playlists) && languageMatches(song, options.languages) && !song.localExcluded && !song.excluded && !song.blocked).map((song, index) => {
    const memberships = (song.playlistIds || [song.playlistId]).filter(id => !playlists.size || playlists.has(String(id)));
    const direct = timestamp(song.addedAt);
    const observed = timestamp(song.observedAddedAt);
    const hasScopedDates = song.addedAtByPlaylist !== undefined;
    const dateRecords = memberships.map(id => {
      const actualDate = timestamp(song.addedAtByPlaylist?.[id]);
      const observedDate = timestamp(song.observedAtByPlaylist?.[id]);
      return { actualDate: actualDate > 0 ? actualDate : 0, addedAt: actualDate > 0 ? actualDate : observedDate > 0 ? observedDate : 0 };
    });
    if (!hasScopedDates) dateRecords.push({ actualDate: direct > 0 ? direct : 0, addedAt: direct > 0 ? direct : observed > 0 ? observed : 0 });
    const latest = dateRecords.reduce((current, record) => record.addedAt > current.addedAt ? record : current, { addedAt: 0, actualDate: 0 });
    const { addedAt, actualDate } = latest;
    const positions = memberships.map(id => Number(song.orderByPlaylist?.[id])).filter(value => Number.isFinite(value) && value >= 0);
    const order = positions.length ? fallback === 'tail' ? Math.max(...positions) : Math.min(...positions) : Number.isFinite(Number(song.playlistOrder)) ? Number(song.playlistOrder) : index;
    return { song, addedAt, actualDate, order, index };
  });
  values.sort((left, right) => right.addedAt - left.addedAt || (fallback === 'tail' ? right.order - left.order : left.order - right.order) || left.index - right.index);
  const selected = values.filter(value => fallback !== 'dated-only' || value.addedAt > 0).slice(0, 100).filter(value => !isExcludedByOptions(value.song, options));
  const known = selected.filter(value => value.addedAt > 0).length;
  return { songs: selected.map(value => ({ ...value.song, recentEvidence: value.actualDate ? 'added-at' : value.addedAt ? 'observed' : `playlist-${fallback}`, recentDate: value.addedAt || null })), count: selected.length, knownDateCount: known, fallback, basis: selected.length > 0 && known === selected.length ? 'added-at' : known ? 'mixed' : 'playlist-order' };
}

export function normalizeQueueOptions(input = {}) {
  const values = input && typeof input === 'object' ? input : {};
  return {
    playlistIds: [...new Set((Array.isArray(values.playlistIds) ? values.playlistIds : []).map(identifier).filter(Boolean))],
    languages: [...new Set((Array.isArray(values.languages) ? values.languages : []).filter(value => value === 'unknown' || normalizeLanguages(value).includes(value)))],
    mood: 'all', moods: [...new Set((Array.isArray(values.moods) ? values.moods : [values.mood]).filter(value => moods.has(value)))],
    excludeMoods: [...new Set((Array.isArray(values.excludeMoods) ? values.excludeMoods : []).filter(value => moods.has(value)))],
    excludeGenres: [...new Set((Array.isArray(values.excludeGenres) ? values.excludeGenres : []).filter(value => genres.has(value)))],
    excludeLanguages: [...new Set((Array.isArray(values.excludeLanguages) ? values.excludeLanguages : []).filter(value => normalizeLanguages(value).includes(value)))],
    excludeUnclassified: values.excludeUnclassified === true,
    genre: 'all', genres: [...new Set((Array.isArray(values.genres) ? values.genres : [values.genre]).filter(value => genres.has(value)))], tag: String(values.tag || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    classificationMode: values.classificationPolicy === 3 && values.classificationMode === 'strict' ? 'strict' : 'balanced',
    includeUnknown: values.classificationPolicy === 3 ? values.includeUnknown !== false : true, classificationPolicy: 3,
    variation: boundedNumber(values.variation ?? 55, 55, 0, 100), cooldownDays: boundedNumber(values.cooldownDays ?? 3, 3, 0, 3650),
    count: Math.floor(boundedNumber(values.count ?? 20, 20, 1, 5000)), countMode: ['custom', 'all'].includes(values.countMode) ? values.countMode : [10, 20, 30, 50, 100, 200, 500, 1000].includes(Number(values.count ?? 20)) ? 'preset' : 'custom',
    recentPriority: boundedNumber(values.recentPriority ?? 50, 50, 0, 100), recentTaste: boundedNumber(values.recentTaste ?? 50, 50, 0, 100),
    referenceStrength: boundedNumber(values.referenceStrength ?? 50, 50, 0, 100), recentFallback: ['head', 'tail', 'dated-only'].includes(values.recentFallback) ? values.recentFallback : 'head',
  };
}

export function getClassificationCoverage(songs, options = {}) {
  const playlists = new Set((options.playlistIds || []).map(identifier));
  const scoped = uniqueSongs(songs).filter(song => inScope(song, playlists) && languageMatches(song, options.languages) && !song.localExcluded && !song.excluded && !song.blocked);
  const selectedMoods = new Set((Array.isArray(options.moods) ? options.moods : [options.mood]).filter(value => moods.has(value)));
  const selectedGenres = new Set((Array.isArray(options.genres) ? options.genres : [options.genre]).filter(value => genres.has(value)));
  const matches = scoped.map(song => classificationMatch(song, selectedMoods, selectedGenres));
  return { total: scoped.length, moodKnown: scoped.filter(song => songMood(song) !== null).length, genreKnown: scoped.filter(song => songGenre(song) !== null).length, energyKnown: scoped.filter(song => songEnergy(song) !== null).length, hasFilters: Boolean(selectedMoods.size || selectedGenres.size), exactCount: matches.filter(match => match.tier === 0).length, relatedCount: matches.filter(match => match.tier === 1).length, unclassifiedCount: matches.filter(match => match.tier === 2).length, conflictCount: matches.filter(match => match.tier === 3).length };
}

export function parseTags(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const tags = new Map();
  for (const item of values) {
    if (typeof item !== 'string') continue;
    for (const part of item.split(/[,，;；\n]/)) {
      const label = part.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (label && !tags.has(label.toLowerCase())) tags.set(label.toLowerCase(), label);
    }
  }
  return [...tags.values()].slice(0, 15);
}

export function getTagCatalog(songs, options = {}) {
  const playlists = new Set((options.playlistIds || []).map(identifier));
  const catalog = new Map();
  for (const song of uniqueSongs(songs)) {
    if (!inScope(song, playlists) || !languageMatches(song, options.languages) || song.localExcluded || song.excluded || song.blocked) continue;
    for (const label of parseTags(Array.isArray(song.localTags) ? song.localTags : song.tags)) {
      const key = label.toLowerCase();
      const item = catalog.get(key) || { label, count: 0 };
      item.count += 1; catalog.set(key, item);
    }
  }
  return [...catalog.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function listeningProfile(songs, featureIndex) {
  const profile = { ids: new Set(), artists: new Map(), moods: new Map(), genres: new Map(), tags: new Map() };
  for (const song of uniqueSongs(songs)) {
    profile.ids.add(song.id);
    const item = featureIndex.get(song.id) || features(song);
    for (const [field, values] of [['artists', item.artists], ['tags', item.tags], ['moods', item.moods], ['genres', item.genres]]) {
      for (const value of values) profile[field].set(value, (profile[field].get(value) || 0) + 1);
    }
  }
  for (const field of ['artists', 'moods', 'genres', 'tags']) {
    const maximum = Math.max(1, ...profile[field].values());
    for (const [key, value] of profile[field]) profile[field].set(key, value / maximum);
  }
  return profile;
}

function affinity(item, profile, includeIdentity = false) {
  if (includeIdentity && profile.ids.has(item.id)) return 1;
  const evidence = [
    [profile.artists.size, Math.max(0, ...item.artists.map(artist => profile.artists.get(artist) || 0))],
    [profile.tags.size, Math.max(0, ...item.tags.map(tag => profile.tags.get(tag) || 0))],
    [profile.moods.size, Math.max(0, ...item.moods.map(value => profile.moods.get(value) || 0))],
    [profile.genres.size, Math.max(0, ...item.genres.map(value => profile.genres.get(value) || 0))],
  ].filter(([available]) => available > 0);
  return evidence.length ? evidence.reduce((sum, [, score]) => sum + score, 0) / evidence.length : 0;
}

export function influenceMultiplier(strength, similarity) {
  return Math.exp(Math.log(1000) * boundedNumber(strength, 0, 0, 1) * boundedNumber(similarity, 0, 0, 1));
}

function historyIndex(history, now) {
  const result = new Map();
  for (const event of Array.isArray(history) ? history : []) {
    if (!event || typeof event !== 'object') continue;
    const songId = identifier(event.songId ?? event.id);
    if (!songId) continue;
    const previous = result.get(songId) ?? { count: 0, recentExposure: 0, lastPlayedAt: null };
    const playedAt = timestamp(event.playedAt ?? event.timestamp ?? event.at);
    previous.count += 1;
    const ageDays = playedAt === null ? 0 : Math.max(0, (now - playedAt) / dayMilliseconds);
    previous.recentExposure += Math.exp(-ageDays / 30);
    if (playedAt !== null && (previous.lastPlayedAt === null || playedAt > previous.lastPlayedAt)) {
      previous.lastPlayedAt = playedAt;
    }
    result.set(songId, previous);
  }
  return result;
}

function previousIds(previousQueue) {
  return (Array.isArray(previousQueue) ? previousQueue : [])
    .map(song => identifier(typeof song === 'object' && song !== null ? song.id : song))
    .filter(Boolean);
}

function uniqueSongs(songs) {
  const result = new Map();
  for (const song of Array.isArray(songs) ? songs : []) {
    if (!song || typeof song !== 'object') continue;
    const songId = identifier(song.id);
    if (songId && !result.has(songId)) result.set(songId, { ...song, id: songId });
  }
  return [...result.values()];
}

function roulette(candidates, weightFor, random) {
  const weighted = candidates.map(song => ({ song, weight: weightFor(song) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const sampled = Number(random());
  const unit = Number.isFinite(sampled) ? Math.min(1 - Number.EPSILON, Math.max(0, sampled)) : 0;
  let remaining = unit * total;
  for (const entry of weighted) {
    remaining -= entry.weight;
    if (remaining < 0) return entry.song;
  }
  return weighted[weighted.length - 1].song;
}

function reorderCurrentQueue(songs, previousQueue, options, random) {
  const library = new Map(uniqueSongs(songs).map(song => [song.id, song]));
  const entries = Array.isArray(previousQueue) ? previousQueue : [];
  const previous = new Map();
  let missingCount = 0;
  for (const entry of entries) {
    const songId = identifier(typeof entry === 'object' && entry !== null ? entry.id : entry);
    if (!songId || previous.has(songId)) continue;
    const snapshot = typeof entry === 'object' && entry !== null ? entry : null;
    const current = library.get(songId);
    if (current || snapshot) {
      const song = { ...snapshot, ...current, id: songId };
      if (!song.blocked && !song.excluded && !song.localExcluded && !isExcludedByOptions(song, options)) previous.set(songId, song);
    }
    else missingCount += 1;
  }
  const priorIds = [...previous.keys()];
  const eligibleCount = previous.size;
  const variation = boundedNumber(options.variation ?? 50, 50, 0, 100);
  const maximumGap = 12 + variation * 0.65;
  const queue = [];
  const warnings = [];
  let lastKnownEnergy = null;
  let lastKnownMood = null;
  let remaining = [...previous.values()];
  while (remaining.length) {
    const smooth = remaining.filter(song => {
      const energy = songEnergy(song);
      return lastKnownEnergy === null || energy === null || Math.abs(energy - lastKnownEnergy) <= maximumGap;
    });
    const selected = roulette(smooth.length ? smooth : remaining, song => {
      const energy = songEnergy(song);
      const mood = songMood(song);
      const transitionFit = lastKnownEnergy === null || energy === null ? 1 : Math.exp(-Math.abs(energy - lastKnownEnergy) / (10 + variation * 0.6));
      const moodFit = lastKnownMood === null || mood === null || lastKnownMood === mood ? 1 : 0.35 + variation * 0.0065;
      return Math.max(Number.EPSILON, transitionFit * moodFit);
    }, random);
    const energy = songEnergy(selected);
    const mood = songMood(selected);
    const unknown = mood === null || energy === null || songGenre(selected) === null;
    queue.push({ ...selected, unknown, reason: `保留当前队列，仅调整顺序${unknown ? '；分类或能量未知，需要你确认听感' : ''}` });
    if (energy !== null) lastKnownEnergy = energy;
    if (mood !== null) lastKnownMood = mood;
    remaining = remaining.filter(song => song.id !== selected.id);
  }
  if (queue.length > 1 && queue.every((song, index) => song.id === priorIds[index])) queue.reverse();
  let finalKnownEnergy = null;
  let hasLargeGap = false;
  for (const song of queue) {
    const energy = songEnergy(song);
    if (energy === null) continue;
    if (finalKnownEnergy !== null && Math.abs(energy - finalKnownEnergy) > maximumGap) hasLargeGap = true;
    finalKnownEnergy = energy;
  }
  if (!entries.length) warnings.push('当前还没有队列，请先生成一批歌曲。');
  else warnings.push('本次仅换当前候选的顺序，并移除已屏蔽及本次不听的歌曲；正向范围、氛围、冷却和首数设置将在生成或换一批时应用。');
  if (missingCount) warnings.push(`当前曲库无法找到 ${missingCount} 首歌曲的信息，无法对这些 ID 重新排序。`);
  if (hasLargeGap) warnings.push('已保留当前队列的所有歌曲，部分能量过渡超过设定范围；可换一批或提高变化幅度。');
  const unknownCount = queue.filter(song => song.unknown).length;
  if (unknownCount) warnings.push(`${unknownCount} 首的分类或能量未知，无法保证其听感过渡；未根据歌名自动猜测。`);
  return { queue, warnings, eligibleCount };
}

export function generateQueue({ songs = [], history = [], previousQueue = [], referenceSongs = [], options = {} } = {}, random = Math.random) {
  const excludedCount = songs.filter(song => isExcludedByOptions(song, options)).length;
  songs = songs.filter(song => languageMatches(song, options.languages));
  const recentSongsSource = songs;
  referenceSongs = referenceSongs.filter(song => !isExcludedByOptions(song, options));
  previousQueue = previousQueue.filter(entry => entry === null || typeof entry !== 'object' || languageMatches(entry, options.languages));
  if (options.refreshMode === 'reorder') return reorderCurrentQueue(songs, previousQueue, options, random);
  songs = songs.filter(song => !isExcludedByOptions(song, options));
  const now = timestamp(options.now) ?? Date.now();
  const count = Math.floor(boundedNumber(options.count ?? 20, 20, 0, 5000));
  const variation = boundedNumber(options.variation ?? 50, 50, 0, 100);
  const cooldownDays = boundedNumber(options.cooldownDays ?? 3, 3, 0, 3650);
  const selectedMoods = new Set((Array.isArray(options.moods) ? options.moods : [options.mood]).filter(value => moods.has(value)));
  const selectedGenres = new Set((Array.isArray(options.genres) ? options.genres : [options.genre]).filter(value => genres.has(value)));
  const customTag = String(options.tag || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const classificationMode = options.classificationMode === 'strict' ? 'strict' : 'balanced';
  const includeUnknown = classificationMode === 'balanced' && options.includeUnknown !== false;
  const recentPriority = boundedNumber(options.recentPriority ?? 0, 0, 0, 100) / 100;
  const recentTaste = boundedNumber(options.recentTaste ?? 0, 0, 0, 100) / 100;
  const referenceStrength = boundedNumber(options.referenceStrength ?? 50, 50, 0, 100) / 100;
  const useRecentQuota = options.recentPriority !== undefined;
  const selectedPlaylists = new Set((Array.isArray(options.playlistIds) ? options.playlistIds : []).map(identifier).filter(Boolean));
  const exposure = historyIndex(history, now);
  const priorIds = previousIds(previousQueue);
  const priorSet = new Set(priorIds);
  const warnings = [];
  if (excludedCount) warnings.push(`本次不听规则排除 ${excludedCount} 首；排除优先于想听、近期比例和参考权重。`);
  const library = uniqueSongs(songs).filter(song => languageMatches(song, options.languages));
  const featureIndex = new Map(library.map(song => [song.id, { id: song.id, ...features(song) }]));
  const classificationIndex = new Map(library.map(song => [song.id, classificationMatch(song, selectedMoods, selectedGenres)]));
  const recent = getRecentSongs(recentSongsSource, options);
  const recentRanks = new Map(recent.songs.map((song, index) => [song.id, 1 - index / 200]));
  const recentProfile = listeningProfile(recent.songs, featureIndex);
  const referenceProfile = listeningProfile(referenceSongs, featureIndex);
  const selectionWeights = new Map(library.map(song => {
    const item = featureIndex.get(song.id);
    return [song.id, {
      recentRank: recentRanks.get(song.id) || 0,
      recentAffinity: affinity(item, recentProfile),
      referenceAffinity: affinity(item, referenceProfile, true),
    }];
  }));
  let cooldownExcluded = 0;
  let moodExcluded = 0;
  let genreExcluded = 0;
  let tagExcluded = 0;
  let unknownExcluded = 0;
  let relatedExcluded = 0;
  let eligible = library.filter(song => {
    if (song.localExcluded || song.excluded || song.blocked) return false;
    if (!inScope(song, selectedPlaylists)) return false;
    const match = classificationIndex.get(song.id);
    if (match.moodTier === 3) { moodExcluded += 1; return false; }
    if (match.genreTier === 3) { genreExcluded += 1; return false; }
    if (match.tier === 2 && !includeUnknown) { unknownExcluded += 1; return false; }
    if (match.tier === 1 && classificationMode === 'strict') { relatedExcluded += 1; return false; }
    if (customTag && !featureIndex.get(song.id).tags.includes(customTag)) { tagExcluded += 1; return false; }
    const lastPlayedAt = exposure.get(song.id)?.lastPlayedAt;
    if (cooldownDays > 0 && lastPlayedAt !== undefined && lastPlayedAt !== null && now - lastPlayedAt < cooldownDays * dayMilliseconds) {
      cooldownExcluded += 1;
      return false;
    }
    return true;
  });
  const eligibleCount = eligible.length;
  const tasteScores = eligible.map(song => selectionWeights.get(song.id).recentAffinity);
  const referenceScores = eligible.map(song => selectionWeights.get(song.id).referenceAffinity);
  const recentEligible = eligible.filter(song => recentRanks.has(song.id)).length;
  const olderEligible = eligibleCount - recentEligible;
  const requestedRecent = Math.round(count * recentPriority);
  let recentQuota = useRecentQuota ? Math.min(requestedRecent, recentEligible) : recentEligible;
  let olderQuota = useRecentQuota ? Math.min(count - requestedRecent, olderEligible) : olderEligible;
  if (useRecentQuota && recentPriority > 0 && recentPriority < 1) {
    recentQuota += Math.min(Math.max(0, count - recentQuota - olderQuota), recentEligible - recentQuota);
    olderQuota += Math.min(Math.max(0, count - recentQuota - olderQuota), olderEligible - olderQuota);
  }
  let selectedRecent = 0;
  let selectedOlder = 0;
  const queue = [];
  const maximumGap = 12 + variation * 0.65;
  const goalEnergies = [...selectedMoods].map(value => targetEnergy[value]);
  let lastKnownEnergy = null;
  let lastKnownMood = null;
  let transitionBlocked = false;
  const matchingPool = (candidates, field, strength) => {
    const maximum = candidates.reduce((best, song) => Math.max(best, selectionWeights.get(song.id)[field]), 0);
    return candidates.filter(song => selectionWeights.get(song.id)[field] > 0 && selectionWeights.get(song.id)[field] >= maximum * strength);
  };

  while (queue.length < count && eligible.length) {
    const feasible = eligible.filter(song => {
      const energy = songEnergy(song);
      const withinQuota = !useRecentQuota || (recentRanks.has(song.id) ? selectedRecent < recentQuota : selectedOlder < olderQuota);
      return withinQuota && (lastKnownEnergy === null || energy === null || Math.abs(energy - lastKnownEnergy) <= maximumGap);
    });
    if (!feasible.length) {
      transitionBlocked = eligible.some(song => !useRecentQuota || (recentRanks.has(song.id) ? selectedRecent < recentQuota : selectedOlder < olderQuota));
      break;
    }
    let quotaPool = feasible;
    if (useRecentQuota) {
      const recentPool = feasible.filter(song => recentRanks.has(song.id));
      const olderPool = feasible.filter(song => !recentRanks.has(song.id));
      quotaPool = !olderPool.length ? recentPool : !recentPool.length ? olderPool : Number(random()) < (recentQuota - selectedRecent) / (recentQuota + olderQuota - selectedRecent - selectedOlder) ? recentPool : olderPool;
    }
    const bestClassificationTier = quotaPool.reduce((best, song) => Math.min(best, classificationIndex.get(song.id).tier), 3);
    quotaPool = quotaPool.filter(song => classificationIndex.get(song.id).tier === bestClassificationTier);
    const tastePool = matchingPool(quotaPool, 'recentAffinity', recentTaste);
    const referencePool = matchingPool(quotaPool, 'referenceAffinity', referenceStrength);
    const tasteGuidance = tastePool.length ? recentTaste : 0;
    const referenceGuidance = referencePool.length ? referenceStrength : 0;
    const signal = tasteGuidance || referenceGuidance ? roulette([
      { id: 'neutral', weight: (1 - tasteGuidance) * (1 - referenceGuidance) },
      { id: 'taste', weight: tasteGuidance * (1 - referenceGuidance / 2) },
      { id: 'reference', weight: referenceGuidance * (1 - tasteGuidance / 2) },
    ], item => item.weight, random).id : 'neutral';
    const guidedPool = signal === 'taste' ? tastePool : signal === 'reference' ? referencePool : quotaPool;
    const fresh = guidedPool.filter(song => !priorSet.has(song.id));
    const pool = fresh.length ? fresh : guidedPool;
    const selected = roulette(pool, song => {
      const statistics = exposure.get(song.id) ?? { count: 0, recentExposure: 0, lastPlayedAt: null };
      const ageDays = statistics.lastPlayedAt === null ? Infinity : Math.max(0, (now - statistics.lastPlayedAt) / dayMilliseconds);
      const fairness = 1 / ((1 + statistics.recentExposure * 1.5) ** 1.3 * (1 + 6 * Math.exp(-ageDays / 7)));
      const energy = songEnergy(song);
      const knownMood = songMood(song);
      const goalFit = !goalEnergies.length || energy === null ? 1 : 1 / (1 + Math.min(...goalEnergies.map(goal => Math.abs(energy - goal))) / 25);
      const transitionFit = lastKnownEnergy === null || energy === null ? 1 : Math.exp(-Math.abs(energy - lastKnownEnergy) / (10 + variation * 0.6));
      const moodFit = lastKnownMood === null || knownMood === null || lastKnownMood === knownMood ? 1 : 0.35 + variation * 0.0065;
      const preferences = selectionWeights.get(song.id);
      const recentFit = signal === 'taste' ? influenceMultiplier(recentTaste, preferences.recentAffinity) : 1;
      const referenceFit = signal === 'reference' ? influenceMultiplier(referenceStrength, preferences.referenceAffinity) : 1;
      return Math.max(Number.EPSILON, fairness * goalFit * transitionFit * moodFit * recentFit * referenceFit);
    }, random);
    const knownMood = songMood(selected);
    const energy = songEnergy(selected);
    const unknown = knownMood === null || energy === null || songGenre(selected) === null;
    const reasons = [];
    const preferences = selectionWeights.get(selected.id);
    const inRecentPool = recentRanks.has(selected.id);
    const classificationTier = classificationIndex.get(selected.id).tier;
    const classificationFiltered = Boolean(selectedMoods.size || selectedGenres.size);
    const classificationKind = !classificationFiltered ? 'unrestricted' : classificationTier === 0 ? 'exact' : classificationTier === 1 ? 'related' : 'unclassified';
    if (inRecentPool) reasons.push(recent.basis === 'added-at' ? '来自最近加入的100首池' : '来自近期参考池（部分添加时间未知）');
    else reasons.push('来自近期池以外的老歌');
    if (recentTaste && preferences.recentAffinity) reasons.push('参考近期歌手或已知分类');
    if (referenceStrength && preferences.referenceAffinity && referenceProfile.ids.size) reasons.push(referenceProfile.ids.has(selected.id) ? '也在参考歌单中' : '参考歌单的歌手或已知分类相近');
    if (!exposure.has(selected.id)) reasons.push('还没有轮到过');
    else reasons.push('近期曝光越多，抽中权重越低');
    if (selectedMoods.has(knownMood)) reasons.push('符合本场所选氛围之一');
    if (classificationKind === 'related') reasons.push('相近类别补充，不是精确匹配；原歌曲标签未改动');
    if (classificationKind === 'unclassified') reasons.push('待分类补位，尚不能确认符合所选氛围或风格');
    if (lastKnownEnergy !== null && energy !== null) reasons.push('与前面已知歌曲的能量变化在设定范围内');
    if (unknown) reasons.push('分类或能量未知，保留候选；需要你确认听感');
    if (priorSet.size && !priorSet.has(selected.id)) reasons.push('上一批未出现');
    queue.push({ ...selected, unknown, inRecentPool, classificationKind, reason: reasons.join('；') });
    if (inRecentPool) selectedRecent += 1;
    else selectedOlder += 1;
    if (energy !== null) lastKnownEnergy = energy;
    if (knownMood !== null) lastKnownMood = knownMood;
    eligible = eligible.filter(song => song.id !== selected.id);
  }

  if (cooldownExcluded) warnings.push(`冷却期内的 ${cooldownExcluded} 首已排除，没有自动放宽冷却。`);
  if (moodExcluded) warnings.push(`已知氛围与本场选择不相近的 ${moodExcluded} 首已排除；这不包含标签未知的歌曲。`);
  if (genreExcluded) warnings.push(`已知风格与本场选择不相近的 ${genreExcluded} 首已排除；这不包含标签未知的歌曲。`);
  if (unknownExcluded) warnings.push(`${unknownExcluded} 首缺少所选分类的标签，属于待判定，不代表不符合听感；当前严格模式或关闭补位使它们未入选。`);
  if (relatedExcluded) warnings.push(`严格模式排除了 ${relatedExcluded} 首相近类别候选；可改为智能宽松后重选。`);
  if (tagExcluded) warnings.push(`没有自定义标签“${String(options.tag).trim()}”的 ${tagExcluded} 首已排除。`);
  if (Number(options.count) > 5000) warnings.push('本版单次最多生成 5000 首，超出部分没有生成。');
  if ((recentPriority || recentTaste) && recent.basis !== 'added-at') warnings.push(options.recentFallback === 'dated-only' ? '已选择只用有时间记录的歌曲；没有时间的歌曲未冒充最近添加，近期池可能不足100首。' : `部分歌曲没有可用添加时间，近期池优先已知时间，其余按歌单${recent.fallback === 'tail' ? '后部' : '前部'}补足；不能保证这就是真正最近加入的100首，请展开预览核对。`);
  if (useRecentQuota && (recentQuota !== requestedRecent || olderQuota !== count - requestedRecent)) warnings.push(`近期目标 ${requestedRecent} 首、老歌目标 ${count - requestedRecent} 首；筛选和冷却后近期可用 ${recentEligible} 首、老歌可用 ${olderEligible} 首。${recentPriority === 1 ? '100% 不会混入老歌补数。' : recentPriority === 0 ? '0% 不会混入近期歌补数。' : '某池不足，已由另一池补足可用数量；实际比例见结果核对。'}`);
  const coverage = getClassificationCoverage(library, options);
  if (selectedMoods.size && coverage.moodKnown === 0) warnings.push(`当前范围没有已知氛围标签，无法自动识别所选氛围；不是说没有符合的歌。${includeUnknown ? '智能宽松可用待分类歌补位，但不能保证符合氛围。' : '可切换智能宽松并允许待分类补位，无须清除范围或冷却。'}`);
  if (selectedGenres.size && coverage.genreKnown === 0) warnings.push(`当前范围没有已知风格标签，无法自动识别所选风格；不是说没有符合的歌。${includeUnknown ? '智能宽松可用待分类歌补位，但不能保证符合风格。' : '可切换智能宽松并允许待分类补位，无须清除范围或冷却。'}`);
  const relatedSelected = queue.filter(song => song.classificationKind === 'related').length;
  const unclassifiedSelected = queue.filter(song => song.classificationKind === 'unclassified').length;
  if (relatedSelected) warnings.push(`${relatedSelected} 首属于相近类别补充，不是精确标签匹配；没有将原标签改成你选的类别。`);
  if (unclassifiedSelected) warnings.push(`${unclassifiedSelected} 首作为待分类补位，尚未确认符合所选分类；优先候选不足才使用，没有冒充匹配成功。`);
  const tasteMatches = tasteScores.filter(score => score > 0).length;
  const referenceMatches = referenceScores.filter(score => score > 0).length;
  if (recentTaste && !tasteMatches) warnings.push('近期口味没有可匹配的歌手或已知分类，这个强度本次没有作用。');
  else if (recentTaste && tasteScores.length > 1 && new Set(tasteScores).size === 1) warnings.push('当前所有候选的近期相似度相同，口味强度不会改变它们之间的相对概率。');
  if (referenceStrength && referenceProfile.ids.size && !referenceMatches) warnings.push('参考歌单与当前范围没有共同歌曲、歌手或已知分类，参考强度本次没有作用。');
  else if (referenceStrength && referenceProfile.ids.size && referenceScores.length > 1 && new Set(referenceScores).size === 1) warnings.push('当前所有候选的参考相似度相同，参考强度不会改变它们之间的相对概率。');
  if (transitionBlocked) warnings.push('剩余歌曲超过当前能量过渡范围，队列提前结束；可以提高变化幅度后再生成。');
  if (queue.length < count) warnings.push(`本次只生成 ${queue.length} / ${count} 首；当前符合范围、氛围及冷却条件的候选共 ${eligibleCount} 首。`);
  const unknownCount = queue.filter(song => song.unknown).length;
  if (unknownCount) warnings.push(`${unknownCount} 首的分类或能量未知，无法保证其听感过渡；未根据歌名自动猜测。`);
  const overlap = priorSet.size ? queue.filter(song => priorSet.has(song.id)).length : 0;
  if (overlap) warnings.push(`未出现过且能衔接的候选不足，本批仍有 ${overlap} 首来自上一批。`);
  return { queue, warnings, eligibleCount, recentCount: recent.count, recencyBasis: recent.basis, referenceCount: referenceProfile.ids.size, selectionReport: { requestedCount: count, requestedRecent: useRecentQuota ? requestedRecent : null, recentEligible, olderEligible, selectedRecent, selectedOlder, actualRecentPercent: queue.length ? Math.round(selectedRecent / queue.length * 100) : 0, knownMoodCount: queue.filter(song => songMood(song) !== null).length, knownGenreCount: queue.filter(song => songGenre(song) !== null).length, knownEnergyCount: queue.filter(song => songEnergy(song) !== null).length, recencyBasis: recent.basis, knownDateCount: recent.knownDateCount, recentPoolCount: recent.count, classification: { mode: classificationMode, filtered: Boolean(selectedMoods.size || selectedGenres.size), exact: queue.filter(song => song.classificationKind === 'exact').length, related: relatedSelected, unclassified: unclassifiedSelected, unknownExcluded, relatedExcluded } } };
}

export function mergePlaylistSnapshot(existing, incoming) {
  const before = uniqueSongs(Array.isArray(existing) ? existing : existing?.songs);
  const snapshot = uniqueSongs(Array.isArray(incoming) ? incoming : incoming?.songs);
  const beforeIndex = new Map(before.map(song => [song.id, song]));
  const incomingIds = new Set(snapshot.map(song => song.id));
  const protectedKeys = new Set(['notes', 'excluded', 'blocked', 'hidden', 'pinned', 'liked', 'rating']);
  const songs = snapshot.map(song => {
    const previous = beforeIndex.get(song.id);
    if (!previous) return song;
    const userFields = Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith('local') || key.startsWith('user') || protectedKeys.has(key)));
    return { ...previous, ...song, ...userFields };
  });
  return {
    songs,
    added: snapshot.filter(song => !beforeIndex.has(song.id)).length,
    removed: before.filter(song => !incomingIds.has(song.id)).length,
  };
}

export function parsePlaylistInput(text) {
  const input = String(text ?? '').trim();
  if (/^[1-9]\d*$/.test(input)) return { type: 'playlist', id: input, url: `https://music.163.com/playlist?id=${input}` };
  const urls = input.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  if (!urls.length && /^(?:[a-z0-9-]+\.)*music\.163\.com\//i.test(input)) urls.push(`https://${input}`);
  if (!urls.length && /^(?:www\.)?163cn\.tv\//i.test(input)) urls.push(`https://${input}`);
  let foundNetease = false;
  for (const rawUrl of urls) {
    let parsed;
    try {
      parsed = new URL(rawUrl.replace(/[，。；！、）》」』】）),;!]+$/u, ''));
    } catch {
      continue;
    }
    const hostname = parsed.hostname.toLowerCase();
    const isMusicDomain = hostname === 'music.163.com' || hostname.endsWith('.music.163.com');
    const isShortDomain = hostname === '163cn.tv' || hostname === 'www.163cn.tv';
    if (!isMusicDomain && !isShortDomain) continue;
    foundNetease = true;
    if (parsed.username || parsed.password || parsed.port) continue;
    parsed.protocol = 'https:';
    if (isShortDomain && parsed.pathname !== '/') return { type: 'shortlink', url: parsed.href };
    const hashRoute = parsed.hash.startsWith('#/') ? parsed.hash.slice(1) : null;
    const route = hashRoute ? new URL(hashRoute, 'https://music.163.com') : parsed;
    const pathId = route.pathname.match(/(?:^|\/)playlist\/([1-9]\d*)(?:\/|$)/)?.[1];
    const queryId = /(?:^|\/)playlist\/?$/.test(route.pathname) ? route.searchParams.get('id') : null;
    const playlistId = pathId ?? queryId;
    if (playlistId && /^[1-9]\d*$/.test(playlistId)) {
      return { type: 'playlist', id: playlistId, url: `https://music.163.com/playlist?id=${playlistId}` };
    }
  }
  throw new Error(foundNetease ? '没有识别到网易云歌单，请粘贴歌单分享链接或歌单 ID。' : '只接受网易云音乐歌单链接、163cn.tv 分享短链或数字歌单 ID。');
}
