import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQueue, normalizeQueueOptions, getClassificationCoverage, parseTags, getTagCatalog } from '../src/shuffle.mjs';

const songs = ['pop', 'folk', 'rap', null].map((genre, index) => ({ id: String(index + 1), title: `歌曲${index}`, genre, mood: 'gentle', playlistIds: ['one'], localTags: index < 2 ? ['夜跑', 'Road Trip'] : ['其他'] }));
test('genre multiselect is a union within the dimension and migrates old selection', () => {
  assert.deepEqual(normalizeQueueOptions({ genre: 'folk' }).genres, ['folk']);
  assert.deepEqual(normalizeQueueOptions({ genre: 'folk', genres: [] }).genres, []);
  assert.deepEqual(normalizeQueueOptions({ genres: ['folk', 'folk', 'invalid'] }).genres, ['folk']);
  const result = generateQueue({ songs, options: { genres: ['pop', 'folk'], classificationMode: 'strict', cooldownDays: 0, count: 10 } });
  assert.deepEqual(new Set(result.queue.map(song => song.id)), new Set(['1', '2']));
  const coverage = getClassificationCoverage(songs, { genres: ['pop', 'folk'], classificationMode: 'strict' });
  assert.equal(coverage.exactCount, 2);
});
test('genre selection still intersects mood, manual tag, cooldown and scope', () => {
  const result = generateQueue({ songs: [...songs, { ...songs[0], id: '5', mood: 'energetic' }], history: [{ songId: '2', playedAt: Date.now() }], options: { genres: ['pop', 'folk'], moods: ['gentle'], tag: '夜跑', classificationMode: 'strict', cooldownDays: 3, count: 10 } });
  assert.deepEqual(result.queue.map(song => song.id), ['1']);
});
test('tag normalization, saved catalog and hard filtering share the same rules', () => {
  assert.deepEqual(parseTags(' 夜跑，夜跑;Road   Trip\nroad trip'), ['夜跑', 'Road Trip']);
  const catalog = getTagCatalog([...songs, songs[0]], { playlistIds: ['one'] });
  assert.equal(catalog.find(item => item.label === '夜跑').count, 2);
  assert.equal(getTagCatalog(songs, { playlistIds: ['other'] }).length, 0);
  const result = generateQueue({ songs, options: { tag: ' ROAD  TRIP ', cooldownDays: 0, count: 10 } });
  assert.deepEqual(new Set(result.queue.map(song => song.id)), new Set(['1', '2']));
  assert.equal(generateQueue({ songs, options: { tag: '未保存过的标签', count: 10 } }).queue.length, 0);
});
