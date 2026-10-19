import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiBody, classificationFromWiki, applyAutoClassification, clearAutoClassification, genreFromStyles, moodsFromTags, classificationNeedsUpdate, AUTO_SOURCE, AUTO_VERSION } from '../src/classify.mjs';
import { createNetEaseService, AppError } from '../src/netease-core.mjs';
import { generateQueue } from '../src/shuffle.mjs';

function wikiBody(styles = [], tags = [], bpm = 0) {
  const subs = [];
  if (styles.length) subs.push({ title: '曲风', wikiSubMetaVos: styles.map(text => ({ text })) });
  if (tags.length) subs.push({ title: '推荐标签', wikiSubMetaVos: tags.map(text => ({ text })) });
  if (bpm) subs.push({ title: 'BPM', wikiSubMetaVos: [{ text: String(bpm) }] });
  return { code: 200, data: { blocks: [{ rnData: { blocks: [{ blockInfo: { wikiSubElementVos: subs } }] } }] } };
}

test('wiki parsing reads style, recommended tags, scenes and BPM', () => {
  const parsed = parseWikiBody(wikiBody(['嘻哈说唱-旋律说唱'], ['孤独', '悲伤', '治愈', '酒吧'], 96));
  assert.deepEqual(parsed.styles, ['嘻哈说唱-旋律说唱']);
  assert.deepEqual(parsed.tags, ['孤独', '悲伤', '治愈', '酒吧']);
  assert.equal(parsed.bpm, 96);
  assert.ok(parsed.scenes.includes('酒吧'));
});

test('wiki parsing tolerates missing blocks and the children 分类 field', () => {
  assert.deepEqual(parseWikiBody({}).styles, []);
  assert.equal(classificationFromWiki({}), null);
  const child = { data: { blocks: [{ rnData: { blocks: [{ blockInfo: { wikiSubElementVos: [{ title: '分类', wikiSubMetaVos: [{ text: '儿童' }] }] } }] } }] } };
  assert.deepEqual(parseWikiBody(child).styles, ['儿童']);
});

test('genre mapping prefers the specific style over a generic pop word', () => {
  assert.equal(genreFromStyles(['流行-流行说唱']), 'hiphop');
  assert.equal(genreFromStyles(['电子-浩室舞曲']), 'electronic');
  assert.equal(genreFromStyles(['R&B-当代R&B']), 'rnb');
  assert.equal(genreFromStyles(['国风-国风流行']), 'traditional');
  assert.equal(genreFromStyles(['二次元-动漫主题曲']), 'acg');
  assert.equal(genreFromStyles(['原声带-电视剧原声']), 'other');
  assert.equal(genreFromStyles(['原声带', '二次元-动漫主题曲']), 'acg');
  assert.equal(genreFromStyles(['原声带-游戏原声']), 'acg');
  assert.equal(genreFromStyles(['摇滚-硬摇滚']), 'rock');
  assert.equal(genreFromStyles(['民谣-华语民谣']), 'folk');
  assert.equal(genreFromStyles(['慢摇DJ']), 'electronic');
  assert.equal(genreFromStyles(['未知风格']), null);
});

test('tag mapping never invents a mood it has no evidence for', () => {
  assert.deepEqual(moodsFromTags(['抑郁', '苦情']), ['sad']);
  assert.deepEqual(moodsFromTags(['治愈', '悲伤']), ['healing', 'sad']);
  assert.deepEqual(moodsFromTags(['KTV', '婚礼']), []);
  assert.deepEqual(moodsFromTags([]), []);
});

test('classification marks confidence by evidence, and auto values never overwrite manual ones', () => {
  const style = classificationFromWiki(wikiBody(['民谣-华语民谣'], ['思念'], 76));
  assert.equal(style.source, AUTO_SOURCE);
  assert.equal(style.genre, 'folk');
  assert.equal(style.mood, 'romantic');
  assert.equal(style.confidence, 'style');
  const tagOnly = classificationFromWiki(wikiBody([], ['放松'], 0));
  assert.equal(tagOnly.confidence, 'tag');
  assert.equal(tagOnly.genre, null);

  const song = applyAutoClassification({ id: '1', localMood: 'sad', localGenre: 'rock', localTags: ['夜跑'] }, style);
  assert.equal(song.localMood, 'sad');
  assert.equal(song.localGenre, 'rock');
  assert.deepEqual(song.localTags, ['夜跑']);
  assert.equal(song.autoMood, 'romantic');
  assert.equal(song.autoGenre, 'folk');
  const cleared = clearAutoClassification(song);
  assert.equal(cleared.autoMood, undefined);
  assert.equal(cleared.localMood, 'sad');
});

test('automatic classification only fills gaps in the shuffle engine and manual values win', () => {
  const base = { id: '11', title: 'A', artist: 'X', addedAt: 1 };
  const run = (song, options) => generateQueue({ songs: [song], options: { count: 1, cooldownDays: 0, ...options } });
  const autoOnly = run({ ...base, autoMood: 'healing', autoGenre: 'folk' }, { moods: ['healing'], genres: ['folk'] });
  assert.equal(autoOnly.queue.length, 1);
  assert.equal(autoOnly.queue[0].id, '11');
  const manualWins = run({ ...base, localMood: 'sad', localGenre: 'rock', autoMood: 'healing', autoGenre: 'folk' }, { moods: ['healing'], genres: ['folk'], classificationMode: 'strict' });
  assert.equal(manualWins.queue.length, 0);
  const excluded = run({ ...base, autoMood: 'sad' }, { moods: ['healing'], genres: [], includeUnknown: false });
  assert.equal(excluded.queue.length, 0);
  const noAuto = run({ ...base }, { moods: ['healing'], genres: [], includeUnknown: false });
  assert.equal(noAuto.queue.length, 0);
});

test('classifySongs counts results, isolates failures, and never writes to the account', async () => {
  const calls = [];
  const upstream = {
    song_wiki_info: async ({ id }) => {
      calls.push(id);
      if (id === '3') throw new Error('boom');
      if (id === '2') return { body: { code: 200, data: { blocks: [] } } };
      return { body: wikiBody(['流行-华语流行'], ['治愈', '悲伤'], 88) };
    },
  };
  const service = createNetEaseService({ upstream, qrImage: async () => 'data:,', fetchImpl: async () => ({ status: 200, headers: { get: () => null } }) });
  const session = { cookie: {} };
  const result = await service.classifySongs(session, { ids: ['1', '2', '3'], delayMs: 0 });
  assert.equal(result.total, 3);
  assert.equal(result.classified, 1);
  assert.equal(result.empty, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(calls.sort(), ['1', '2', '3']);
  const first = result.items.find(item => item.id === '1');
  assert.equal(first.genre, 'pop');
  assert.equal(first.mood, 'healing');
  assert.equal(first.source, AUTO_SOURCE);
  const content = JSON.stringify(result);
  assert.ok(!/https?:/.test(content), '分类结果里不应出现任何 URL');
});

test('classifySongs enforces the batch limit and rejects invalid ids', async () => {
  const service = createNetEaseService({ upstream: { song_wiki_info: async () => ({ body: wikiBody(['流行'], []) }) }, qrImage: async () => 'data:', fetchImpl: async () => ({ status: 200, headers: { get: () => null } }) });
  const session = { cookie: {} };
  await assert.rejects(() => service.classifySongs(session, { ids: ['1', '2', '3'], limit: 2 }), error => error.code === 'CLASSIFY_LIMIT');
  await assert.rejects(() => service.classifySongs(session, { ids: ['abc'] }), error => error.code === 'INVALID_ID');
  await assert.rejects(() => service.classifySongs(session, { ids: [] }), error => error.code === 'INVALID_IDS');
});

test('a dead session stops the batch instead of hammering the upstream', async () => {
  let calls = 0;
  const upstream = { song_wiki_info: async () => { calls += 1; const error = new Error('auth'); error.body = { code: 301 }; throw error; } };
  const service = createNetEaseService({ upstream, qrImage: async () => 'data:', fetchImpl: async () => ({ status: 200, headers: { get: () => null } }) });
  await assert.rejects(() => service.classifySongs({ cookie: {} }, { ids: ['1', '2', '3', '4'], delayMs: 0 }), error => error instanceof AppError && error.code === 'AUTH_REQUIRED');
  assert.equal(calls, 1);
});

test('actual wiki scalar content is read and every automatic mood can match', () => {
  const body = wikiBody(['原声带', '二次元-动漫主题曲', '流行-华语流行'], ['浪漫', '治愈']);
  body.data.blocks[0].rnData.blocks[0].blockInfo.wikiSubElementVos.push({ title: 'BPM', content: '89' }, { title: '语种', content: '日语' });
  const classification = classificationFromWiki(body);
  assert.equal(classification.bpm, 89);
  assert.equal(parseWikiBody(body).language, '日语');
  assert.deepEqual(classification.genreKeys, ['acg', 'pop']);
  const song = applyAutoClassification({ id: '1', title: 'A' }, classification);
  assert.equal(generateQueue({ songs: [song], options: { count: 1, cooldownDays: 0, moods: ['healing'], genres: ['pop'], classificationMode: 'strict' } }).queue.length, 1);
  assert.equal(generateQueue({ songs: [{ ...song, localMood: null }], options: { count: 1, cooldownDays: 0, moods: ['healing'], classificationMode: 'strict' } }).queue.length, 0);
  assert.equal(song.energy, undefined);
});

test('classification cache reuses metadata and empty results, but explicit refresh bypasses it', async () => {
  let calls = 0;
  const service = createNetEaseService({ upstream: { song_wiki_info: async ({ id }) => { calls++; return { body: id === '1' ? wikiBody(['流行'], ['治愈']) : { code: 200, data: { blocks: [] } } }; } } });
  const session = { cookie: {} };
  await service.classifySongs(session, { ids: ['1', '2'], delayMs: 0 });
  await service.classifySongs(session, { ids: ['1', '2'], delayMs: 0 }); assert.equal(calls, 2);
  await service.classifySongs(session, { ids: ['1', '2'], delayMs: 0, refresh: true }); assert.equal(calls, 4);
});

test('classification resume skips recent empty results, retries failures later and excludes blocked songs', () => {
  const now = Date.now();
  assert.equal(classificationNeedsUpdate({ id: '1', autoSource: AUTO_SOURCE, autoVersion: AUTO_VERSION }, now), false);
  assert.equal(classificationNeedsUpdate({ id: '1', autoSource: AUTO_SOURCE }, now), true);
  assert.equal(classificationNeedsUpdate({ id: '1', autoVersion: AUTO_VERSION, autoStatus: 'empty', autoAttemptAt: now }, now), false);
  assert.equal(classificationNeedsUpdate({ id: '1', autoStatus: 'failed', autoAttemptAt: now }, now + 11 * 60000), true);
  assert.equal(classificationNeedsUpdate({ id: '1', blocked: true }, now, true), false);
});
