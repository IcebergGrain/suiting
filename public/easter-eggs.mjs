import { matchingEasterSong, easterFileAllowed } from '../src/easter.mjs';
import { createEasterSound } from './easter-sound.mjs';

export function createEasterEggs({ player, songs, stream, search, blocked, canPlay, escape, onBlacklist, document: doc = globalThis.document, soundFactory = createEasterSound }) {
  let active = null;
  const sameQueue = previous => {
    const current = player.snapshot();
    return current.paused && current.song?.id === previous.songId && current.queueId === previous.queueId;
  };
  const restore = previous => {
    if (!previous || !sameQueue(previous)) return;
    if (active) active.resume = previous;
    else void Promise.resolve(player.play()).catch(() => {});
  };
  function close({ resume = true } = {}) {
    const session = active;
    if (!session) return;
    active = null;
    session.cancelled = true;
    session.sound.destroy();
    session.audio.pause(); session.audio.removeAttribute('src'); session.audio.load();
    for (const url of session.urls) URL.revokeObjectURL(url);
    session.dialog.remove();
    if (resume) restore(session.resume);
    if (session.focus?.isConnected) session.focus.focus();
  }
  async function open(egg) {
    const inherited = active?.resume;
    close({ resume: false });
    const previous = player.snapshot();
    const dialog = doc.createElement('dialog');
    dialog.className = 'easter-dialog';
    dialog.setAttribute('aria-label', egg.title);
    dialog.innerHTML = `<header><h2>${escape(egg.title)}</h2><button class="button" data-egg="close">退出彩蛋</button></header><div class="easter-art ${egg.id}" aria-label="原创动态唱片表情"><img class="easter-record" src="/icon.svg" alt=""><strong>${egg.id === 'ouye' ? '欧耶' : '大肥鱼'}</strong><span>${egg.id === 'ouye' ? '随机生活，偶尔跳一下。' : '摸鱼，也要有节奏。'}</span></div><img class="easter-custom-image" hidden alt="本机选择的彩蛋动图"><p class="easter-status" role="status">准备原创小调…</p><div class="easter-actions"><button class="button primary" data-egg="play">播放小调</button><button class="button" data-egg="image-select">换本机 GIF</button><button class="button" data-egg="audio-select">换本机音频</button><button class="button" data-egg="lookup">查找网易云对应版本</button><button class="button danger" data-egg="block" hidden>拉黑这首歌</button></div><input type="file" accept="image/gif,image/png,image/jpeg,image/webp" data-egg="image" hidden><input type="file" accept="audio/*" data-egg="audio" hidden><p class="easter-caption">默认是随听原创动态表情与小调，不附带商业歌曲。换入素材仅本次有效、不上传；请自行确认使用权限。媒体音量不变，退出即停止并恢复未变更的原队列。</p><p class="easter-caption">对应歌曲：${escape(egg.song)}。只有主动点击查找，才通过已开启的网易云插件查询；不绕过版权和账号权限。</p>`;
    const session = { dialog, audio: doc.createElement('audio'), sound: soundFactory(egg.id, previous.volume ?? 0.6, () => {
      if (active !== session || session.custom) return;
      dialog.classList.add('is-paused');
      dialog.querySelector('[data-egg="play"]').textContent = '重播原创小调';
      dialog.querySelector('.easter-status').textContent = '原创小调已播完，可以重播或退出。';
    }), focus: doc.activeElement, urls: new Set(), resume: inherited, cancelled: false, lookup: 0, custom: false, currentSong: null, ready: false };
    active = session;
    session.audio.preload = 'none'; session.audio.volume = previous.volume ?? 0.6;
    const status = dialog.querySelector('.easter-status');
    const play = dialog.querySelector('[data-egg="play"]');
    const block = dialog.querySelector('[data-egg="block"]');
    const current = () => active === session && !session.cancelled;
    const pause = () => { session.sound.pause(); session.audio.pause(); dialog.classList.add('is-paused'); play.textContent = '继续彩蛋'; };
    const start = async () => {
      if (!current() || !session.ready) return;
      try {
        if (session.custom) await session.audio.play(); else await session.sound.play();
        if (!current()) { session.audio.pause(); session.sound.destroy(); return; }
        dialog.classList.remove('is-paused'); play.textContent = '暂停彩蛋';
        status.textContent = session.custom ? '彩蛋音乐播放中；退出即停止。' : '原创小调播放中；没有连接音乐平台。';
      } catch (error) { if (current()) { pause(); status.textContent = error.message || '请点击播放，或选择本机音频。'; } }
    };
    const useSong = async (song, revision = ++session.lookup) => {
      if (blocked(song.id)) throw new Error('对应歌曲已在黑名单中，不会播放。');
      if (!canPlay(song)) throw new Error('这首歌的音乐来源尚未开启。');
      const info = await stream(song.id);
      if (!current() || revision !== session.lookup) return;
      if (blocked(song.id) || !canPlay(song)) throw new Error('来源已关闭或歌曲已被拉黑，请重新选择。');
      pause(); session.audio.src = info.url; session.custom = true; session.currentSong = song; block.hidden = false;
      await start();
    };
    doc.body.append(dialog); dialog.showModal();
    dialog.querySelector('[data-egg="close"]').focus();
    dialog.querySelector('[data-egg="close"]').addEventListener('click', () => close());
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    play.addEventListener('click', () => { if (session.custom ? session.audio.paused : session.sound.paused) void start(); else { pause(); status.textContent = '彩蛋已暂停。'; } });
    block.addEventListener('click', () => {
      if (!session.currentSong) return;
      pause(); onBlacklist(session.currentSong); session.audio.removeAttribute('src'); session.audio.load();
      session.custom = false; session.currentSong = null; block.hidden = true;
      status.textContent = '已拉黑这首歌；可以播放原创小调或退出。';
    });
    for (const type of ['image', 'audio']) {
      const input = dialog.querySelector(`[data-egg="${type}"]`);
      dialog.querySelector(`[data-egg="${type}-select"]`).addEventListener('click', () => { session.choosing = true; input.click(); });
      input.addEventListener('cancel', () => { session.choosing = false; });
    }
    dialog.addEventListener('change', event => {
      const type = event.target.dataset.egg, file = event.target.files?.[0];
      session.choosing = false;
      if (!['image', 'audio'].includes(type) || !file || !current()) return;
      if (!easterFileAllowed(file, type)) { status.textContent = type === 'image' ? '请选择 5 MB 以内的 GIF／PNG／JPEG／WebP。' : '请选择 40 MB 以内的普通音频。'; return; }
      const url = URL.createObjectURL(file); session.urls.add(url);
      if (type === 'image') {
        const image = dialog.querySelector('.easter-custom-image'); image.src = url; image.hidden = false; dialog.querySelector('.easter-art').hidden = true;
      } else {
        ++session.lookup; pause(); session.audio.src = url; session.custom = true; session.currentSong = null; block.hidden = true; void start();
      }
    });
    dialog.querySelector('[data-egg="lookup"]').addEventListener('click', async event => {
      if (!session.ready) return;
      const revision = ++session.lookup;
      const button = event.currentTarget; button.disabled = true;
      try {
        const result = await search(egg.query);
        if (!current() || revision !== session.lookup) return;
        const song = matchingEasterSong(egg, result.songs);
        if (!song) throw new Error('没有确认到对应版本，请选择本机音频。');
        await useSong(song, revision);
      } catch (error) { if (current() && revision === session.lookup) status.textContent = error.message || '查找失败，请选择本机音频。'; }
      finally { if (current()) button.disabled = false; }
    });
    session.audio.addEventListener('ended', () => { if (current()) { pause(); status.textContent = '播放结束，可以重播或退出。'; } });
    session.audio.addEventListener('error', () => { if (current()) { pause(); status.textContent = '音频无法播放，请换普通音频或退出；未尝试解密。'; } });
    try {
      if (previous.song && !previous.paused) {
        const confirmed = await player.pause();
        if (confirmed === false) throw new Error('主播放器未确认暂停，请先暂停后再试。');
        const original = { songId: previous.song.id, queueId: previous.queueId };
        if (!current()) { restore(original); return; }
        session.resume = original;
      }
      if (!current()) return;
      session.ready = true;
      const existing = matchingEasterSong(egg, songs());
      if (existing && !blocked(existing.id) && canPlay(existing)) await useSong(existing);
      else await start();
    } catch (error) {
      if (current()) {
        if (session.ready) { await start(); status.textContent = '对应歌曲暂不可用，已使用原创小调；也可换本机音频。'; }
        else { play.disabled = true; status.textContent = error.message || '请先暂停主播放器，再重新触发彩蛋。'; }
      }
    }
  }
  doc.addEventListener('visibilitychange', () => {
    if (!doc.hidden || !active) return;
    if (active.choosing) { active.sound.pause(); active.audio.pause(); }
    else close({ resume: false });
  });
  return { open, close, isOpen: () => Boolean(active) };
}
