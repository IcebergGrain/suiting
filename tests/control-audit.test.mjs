import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQueue, getRecentSongs, normalizeQueueOptions, influenceMultiplier, moodDefinitions, genreDefinitions } from '../src/shuffle.mjs';

const now = Date.parse('2026-10-18T12:00:00+08:00');
const library = (count = 3000) => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), title: `审计歌曲${index + 1}`, artist: `歌手${index % 5}`, playlistIds: ['audit'], playlistOrder: index, addedAt: now - index * 1000 }));
const run = (recentPriority, extra = {}, songs = library()) => generateQueue({ songs, options: { count: 20, recentPriority, cooldownDays: 0, now, ...extra } }, () => 0.5);

test('100 percent recent is a strict pool even in a 3000-song library with strong opposing weights', () => {
  const songs = library();
  const result = generateQueue({ songs, previousQueue: songs.slice(0, 100), history: songs.slice(0, 100).flatMap(song => Array.from({ length: 100 }, () => ({ songId: song.id, playedAt: now - 86400000 }))), referenceSongs: songs.slice(100), options: { count: 100, recentPriority: 100, recentTaste: 100, referenceStrength: 100, cooldownDays: 0, now } }, () => 0.5);
  assert.equal(result.queue.length, 100);
  assert.ok(result.queue.every(song => Number(song.id) <= 100));
  assert.equal(result.selectionReport.actualRecentPercent, 100);
});

test('0 percent excludes the recent pool and intermediate percentages allocate exact rounded counts', () => {
  for (const percentage of [0, 1, 25, 50, 75, 99, 100]) {
    const result = run(percentage);
    assert.equal(result.queue.length, 20);
    assert.equal(result.queue.filter(song => Number(song.id) <= 100).length, Math.round(20 * percentage / 100));
    assert.equal(new Set(result.queue.map(song => song.id)).size, 20);
  }
});

test('100 percent recent never fills shortages with older, excluded, mismatched or cooling songs', () => {
  const songs = library();
  const result = generateQueue({ songs, history: songs.slice(0, 98).map(song => ({ songId: song.id, playedAt: now })), options: { count: 20, recentPriority: 100, cooldownDays: 3, now } });
  assert.deepEqual(new Set(result.queue.map(song => song.id)), new Set(['99', '100']));
  assert.ok(result.warnings.some(value => value.includes('不会混入老歌')));
  assert.equal(run(100, { count: 200 }).queue.length, 100);
  assert.equal(run(0, { count: 20 }, library(20)).queue.length, 0);
});

test('intermediate shortages are explicitly reported with actual composition', () => {
  const result = run(50, { count: 400 });
  assert.equal(result.queue.length, 400);
  assert.equal(result.selectionReport.selectedRecent, 100);
  assert.equal(result.selectionReport.selectedOlder, 300);
  assert.equal(result.selectionReport.actualRecentPercent, 25);
  assert.ok(result.warnings.some(value => value.includes('实际比例')));
});

test('missing dates support visible head, tail and strict evidence-only pools without fabricating dates', () => {
  const songs = library(150).map(song => ({ ...song, addedAt: null }));
  assert.equal(getRecentSongs(songs).songs[0].id, '1');
  const tail = getRecentSongs(songs, { recentFallback: 'tail' });
  assert.equal(tail.songs[0].id, '150');
  assert.equal(tail.songs[0].recentEvidence, 'playlist-tail');
  assert.equal(tail.songs[0].recentDate, null);
  assert.equal(getRecentSongs(songs, { recentFallback: 'dated-only' }).count, 0);
  const strict = run(100, { recentFallback: 'dated-only' }, songs);
  assert.equal(strict.queue.length, 0);
  assert.ok(strict.warnings.some(value => value.includes('没有时间')));
});

test('real addition dates outrank observation dates and remain scoped to the chosen playlist', () => {
  const songs = [
    { ...library(1)[0], addedAtByPlaylist: { audit: now - 100000 }, observedAtByPlaylist: { audit: now }, orderByPlaylist: { audit: 0 } },
    { ...library(2)[1], addedAtByPlaylist: { audit: now - 1000 }, observedAtByPlaylist: {}, orderByPlaylist: { audit: 1 } },
  ];
  assert.equal(getRecentSongs(songs).songs[0].id, '2');
});

test('every mood and genre still has an optional precise-label mode while balanced mode can supplement unknowns', () => {
  for (const mood of Object.keys(moodDefinitions)) {
    const songs = Object.keys(moodDefinitions).map((value, index) => ({ ...library(20)[index], mood: value }));
    songs.push({ ...library(30)[29], mood: null });
    const result = generateQueue({ songs, options: { classificationMode: 'strict', moods: [mood], count: 30, cooldownDays: 0 } });
    assert.equal(result.queue.length, 1);
    assert.equal(result.queue[0].mood, mood);
  }
  for (const genre of Object.keys(genreDefinitions)) {
    const songs = Object.keys(genreDefinitions).map((value, index) => ({ ...library(20)[index], genre: value }));
    assert.equal(generateQueue({ songs, options: { classificationMode: 'strict', genre, count: 30 } }).queue.length, 1);
  }
  const songs = library(4);
  assert.equal(generateQueue({ songs, options: { classificationMode: 'strict', mood: 'gentle', count: 4 } }).queue.length, 0);
  const allowed = generateQueue({ songs, options: { mood: 'gentle', includeUnknown: true, count: 4 } });
  assert.equal(allowed.queue.length, 4);
  assert.ok(allowed.warnings.some(value => value.includes('无法自动识别')));
  const missingGenre = generateQueue({ songs: [{ ...library(1)[0], mood: 'gentle', energy: 25 }], options: { count: 1 } });
  assert.equal(missingGenre.queue[0].unknown, true);
});

test('stored options migrate to balanced classification, preserve legacy moods, and validate imported controls', () => {
  const migrated = normalizeQueueOptions({ mood: 'gentle', includeUnknown: true, recentPriority: 100 });
  assert.deepEqual(migrated.moods, ['gentle']);
  assert.equal(migrated.includeUnknown, true);
  assert.equal(migrated.classificationMode, 'balanced');
  assert.equal(migrated.recentPriority, 100);
  const restored = normalizeQueueOptions({ ...migrated, includeUnknown: true, count: 99999, recentPriority: -1, recentFallback: 'tail' });
  assert.equal(restored.includeUnknown, true);
  assert.equal(restored.count, 5000);
  assert.equal(restored.recentPriority, 0);
  assert.equal(restored.recentFallback, 'tail');
  assert.equal(normalizeQueueOptions({ count: 13 }).countMode, 'custom');
});

test('soft influence has a strong monotonic curve, zero is neutral and full identity match reaches 1000x', () => {
  assert.equal(influenceMultiplier(0, 1), 1);
  assert.equal(influenceMultiplier(1, 0), 1);
  assert.ok(Math.abs(influenceMultiplier(0.5, 1) - Math.sqrt(1000)) < 0.000001);
  assert.ok(Math.abs(influenceMultiplier(1, 1) - 1000) < 0.000001);
  assert.ok(influenceMultiplier(1, 0.8) > 250);
  assert.ok(influenceMultiplier(1, 0.8) > influenceMultiplier(0.5, 0.8));
});

test('high reference strength strongly selects a known matching category rather than weakly nudging it', () => {
  const songs = library(2).map((song, index) => ({ ...song, artist: '', mood: index === 0 ? 'gentle' : 'intense' }));
  const referenceSongs = [{ id: '9999', mood: 'gentle', artist: '' }];
  const neutral = generateQueue({ songs, referenceSongs, options: { count: 1, referenceStrength: 0 } }, () => 0.9);
  const strong = generateQueue({ songs, referenceSongs, options: { count: 1, referenceStrength: 100 } }, () => 0.9);
  assert.equal(neutral.queue[0].id, '2');
  assert.equal(strong.queue[0].id, '1');
});

test('uniform or unavailable similarities explain why a preference has no effect', () => {
  const songs = library(5).map(song => ({ ...song, artist: '' }));
  const missing = run(100, { recentTaste: 100 }, songs);
  assert.ok(missing.warnings.some(value => value.includes('这个强度本次没有作用')));
  const uniform = run(100, { recentTaste: 100 }, library(5));
  assert.ok(uniform.warnings.some(value => value.includes('相似度相同')));
});

test('strong guidance cannot be diluted by thousands of unrelated songs or vetoed by previous-batch freshness', () => {
  const songs = library().map(song => ({ ...song, artist: `独立歌手${song.id}`, mood: 'gentle', genre: 'pop' }));
  const result = generateQueue({ songs, previousQueue: [songs[0]], referenceSongs: [songs[0]], options: { count: 1, referenceStrength: 100, recentTaste: 0 } }, () => 0.99999);
  assert.equal(result.queue[0].id, '1');
});

test('observed additions in another selected playlist remain valid, but an unselected playlist cannot leak recency', () => {
  const songs = [{ ...library(1)[0], playlistIds: ['audit', 'two'], addedAtByPlaylist: { audit: now - 100000 }, observedAtByPlaylist: { audit: now, two: now - 1 } }];
  assert.equal(getRecentSongs(songs, { playlistIds: ['audit'] }).songs[0].recentDate, now - 100000);
  const both = getRecentSongs(songs);
  assert.equal(both.songs[0].recentDate, now - 1);
  assert.equal(both.songs[0].recentEvidence, 'observed');
});

test('reference guidance cannot restore a song blocked by scope, tag or cooldown', () => {
  const songs = library().map(song => ({ ...song, artist: `唯一歌手${song.id}`, localTags: song.id === '1' ? ['别选'] : ['夜跑'] }));
  const result = generateQueue({ songs, referenceSongs: [songs[0]], history: [{ songId: '1', playedAt: now }], options: { count: 20, referenceStrength: 100, tag: '夜跑', cooldownDays: 3, now } });
  assert.equal(result.queue.length, 20);
  assert.ok(result.queue.every(song => song.id !== '1'));
  assert.ok(result.warnings.some(value => value.includes('参考强度本次没有作用')));
});
