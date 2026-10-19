import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { easterSearchTrigger, resolveEasterEgg, matchingEasterSong, easterFileAllowed } from '../src/easter.mjs';
import { createEasterEggs } from '../public/easter-eggs.mjs';
import { createEasterSound } from '../public/easter-sound.mjs';
import { readFile } from 'node:fs/promises';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const dom = new JSDOM('<button id="search">搜索</button>');
  const doc = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () {};
  dom.window.HTMLMediaElement.prototype.play = async function () {};
  let view = { song: { id: '123' }, queueId: 'original', paused: false, volume: 0.3 };
  const calls = { pause: 0, resume: 0, sound: 0, destroy: 0, search: 0, stream: 0 };
  const player = { snapshot: () => ({ ...view }), pause: async () => { calls.pause++; view.paused = true; return true; }, play: async () => { calls.resume++; view.paused = false; } };
  const eggs = createEasterEggs({ document: doc, player, escape: value => String(value).replaceAll('<', '&lt;'), songs: () => [], blocked: () => false, canPlay: () => true,
    search: async () => { calls.search++; return { songs: [] }; }, stream: async () => { calls.stream++; return { url: 'blob:fixture' }; }, onBlacklist: () => {},
    soundFactory: () => ({ paused: true, play: async () => { calls.sound++; }, pause() {}, destroy() { calls.destroy++; } }), ...options });
  return { dom, doc, calls, eggs, setView: next => { view = next; } };
}
test('easter triggers only confirmed library keywords, never IME composition or other fields', () => {
  for (const value of [' 欧耶！ ', 'Deep Seek', 'ＤＥＥＰＳＥＥＫ', '蓝色大肥鱼', '肥鱼']) assert.ok(easterSearchTrigger({ id: 'search', value, enabled: true }));
  for (const values of [{ id: 'profile-search', enabled: true }, { id: 'search', enabled: false }, { id: 'search', enabled: true, composing: true }]) assert.equal(easterSearchTrigger({ value: '欧耶', ...values }), null);
  assert.equal(resolveEasterEgg('一首大肥鱼的歌'), null);
  assert.equal(resolveEasterEgg(''), null);
});
test('requested song version and local-file constraints cannot be bypassed by loose names', () => {
  const egg = resolveEasterEgg('欧耶');
  assert.equal(matchingEasterSong(egg, [{ title: '邦友的酒 DJ', artist: 'others' }]), null);
  assert.equal(matchingEasterSong(egg, [{ id: '1', title: '邦友的酒(DJ版)', artist: '夢ノ結唱 HALO' }]).id, '1');
  assert.ok(easterFileAllowed({ size: 100, type: 'image/gif' }, 'image'));
  for (const file of [{ size: 0, type: 'image/gif' }, { size: 6 * 1024 * 1024, type: 'image/gif' }, { size: 100, type: 'image/svg+xml' }]) assert.equal(easterFileAllowed(file, 'image'), false);
  assert.equal(easterFileAllowed({ size: 41 * 1024 * 1024, type: 'audio/wav' }, 'audio'), false);
});
test('default easter is local and close restores only the unchanged original player and focus', async () => {
  const setup = fixture();
  try {
    const focus = setup.doc.querySelector('#search'); focus.focus();
    await setup.eggs.open(resolveEasterEgg('欧耶'));
    assert.equal(setup.calls.search, 0); assert.equal(setup.calls.stream, 0); assert.equal(setup.calls.sound, 1); assert.equal(setup.calls.pause, 1);
    assert.equal(setup.eggs.isOpen(), true);
    setup.doc.querySelector('[data-egg="close"]').click();
    await tick(); assert.equal(setup.calls.resume, 1); assert.equal(setup.calls.destroy, 1); assert.equal(setup.doc.activeElement, focus);
    await setup.eggs.open(resolveEasterEgg('大肥鱼'));
    setup.setView({ song: { id: '456' }, queueId: 'new', paused: true });
    setup.eggs.close(); await tick(); assert.equal(setup.calls.resume, 1);
  } finally { setup.eggs.close(); setup.dom.window.close(); }
});
test('blacklist and closed platform sources prevent streams, not just queue selection', async () => {
  for (const policy of [{ blocked: () => true }, { canPlay: () => false }]) {
    const setup = fixture({ songs: () => [{ id: '123', title: '邦友的酒 DJ', artist: 'HALO' }], ...policy });
    try { await setup.eggs.open(resolveEasterEgg('欧耶')); assert.equal(setup.calls.stream, 0); assert.equal(setup.calls.sound, 1); }
    finally { setup.eggs.close(); setup.dom.window.close(); }
  }
});
test('pending search cannot start audio after closing and cannot replace the queue', async () => {
  let resolveSearch;
  const setup = fixture({ search: () => new Promise(resolve => { resolveSearch = resolve; }) });
  try {
    await setup.eggs.open(resolveEasterEgg('欧耶'));
    setup.doc.querySelector('[data-egg="lookup"]').click();
    setup.eggs.close();
    resolveSearch({ songs: [{ id: '123', title: '邦友的酒 DJ', artist: 'HALO' }] });
    await tick(); assert.equal(setup.calls.stream, 0); assert.equal(setup.calls.resume, 1); assert.equal(setup.eggs.isOpen(), false);
  } finally { setup.eggs.close(); setup.dom.window.close(); }
});
test('late pause acknowledgement restores a closed easter instead of playing a stale sound', async () => {
  let finishPause, resumed = 0, paused = false;
  const player = { snapshot: () => ({ song: { id: '123' }, queueId: 'same', paused }), pause: () => new Promise(resolve => { finishPause = () => { paused = true; resolve(true); }; }), play: async () => { resumed++; paused = false; } };
  const setup = fixture({ player });
  try {
    const pending = setup.eggs.open(resolveEasterEgg('大肥鱼'));
    setup.eggs.close(); finishPause(); await pending; await tick();
    assert.equal(resumed, 1); assert.equal(setup.calls.sound, 0);
  } finally { setup.eggs.close(); setup.dom.window.close(); }
});
test('cancel, hidden document and disabled plugin have an exit without residual sound', async () => {
  const setup = fixture();
  try {
    await setup.eggs.open(resolveEasterEgg('欧耶'));
    setup.doc.querySelector('dialog').dispatchEvent(new setup.dom.window.Event('cancel', { cancelable: true }));
    assert.equal(setup.eggs.isOpen(), false);
    await setup.eggs.open(resolveEasterEgg('欧耶'));
    Object.defineProperty(setup.doc, 'hidden', { value: true });
    setup.doc.dispatchEvent(new setup.dom.window.Event('visibilitychange'));
    assert.equal(setup.eggs.isOpen(), false);
  } finally { setup.eggs.close(); setup.dom.window.close(); }
});
test('original sound fails recoverably without Web Audio and does not require any network', async () => {
  const sound = createEasterSound('ouye', 0);
  await assert.rejects(sound.play(), /本机音频/u); sound.destroy();
  const source = await readFile(new URL('../public/easter-sound.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|https?:|setStreamVolume|setMediaVolume/u);
});
