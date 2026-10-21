import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { generateQueue, getRecentSongs, normalizeQueueOptions, isExcludedByOptions, genreDefinitions, moodDefinitions } from '../src/shuffle.mjs';
import { normalizeArtistBlacklist, artistBlacklistMatcher, songArtists, applyBlacklist, playableSongs } from '../src/library.mjs';
import { normalizePlayingQueue } from '../src/listening-session.mjs';
import { languageDefinitions } from '../src/languages.mjs';
import { renderExclusions, renderArtistActions, renderArtistBlacklist } from '../public/exclusions-view.mjs';
import { createQueuePlayer, createNativeQueuePlayer } from '../public/queue-player.mjs';

const song = (id, fields = {}) => ({ id: String(id), title: `合成歌曲 ${id}`, artist: '甲', playlistIds: ['one'], genre: 'pop', mood: 'gentle', energy: 30, languages: ['zh'], ...fields });
const options = { count: 20, cooldownDays: 0, recentPriority: 100, variation: 100 };
const ids = values => values.map(value => value.id).sort();
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const documentFor = html => new JSDOM(html).window.document;
const rules = normalizeArtistBlacklist([{ id: '7', name: '甲', blockedAt: 123 }]);

test('negative categories normalize known keys and do not erase positive preferences', () => {
  const result = normalizeQueueOptions({ genres: ['hiphop'], excludeGenres: ['hiphop', 'hiphop', 'bad'], excludeMoods: ['gentle', 'all'], excludeLanguages: ['en', 'bad'], excludeUnclassified: 'true' });
  assert.deepEqual(result.genres, ['hiphop']);
  assert.deepEqual(result.excludeGenres, ['hiphop']);
  assert.deepEqual(result.excludeMoods, ['gentle']);
  assert.deepEqual(result.excludeLanguages, ['en']);
  assert.equal(result.excludeUnclassified, false);
});

test('negative matching uses all effective tags, including multi-language songs and manual overrides', () => {
  assert.equal(isExcludedByOptions(song(1, { genre: undefined, autoGenreKeys: ['pop', 'hiphop'] }), { excludeGenres: ['hiphop'] }), true);
  assert.equal(isExcludedByOptions(song(1, { languages: ['zh', 'en'] }), { excludeLanguages: ['en'] }), true);
  assert.equal(isExcludedByOptions(song(1, { mood: 'energetic' }), { excludeMoods: ['energetic'] }), true);
  assert.equal(isExcludedByOptions(song(1, { genre: 'hiphop', localGenre: 'pop' }), { excludeGenres: ['hiphop'] }), false);
  assert.equal(isExcludedByOptions(song(1, { language: 'en', localLanguages: ['ja'] }), { excludeLanguages: ['en'] }), false);
});

test('unknown metadata is retained by default and explicitly removable per selected dimension', () => {
  const unknown = song(1, { genre: undefined, mood: undefined, languages: undefined });
  assert.equal(isExcludedByOptions(unknown, { excludeGenres: ['hiphop'] }), false);
  assert.equal(isExcludedByOptions(unknown, { excludeGenres: ['hiphop'], excludeUnclassified: true }), true);
  assert.equal(isExcludedByOptions(unknown, { excludeUnclassified: true }), false);
  assert.equal(isExcludedByOptions(song(2, { genre: undefined }), { excludeLanguages: ['en'], excludeUnclassified: true }), false);
});

test('exclusions beat positive selection, unknown soft fallback and 100 percent references', () => {
  const songs = [song(1, { genre: 'hiphop' }), song(2), song(3, { genre: undefined })];
  const result = generateQueue({ songs, referenceSongs: [songs[0]], options: { ...options, genres: ['hiphop'], referenceStrength: 100, excludeGenres: ['hiphop'], excludeUnclassified: true } });
  assert.equal(result.queue.some(value => ['1', '3'].includes(value.id)), false);
  assert.ok(result.warnings.some(value => value.includes('排除优先')));
});

test('excluding recent songs does not promote song 101 into the latest 100 pool', () => {
  const songs = Array.from({ length: 101 }, (_, index) => song(index + 1, { addedAt: 1800000000000 - index * 1000, genre: index < 100 ? 'hiphop' : 'pop' }));
  assert.equal(getRecentSongs(songs, { excludeGenres: ['hiphop'] }).count, 0);
  assert.equal(generateQueue({ songs, options: { ...options, excludeGenres: ['hiphop'] } }).queue.length, 0);
  const mixed = songs.map((value, index) => index === 99 ? { ...value, genre: 'pop' } : value);
  assert.deepEqual(ids(getRecentSongs(mixed, { excludeGenres: ['hiphop'] }).songs), ['100']);
  const result = generateQueue({ songs: mixed, options: { ...options, count: 1, excludeGenres: ['hiphop'], recentTaste: 100 } });
  assert.deepEqual(ids(result.queue), ['100']);
});

test('reordering cannot restore an excluded track using its stale snapshot', () => {
  const songs = [song(1, { genre: 'hiphop' }), song(2)];
  const previousQueue = [song(1), songs[1]];
  assert.deepEqual(ids(generateQueue({ songs, previousQueue, options: { ...options, refreshMode: 'reorder', excludeGenres: ['hiphop'] } }).queue), ['2']);
});

test('artist identity prefers IDs, matches collaborators and falls back only to complete legacy names', () => {
  const blocked = artistBlacklistMatcher(rules);
  assert.ok(blocked(song(1, { artists: [{ id: '8', name: '乙' }, { id: '7', name: '甲新名' }] })));
  assert.equal(blocked(song(1, { artists: [{ id: '8', name: '甲' }] })), null);
  assert.ok(blocked(song(1, { artist: '乙 / 甲' })));
  assert.equal(blocked(song(1, { artist: '甲乙' })), null);
  assert.equal(blocked(song(1, { artist: '未知歌手' })), null);
  assert.deepEqual(songArtists({ artist: 'AC/DC' }).map(value => value.name), ['AC/DC']);
});

test('legacy artist names normalize width, casing and whitespace without substring guessing', () => {
  const blocked = artistBlacklistMatcher([{ name: 'Ａlice  Band' }]);
  assert.ok(blocked({ artists: [{ id: '42', name: 'alice band' }] }));
  assert.equal(blocked({ artist: 'Alice Band Live' }), null);
  assert.deepEqual(Object.keys(normalizeArtistBlacklist([{}, { name: '未知歌手' }, { id: 'bad', name: '甲' }])), ['name:甲']);
});

test('artist rules survive JSON and sync while individual song blocks remain independent', () => {
  const restored = normalizeArtistBlacklist(JSON.parse(JSON.stringify(rules)));
  const songs = [song(1, { artists: [{ id: '7', name: '甲' }] }), song(2, { artists: [{ id: '8', name: '乙' }] })];
  assert.deepEqual(ids(playableSongs(applyBlacklist(songs, {}, restored))), ['2']);
  assert.deepEqual(ids(generateQueue({ songs: applyBlacklist(songs, {}, restored), options }).queue), ['2']);
  assert.deepEqual(ids(playableSongs(songs, ['1'], {})), ['2']);
  assert.deepEqual(ids(playableSongs(songs, [], {})), ['1', '2']);
  assert.equal(songs[0].blocked, undefined);
  assert.deepEqual(normalizePlayingQueue(songs, [], restored)[0].artists.map(value => value.id), ['8']);
});

test('negative UI labels precedence, classification gaps and separate persistent artist management', () => {
  const state = { options: normalizeQueueOptions({ excludeGenres: ['hiphop'] }), exclusionsOpen: true, artistBlacklist: rules };
  const document = documentFor(renderExclusions({ state, moodNames: Object.fromEntries(Object.entries(moodDefinitions).map(([key, value]) => [key, value.name])), genreDefinitions, languageDefinitions, escape }));
  assert.equal(document.querySelector('[data-field="excludeGenres"][data-value="hiphop"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#exclude-unclassified').checked, false);
  assert.match(document.body.textContent, /排除优先/);
  const menu = documentFor(renderArtistActions(song(1, { artists: [{ id: '7', name: '<甲>' }, { id: '8', name: '乙' }] }), rules, escape));
  assert.equal(menu.querySelector('[data-action="unblock-artist"]').dataset.key, 'id:7');
  assert.equal(menu.querySelector('[data-action="block-artist"]').dataset.key, 'id:8');
  assert.equal(menu.querySelector('甲'), null);
  assert.match(documentFor(renderArtistBlacklist(state, escape)).body.textContent, /7|歌手 ID/);
});

class FakeAudio extends EventTarget {
  paused = true;
  volume = 1;
  currentTime = 0;
  duration = 100;
  src = '';
  load() {}
  removeAttribute() { this.src = ''; }
  getAttribute() { return this.src; }
  pause() { this.paused = true; }
  async play() { this.paused = false; }
}

test('web artist block prunes collaborators while keeping an allowed current track uninterrupted', async () => {
  const player = createQueuePlayer({ audio: new FakeAudio(), loadTrack: async () => ({ url: 'https://audio.example/test.mp3' }) });
  await player.start([song(1, { artists: [{ id: '8', name: '乙' }] }), song(2, { artists: [{ id: '7', name: '甲' }] })]);
  await player.syncArtistBlacklist(rules);
  assert.equal(player.snapshot().song.id, '1');
  assert.equal(player.snapshot().count, 1);
  assert.equal(player.snapshot().paused, false);
  assert.equal(await player.start([song(3, { artists: [{ id: '7', name: '甲' }] })]), false);
  await player.syncArtistBlacklist({});
  assert.equal(player.snapshot().count, 1);
});

test('native handoff preserves official artist IDs and synchronizes persistent artist rules', async () => {
  const calls = [];
  const player = createNativeQueuePlayer({ request: async (operation, arguments_) => { calls.push({ operation, arguments_ }); return {}; }, getBlockedArtists: () => rules });
  assert.equal(await player.start([song(1, { artists: [{ id: '7', name: '甲' }] })]), false);
  await player.start([song(2, { artists: [{ id: '8', name: '乙' }] })]);
  assert.equal(calls[0].arguments_.queue[0].artists[0].id, '8');
  await player.syncArtistBlacklist(rules);
  assert.equal(calls[1].operation, 'player_artist_blocklist');
  assert.equal(calls[1].arguments_.artists[0].id, '7');
});

test('notification lyric changes refresh the in-app switch even without any playback change', async () => {
  let enabled = false;
  const updates = [];
  const player = createNativeQueuePlayer({ request: async () => ({ song: song(1), count: 1, index: 0, paused: false, overlay: { enabled, permission: true } }), onChange: view => updates.push(view.overlay.enabled) });
  await player.refresh();
  enabled = true;
  await player.refresh();
  enabled = false;
  await player.refresh();
  assert.deepEqual(updates, [false, true, false]);
});
