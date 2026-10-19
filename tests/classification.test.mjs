import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQueue, getClassificationCoverage, normalizeQueueOptions } from '../src/shuffle.mjs';

const now = Date.parse('2026-10-18T12:00:00+08:00');
const track = (id, fields = {}) => ({ id: String(id), title: `分类回归 ${id}`, artist: `歌手${id}`, playlistIds: ['one'], playlistOrder: Number(id) - 1, ...fields });
const criteria = { moods: ['gentle'], genre: 'folk', cooldownDays: 0, now };
const mixed = () => [track(1), track(2, { mood: 'healing', genre: 'pop', energy: 25 }), track(3), track(4, { mood: 'gentle', genre: 'folk', energy: 25 }), track(5, { mood: 'intense', genre: 'metal', energy: 90 })];

test('realistic unlabelled 3000-song import does not become empty when mood and genre are selected', () => {
  const songs = Array.from({ length: 3000 }, (_, index) => track(index + 1));
  const original = JSON.stringify(songs);
  const result = generateQueue({ songs, options: { ...criteria, recentPriority: 100, count: 20 } }, () => 0.5);
  assert.equal(result.queue.length, 20);
  assert.ok(result.queue.every(song => Number(song.id) <= 100 && song.classificationKind === 'unclassified'));
  assert.equal(result.selectionReport.classification.unclassified, 20);
  assert.equal(result.selectionReport.classification.exact, 0);
  assert.ok(result.warnings.some(value => value.includes('不是说没有符合的歌')));
  assert.ok(result.warnings.some(value => value.includes('没有冒充匹配成功')));
  assert.equal(JSON.stringify(songs), original);
});

test('exact matches precede nearby categories, which precede unknown supplements even against strong opposing guidance', () => {
  const songs = mixed();
  const result = generateQueue({ songs, referenceSongs: [songs[0]], previousQueue: ['4'], options: { ...criteria, count: 4, referenceStrength: 100 } }, () => 0.999);
  assert.deepEqual(result.queue.slice(0, 2).map(song => song.id), ['4', '2']);
  assert.deepEqual(result.queue.map(song => song.classificationKind), ['exact', 'related', 'unclassified', 'unclassified']);
  assert.equal(result.queue[1].mood, 'healing');
  assert.equal(result.queue[1].genre, 'pop');
  assert.ok(result.queue[1].reason.includes('不是精确匹配'));
  assert.equal(result.selectionReport.classification.exact, 1);
  assert.equal(result.selectionReport.classification.related, 1);
  assert.equal(result.selectionReport.classification.unclassified, 2);
});

test('missing one dimension never lets a known incompatible other dimension bypass filtering', () => {
  const songs = [track(1, { mood: 'intense' }), track(2, { genre: 'hiphop' }), track(3)];
  const result = generateQueue({ songs, options: { ...criteria, count: 3 } });
  assert.deepEqual(result.queue.map(song => song.id), ['3']);
  assert.ok(result.warnings.some(value => value.includes('已知氛围')));
  assert.ok(result.warnings.some(value => value.includes('已知风格')));
});

test('strict mode remains opt-in and ignores unknown supplements even if their checkbox value was saved', () => {
  const result = generateQueue({ songs: mixed(), options: { ...criteria, classificationMode: 'strict', includeUnknown: true, count: 10 } });
  assert.deepEqual(result.queue.map(song => song.id), ['4']);
  assert.equal(result.selectionReport.classification.unknownExcluded, 2);
  assert.equal(result.selectionReport.classification.relatedExcluded, 1);
  assert.ok(result.warnings.some(value => value.includes('属于待判定，不代表不符合听感')));
});

test('balanced mode can independently disable unknown supplements without rejecting nearby categories', () => {
  const result = generateQueue({ songs: mixed(), options: { ...criteria, includeUnknown: false, count: 10 } });
  assert.deepEqual(result.queue.map(song => song.id), ['4', '2']);
  assert.equal(result.selectionReport.classification.unclassified, 0);
});

test('no classification selection does not exclude unlabelled music even in strict mode', () => {
  const result = generateQueue({ songs: [track(1), track(2)], options: { classificationMode: 'strict', includeUnknown: false, count: 2 } });
  assert.equal(result.queue.length, 2);
  assert.equal(result.selectionReport.classification.filtered, false);
  assert.ok(result.queue.every(song => song.classificationKind === 'unrestricted'));
});

test('nearby-category relationships are direct, not a chain that eventually admits every style', () => {
  const songs = [track(1, { mood: 'healing', genre: 'rock' }), track(2, { mood: 'bright', genre: 'rock' }), track(3, { mood: 'gentle', genre: 'metal' })];
  const result = generateQueue({ songs, options: { ...criteria, genre: 'pop', count: 10 } });
  assert.deepEqual(result.queue.map(song => song.id), ['1']);
});

test('classification supplementation never relaxes selected scope, explicit tags, exclusions or cooldown', () => {
  const songs = [track(1, { localTags: ['夜跑'] }), track(2, { playlistIds: ['other'], localTags: ['夜跑'] }), track(3, { localTags: ['夜跑'], excluded: true }), track(4, { localTags: ['夜跑'] }), track(5)];
  const result = generateQueue({ songs, history: [{ songId: '4', playedAt: now }], options: { ...criteria, playlistIds: ['one'], tag: '夜跑', cooldownDays: 3, count: 10 } });
  assert.deepEqual(result.queue.map(song => song.id), ['1']);
});

test('100 percent recent cannot use older exact matches to replace recent unknowns or cooling songs', () => {
  const songs = Array.from({ length: 130 }, (_, index) => track(index + 1, index >= 100 ? { mood: 'gentle', genre: 'folk' } : {}));
  const history = songs.slice(0, 99).map(song => ({ songId: song.id, playedAt: now }));
  const result = generateQueue({ songs, history, options: { ...criteria, cooldownDays: 3, recentPriority: 100, count: 20 } });
  assert.deepEqual(result.queue.map(song => song.id), ['100']);
  assert.equal(result.queue[0].classificationKind, 'unclassified');
  assert.equal(result.selectionReport.selectedOlder, 0);
});

test('migration fixes the previous forced strict default once and respects subsequent explicit user choices', () => {
  const upgraded = normalizeQueueOptions({ classificationPolicy: 2, includeUnknown: false, moods: ['gentle'], genre: 'folk', recentPriority: 100, cooldownDays: 7 });
  assert.equal(upgraded.classificationMode, 'balanced');
  assert.equal(upgraded.includeUnknown, true);
  assert.deepEqual(upgraded.moods, ['gentle']);
  assert.equal(upgraded.recentPriority, 100);
  assert.equal(upgraded.cooldownDays, 7);
  const strict = normalizeQueueOptions(JSON.parse(JSON.stringify({ ...upgraded, classificationMode: 'strict', includeUnknown: false })));
  assert.equal(strict.classificationMode, 'strict');
  assert.equal(strict.includeUnknown, false);
  assert.equal(normalizeQueueOptions({ ...upgraded, includeUnknown: false }).includeUnknown, false);
});

test('coverage separates missing labels from known conflicts rather than calling all missing tracks mismatched', () => {
  const result = getClassificationCoverage(mixed(), criteria);
  assert.equal(result.exactCount, 1);
  assert.equal(result.relatedCount, 1);
  assert.equal(result.unclassifiedCount, 2);
  assert.equal(result.conflictCount, 1);
});
