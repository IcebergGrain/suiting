import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQueue, mergePlaylistSnapshot, parsePlaylistInput, getRecentSongs, moodDefinitions, genreDefinitions } from '../src/shuffle.mjs';

const now = Date.parse('2026-10-18T12:00:00+08:00');
const song = (id, overrides = {}) => ({ id: String(id), title: `歌曲 ${id}`, artist: '歌手', playlistIds: ['one'], mood: 'gentle', energy: 25, ...overrides });

function seededRandom(seed = 12345) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

test('selected playlist membership is a hard limit and duplicate IDs never repeat', () => {
  const result = generateQueue({ songs: [song(1), song(1), song(2, { playlistIds: ['two'] }), song(3)], options: { playlistIds: ['one'], count: 10, now } }, seededRandom());
  assert.deepEqual(new Set(result.queue.map(item => item.id)), new Set(['1', '3']));
  assert.equal(result.queue.length, 2);
  assert.equal(result.eligibleCount, 2);
  assert.ok(result.warnings.some(warning => warning.includes('2 / 10')));
});

test('cooldown remains strict when too few candidates remain', () => {
  const result = generateQueue({ songs: [song(1), song(2)], history: [{ songId: '1', playedAt: now - 86_400_000 }], options: { count: 2, cooldownDays: 3, now } });
  assert.deepEqual(result.queue.map(item => item.id), ['2']);
  assert.ok(result.warnings.some(warning => warning.includes('没有自动放宽冷却')));
});

test('unknown metadata is retained and explicitly disclosed during mood filtering', () => {
  const result = generateQueue({ songs: [song(1), song(2, { mood: 'energetic' }), song(3, { mood: undefined, energy: undefined })], options: { mood: 'gentle', includeUnknown: true, count: 3, now } }, seededRandom());
  assert.deepEqual(new Set(result.queue.map(item => item.id)), new Set(['1', '3']));
  assert.equal(result.queue.find(item => item.id === '3').unknown, true);
  assert.ok(result.warnings.some(warning => warning.includes('未根据歌名自动猜测')));
});

test('local mood and energy edits take precedence over imported metadata', () => {
  const result = generateQueue({ songs: [song(1, { mood: 'energetic', energy: 95, localMood: 'gentle', localGenre: 'folk', localEnergy: 20 }), song(2, { energy: 25 })], options: { mood: 'gentle', count: 2, variation: 0, now } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['1', '2']);
  assert.equal(result.queue[0].unknown, false);
});

test('local energy uses a percentage scale even when the value is one', () => {
  const result = generateQueue({ songs: [song(1, { energy: 1, localEnergy: 1 }), song(2, { localEnergy: 5 })], options: { count: 2, variation: 0, now } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['1', '2']);
});

test('imported energy may use a normalized scale when no local value exists', () => {
  const result = generateQueue({ songs: [song(1, { energy: 1 }), song(2, { energy: 95 })], options: { count: 2, variation: 0, now } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['1', '2']);
});

test('strict transitions do not silently bridge a large known energy jump', () => {
  const result = generateQueue({ songs: [song(1, { energy: 10 }), song(2, { energy: 90 })], options: { count: 2, variation: 0, now } }, () => 0);
  assert.equal(result.queue.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes('超过当前能量过渡范围')));
});

test('an unknown song does not erase the last known energy constraint', () => {
  const result = generateQueue({ songs: [song(1, { energy: 10 }), song(2, { energy: null }), song(3, { energy: 90 })], options: { count: 3, variation: 0, now } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['1', '2']);
});

test('new batch prioritizes tracks absent from the previous batch', () => {
  const result = generateQueue({ songs: [song(1), song(2), song(3), song(4)], previousQueue: ['1', '2'], options: { count: 2, refreshMode: 'new', now } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['3', '4']);
});

test('reorder stays within the previous batch and changes an unchanged order', () => {
  const result = generateQueue({ songs: [song(1), song(2), song(3)], previousQueue: ['1', '2'], options: { count: 2, refreshMode: 'reorder', now } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['2', '1']);
});

test('reorder preserves the current set despite changed filters, count, and new cooldown history', () => {
  const songs = [song(1, { mood: 'energetic', energy: 90 }), song(2, { energy: 5 }), song(3)];
  const result = generateQueue({ songs, previousQueue: songs.slice(0, 2), history: [{ songId: '1', playedAt: now }], options: { count: 1, refreshMode: 'reorder', playlistIds: ['another'], mood: 'gentle', variation: 0, cooldownDays: 3, now } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['2', '1']);
  assert.equal(result.eligibleCount, 2);
  assert.ok(result.warnings.some(warning => warning.includes('所有歌曲')));
  assert.ok(result.warnings.some(warning => warning.includes('生成或换一批时应用')));
});

test('reorder can retain snapshot objects and reports unresolved ID entries', () => {
  const result = generateQueue({ songs: [], previousQueue: [song(1), 'missing'], options: { refreshMode: 'reorder' } }, () => 0);
  assert.deepEqual(result.queue.map(item => item.id), ['1']);
  assert.ok(result.warnings.some(warning => warning.includes('无法找到 1 首')));
});

test('reorder with no current queue does not unexpectedly generate a new batch', () => {
  const result = generateQueue({ songs: [song(1)], previousQueue: [], options: { refreshMode: 'reorder' } });
  assert.deepEqual(result.queue, []);
  assert.ok(result.warnings.some(warning => warning.includes('请先生成')));
});

test('repeated automated exposure reduces rather than increases selection frequency', () => {
  const history = Array.from({ length: 25 }, () => ({ songId: '1', playedAt: now - 10 * 86_400_000, source: 'automatic' }));
  const random = seededRandom();
  let repeatedSelections = 0;
  for (let iteration = 0; iteration < 800; iteration += 1) {
    const result = generateQueue({ songs: [song(1), song(2)], history, options: { count: 1, now } }, random);
    if (result.queue[0].id === '1') repeatedSelections += 1;
  }
  assert.ok(repeatedSelections < 100, `Repeated track was selected ${repeatedSelections} times.`);
});

test('generation does not mutate songs, history, or previous queues', () => {
  const songs = [song(1), song(2)];
  const history = [{ songId: '1', playedAt: now - 10 * 86_400_000 }];
  const previousQueue = [songs[0]];
  const snapshot = structuredClone({ songs, history, previousQueue });
  generateQueue({ songs, history, previousQueue, options: { count: 2, now } });
  assert.deepEqual({ songs, history, previousQueue }, snapshot);
});

test('old exposure decays so previously frequent songs are not penalized forever', () => {
  const history = Array.from({ length: 25 }, () => ({ songId: '1', playedAt: now - 365 * 86_400_000 }));
  const result = generateQueue({ songs: [song(1), song(2)], history, options: { count: 1, now } }, () => 0.45);
  assert.equal(result.queue[0].id, '1');
});

test('snapshot sync updates remote metadata, removes deleted tracks, and preserves local edits', () => {
  const existing = [song(1, { localTags: ['甜但很躁'], localMood: 'bright', localEnergy: 60, userData: { note: 'keep' }, notes: '备注' }), song(2)];
  const incoming = [song(1, { title: '新名称', localMood: 'sad' }), song(3), song(3)];
  const result = mergePlaylistSnapshot(existing, incoming);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.deepEqual(result.songs.map(item => item.id), ['1', '3']);
  assert.equal(result.songs[0].title, '新名称');
  assert.equal(result.songs[0].localMood, 'bright');
  assert.equal(result.songs[0].localEnergy, 60);
  assert.deepEqual(result.songs[0].localTags, ['甜但很躁']);
  assert.deepEqual(result.songs[0].userData, { note: 'keep' });
  assert.equal(result.songs[0].notes, '备注');
});

test('playlist parser accepts IDs, mobile and hash links, path URLs, and share text', () => {
  for (const input of ['12345', 'https://music.163.com/#/playlist?id=12345', 'https://music.163.com/playlist/12345', 'https://y.music.163.com/m/playlist?id=12345&userid=7', '分享歌单：宝藏 https://music.163.com/playlist?id=12345 （来自网易云音乐）', 'music.163.com/playlist?id=12345']) {
    assert.deepEqual(parsePlaylistInput(input), { type: 'playlist', id: '12345', url: 'https://music.163.com/playlist?id=12345' });
  }
});

test('playlist parser returns recognized shortlinks for server resolution', () => {
  assert.deepEqual(parsePlaylistInput('分享歌单 https://163cn.tv/ABCdef。'), { type: 'shortlink', url: 'https://163cn.tv/ABCdef' });
});

test('playlist parser rejects unrelated domains, misleading hosts, credentials, and song links', () => {
  for (const input of ['https://example.com/playlist?id=12345', 'https://music.163.com.evil.example/playlist?id=12345', 'https://music.163.com@evil.example/playlist?id=12345', 'https://user:password@music.163.com/playlist?id=12345', 'https://music.163.com/song?id=12345', 'javascript:alert(1)', '0', '']) {
    assert.throws(() => parsePlaylistInput(input));
  }
});

test('expanded moods, musical genres, and custom tags filter independently without inventing unknown labels', () => {
  assert.equal(Object.keys(moodDefinitions).length, 12);
  assert.equal(Object.keys(genreDefinitions).length, 14);
  const songs = [song(1, { localMood: 'dreamy', localGenre: 'jazz', localTags: ['夜跑'] }), song(2, { localMood: 'calm', localGenre: 'jazz', localTags: ['夜跑'] }), song(3, { localMood: 'dreamy', localGenre: 'rock', localTags: ['夜跑'] }), song(4, { localMood: null, localGenre: null, localTags: ['夜跑'] }), song(5, { localMood: 'dreamy', localGenre: 'jazz', localTags: ['睡前'] })];
  const strict = generateQueue({ songs, options: { classificationMode: 'strict', mood: 'dreamy', genre: 'jazz', tag: '夜跑', includeUnknown: false, count: 10, now } });
  assert.deepEqual(strict.queue.map(item => item.id), ['1']);
  const inclusive = generateQueue({ songs, options: { mood: 'dreamy', genre: 'jazz', tag: '夜跑', includeUnknown: true, count: 10, now } });
  assert.deepEqual(new Set(inclusive.queue.map(item => item.id)), new Set(['1', '2', '4']));
  assert.equal(inclusive.queue.find(item => item.id === '2').classificationKind, 'related');
  assert.equal(inclusive.queue.find(item => item.id === '4').unknown, true);
});

test('custom quantities can exceed 500, retain no duplicates, and disclose the 5000 limit', () => {
  const songs = Array.from({ length: 650 }, (_, index) => song(index + 1));
  const result = generateQueue({ songs, options: { count: 600, now } }, seededRandom());
  assert.equal(result.queue.length, 600);
  assert.equal(new Set(result.queue.map(item => item.id)).size, 600);
  const limited = generateQueue({ songs: songs.slice(0, 2), options: { count: 5001, now } });
  assert.ok(limited.warnings.some(warning => warning.includes('最多生成 5000')));
});

test('recent 100 are sorted by playlist addition dates rather than listening frequency or display order', () => {
  const songs = Array.from({ length: 150 }, (_, index) => song(index + 1, { addedAt: now - (150 - index) * 1000, playlistOrder: index }));
  const recent = getRecentSongs(songs);
  assert.equal(recent.count, 100);
  assert.equal(recent.basis, 'added-at');
  assert.equal(recent.songs[0].id, '150');
  assert.equal(recent.songs.at(-1).id, '51');
});

test('recent dates are scoped to selected playlists and missing dates explicitly use current order', () => {
  const songs = [song(1, { playlistIds: ['one', 'two'], addedAtByPlaylist: { one: now - 10000, two: now }, orderByPlaylist: { one: 0, two: 0 } }), song(2, { addedAtByPlaylist: { one: now - 1000 }, orderByPlaylist: { one: 1 } })];
  assert.equal(getRecentSongs(songs, { playlistIds: ['one'] }).songs[0].id, '2');
  const unknown = getRecentSongs([song(1, { playlistOrder: 5 }), song(2, { playlistOrder: 0 })]);
  assert.equal(unknown.basis, 'playlist-order');
  assert.equal(unknown.songs[0].id, '2');
  const partiallyDated = getRecentSongs([...Array.from({ length: 100 }, (_, index) => song(index + 1, { addedAt: now - index * 1000 })), song(101)]);
  assert.equal(partiallyDated.knownDateCount, 100);
  assert.equal(partiallyDated.basis, 'added-at');
});

test('recent-priority slider raises recent exposure while strict scope and cooldown still win', () => {
  const songs = Array.from({ length: 200 }, (_, index) => song(index + 1, { addedAt: now - (200 - index) * 1000 }));
  const baselineRandom = seededRandom(801);
  const boostedRandom = seededRandom(801);
  let baseline = 0;
  let boosted = 0;
  for (let index = 0; index < 400; index += 1) {
    baseline += Number(generateQueue({ songs, options: { count: 1, recentPriority: 0, recentTaste: 0, now } }, baselineRandom).queue[0].id) > 100 ? 1 : 0;
    boosted += Number(generateQueue({ songs, options: { count: 1, recentPriority: 100, recentTaste: 0, now } }, boostedRandom).queue[0].id) > 100 ? 1 : 0;
  }
  assert.ok(boosted > baseline + 60, `${boosted} should exceed ${baseline}`);
  const restricted = generateQueue({ songs: [song(1, { addedAt: now }), song(2, { playlistIds: ['two'], addedAt: now }), song(3)], history: [{ songId: '1', playedAt: now }], options: { playlistIds: ['one'], count: 5, recentPriority: 100, recentTaste: 100, cooldownDays: 3, now } });
  assert.deepEqual(restricted.queue.map(item => item.id), ['3']);
});

test('recent taste affects older songs with matching artists rather than only replaying recent IDs', () => {
  const songs = [song(1, { artist: '近期歌手', addedAt: now - 100000 }), song(2, { artist: '其他歌手', addedAt: now - 100000 }), ...Array.from({ length: 100 }, (_, index) => song(index + 3, { artist: '近期歌手', addedAt: now - index * 100 }))];
  const history = songs.slice(2).map(item => ({ songId: item.id, playedAt: now }));
  const first = seededRandom(42);
  const second = seededRandom(42);
  let baseline = 0;
  let influenced = 0;
  for (let index = 0; index < 300; index += 1) {
    baseline += generateQueue({ songs, history, options: { count: 1, recentPriority: 0, recentTaste: 0, now } }, first).queue[0].id === '1' ? 1 : 0;
    influenced += generateQueue({ songs, history, options: { count: 1, recentPriority: 0, recentTaste: 100, now } }, second).queue[0].id === '1' ? 1 : 0;
  }
  assert.ok(influenced > baseline + 40, `${influenced} should exceed ${baseline}`);
});

test('curated reference playlists influence the existing pool without inserting external songs', () => {
  const songs = [song(1, { artist: '参考歌手' }), song(2, { artist: '其他歌手' })];
  const referenceSongs = [song(999, { artist: '参考歌手', playlistIds: ['external'] })];
  const first = seededRandom(18);
  const second = seededRandom(18);
  let baseline = 0;
  let influenced = 0;
  for (let index = 0; index < 300; index += 1) {
    baseline += generateQueue({ songs, referenceSongs, options: { count: 1, referenceStrength: 0, now } }, first).queue[0].id === '1' ? 1 : 0;
    const result = generateQueue({ songs, referenceSongs, options: { count: 1, referenceStrength: 100, now } }, second);
    assert.notEqual(result.queue[0].id, '999');
    influenced += result.queue[0].id === '1' ? 1 : 0;
  }
  assert.ok(influenced > baseline + 50, `${influenced} should exceed ${baseline}`);
});

test('multiple moods use union matching and retain strict scope, cooldown, and unknown choices', () => {
  const songs = [song(1), song(2, { mood: 'healing' }), song(3, { mood: 'bright' }), song(4, { mood: null }), song(5, { mood: 'healing', playlistIds: ['two'] }), song(6, { mood: 'healing' })];
  const history = [{ songId: '6', playedAt: now }];
  const options = { classificationMode: 'strict', moods: ['gentle', 'healing'], mood: 'bright', playlistIds: ['one'], includeUnknown: false, count: 10, now };
  const strict = generateQueue({ songs, history, options });
  assert.deepEqual(new Set(strict.queue.map(item => item.id)), new Set(['1', '2']));
  const inclusive = generateQueue({ songs, history, options: { ...options, classificationMode: 'balanced', includeUnknown: true } });
  assert.deepEqual(new Set(inclusive.queue.map(item => item.id)), new Set(['1', '2', '3', '4']));
});

test('empty mood selection means unlimited and old single-mood callers remain supported', () => {
  const songs = [song(1), song(2, { mood: 'healing' }), song(3, { mood: 'bright' })];
  assert.equal(generateQueue({ songs, options: { moods: [], mood: 'gentle', count: 3, now } }).queue.length, 3);
  assert.deepEqual(generateQueue({ songs, options: { classificationMode: 'strict', mood: 'healing', count: 3, now } }).queue.map(item => item.id), ['2']);
});

test('distant selected moods do not silently bypass energy continuity', () => {
  const result = generateQueue({ songs: [song(1), song(2, { mood: 'intense', energy: 92 })], options: { moods: ['gentle', 'intense'], count: 2, variation: 0, now } }, () => 0);
  assert.equal(result.queue.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes('能量过渡')));
});
