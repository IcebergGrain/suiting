import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtinPlugins, normalizePlugin, restorePlugins, validateQueueOrder, applyQueuePlugins, applyQueueProviders } from '../src/plugins.mjs';

const songs = [{ id: '1', title: 'one', artist: 'same', blocked: false }, { id: '2', title: 'two', artist: 'same' }, { id: '3', title: 'three', artist: 'other' }];
const manifest = { apiVersion: 1, id: 'community.reverse', name: 'Reverse', version: '1', kind: 'queue-order', rule: 'reverse' };

test('JSON extension is versioned declarative data, never arbitrary code or network', () => {
  assert.equal(normalizePlugin(manifest).rule, 'reverse');
  for (const extra of [{ script: 'fetch(cookie)' }, { url: 'https://outside.invalid' }, { permissions: ['account.write'] }]) assert.throws(() => normalizePlugin({ ...manifest, ...extra }), /不支持/);
  assert.throws(() => normalizePlugin({ ...manifest, apiVersion: 2 }), /apiVersion/);
  assert.throws(() => normalizePlugin({ ...manifest, id: '__proto__' }), /ID/);
  assert.throws(() => normalizePlugin({ ...manifest, rule: 'eval' }), /规则/);
});

test('presets cannot modify source scope, login or enable arbitrary extensions', () => {
  const preset = { ...manifest, kind: 'preset', rule: undefined, preset: { count: 30, moods: ['gentle'] } };
  assert.deepEqual(normalizePlugin(preset).preset.moods, ['gentle']);
  for (const forbidden of ['playlistIds', 'cookie', 'accountId', 'enabledPlugins']) assert.throws(() => normalizePlugin({ ...preset, preset: { [forbidden]: [] } }), /不能修改/);
});

test('restoration rejects corrupt extensions, duplicates and reserved builtins', () => {
  assert.equal(restorePlugins([manifest, manifest, { ...manifest, id: 'suiting.override' }, null]).length, 1);
  assert.equal(restorePlugins('code').length, 0);
});

test('disabled extensions have no effect; enabled extensions only reorder the selected set', () => {
  assert.deepEqual(applyQueuePlugins(songs, [manifest], []).queue, songs);
  assert.deepEqual(applyQueuePlugins(songs, [manifest], [manifest.id]).queue.map(song => song.id), ['3', '2', '1']);
  const spread = applyQueuePlugins(songs, builtinPlugins, [builtinPlugins[0].id]);
  assert.deepEqual(spread.queue.map(song => song.id), ['1', '3', '2']);
  assert.deepEqual(songs.map(song => song.id), ['1', '2', '3']);
});

test('queue validation rejects additions, dropped songs, duplicates and metadata replacement', () => {
  assert.throws(() => validateQueueOrder(songs, ['1', '2']), /全部/);
  assert.throws(() => validateQueueOrder(songs, ['1', '1', '3']), /重复/);
  assert.throws(() => validateQueueOrder(songs, ['1', '2', '99']), /外部/);
  const result = validateQueueOrder(songs, [{ id: '1', title: 'injected', url: 'outside' }, '2', '3']);
  assert.equal(result[0], songs[0]);
  assert.equal(result[0].title, 'one');
  assert.equal(result[0].url, undefined);
});

test('future source providers require explicit enabling and receive only frozen selected song metadata', async () => {
  let calls = 0;
  const provider = { id: 'trusted.example', name: 'Example', transformQueue: async context => {
    calls++;
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.songs[0]), true);
    assert.deepEqual(Object.keys(context.songs[0]), ['id', 'title', 'artist']);
    return context.songs.map(song => song.id).reverse();
  } };
  assert.deepEqual((await applyQueueProviders(songs, [provider], [])).queue, songs);
  assert.equal(calls, 0);
  assert.deepEqual((await applyQueueProviders(songs, [provider], [provider.id])).queue.map(song => song.id), ['3', '2', '1']);
  assert.equal(calls, 1);
});

test('broken, malicious or timed-out source providers keep the original queue and do not hang', async () => {
  const bad = { id: 'bad', name: 'Bad', transformQueue: () => ['99'] };
  const result = await applyQueueProviders(songs, [bad], ['bad']);
  assert.deepEqual(result.queue, songs);
  assert.equal(result.warnings.length, 1);
  let signal;
  const slow = { id: 'slow', name: 'Slow', transformQueue: context => { signal = context.signal; return new Promise(() => {}); } };
  const timed = await applyQueueProviders(songs, [slow], ['slow'], 8);
  assert.deepEqual(timed.queue, songs);
  assert.equal(signal.aborted, true);
  assert.match(timed.warnings[0], /超时/);
});

test('shipped DIY examples conform to v1 and preserve their declared settings', async () => {
  for (const name of ['artist-spacing.plugin.json', 'evening.plugin.json']) {
    const value = JSON.parse(await readFile(new URL('../examples/' + name, import.meta.url)));
    const normalized = normalizePlugin(value);
    if (normalized.kind === 'preset') assert.deepEqual(normalized.preset.moods, ['gentle', 'calm']);
  }
});
