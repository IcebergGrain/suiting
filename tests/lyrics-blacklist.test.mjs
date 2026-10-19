import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, normalizeLyrics, activeLyricIndex } from '../src/lyrics.mjs';
import { normalizeBlacklist, applyBlacklist, playableSongs } from '../src/library.mjs';
import { generateQueue, mergePlaylistSnapshot } from '../src/shuffle.mjs';
import { createNetEaseService } from '../src/netease-core.mjs';
import { createMobileApi } from '../public/mobile-api.mjs';

test('LRC handles repeated timestamps, fractions, offset, metadata and translation', () => {
  const lyrics = normalizeLyrics({ lrc: { lyric: '[ar:合成作者]\n[offset:500]\n[00:01.25][00:03.250]合成第一行\n[00:05]合成第二行' }, tlyric: { lyric: '[00:01.750]合成译文' } });
  assert.equal(lyrics.status, 'timed');
  assert.deepEqual(lyrics.lines.map(line => line.time), [1.75, 3.75, 5.5]);
  assert.equal(lyrics.lines[0].translation, '合成译文');
  assert.equal(activeLyricIndex(lyrics.lines, 1), -1);
  assert.equal(activeLyricIndex(lyrics.lines, 4), 1);
  assert.equal(activeLyricIndex(lyrics.lines, 100), 2);
  assert.equal(parseLrc('[00:70]错误时间').lines.length, 0);
});

test('plain, instrumental and missing lyrics remain distinct without fake timestamps', () => {
  assert.equal(normalizeLyrics({ nolyric: true }).status, 'instrumental');
  assert.equal(normalizeLyrics({ lrc: { lyric: '静态合成歌词' } }).status, 'plain');
  assert.equal(normalizeLyrics({}).status, 'unavailable');
  assert.equal(activeLyricIndex([], 1), -1);
  assert.equal(parseLrc('[00:01]一\n[00:01]二').lines[0].text, '一 / 二');
});

test('blacklist is global across snapshots, survives JSON and cannot be undone by sync', () => {
  const original = [{ id: '1', title: 'A', playlistIds: ['one'] }, { id: '2', title: 'B', playlistIds: ['one'] }];
  const blocked = normalizeBlacklist({ 1: { title: 'A', artist: 'X', blockedAt: 1 } });
  const restored = normalizeBlacklist(JSON.parse(JSON.stringify(blocked)));
  const synced = mergePlaylistSnapshot(original, original.map(song => ({ ...song, title: `${song.title} 更新` }))).songs;
  const songs = applyBlacklist(synced, restored);
  assert.equal(original[0].blocked, undefined);
  assert.equal(songs[0].blocked, true);
  assert.deepEqual(playableSongs(songs).map(song => song.id), ['2']);
  assert.deepEqual(generateQueue({ songs, options: { count: 2, cooldownDays: 0, recentPriority: 100 } }).queue.map(song => song.id), ['2']);
  assert.deepEqual(generateQueue({ songs, previousQueue: original, options: { refreshMode: 'reorder' } }).queue.map(song => song.id), ['2']);
  delete restored['1'];
  assert.equal(applyBlacklist(synced, restored)[0].blocked, false);
});

test('malformed blacklist keys are rejected and playable songs are deduplicated', () => {
  const blocked = normalizeBlacklist(JSON.parse('{"__proto__":{"title":"bad"},"../file":{},"2":{"title":"B"}}'));
  assert.deepEqual(Object.keys(blocked), ['2']);
  assert.deepEqual(playableSongs([{ id: '1' }, { id: '1' }, { id: '2' }, { id: '3', demo: true }], ['2']).map(song => song.id), ['1']);
});

test('shared lyrics service validates IDs and mobile forwards only the permitted operation', async () => {
  let calls = 0;
  const service = createNetEaseService({ upstream: { lyric: async () => { calls++; return { body: { code: 200, lrc: { lyric: '[00:01]合成歌词' } } }; } } });
  const session = { cookie: {} };
  await assert.rejects(() => service.lyrics(session, 'bad'), error => error.code === 'INVALID_ID');
  assert.equal(calls, 0);
  assert.equal((await service.lyrics(session, '1')).lines[0].text, '合成歌词');
  const mobile = createMobileApi(async (operation, parameters) => {
    assert.equal(operation, 'lyric'); assert.equal(parameters.id, '1'); assert.equal(parameters.cookie, undefined);
    return { body: { code: 200, lrc: { lyric: '[00:01]合成歌词' } } };
  });
  assert.equal((await mobile('/api/lyrics', { method: 'POST', body: JSON.stringify({ id: '1' }) })).status, 'timed');
});
