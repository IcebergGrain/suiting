import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { renderSyncPage } from '../public/sync-view.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const helpers = { isRemoteSource: source => !source.local && !source.demo && /^\d+$/.test(source.id), escape, icon: () => '<svg aria-hidden="true"></svg>', safeImage: () => '', remoteGroups: () => '<details class="remote-group"><summary>我创建的</summary><button data-action="sync-one" data-id="42">同步</button></details>', sourceRow: source => `<div class="source-row">${escape(source.name)}<button data-action="sync-one" data-id="${escape(source.id)}">更新</button></div>`, formatDate: () => '刚刚' };
const render = (overrides = {}, native = false) => new JSDOM(renderSyncPage({ state: { status: { loggedIn: false }, sources: [], remote: [], autoSync: true, ...overrides }, native, helpers })).window.document;

test('connection screen has one usable QR entry rather than a duplicate introduction CTA', () => {
  const page = render();
  assert.equal(page.querySelectorAll('[data-action="login"]').length, 1);
  assert.equal(page.querySelectorAll('.sync-intro, [data-action="start-account-login"]').length, 0);
  assert.ok(page.querySelector('.login-panel'));
  assert.equal(page.querySelector('[data-action="login"]').textContent, '生成登录二维码');
  assert.match(page.body.textContent, /私密歌单需登录本人账号/);
  assert.equal(page.querySelector('[data-action="login"]').disabled, false);
  assert.equal(render({ busy: true }).querySelector('[data-action="login"]').disabled, true);
});

test('native QR keeps the actual save and launch actions with visible same-phone instructions', () => {
  const page = render({ qr: { image: '/test-qr.png' }, qrMessage: '等待 <确认>' }, true);
  assert.ok(page.querySelector('[data-action="save-qr"]'));
  assert.ok(page.querySelector('[data-action="open-netease"]'));
  assert.equal(page.querySelector('.qr-image').getAttribute('src'), '/test-qr.png');
  assert.equal(page.querySelector('.login-pending').textContent, '等待 <确认>');
  assert.match(page.querySelector('.connection-note').textContent, /扫一扫 → 相册/);
  assert.equal(page.querySelectorAll('确认').length, 0);
  const web = render({ qr: { image: '/test-qr.png' } });
  assert.equal(web.querySelector('[data-action="open-netease"]'), null);
});

test('signed-in UI uses the real profile, remote groups, updates and manual next step without pretending to sync', () => {
  const page = render({ status: { loggedIn: true, profile: { nickname: '<测试>' } }, remote: [{ id: '42' }], sources: [{ id: '42', name: '收藏' }], lastSync: 123 });
  assert.equal(page.querySelector('.account-profile h3').textContent, '<测试>');
  assert.ok(page.querySelector('[data-action="load-playlists"]'));
  assert.ok(page.querySelector('[data-action="logout"]'));
  assert.ok(page.querySelector('.remote-group'));
  assert.equal(page.querySelectorAll('[data-action="sync-one"]').length, 2);
  assert.ok(page.querySelector('[data-action="sync-all"]'));
  assert.ok(page.querySelector('[data-tab="workspace"]'));
  assert.equal(page.querySelector('[data-action="login"]'), null);
  assert.equal(page.querySelector('#auto-sync').checked, true);
});

test('link import and JSON migration retain their IDs while destructive actions stay collapsed', () => {
  const page = render();
  assert.ok(page.querySelector('#import-form #playlist-input'));
  assert.equal(page.querySelector('#playlist-input').required, true);
  assert.ok(page.querySelector('[data-action="import-backup"]'));
  assert.equal(page.querySelector('#backup-file').accept, 'application/json,.json');
  assert.equal(page.querySelector('.sync-backup-tools').open, false);
  assert.equal(page.querySelector('.sync-danger-tools').open, false);
  assert.ok(page.querySelector('.sync-danger-tools [data-action="clear-data"]'));
  assert.equal(page.querySelectorAll('[data-action="local-import"], [accept*="audio"], iframe').length, 0);
});

test('native overlay no longer constructs a clickable action window, and notification likes use the service session', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const desktop = await read('android/app/src/main/java/io/suiting/music/DesktopLyrics.java');
  assert.doesNotMatch(desktop, /ImageButton|OverlayLikes|toggleHeart|syncActions|showActions/);
  assert.match(desktop, /FLAG_NOT_TOUCHABLE/);
  assert.match(desktop, /put\("controlsVisible", false\)/);
  const service = await read('android/app/src/main/java/io/suiting/music/PlaybackService.java');
  assert.match(service, /onCustomCommand/);
  assert.match(service, /setAvailableSessionCommands/);
  assert.match(service, /isMediaNotificationController\(controller\)/);
  assert.match(service, /notificationFavorites\.destroy\(\)/);
  const notifications = await read('android/app/src/main/java/io/suiting/music/NotificationFavorites.java');
  assert.match(notifications, /setMediaButtonPreferences/);
  assert.match(notifications, /likes\.set\(id, desired, epoch/);
  assert.match(notifications, /gate\.begin\(id, epoch, revision\)/);
});
