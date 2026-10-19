import { activeLyricIndex } from '../src/lyrics.mjs';

export function lyricFollowPresentation(enabled, timed = true) {
  if (!timed) return { active: false, label: '自动跟随：不可用', description: '没有时间轴，当前歌词不能自动跟随。' };
  return enabled ? { active: true, label: '自动跟随：开', description: '已开启，当前歌词随播放居中；手动浏览会关闭跟随。' } : { active: false, label: '自动跟随：关', description: '已关闭，保留你浏览的位置；点击开启可回到当前句。' };
}

export function renderLyricsPanel({ lyrics, view, follow }, { escape, icon }) {
  const active = activeLyricIndex(lyrics.lines, view.currentTime);
  const timed = lyrics.lines.length > 0;
  const control = lyricFollowPresentation(follow, timed);
  const messages = { loading: '正在读取歌词…', instrumental: '纯音乐，请欣赏。', unavailable: '这首歌暂无可用歌词。', error: '歌词暂时无法加载，不影响播放。' };
  return `<section class="lyrics-panel" aria-label="滚动歌词"><div class="lyrics-toolbar"><strong>歌词</strong><button class="button small lyric-follow ${control.active ? 'is-active' : ''}" data-action="lyric-follow" aria-pressed="${control.active}" ${!timed ? 'disabled' : ''}>${icon(control.active ? 'check' : 'pause')}<span>${control.label}</span></button>${lyrics.status === 'error' ? '<button class="text-button" data-action="lyric-retry">重试</button>' : ''}</div><p class="lyric-follow-status" role="status">${control.description}</p><div class="lyrics-lines" tabindex="0" aria-label="歌词，点按某行跳转播放">${timed ? lyrics.lines.map((line, index) => `<button class="lyric-line ${index === active ? 'active' : ''}" data-action="lyric-seek" data-time="${line.time}" data-line="${index}" ${index === active ? 'aria-current="true"' : ''}>${escape(line.text)}${line.translation ? `<small>${escape(line.translation)}</small>` : ''}</button>`).join('') : lyrics.status === 'plain' ? `<p class="lyric-note">暂无时间轴，以下为静态歌词。</p>${lyrics.plain.map(line => `<p class="lyric-static">${escape(line)}</p>`).join('')}` : `<p class="lyric-note">${messages[lyrics.status] || messages.unavailable}</p>`}</div></section>`;
}
