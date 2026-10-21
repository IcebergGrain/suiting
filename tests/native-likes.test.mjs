import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function fixture() {
  const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  const requests = [];
  const state = { status: { loggedIn: true, profile: { userId: '42' } }, likes: { loaded: true, ids: [] }, likePending: {}, likesLoading: false };
  const context = { state, likesRevision: 0, nativeLikesDirty: false, accountEpoch: 1, render: () => {}, toast: () => {}, api: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) };
  const functions = ['async function loadLikes()', 'function onNativeLikesChanged()', 'function refreshNativeLikes()'].map(name => { const start = source.indexOf(name); assert.ok(start > 0); return source.slice(start, source.indexOf('\n}\n', start) + 3); });
  runInNewContext(functions.join('\n'), context);
  return { state, requests, context };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('a notification favorite invalidates an in-flight stale read and coalesces one fresh read', async () => {
  const { state, requests, context } = await fixture();
  const old = context.loadLikes();
  context.onNativeLikesChanged(); context.onNativeLikesChanged();
  assert.equal(requests.length, 1);
  requests[0].resolve({ accountId: '42', ids: ['1'] });
  await old; await flush();
  assert.equal(requests.length, 2);
  assert.equal(state.likes.loaded, false);
  requests[1].resolve({ accountId: '42', ids: ['2'] });
  await flush();
  assert.equal(state.likes.loaded, true);
  assert.deepEqual(Array.from(state.likes.ids), ['2']);
});

test('notification refresh waits for an app-side write and does nothing when signed out', async () => {
  const { state, requests, context } = await fixture();
  state.likePending['1'] = true;
  context.onNativeLikesChanged();
  assert.equal(requests.length, 0);
  delete state.likePending['1']; context.refreshNativeLikes();
  assert.equal(requests.length, 1);
  requests[0].resolve({ accountId: '42', ids: ['1'] }); await flush();
  state.status.loggedIn = false;
  context.onNativeLikesChanged();
  assert.equal(requests.length, 1);
});
