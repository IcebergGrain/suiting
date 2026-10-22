import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { emptyLikes, effectiveLike, stageLike, observeLikes, likesReport, createLikeStore, createLikesController } from '../src/likes-journal.mjs';
import { renderLikesSync } from '../public/likes-view.mjs';

const song = { id: '1', title: '合成歌曲', artist: '合成歌手' };
const timestamp = new Date(2026, 9, 22, 12).getTime();
function fixture() {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  return { storage, store: createLikeStore({ storage }) };
}

test('offline likes persist per account, cancel locally and never require the remote API', async () => {
  const { storage, store } = fixture();
  await store.stage('42', song, true);
  assert.equal(effectiveLike(await createLikeStore({ storage }).get('42'), '1'), true);
  assert.equal(effectiveLike(await store.get('43'), '1'), false);
  const canceled = await store.stage('42', song, false);
  assert.equal(canceled.records[0].pending, false);
  assert.equal(effectiveLike(canceled, '1'), false);
});

test('a failed durable save never pretends a local favorite succeeded', async () => {
  const store = createLikeStore({ storage: { getItem: () => '{}', setItem: () => { throw new Error('disk full'); } } });
  await assert.rejects(store.stage('42', song, true), /disk full/);
  assert.equal((await store.get('42')).records.length, 0);
});

test('first check establishes a baseline, later checks report additions without inventing their dates', () => {
  const first = observeLikes(emptyLikes('42'), ['2', '3'], timestamp);
  assert.deepEqual(first.addedIds, []);
  const later = observeLikes(first, ['2', '3', '4'], timestamp + 1000);
  assert.deepEqual(later.addedIds, ['4']);
  assert.equal(later.comparisonFrom, timestamp);
  assert.throws(() => observeLikes(later, ['bad']), /不完整/);
});

test('read-only reconciliation preserves unsynced intent and never re-enqueues old confirmed actions', () => {
  const baseline = observeLikes(emptyLikes('42'), ['2'], timestamp);
  const staged = stageLike(baseline, song, true, timestamp);
  assert.equal(effectiveLike(observeLikes(staged, ['2'], timestamp), '1'), true);
  const matched = observeLikes(staged, ['1', '2'], timestamp);
  assert.equal(matched.records[0].pending, false);
  const externallyChanged = observeLikes(matched, ['2'], timestamp);
  assert.equal(externallyChanged.records[0].pending, false);
  assert.equal(effectiveLike(externallyChanged, '1'), false);
  assert.equal(likesReport(externallyChanged, timestamp).mismatches.length, 1);
});

test('manual sync sends only staged targets and preserves unrelated NetEase favorites', async () => {
  const { store } = fixture();
  let remote = ['9'];
  const writes = [];
  await store.stage('42', song, true);
  const controller = createLikesController({ store, account: () => '42', api: async (path, options) => {
    if (path === '/api/likes') return { accountId: '42', ids: remote };
    const body = JSON.parse(options.body); writes.push(body); remote.push(body.id);
    return { ...body, verified: true };
  } });
  const result = await controller.sync();
  assert.deepEqual(writes, [{ accountId: '42', id: '1', liked: true }]);
  assert.deepEqual(new Set(result.journal.remoteIds), new Set(['9', '1']));
  assert.equal(result.journal.records[0].pending, false);
  assert.equal((await controller.sync()).failures.length, 0);
  assert.equal(writes.length, 1);
});

test('explicit cancellation syncs false rather than toggling a stale remote value', async () => {
  const { store } = fixture();
  await store.observe('42', ['1', '9']); await store.stage('42', song, false);
  let remote = ['1', '9'];
  const controller = createLikesController({ store, account: () => '42', api: async (path, options) => {
    if (path === '/api/likes') return { accountId: '42', ids: remote };
    const body = JSON.parse(options.body); assert.equal(body.liked, false); remote = ['9'];
    return { ...body, verified: true };
  } });
  assert.deepEqual((await controller.sync()).journal.remoteIds, ['9']);
});

test('a newer tap while a remote write is in flight is preserved for the next explicit sync', async () => {
  const { store } = fixture();
  await store.observe('42', []); await store.stage('42', song, true);
  let remote = [];
  const controller = createLikesController({ store, account: () => '42', api: async (path, options) => {
    if (path === '/api/likes') return { accountId: '42', ids: remote };
    const body = JSON.parse(options.body);
    await store.stage('42', song, false); remote = ['1'];
    return { ...body, verified: true };
  } });
  const result = await controller.sync();
  assert.equal(result.journal.records[0].liked, false);
  assert.equal(result.journal.records[0].pending, true);
});

test('uncertain writes stop the batch, preserve pending work and are checked rather than retried automatically', async () => {
  const { store } = fixture();
  await store.stage('42', song, true); await store.stage('42', { ...song, id: '2' }, true);
  let writes = 0;
  const controller = createLikesController({ store, account: () => '42', api: async path => {
    if (path === '/api/likes') return { accountId: '42', ids: [] };
    writes++; throw new Error('timeout');
  } });
  const result = await controller.sync();
  assert.equal(writes, 1); assert.equal(result.failures.length, 1);
  assert.equal(result.journal.records.filter(record => record.pending).length, 2);
});

test('account switches and foreign readbacks cannot issue likes or expose another journal', async () => {
  const { store } = fixture();
  await store.stage('42', song, true);
  let account = '42'; let writes = 0;
  const controller = createLikesController({ store, account: () => account, api: async path => {
    if (path === '/api/likes') { account = '43'; return { accountId: '42', ids: [] }; }
    writes++;
  } });
  await assert.rejects(controller.sync(), /账号已变化/);
  assert.equal(writes, 0);
  assert.equal((await store.get('42')).records[0].pending, true);
});

test('likes screen has separate read-only and write controls, honest baseline text and escaped song names', () => {
  const journal = stageLike(emptyLikes('42'), { ...song, title: '<img src=x onerror=alert(1)>' }, true, timestamp);
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const html = renderLikesSync({ state: { status: { loggedIn: true }, features: { netease: true }, likeJournal: journal, likePending: {} }, escape, icon: () => '' });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll('img').length, 0);
  assert.equal(document.querySelector('[data-action="sync-likes"]').disabled, false);
  assert.ok(document.querySelector('[data-action="load-likes"]'));
  assert.match(document.body.textContent, /不能判断是否一致/);
});

test('disabled public plugin cannot check or submit, and local audio cannot enter the remote journal', async () => {
  const { store } = fixture();
  const journal = stageLike(emptyLikes('42'), song, true, timestamp);
  const document = new JSDOM(renderLikesSync({ state: { status: { loggedIn: true }, features: { netease: false }, likeJournal: journal, likePending: {} }, escape: String, icon: () => '' })).window.document;
  assert.equal(document.querySelector('[data-action="sync-likes"]').disabled, true);
  assert.equal(document.querySelector('[data-action="load-likes"]').disabled, true);
  assert.match(document.body.textContent, /网易云连接插件已关闭/);
  let calls = 0;
  const controller = createLikesController({ store, account: () => '', api: async () => { calls++; } });
  await assert.rejects(controller.sync(), /账号已变化/);
  await assert.rejects(controller.check(), /账号已变化/);
  assert.equal(calls, 0);
  await assert.rejects(store.stage('42', { ...song, id: 'local-' + 'a'.repeat(64) }, true), /无效/);
});
