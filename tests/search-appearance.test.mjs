import test from 'node:test';
import assert from 'node:assert/strict';
import { searchText, matchesSearch, createSearchInput } from '../src/search.mjs';
import { normalizeAppearance, resolvedAppearance } from '../src/appearance.mjs';

test('library search handles Chinese, full width input, case, whitespace and multiple terms', () => {
  assert.equal(searchText('  ＨＡＬＯ　 梦的结  '), 'halo 梦的结');
  assert.equal(matchesSearch(['HALO', '梦的结', '夜里'], 'ｈａｌｏ 梦的结'), true);
  assert.equal(matchesSearch(['日落', '温柔'], '日落 治愈'), false);
  assert.equal(matchesSearch(['ヘヴン', 'tayori'], ''), true);
});

test('composition updates state without rendering away the active IME', () => {
  const values = [];
  let renders = 0;
  const tasks = new Set();
  const controller = createSearchInput({
    update: value => values.push(value), render: () => renders++,
    schedule: callback => { tasks.add(callback); return callback; },
    cancel: callback => tasks.delete(callback),
  });
  controller.start();
  controller.input('ou', true);
  controller.input('欧', true);
  controller.flush();
  assert.equal(renders, 0);
  assert.equal(tasks.size, 0);
  controller.end('欧耶');
  assert.equal(renders, 1);
  assert.equal(values.at(-1), '欧耶');
  assert.equal(controller.composing, false);
});

test('rapid search, enter and clearing cancel pending callbacks rather than keeping stale results', () => {
  let value;
  const rendered = [];
  const tasks = new Set();
  const controller = createSearchInput({ update: next => { value = next; }, render: () => rendered.push(value), schedule: callback => { tasks.add(callback); return callback; }, cancel: callback => tasks.delete(callback) });
  controller.input('歌');
  controller.input('歌手');
  assert.equal(tasks.size, 1);
  assert.equal(controller.pending, true);
  controller.flush();
  assert.equal(controller.pending, false);
  assert.deepEqual(rendered, ['歌手']);
  assert.equal(tasks.size, 0);
  controller.input('');
  controller.flush();
  assert.deepEqual(rendered, ['歌手', '']);
  controller.input('pending');
  controller.start();
  assert.equal(tasks.size, 0);
  controller.end('已确认');
  assert.equal(rendered.at(-1), '已确认');
});

test('appearance resolves native or web system preference and manual choices independently', () => {
  assert.equal(normalizeAppearance('invert'), 'system');
  assert.equal(resolvedAppearance('system', 'dark'), 'dark');
  assert.equal(resolvedAppearance('light', 'dark'), 'light');
  assert.equal(resolvedAppearance('dark', 'light'), 'dark');
  assert.equal(resolvedAppearance(null, 'unknown'), 'light');
});
