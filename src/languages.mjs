export const languageDefinitions = { zh: '中文', ja: '日语', ko: '韩语', en: '英语', fr: '法语', ru: '俄语', de: '德语', other: '其他语言', instrumental: '纯音乐' };
export const languageFilterDefinitions = { ...languageDefinitions, unknown: '待识别' };
const aliases = {
  zh: ['中文', '汉语', '华语', '国语', '普通话', '粤语', '闽南语', '客家话', '台语', 'chinese', 'mandarin', 'cantonese', 'zh-cn', 'zh-tw', 'zh-hk'],
  ja: ['日语', '日文', '日本语', 'japanese', 'jpn'],
  ko: ['韩语', '韩文', '朝鲜语', 'korean', 'kor'],
  en: ['英语', '英文', 'english', 'eng', 'en-us', 'en-gb'],
  fr: ['法语', '法文', 'french', 'fra', 'fre'],
  ru: ['俄语', '俄文', 'russian', 'rus'],
  de: ['德语', '德文', 'german', 'deu', 'ger'],
  instrumental: ['纯音乐', '器乐', 'instrumental'],
  other: ['其他', '其他语言', 'other', '西班牙语', '葡萄牙语', '意大利语', '泰语', '越南语', '阿拉伯语', '印地语', '印尼语', '瑞典语', '芬兰语', '土耳其语', '拉丁语', '希腊语', '荷兰语', '波兰语', '希伯来语', '马来语', '蒙语', '蒙古语', '藏语', '维吾尔语', 'spanish', 'portuguese', 'italian', 'thai', 'vietnamese', 'arabic', 'hindi', 'indonesian', 'swedish', 'finnish', 'turkish', 'latin', 'greek', 'dutch', 'polish', 'hebrew', 'malay'],
};
const aliasKeys = new Map(Object.entries(aliases).flatMap(([key, values]) => [key, ...values].map(value => [value.toLowerCase(), key])));
const combined = { 中英: ['zh', 'en'], 中日: ['zh', 'ja'], 中韩: ['zh', 'ko'], 日韩: ['ja', 'ko'] };

export function normalizeLanguages(value) {
  const values = Array.isArray(value) ? value : [value];
  const found = new Set();
  for (const item of values) {
    if (typeof item !== 'string') continue;
    for (const label of item.normalize('NFKC').split(/[,，、/;；&+|]+/u)) {
      const text = label.trim().toLowerCase();
      if (combined[text]) { for (const key of combined[text]) found.add(key); continue; }
      const key = aliasKeys.get(text);
      if (key) found.add(key);
      else if (/^[\p{Script=Han}]{1,12}语$/u.test(text) && !['语言', '未知语', '外语', '多语', '混合语', '无语'].includes(text)) found.add('other');
    }
  }
  return [...found].slice(0, 9);
}

export function songLanguages(song = {}) {
  if (Object.hasOwn(song, 'localLanguages')) return normalizeLanguages(song.localLanguages);
  const automatic = normalizeLanguages(song.autoLanguageKeys);
  return automatic.length ? automatic : normalizeLanguages(song.languages ?? song.language);
}

export function languageMatches(song, selected = []) {
  const choices = Array.isArray(selected) ? selected.filter(key => Object.hasOwn(languageFilterDefinitions, key)) : [];
  if (!choices.length) return true;
  const known = songLanguages(song);
  return known.length ? known.some(key => choices.includes(key)) : choices.includes('unknown');
}

export function languageCoverage(songs) {
  const counts = Object.fromEntries(Object.keys(languageFilterDefinitions).map(key => [key, 0]));
  for (const song of songs) {
    const keys = songLanguages(song);
    if (!keys.length) counts.unknown++;
    else for (const key of keys) counts[key]++;
  }
  return { total: songs.length, known: songs.length - counts.unknown, counts };
}

export function needsLanguageLookup(song, now = Date.now()) {
  if (song.demo || song.blocked || songLanguages(song).length || Object.hasOwn(song, 'localLanguages')) return false;
  const age = now - Number(song.autoLanguageAttemptAt || 0);
  return song.autoLanguageStatus === 'failed' ? age >= 10 * 60000 : song.autoLanguageStatus === 'empty' ? age >= 7 * 86400000 : true;
}

export function qqLanguageLabels(data, expectedMid) {
  const track = data?.track_info;
  if (!track || String(track.mid ?? track.songmid) !== expectedMid) throw new Error('QQ 返回的语种资料与歌曲不一致。');
  const content = data.info?.lan?.content;
  return Array.isArray(content) ? content.filter(item => typeof item?.value === 'string').map(item => item.value).slice(0, 9) : [];
}
