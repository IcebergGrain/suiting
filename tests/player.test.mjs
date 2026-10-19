import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueuePlayer, createNativeQueuePlayer } from '../public/queue-player.mjs';
import { formatTime, normalizePlaybackPreferences, qualityDescription } from '../src/playback.mjs';
import { loadGeneratedQueue } from '../src/queue-session.mjs';

class FakeAudio extends EventTarget {
  paused = true;
  seeking = false;
  currentTime = 0;
  duration = 120;
  src = '';
  volume = 1;
  load() {}
  removeAttribute() { this.src = ''; this.currentTime = 0; }
  getAttribute() { return this.src; }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  emit(name) { this.dispatchEvent(new Event(name)); }
}
const songs = [{ id: '1', title: '第一首' }, { id: '2', title: '第二首' }, { id: '3', title: '第三首' }];
const flush = () => new Promise(resolve => setImmediate(resolve));

test('generation replaces the loaded queue, resets its cursor and preserves pause intent', async () => {
  const { player, audio } = fixture();
  await player.start(songs, 2);
  await player.pause();
  assert.equal((await loadGeneratedQueue(player, [{ id: '9', title: '新批次' }], 'batch-two')).loaded, true);
  assert.equal(player.snapshot().song.id, '9');
  assert.equal(player.snapshot().index, 0);
  assert.equal(player.snapshot().count, 1);
  assert.equal(player.snapshot().queueId, 'batch-two');
  assert.equal(audio.paused, true);
  await player.next();
  assert.equal(player.snapshot().song.id, '9');
  assert.equal((await loadGeneratedQueue(player, songs, 'batch-three', true)).loaded, true);
  assert.equal(audio.paused, false);
  await player.stop();
  assert.equal(player.snapshot().count, 0);
  assert.equal(player.snapshot().queueId, '');
});

test('an obsolete native failure cannot overwrite a newer accepted queue', async () => {
  const pending = [];
  const player = createNativeQueuePlayer({ request: (operation, parameters) => new Promise((resolve, reject) => pending.push({ parameters, resolve, reject })) });
  const first = player.start(songs, 0, { queueId: 'old' });
  const second = player.start(songs.slice(1), 0, { queueId: 'new', autoplay: false });
  assert.equal(pending[1].parameters.autoplay, false);
  pending[1].resolve({ song: songs[1], queueId: 'new', index: 0, count: 2, paused: true });
  await second;
  pending[0].reject(new Error('过时请求失败'));
  assert.equal(await first, false);
  assert.equal(player.snapshot().queueId, 'new');
  assert.equal(player.snapshot().song.id, '2');
  assert.notEqual(player.snapshot().error, '过时请求失败');
});
function fixture(overrides = {}) {
  const audio = new FakeAudio();
  const calls = [];
  const heard = [];
  let clock = 0;
  const player = createQueuePlayer({ audio, loadTrack: async (id, quality) => { calls.push({ id, quality }); return { url: `https://test.invalid/${id}`, bitrate: 128000, actualLevel: 'standard', requestedQuality: quality }; }, onHeard: event => heard.push(event), now: () => clock, ...overrides });
  return { audio, player, calls, heard, advance: seconds => { clock += seconds * 1000; audio.currentTime += seconds; audio.emit('timeupdate'); } };
}

test('quality preferences and actual metadata do not promise requested quality', () => {
  assert.deepEqual(normalizePlaybackPreferences({ quality: 'unlock', volume: 4 }), { quality: 'exhigh', volume: 1, mode: 'order' });
  assert.equal(normalizePlaybackPreferences().volume, 0.7);
  assert.equal(formatTime(3601.3), '60:01');
  assert.match(qualityDescription({ requestedQuality: 'lossless', actualLevel: 'standard', format: 'mp3', bitrate: 128000 }), /MP3 · 128 kbps · 标准/);
});

test('player supports pause, resume, next, previous and bounded seek', async () => {
  const { player, audio } = fixture();
  await player.start(songs);
  assert.equal(player.snapshot().song.id, '1');
  await player.pause(); assert.equal(audio.paused, true);
  await player.play(); assert.equal(audio.paused, false);
  audio.emit('durationchange');
  await player.seek(200); assert.equal(audio.currentTime, 120);
  await player.seek(-20); assert.equal(audio.currentTime, 0);
  await player.next(); assert.equal(player.snapshot().song.id, '2');
  await player.previous(); assert.equal(player.snapshot().song.id, '1');
  await player.stop(); assert.equal(player.snapshot().song, null); assert.equal(audio.src, '');
});

test('natural end advances frozen queue and stops at last song', async () => {
  const { player, audio } = fixture();
  await player.start(songs);
  audio.emit('ended'); await flush(); assert.equal(player.snapshot().song.id, '2');
  await player.next(); audio.emit('ended'); await flush();
  assert.equal(player.snapshot().song.id, '3'); assert.equal(player.snapshot().ended, true);
});

test('actual listening counts, seeking and paused time do not', async () => {
  const { player, audio, heard, advance } = fixture();
  await player.start(songs);
  for (let count = 0; count < 5; count++) advance(1);
  await player.seek(100);
  assert.equal(heard.length, 0);
  await player.pause(); advance(30); assert.equal(heard.length, 0);
  await player.play();
  for (let count = 0; count < 10; count++) advance(1);
  assert.equal(heard.length, 1); assert.equal(heard[0].songId, '1');
  advance(1); assert.equal(heard.length, 1);
  assert.ok(audio.currentTime > 100);
});

test('quality changes preserve position and pause, without persisting audio URL in snapshot', async () => {
  const { player, audio, calls } = fixture();
  await player.start(songs); audio.currentTime = 27; audio.emit('timeupdate'); await player.pause();
  await player.setQuality('lossless'); audio.emit('loadedmetadata');
  assert.equal(calls.at(-1).quality, 'lossless'); assert.equal(audio.currentTime, 27); assert.equal(player.snapshot().paused, true);
  assert.equal(JSON.stringify(player.snapshot()).includes('https://test.invalid'), false);
});

test('late URL response cannot replace newer selection or restart a stopped queue', async () => {
  const resolvers = [];
  const { player, audio } = fixture({ loadTrack: id => new Promise(resolve => resolvers.push(() => resolve({ url: `https://test.invalid/${id}` }))) });
  const first = player.start(songs);
  const second = player.next();
  resolvers[1](); await second; resolvers[0](); await first;
  assert.equal(player.snapshot().song.id, '2'); assert.equal(audio.src, 'https://test.invalid/2');
  const third = player.next(); await player.stop(); resolvers[2](); await third;
  assert.equal(audio.src, ''); assert.equal(player.snapshot().song, null);
});

test('unavailable audio stops with error rather than skipping songs or using a replacement', async () => {
  const { player, calls } = fixture({ loadTrack: async () => { throw new Error('账号无权限'); } });
  await player.start(songs);
  assert.equal(player.snapshot().song.id, '1'); assert.equal(player.snapshot().paused, true); assert.match(player.snapshot().error, /无权限/); assert.equal(calls.length, 0);
});

test('synthetic and invalid songs cannot be submitted for playback', async () => {
  const { player } = fixture();
  await player.start([{ id: 'demo-1' }, { id: '2', demo: true }]); assert.equal(player.snapshot().song, null);
});

test('single mode repeats the current song and loop mode wraps the list', async () => {
  const { player, audio } = fixture();
  await player.start(songs, 1); await player.setMode('single');
  audio.emit('ended'); await flush(); assert.equal(player.snapshot().song.id, '2'); assert.equal(player.snapshot().ended, false);
  await player.next(); assert.equal(player.snapshot().song.id, '3');
  await player.setMode('loop'); audio.emit('ended'); await flush(); assert.equal(player.snapshot().song.id, '1');
  await player.previous(); assert.equal(player.snapshot().song.id, '3');
  await player.setMode('order'); audio.emit('ended'); await flush(); assert.equal(player.snapshot().ended, true);
});

test('blacklisting current and queued songs removes them immediately, preserving a paused state', async () => {
  const { player, audio } = fixture();
  await player.start(songs); await player.pause();
  await player.syncBlacklist(['1', '3']);
  assert.equal(player.snapshot().song.id, '2'); assert.equal(player.snapshot().count, 1); assert.equal(audio.paused, true);
  await player.syncBlacklist([]); assert.equal(player.snapshot().count, 1);
  await player.syncBlacklist(['2']); assert.equal(player.snapshot().song, null);
  await player.start(songs); assert.equal(player.snapshot().song.id, '1');
});

test('a late stream request cannot revive a newly blacklisted current song', async () => {
  const resolvers = [];
  const { player, audio } = fixture({ loadTrack: id => new Promise(resolve => resolvers.push(() => resolve({ url: `https://test.invalid/${id}` }))) });
  const loading = player.start(songs);
  const blocked = player.syncBlacklist(['1']);
  resolvers[1](); await blocked; resolvers[0](); await loading;
  assert.equal(player.snapshot().song.id, '2'); assert.equal(audio.src, 'https://test.invalid/2');
});

test('a mixed demo and real queue starts the first playable song rather than silently doing nothing', async () => {
  const { player } = fixture();
  const mixed = [{ id: 'demo-1', demo: true }, ...songs];
  await player.start(mixed);
  assert.equal(player.snapshot().song.id, '1');
  assert.equal(player.snapshot().count, 3);
  const calls = [];
  const native = createNativeQueuePlayer({ request: async (operation, parameters) => { calls.push({ operation, parameters }); return { song: songs[0], index: 0, count: 3, paused: false, quality: 'exhigh', volume: 0.7 }; } });
  await native.start(mixed);
  assert.equal(calls[0].parameters.index, 0);
  assert.equal(calls[0].parameters.queue.length, 3);
  assert.equal(calls[0].parameters.queue[0].id, '1');
});

test('native adapter restores background status and acknowledges history only after saving', async () => {
  const calls = [];
  const heard = [{ eventId: 'one', songId: '1', playedAt: 1 }];
  const status = { song: songs[1], index: 1, count: 3, paused: false, quality: 'lossless', volume: 0.5, heard };
  let saved = false;
  const player = createNativeQueuePlayer({ request: async (operation, parameters) => { calls.push({ operation, parameters }); return status; }, onHeard: async () => saved });
  await player.initialize(); await flush();
  assert.equal(player.snapshot().song.id, '2'); assert.equal(calls.some(call => call.operation === 'player_queue'), false);
  assert.equal(calls.some(call => call.operation === 'player_ack'), false);
  saved = true; await player.refresh(); await flush();
  assert.deepEqual(calls.find(call => call.operation === 'player_ack').parameters.ids, ['one']);
});

test('shuffle play walks a fixed shuffled cycle without repeats, supports previous and never changes source queue', async () => {
  const { player, audio } = fixture({ random: () => 0 });
  await player.start(songs);
  await player.setMode('shuffle');
  assert.equal(player.snapshot().song.id, '1');
  assert.equal(player.snapshot().mode, 'shuffle');
  const played = [player.snapshot().song.id];
  await player.next(); played.push(player.snapshot().song.id);
  audio.emit('ended'); await flush(); played.push(player.snapshot().song.id);
  assert.equal(new Set(played).size, 3);
  assert.deepEqual(new Set(played), new Set(songs.map(song => song.id)));
  await player.next(); assert.equal(player.snapshot().song.id, '1');
  await player.previous(); assert.equal(player.snapshot().song.id, played[2]);
  assert.equal(player.snapshot().canNext, true);
  const current = player.snapshot().song.id;
  await player.setMode('order'); assert.equal(player.snapshot().song.id, current);
  assert.deepEqual(songs.map(song => song.id), ['1', '2', '3']);
});

test('shuffle playback prunes blacklisted songs and one-song queues remain playable', async () => {
  const { player, audio } = fixture({ random: () => 0 });
  await player.start(songs);
  await player.setMode('shuffle');
  await player.syncBlacklist(['2', '3']);
  for (let count = 0; count < 4; count++) { audio.emit('ended'); await flush(); assert.equal(player.snapshot().song.id, '1'); }
  await player.syncBlacklist(['1', '2', '3']);
  assert.equal(player.snapshot().song, null);
  await player.next();
  assert.equal(player.snapshot().song, null);
});
