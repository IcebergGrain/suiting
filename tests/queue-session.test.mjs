import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGeneratedQueue } from '../src/queue-session.mjs';
import { lyricFollowPresentation, renderLyricsPanel } from '../public/lyrics-view.mjs';

test('generated batches require player confirmation and default to paused', async () => {
  let view = {};
  const player = { snapshot: () => view, start: async (songs, index, options) => { assert.equal(options.autoplay, false); view = { queueId: options.queueId, count: songs.length }; return true; } };
  assert.deepEqual(await loadGeneratedQueue(player, [{ id: '1' }, { id: 'demo', demo: true }], 'new-batch'), { loaded: true, count: 1 });
  assert.equal((await loadGeneratedQueue(player, [], 'empty')).loaded, false);
  player.start = async () => false;
  assert.equal((await loadGeneratedQueue(player, [{ id: '2' }], 'newer-batch')).loaded, false);
  player.start = async () => true;
  assert.equal((await loadGeneratedQueue(player, [{ id: '2' }], 'newer-batch')).loaded, false);
});

test('follow is a persistent visibly pressed toggle, not an invisible timeout', () => {
  const input = { lyrics: { lines: [{ time: 0, text: '原文', translation: '译文' }], status: 'timed' }, view: { currentTime: 0 } };
  const helpers = { escape: String, icon: name => `<svg data-icon="${name}"></svg>` };
  const active = renderLyricsPanel({ ...input, follow: true }, helpers);
  assert.match(active, /lyric-follow is-active/);
  assert.match(active, /aria-pressed="true"/);
  assert.match(active, /自动跟随：开/);
  const inactive = renderLyricsPanel({ ...input, follow: false }, helpers);
  assert.match(inactive, /aria-pressed="false"/);
  assert.match(inactive, /自动跟随：关/);
  assert.match(inactive, /保留你浏览的位置/);
  assert.match(inactive, /原文<small>译文/);
  assert.equal(lyricFollowPresentation(true, false).active, false);
});
