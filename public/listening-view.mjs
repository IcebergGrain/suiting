export function renderListeningFilters({ state, content, escape }) {
  const genres = state.options.genres?.length || 0;
  const languages = state.options.languages?.length || 0;
  const description = genres || languages ? `已选 ${genres} 种风格 · ${languages} 种语言` : '不限风格与语言 · 可展开多选';
  return `<details class="listening-filters" data-detail="filters" ${state.filtersOpen ? 'open' : ''}><summary>风格与语言<span>${escape(description)}</span></summary><div class="filter-body">${content}</div></details>`;
}

export function renderSyncIntro({ state }) {
  return `<section class="sync-intro" aria-label="连接步骤"><h2>${state.status.loggedIn ? '下一步：把歌单带进来' : '扫码连接，开始你的随听'}</h2><p>${state.status.loggedIn ? '在歌单旁点击「同步」，完成后回到随机工作台。这里只读取歌单信息，不下载音频。' : '点击「生成登录二维码」，再用网易云音乐 App 扫码确认。同一手机可保存二维码，再从扫一扫的相册识别。'}</p><div class="actions">${state.status.loggedIn ? '<button class="button primary" data-tab="workspace">去随机工作台</button>' : `<button class="button primary" data-action="start-account-login" ${state.busy ? 'disabled' : ''}>生成登录二维码</button>`}<button class="button" data-tab="library">查看我的曲库</button></div></section>`;
}

export function renderTrackExplanation(reason, escape) {
  return reason ? `<details class="track-explanation"><summary>为什么选这首</summary><p class="track-reason">${escape(reason)}</p></details>` : '';
}
