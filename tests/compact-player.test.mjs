import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createListeningSession, normalizePlayingQueue } from '../src/listening-session.mjs';
import { renderMiniPlayer, renderPlayingQueue } from '../public/compact-player-view.mjs';
import { songIsBlocked } from '../src/library.mjs';
import { isExcludedByOptions } from '../src/shuffle.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const helpers = { escape, icon: name => `<svg data-icon="${name}"></svg>`, safeImage: () => '', blacklistButton: song => `<button data-action="block-song" data-id="${escape(song.id)}">拉黑</button>` };
const documentFor = html => new JSDOM(html).window.document;
const songs = [{ id: '1', title: '一', artist: '甲' }, { id: '2', title: '二', artist: '乙' }];

test('playing metadata normalizes persisted data and excludes demos, duplicates, blocked IDs and audio URLs', () => {
  assert.deepEqual(normalizePlayingQueue([null, {}, ...songs, { ...songs[0], url: 'secret' }, { id: '3', demo: true }], ['2']), [{ id: '1', title: '一', artist: '甲', cover: '' }]);
  assert.deepEqual(normalizePlayingQueue({ bad: true }), []);
});

function playerFixture() {
  let view = { count: 0, queueId: '', song: null };
  const accepted = [];
  const player = {
    snapshot: () => view,
    start: async (queue, index, options) => { view = { count: queue.length, queueId: options.queueId, song: queue[index], paused: !options.autoplay }; return true; },
    stop: async () => { view = { count: 0, queueId: '', song: null }; return true; },
  };
  return { player, accepted, session: createListeningSession({ player, newId: () => 'test', onQueue: queue => accepted.push(queue) }) };
}

test('explicit queue handoff freezes its metadata independently of later candidate edits', async () => {
  const fixture = playerFixture();
  const candidates = songs.map(song => ({ ...song }));
  assert.equal(await fixture.session.start(candidates, 1, { queueId: 'batch-a' }), true);
  candidates.splice(0, candidates.length, { id: '9', title: '新候选' });
  assert.equal(fixture.player.snapshot().song.id, '2');
  assert.deepEqual(fixture.accepted[0].songs.map(song => song.id), ['1', '2']);
  assert.equal(fixture.player.snapshot().queueId, 'batch-a');
});

test('stopping the player clears only its snapshot and does not mutate candidate data', async () => {
  const fixture = playerFixture();
  await fixture.session.start(songs);
  await fixture.session.stop();
  assert.deepEqual(fixture.accepted.at(-1), { id: '', songs: [] });
  assert.equal(songs.length, 2);
});

test('an obsolete queue acceptance cannot restore the ledger after a stop', async () => {
  let complete;
  const updates = [];
  const player = { snapshot: () => ({ queueId: 'old', count: 2 }), start: () => new Promise(resolve => { complete = resolve; }), stop: async () => true };
  const session = createListeningSession({ player, onQueue: queue => updates.push(queue) });
  const pending = session.start(songs, 0, { queueId: 'old' });
  await session.stop(); complete(true);
  assert.equal(await pending, false);
  assert.deepEqual(updates, [{ id: '', songs: [] }]);
});

test('the actual workbench generate function updates candidates without reading or replacing the current player', async () => {
  const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const generate = source.slice(source.indexOf('async function generate('), source.indexOf('function useDemo()'));
  const activeQueue = [{ id: '99', title: '仍在播放' }];
  const state = { options: { count: 2, countMode: 'preset' }, activeQueue, activeQueueId: 'listening-old', queue: [], history: [], enabledPlugins: [], blacklist: {} };
  const context = { state, queueGeneration: 0, document: { querySelector: () => null }, selectedSongs: () => songs, allSongs: () => songs, selectedReferenceSongs: () => [], queueSettingsSignature: () => 'rules', allPlugins: () => [], perform: async (label, action) => action(), computeQueue: async () => ({ queue: songs, warnings: [], eligibleCount: 2 }), applyQueuePlugins: queue => ({ queue, warnings: [] }), applyQueueProviders: async queue => ({ queue, warnings: [] }), persist: () => true, toast: () => {}, crypto: { randomUUID: () => 'candidate-new' }, player: new Proxy({}, { get: () => { throw new Error('Generation must not touch playback'); } }), replaceCurrentBatch: () => { throw new Error('Generation must not hand off playback'); } };
  context.queueProviders = [];
  context.isBlockedSong = song => songIsBlocked(song, state.blacklist);
  context.isExcludedByOptions = isExcludedByOptions;
  await runInNewContext(`(${generate})()`, context);
  assert.equal(state.activeQueue, activeQueue);
  assert.equal(state.activeQueueId, 'listening-old');
  assert.equal(state.queue.length, 2);
  assert.equal(state.queueBatchId, 'candidate-new');
});

test('mini player escapes inline metadata and keeps only the open, transport and playlist controls', () => {
  const view = { song: { id: '1', title: '<img src=x>', artist: '甲' }, paused: false, currentTime: 5, duration: 10 };
  const page = documentFor(renderMiniPlayer({ view, candidateCount: 2, native: true, overlay: { enabled: true }, helpers }));
  assert.equal(page.querySelectorAll('img').length, 0);
  assert.match(page.querySelector('[data-action="open-player"]').textContent, /<img src=x>/);
  assert.equal(page.querySelector('[data-action="player-toggle"]').getAttribute('aria-label'), '暂停');
  assert.equal(page.querySelectorAll('button').length, 3);
  assert.equal(page.querySelector('.mini-player').dataset.playing, 'true');
  assert.equal(page.querySelector('.mini-copy').textContent, '<img src=x> - 甲');
  assert.equal(page.querySelector('.mini-copy small'), null);
  assert.equal(page.querySelector('.mini-progress').style.getPropertyValue('--progress'), '50');
  assert.ok(page.querySelector('.mini-progress-value[pathLength="100"]'));
  assert.ok(page.querySelector('[data-action="open-playing-queue"]'));
  assert.equal(renderMiniPlayer({ view: {}, candidateCount: 0, helpers }), '');
});

test('mini player uses a circular album cover, keeps pause and loading states accessible, and bounds progress', () => {
  const view = { song: { id: '1', title: '很长的标题'.repeat(30), artist: '歌手' }, paused: true, currentTime: 120, duration: 100 };
  const page = documentFor(renderMiniPlayer({ view, candidateCount: 2, loading: true, helpers: { ...helpers, safeImage: () => '/icon.svg' } }));
  assert.equal(page.querySelector('.mini-cover img').getAttribute('src'), '/icon.svg');
  assert.equal(page.querySelector('.mini-player').dataset.playing, 'false');
  assert.match(page.querySelector('[data-action="open-player"]').getAttribute('aria-label'), /已暂停/);
  assert.equal(page.querySelector('[data-action="player-toggle"]').getAttribute('aria-label'), '播放');
  assert.equal(page.querySelector('[data-action="player-toggle"]').disabled, true);
  assert.equal(page.querySelector('.mini-progress').style.getPropertyValue('--progress'), '100');
  const waiting = documentFor(renderMiniPlayer({ view: { ...view, loading: true, currentTime: -1 }, helpers }));
  assert.match(waiting.querySelector('[data-action="open-player"]').getAttribute('aria-label'), /正在连接/);
  assert.equal(waiting.querySelector('.mini-progress').style.getPropertyValue('--progress'), '0');
  const failed = documentFor(renderMiniPlayer({ view: { ...view, error: 'offline', duration: 0 }, helpers }));
  assert.match(failed.querySelector('[data-action="open-player"]').getAttribute('aria-label'), /播放中断/);
  const candidates = documentFor(renderMiniPlayer({ view: {}, candidateCount: 12, helpers }));
  assert.equal(candidates.querySelector('.mini-copy').textContent, '12 首新歌已选好 - 点开试听');
  assert.equal(candidates.querySelector('.mini-progress').style.getPropertyValue('--progress'), '0');
});

test('mini player progress updates use the SVG path scale, and desktop lyrics remain in the expanded player', async () => {
  const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function updatePlayerProgress(');
  const update = source.slice(start, source.indexOf('\n}\n', start) + 3);
  const properties = new Map();
  const context = { document: { querySelector: selector => selector === '.mini-progress' ? { style: { setProperty: (name, value) => properties.set(name, value) } } : null }, updateLyricProgress: () => {} };
  for (const [view, expected] of [[{ currentTime: 25, duration: 100 }, '25'], [{ duration: 100 }, '0'], [{ currentTime: -5, duration: 100 }, '0'], [{ currentTime: 200, duration: 100 }, '100'], [{ currentTime: 10, duration: 0 }, '0']]) {
    runInNewContext(`(${update})(${JSON.stringify(view)})`, context);
    assert.equal(properties.get('--progress'), expected);
  }
  assert.match(source, /class="player-overlay-shortcuts"[\s\S]*?data-action="quick-overlay"/);
});

test('current playback list is distinct from candidates, paginated and still supports blacklisting', () => {
  const page = documentFor(renderPlayingQueue({ view: { song: songs[0], count: 2 }, songs, visibleCount: 1, helpers }));
  assert.equal(page.querySelectorAll('[data-action="play-active"]').length, 1);
  assert.equal(page.querySelectorAll('[data-action="block-song"]').length, 1);
  assert.ok(page.querySelector('[data-action="more-playing"]'));
  assert.ok(page.querySelector('[aria-current="true"]'));
  const unknown = documentFor(renderPlayingQueue({ view: { song: songs[0], count: 9 }, songs: [], visibleCount: 60, helpers }));
  assert.match(unknown.body.textContent, /完整列表暂不可用/);
});

test('first-run guide is persisted, manually reopenable, and overlays are separate from rerendered page content', async () => {
  const app = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const index = documentFor(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'));
  assert.equal(index.querySelectorAll('#guide-dialog, #player-dialog').length, 2);
  assert.equal(index.querySelector('#app').querySelectorAll('dialog').length, 0);
  assert.match(app, /guideOpen: saved\.guideSeen !== true/);
  assert.match(app, /state\.guideSeen = true; persist\(\)/);
  assert.match(app, /action === 'open-guide'/);
  assert.match(app, /if \(state\.playerExpanded\) \{ closePlayer\(\); return true; \}/);
  assert.match(app, /suiting\.public\.library\.v1/);
  assert.doesNotMatch(app.slice(app.indexOf('function workspace()'), app.indexOf('function trackRow(')), /renderListeningWelcome|playerPanel/);
});
