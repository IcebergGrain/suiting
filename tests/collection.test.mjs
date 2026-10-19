import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRecommendation, collectedSongIds, dailyCollectionId, isRemoteSource } from '../src/collection.mjs';

test('daily collection is local, persistent, duplicate-free and never fabricates NetEase addition dates', () => {
  const original = [{ id: '11', songs: [], owned: true }];
  const song = { id: '123', title: '合成歌曲', artist: '合成歌手', url: 'https://secret.invalid/', addedAt: 17, blocked: true };
  const sources = collectRecommendation(original, song, true, 10000);
  assert.equal(original.length, 1);
  const source = sources.find(entry => entry.id === dailyCollectionId);
  assert.equal(source.local, true);
  assert.equal(isRemoteSource(source), false);
  assert.equal(source.songs[0].url, undefined);
  assert.equal(source.songs[0].blocked, undefined);
  assert.equal(source.songs[0].addedAt, null);
  assert.equal(source.songs[0].observedAddedAt, 10000);
  assert.equal(collectRecommendation(sources, song), sources);
  assert.deepEqual([...collectedSongIds(JSON.parse(JSON.stringify(sources)))], ['123']);
  assert.deepEqual([...collectedSongIds(collectRecommendation(sources, song, false))], []);
});

test('only valid real tracks can be locally collected and local sources never enter remote refresh', () => {
  for (const song of [{ id: 'bad', title: 'X' }, { id: '1', title: 'X', demo: true }, { id: '1' }]) assert.throws(() => collectRecommendation([], song));
  assert.equal(isRemoteSource({ id: '123' }), true);
  assert.equal(isRemoteSource({ id: '123', demo: true }), false);
  assert.equal(isRemoteSource({ id: 'local-user' }), false);
});
