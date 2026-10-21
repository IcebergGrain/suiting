export function renderMiniPlayer({ view, candidateCount, loading, helpers: { escape, icon, safeImage } }) {
  if (!view.song && !candidateCount) return '';
  const cover = safeImage(view.song?.cover);
  const playing = view.song && !view.paused && !view.ended;
  const title = view.song?.title || `${candidateCount} 首新歌已选好`;
  const artist = view.song ? view.artist || view.song.artist || '未知歌手' : '点开试听';
  const status = view.song ? view.loading ? '正在连接' : view.error ? '播放中断，点开播放器重试' : playing ? '正在播放' : '已暂停' : '尚未开始播放';
  const progress = view.duration > 0 ? Math.max(0, Math.min(100, (view.currentTime || 0) / view.duration * 100)) : 0;
  return `<section class="mini-player" aria-label="底部播放器" data-playing="${Boolean(playing)}"><button class="mini-open" data-action="open-player" aria-label="打开播放器：${escape(title)}，${escape(artist)}，${escape(status)}"><span class="mini-cover" aria-hidden="true">${cover ? `<img src="${escape(cover)}" alt="" referrerpolicy="no-referrer">` : icon('music')}</span><span class="mini-copy"><strong>${escape(title)}</strong><span class="mini-artist"> - ${escape(artist)}</span></span></button><button class="icon-button mini-toggle" data-action="player-toggle" aria-label="${playing ? '暂停' : '播放'}" ${loading ? 'disabled' : ''}><svg class="mini-progress" viewBox="0 0 32 32" aria-hidden="true" style="--progress:${progress}"><circle class="mini-progress-track" cx="16" cy="16" r="13.5"/><circle class="mini-progress-value" cx="16" cy="16" r="13.5" pathLength="100"/></svg>${icon(playing ? 'pause' : 'play')}</button><button class="icon-button mini-queue" data-action="open-playing-queue" aria-label="当前播放列表"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M4 11h16M4 17h9m4-2 4 3-4 3z"/></svg></button></section>`;
}

export function renderPlayingQueue({ view, songs, visibleCount, helpers: { escape, icon, blacklistButton } }) {
  const known = songs.length === view.count && songs.some(song => song.id === view.song?.id);
  return `<section class="playing-list" aria-label="当前播放列表"><div class="playing-list-heading"><h2>当前播放列表 <small>${view.count || 0} 首</small></h2><button class="button quiet small" data-action="clear-queue" ${!view.song ? 'disabled' : ''}>停止并清空</button></div><p class="tiny-note">这是播放器正在用的列表；工作台生成的新候选不会替换它。</p>${!view.song ? '<div class="empty-state"><h3>还没有开始播放</h3><p>回到工作台，先生成一批，再点「播放这批」。</p></div>' : !known ? '<p class="notice">播放器仍在继续；当前完整列表暂不可用，载入下一批后可查看。</p>' : `<ol class="playing-tracks">${songs.slice(0, visibleCount).map((song, index) => `<li ${view.song?.id === song.id ? 'aria-current="true"' : ''}><button class="playing-track" data-action="play-active" data-id="${escape(song.id)}"><span>${view.song?.id === song.id ? icon('music') : index + 1}</span><span><strong>${escape(song.title)}</strong><small>${escape(song.artist)}</small></span></button>${blacklistButton(song)}</li>`).join('')}</ol>${songs.length > visibleCount ? `<button class="button" data-action="more-playing">显示更多（${visibleCount} / ${songs.length}）</button>` : ''}`}</section>`;
}

export function renderCompactEmpty() {
  return '<section class="compact-empty" aria-label="连接曲库"><h2>先把喜欢的歌带过来</h2><p>导入本地音乐，选好规则，再生成这一刻想听的歌。网易云连接可以按需开启。</p><div class="actions"><button class="button primary" data-action="local-import">导入本地音乐</button><button class="button" data-action="connect-netease">连接网易云</button><button class="button" data-action="demo">体验示例</button></div><small>示例只演示选歌规则，没有实际音频。</small></section>';
}
