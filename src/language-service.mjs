import { AppError } from './netease-core.mjs';
import { normalizeLanguages } from './languages.mjs';

export async function lookupLanguages(input = {}, { netease, qq } = {}) {
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 5 || input.ids.some(id => !/^(?:[1-9]\d{0,17}|qq-[A-Za-z0-9]{5,40})$/u.test(String(id)))) throw new AppError('每批只能识别 1–5 首有明确平台 ID 的歌曲。', 'INVALID_LANGUAGE_BATCH', 400);
  const ids = [...new Set(input.ids.map(String))];
  const items = [];
  const neteaseIds = ids.filter(id => !id.startsWith('qq-'));
  if (neteaseIds.length) {
    try {
      const result = await netease(neteaseIds);
      for (const id of neteaseIds) {
        const entry = result.items?.find(item => String(item.id) === id);
        items.push({ id, languages: normalizeLanguages(entry?.languageKeys ?? entry?.language), source: 'netease-wiki', failed: !entry || entry.reason === 'request-failed' });
      }
    } catch { items.push(...neteaseIds.map(id => ({ id, languages: [], source: 'netease-wiki', failed: true }))); }
  }
  for (const id of ids.filter(value => value.startsWith('qq-'))) {
    try {
      if (!qq) throw new Error('QQ unavailable');
      if (items.length) await new Promise(resolve => setTimeout(resolve, 200));
      const result = await qq(id);
      items.push({ id, languages: normalizeLanguages(result.labels), source: 'qqmusic-detail', failed: false });
    } catch { items.push({ id, languages: [], source: 'qqmusic-detail', failed: true }); }
  }
  return { items, failed: items.filter(item => item.failed).length };
}
