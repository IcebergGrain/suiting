import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { applyBlacklist, normalizeArtistBlacklist, playableSongs } from '../src/library.mjs';
import { normalizePlayingQueue } from '../src/listening-session.mjs';
import { createNativeQueuePlayer } from '../public/queue-player.mjs';
import { generateQueue } from '../src/shuffle.mjs';
import { normalizePlugin } from '../src/plugins.mjs';

const localId = 'local-' + 'a'.repeat(64);
const otherId = 'local-' + 'b'.repeat(64);

test('every browser entry import is served without platform authorization or missing-module boot failures', async context => {
  const calls = [];
  const server = createApp({ upstream: new Proxy({}, { get: (target, operation) => async () => { calls.push(operation); throw new Error('No platform access expected'); } }), port: 0 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pending = ['/app.mjs', '/shuffle-worker.mjs'];
  const visited = new Set();
  while (pending.length) {
    const pathname = pending.shift();
    if (visited.has(pathname)) continue;
    visited.add(pathname);
    const response = await fetch(base + pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type'), /javascript/);
    const source = await response.text();
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.') || match[1].startsWith('/')) pending.push(new URL(match[1], base + pathname).pathname);
    }
  }
  assert.ok(visited.has('/src/listening-session.mjs'));
  assert.ok(visited.has('/exclusions-view.mjs'));
  assert.deepEqual(calls, []);
});

test('artist blocks apply across offline local files, platform tracks and collaboration credits', () => {
  const rules = normalizeArtistBlacklist([{ id: '7', name: '测试歌手' }]);
  const songs = [{ id: localId, title: '本地', artist: '测试歌手', genre: 'hiphop' }, { id: otherId, title: '其他', artist: '其他歌手', genre: 'pop' }, { id: '123', title: '合作', artists: [{ id: '8', name: '其他歌手' }, { id: '7', name: '测试歌手' }] }];
  const marked = applyBlacklist(songs, {}, rules);
  assert.deepEqual(playableSongs(marked).map(song => song.id), [otherId]);
  assert.deepEqual(normalizePlayingQueue(songs, [], rules).map(song => song.id), [otherId]);
  const selected = generateQueue({ songs: songs.slice(0, 2), options: { excludeGenres: ['hiphop'], cooldownDays: 0, count: 2 } });
  assert.deepEqual(selected.queue.map(song => song.id), [otherId]);
});

test('native explicit-song blacklist retains local IDs and does not erase local protections', async () => {
  const calls = [];
  const player = createNativeQueuePlayer({ request: async (operation, parameters) => { calls.push({ operation, parameters }); return {}; } });
  await player.syncBlacklist([localId, '123', 'bad']);
  assert.deepEqual(calls[0].parameters.ids, [localId, '123']);
});

test('DIY presets preserve negative categories together with languages and unknown handling', () => {
  const plugin = normalizePlugin({ apiVersion: 1, id: 'my.no-rap', name: '不听说唱', version: '1.0.0', kind: 'preset', preset: { languages: ['zh'], excludeGenres: ['hiphop'], excludeUnclassified: true } });
  const result = plugin.preset;
  assert.deepEqual(result.languages, ['zh']);
  assert.deepEqual(result.excludeGenres, ['hiphop']);
  assert.equal(result.excludeUnclassified, true);
});

test('public package keeps independent identity and ships no private experiment media or settings', async () => {
  const app = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const manifest = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(app, /suiting\.public\.library\.v1/);
  assert.doesNotMatch(app, /suiting\.ui-experiment|随听·界面实验/);
  assert.match(manifest, /io\.suiting\.music\.publicapp/);
  assert.match(html, /id="experience"/);
  assert.match(html, /id="player-dialog"/);
  assert.match(html, /id="guide-dialog"/);
  assert.doesNotMatch(html, /ouye-kasumi|deepseek-big-small/);
});
