import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOverlaySettings } from '../public/overlay-view.mjs';

const escape = value => String(value).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const render = overlay => renderOverlaySettings({ open: true, native: true, overlay, device: { manufacturer: 'Xiaomi', model: 'Redmi K70', sdk: 36 } }, { escape });
const base = { permission: true, enabled: true, visible: false, fontSize: 22, opacity: 0.8, locked: false };

test('desktop lyric view never confuses web inline lyrics with an Android overlay', () => {
  assert.equal(renderOverlaySettings({ open: false }, { escape }), '');
  assert.match(renderOverlaySettings({ open: true, native: false }, { escape }), /不是桌面悬浮歌词/);
  assert.match(render(null), /检查权限与浮窗状态/);
  assert.doesNotMatch(render(null), /正在检查系统权限/);
});

test('permission refusal disables test and enable; returning users can explicitly refresh or open settings', () => {
  const html = render({ ...base, permission: false, enabled: false, state: 'permission' });
  assert.match(html, /前往系统授权/);
  assert.match(html, /data-action="overlay-test" disabled/);
  assert.match(html, /data-action="overlay-enable" disabled/);
  assert.match(html, /data-action="overlay-refresh"/);
  assert.match(html, /data-action="overlay-app-settings"/);
  assert.match(html, /Redmi K70.*API 36/);
});

test('enabled is not a claim of window visibility and rejection has a recovery action', () => {
  assert.match(render({ ...base, state: 'waiting' }), /等待歌曲开始播放/);
  assert.match(render({ ...base, state: 'pending' }), /尚未确认浮窗创建/);
  assert.match(render({ ...base, state: 'attached', visible: true }), /请切到手机桌面确认/);
  const rejected = render({ ...base, enabled: false, state: 'error', error: '系统拒绝 <window>' });
  assert.match(rejected, /重试开启桌面歌词/);
  assert.match(rejected, /系统拒绝 &lt;window&gt;/);
  assert.doesNotMatch(rejected, /系统拒绝 <window>/);
  assert.match(render({ ...base, state: 'testing', testing: true }), /10秒原生浮窗测试中/);
});

test('lyric alignment, original line count and translation reflect persisted native settings', () => {
  const defaults = render(base);
  assert.match(defaults, /字号 22 sp/);
  assert.match(defaults, /value="center" selected/);
  assert.match(defaults, /value="1" selected/);
  assert.match(defaults, /id="overlay-translation" type="checkbox" checked/);
  const customized = render({ ...base, alignment: 'right', lines: 1, showTranslation: false });
  assert.match(customized, /value="right" selected/);
  assert.match(customized, /value="1" selected/);
  assert.doesNotMatch(customized, /id="overlay-translation" type="checkbox" checked/);
  assert.match(customized, /翻译另占一行/);
});

test('touch-through is explicit, editing is bounded, and width and position are recoverable', () => {
  const safe = render({ ...base, locked: true });
  assert.match(safe, /锁定穿透：歌词不接收点击/);
  assert.match(safe, /调整位置（20秒）/);
  assert.match(safe, /data-action="overlay-reset"/);
  assert.match(safe, /id="overlay-width".*value="72"/);
  const editing = render({ ...base, locked: false, widthPercent: 40, lines: 2 });
  assert.match(editing, /20秒后自动恢复穿透/);
  assert.match(editing, /完成调整并穿透/);
  assert.match(editing, /窗口宽度 40%/);
  assert.match(editing, /value="2" selected/);
});
