import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderListeningWelcome } from '../public/public-view.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
function welcome({ connected = false, enabled = connected, songCount = 0, busy = false, nickname = '音乐爱好者', queue = [] } = {}) {
  return new JSDOM(renderListeningWelcome({
    state: { features: { netease: enabled }, status: { loggedIn: connected, profile: { nickname } }, busy, queue },
    songCount, escape,
  })).window.document;
}

test('first visit exposes both music sources and a clear ordered next step without enabling the platform', () => {
  const page = welcome();
  assert.equal(page.querySelector('[data-action="connect-netease"]').textContent.trim(), '连接网易云音乐 ↗');
  assert.ok(page.querySelector('[data-action="local-import"]'));
  assert.equal(page.querySelectorAll('.listening-steps li').length, 3);
  assert.match(page.querySelector('.listening-steps .current').textContent, /带上你的歌/);
  assert.equal(page.querySelectorAll('img, iframe, script').length, 0);
});

test('authorized empty library tells the listener to sync a playlist rather than log in again', () => {
  const page = welcome({ connected: true });
  assert.match(page.querySelector('.welcome-copy p').textContent, /选一个歌单同步/);
  assert.match(page.querySelector('[data-action="connect-netease"]').textContent, /管理网易云歌单/);
});

test('existing local library advances to selection even with the platform disabled; generated queue advances to playback', () => {
  const local = welcome({ songCount: 42 });
  assert.ok(local.querySelector('.has-library'));
  assert.match(local.querySelector('.listening-steps .current').textContent, /选一种听法/);
  const generated = welcome({ songCount: 42, queue: [{ id: '1' }] });
  assert.match(generated.querySelector('.listening-steps .current').textContent, /开始听/);
});

test('the three-step guide keeps one accessible current step before login, after sync and after generation', () => {
  for (const [options, number] of [
    [{}, '01'],
    [{ connected: true }, '01'],
    [{ connected: true, songCount: 30 }, '02'],
    [{ connected: true, songCount: 30, queue: [{ id: '1' }] }, '03'],
  ]) {
    const page = welcome(options);
    assert.equal(page.querySelectorAll('.listening-steps li').length, 3);
    assert.equal(page.querySelectorAll('[aria-current="step"]').length, 1);
    assert.equal(page.querySelector('[aria-current="step"] > span').textContent, number);
    assert.equal(page.querySelectorAll('.listening-steps .complete').length, Number(number) - 1);
  }
});

test('busy connection cannot be resubmitted and account names cannot inject markup', () => {
  const page = welcome({ connected: true, busy: true, nickname: '<img src=x onerror=alert(1)>' });
  assert.ok(page.querySelector('[data-action="connect-netease"]').disabled);
  assert.ok(page.querySelector('[data-action="local-import"]').disabled);
  assert.equal(page.querySelectorAll('img').length, 0);
  assert.match(page.querySelector('.welcome-note').textContent, /<img src=x/);
});
