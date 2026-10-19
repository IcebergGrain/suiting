import { languageDefinitions, languageFilterDefinitions, languageCoverage, songLanguages } from '../src/languages.mjs';

export function renderLanguageControls({ state, songs, escape }) {
  const coverage = languageCoverage(songs);
  const selected = state.options.languages || [];
  const progress = state.languageProgress;
  return `<details class="genre-picker language-picker" data-detail="language-picker" ${state.languagePickerOpen ? 'open' : ''}><summary><strong>演唱语言</strong><span>${selected.length ? escape(selected.map(key => languageFilterDefinitions[key]).join(' / ')) : '不限语言 · 可多选'}</span></summary><div class="genre-chips" role="group" aria-label="演唱语言多选"><button class="chip ${!selected.length ? 'selected' : ''}" data-action="language" data-language="all" aria-pressed="${!selected.length}">不限语言</button>${Object.entries(languageFilterDefinitions).map(([key, label]) => `<button class="chip ${selected.includes(key) ? 'selected' : ''}" data-action="language" data-language="${key}" aria-pressed="${selected.includes(key)}">${label}<small> ${coverage.counts[key]}</small></button>`).join('')}</div><p class="language-note">已识别 ${coverage.known} / ${coverage.total} 首。按演唱语言，不按歌手国籍；英语包含美英等。选择语言后只取已匹配歌曲，不用“待识别”偷偷补位；“其他”仅指已知的其他语言。</p>${progress ? `<p class="language-note" role="status">正在补齐语种 ${progress.done} / ${progress.total}</p><button class="button" data-action="pause-language">处理完当前批后暂停</button>` : `<button class="button" data-action="auto-language" ${state.busy || state.classifyProgress || !coverage.counts.unknown ? 'disabled' : ''}>补齐待识别语种</button>`}<p class="language-note">优先读取平台歌曲资料／网易云百科；无数据保留未知。曲库的“编辑分类”也能手工多选语种。</p></details>`;
}

export function renderLanguageEditor(song, escape) {
  const selected = songLanguages(song);
  return `<fieldset class="language-editor"><legend>演唱语言（可多选）</legend><div class="genre-chips">${Object.entries(languageDefinitions).map(([key, label]) => `<label class="compact-check"><input type="checkbox" data-edit-language value="${key}" ${selected.includes(key) ? 'checked' : ''}>${escape(label)}</label>`).join('')}</div><p class="caption">未勾选表示手工标为待识别；手工值优先，不会被同步覆盖。</p><button type="button" class="text-button" data-action="auto-language-value" data-id="${escape(song.id)}">恢复平台自动语种</button></fieldset>`;
}
