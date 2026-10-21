import { songArtists, normalizeArtistBlacklist, artistBlacklistMatcher } from '../src/library.mjs';

export function renderExclusions({ state, moodNames, genreDefinitions, languageDefinitions, escape }) {
  const groups = [['excludeGenres', '音乐风格', genreDefinitions], ['excludeMoods', '氛围', Object.fromEntries(Object.entries(moodNames).filter(([key]) => key !== 'all'))], ['excludeLanguages', '演唱语言', languageDefinitions]];
  const selected = groups.flatMap(([field, , definitions]) => (state.options[field] || []).map(key => definitions[key]).filter(Boolean));
  const summary = selected.length ? `${selected.slice(0, 2).join('、')}${selected.length > 2 ? `等 ${selected.length} 类` : ''}` : '不想听什么，就在这里排除';
  return `<details class="exclusion-picker" data-detail="exclusions" ${state.exclusionsOpen ? 'open' : ''}><summary><strong>本次不听</strong><span>${escape(summary)}</span></summary><div class="exclusion-body">${groups.map(([field, label, definitions]) => `<fieldset><legend>${label}</legend><div class="exclusion-chips" role="group" aria-label="不听的${label}">${Object.entries(definitions).map(([key, name]) => `<button class="chip exclusion-chip" data-action="exclude-option" data-field="${field}" data-value="${escape(key)}" aria-pressed="${(state.options[field] || []).includes(key)}">${escape(name)}</button>`).join('')}</div></fieldset>`).join('')}<label class="exclusion-unknown"><input id="exclude-unclassified" type="checkbox" ${state.options.excludeUnclassified ? 'checked' : ''} ${!selected.length ? 'disabled' : ''}>同时排除所选维度中未分类的歌</label><p class="exclusion-note">排除优先，不被近期比例或参考权重覆盖。未勾选上面的开关时，未分类歌曲仍可能出现，无法保证它们不含所选风格。生成／换一批时生效，不打断当前播放。</p><button class="button quiet" data-action="clear-exclusions" ${!selected.length && !state.options.excludeUnclassified ? 'disabled' : ''}>清空本次排除</button></div></details>`;
}

export function renderArtistActions(song, blacklist, escape) {
  const artists = songArtists(song);
  if (!artists.length) return '';
  const match = artistBlacklistMatcher(blacklist);
  return `<details class="artist-block-menu"><summary>歌手屏蔽</summary><div class="artist-block-options">${artists.map(artist => {
    const blocked = match({ artists: [artist] });
    return `<button class="button quiet small" data-action="${blocked ? 'unblock-artist' : 'block-artist'}" data-id="${escape(song.id)}" data-key="${escape(blocked?.key || artist.key)}">${blocked ? '恢复' : '不听'} ${escape(artist.name)}</button>`;
  }).join('')}<small>长期生效，包含合唱和以后同步的署名歌曲；只在随听排除。</small></div></details>`;
}

export function renderArtistBlacklist(state, escape) {
  const entries = Object.values(normalizeArtistBlacklist(state.artistBlacklist)).sort((left, right) => right.blockedAt - left.blockedAt);
  const keyword = String(state.profileSearch || '').normalize('NFKC').trim().toLowerCase();
  const shown = entries.filter(artist => artist.name.normalize('NFKC').toLowerCase().includes(keyword));
  const count = state.profileVisible || 60;
  return `<section class="blocked-artists" aria-label="歌手黑名单"><h3>歌手黑名单 <span>${entries.length} 位</span></h3><p>署名独唱、合唱及以后同步的新歌都会排除。解除歌手屏蔽不会解除单独拉黑的歌曲。</p>${shown.length ? `<ul>${shown.slice(0, count).map(artist => `<li><div><strong>${escape(artist.name)}</strong><small>${artist.id ? '按网易云歌手 ID 屏蔽' : '按完整署名屏蔽'}</small></div><button class="button quiet" data-action="unblock-artist" data-key="${escape(artist.key)}">解除屏蔽</button></li>`).join('')}</ul>${shown.length > count ? '<button class="button" data-action="show-more-profile">显示更多歌手</button>' : ''}` : `<p class="artist-empty">${entries.length ? '没有匹配的歌手。' : '在歌曲的「歌手屏蔽」中选择不想听的人。'}</p>`}<p class="artist-identity-note">优先使用歌手 ID；旧资料缺少 ID 时按完整署名匹配，不做名字包含匹配。</p></section>`;
}
