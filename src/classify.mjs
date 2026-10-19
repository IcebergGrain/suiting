// 网易云歌曲百科 → 本地氛围/风格 的映射与解析。
// 纯函数、无网络依赖，便于单元测试。所有结果都带来源标记，绝不冒充手工分类。

import { normalizeLanguages } from './languages.mjs';

export const AUTO_SOURCE = 'netease-wiki';
export const AUTO_VERSION = 3;

export const genreNameToKey = {
  流行: 'pop',
  民谣: 'folk',
  摇滚: 'rock',
  说唱: 'hiphop',
  'R&B / 灵魂': 'rnb',
  电子: 'electronic',
  爵士: 'jazz',
  古典: 'classical',
  纯音乐: 'instrumental',
  氛围音乐: 'ambient',
  '动漫 / 游戏': 'acg',
  '国风 / 戏曲': 'traditional',
  金属: 'metal',
  其他: 'other',
};

// 曲风匹配按「越具体越先」的顺序，避免「流行说唱」被判成流行。
const genreRules = [
  [/(嘻哈|说唱|rap|hiphop|hip-hop)/i, 'hiphop'],
  [/(电子|电音|慢摇|dj|浩室|house|舞曲|dance|dubstep|trap|edm)/i, 'electronic'],
  [/(r&b|rnb|灵魂|soul)/i, 'rnb'],
  [/(国风|古风|戏曲|中国风|民乐)/i, 'traditional'],
  [/(二次元|动漫|动画|acg|游戏原声|galgame)/i, 'acg'],
  [/(金属|metal)/i, 'metal'],
  [/(爵士|jazz)/i, 'jazz'],
  [/(古典|classical|交响|协奏)/i, 'classical'],
  [/(摇滚|rock|朋克|punk)/i, 'rock'],
  [/(民谣|folk)/i, 'folk'],
  [/(纯音乐|轻音乐|器乐|钢琴曲|instrumental)/i, 'instrumental'],
  [/(氛围|ambient|白噪音|环境音)/i, 'ambient'],
  [/(原声带|ost|配乐|bgm)/i, 'other'],
  [/(儿童|儿歌)/i, 'other'],
  [/(流行|pop)/i, 'pop'],
];

// 推荐标签 → 氛围。顺序即优先级，前端按第一个命中作为主氛围。
const moodRules = [
  [/(悲伤|苦情|抑郁|孤独|失恋|心碎|难过|emo)/i, 'sad'],
  [/(浪漫|思念|甜蜜|情歌|告白)/i, 'romantic'],
  [/(治愈|温暖|暖心)/i, 'healing'],
  [/(助眠|冥想|睡前|安眠)/i, 'calm'],
  [/(平静|安静|舒缓|放松|轻音乐)/i, 'calm'],
  [/(温柔|柔软)/i, 'gentle'],
  [/(欢快|活力|阳光|清新)/i, 'bright'],
  [/(热血|励志|激昂|战斗)/i, 'energetic'],
  [/(狂欢|酒吧|夜店|蹦迪|躁)/i, 'intense'],
  [/(慵懒|午后|慢节奏)/i, 'laidback'],
  [/(怀旧|回忆|复古|年代)/i, 'nostalgic'],
  [/(梦幻|空灵|飘渺)/i, 'dreamy'],
  [/(专注|学习|工作|读书)/i, 'focused'],
];

// 场景词不映射氛围，单独保留，供「场景标签」使用。
const sceneWords = /(ktv|婚礼|酒吧|旅游|开车|跑步|健身|助眠|冥想|学习|工作|游戏|咖啡|雨天|深夜|清晨|通勤|运动)/i;

export function genreFromStyles(styles = []) {
  let fallback = null;
  for (const style of styles) {
    const text = String(style || '');
    for (const [pattern, key] of genreRules) {
      if (!pattern.test(text)) continue;
      // 「原声带」「儿童」这类只作为兜底，让后面的「二次元-动漫主题曲」等具体曲风优先。
      if (key === 'other') { fallback ??= key; break; }
      return key;
    }
  }
  return fallback;
}

export function genreKeysFromStyles(styles = []) {
  const values = [...new Set(styles.map(style => genreFromStyles([style])).filter(Boolean))];
  return values.some(value => value !== 'other') ? values.filter(value => value !== 'other') : values;
}

export function classificationNeedsUpdate(song, now = Date.now(), force = false) {
  if (song.demo || song.blocked || !/^[1-9]\d{0,17}$/.test(String(song.id))) return false;
  if (force) return true;
  if (song.autoSource && song.autoVersion === AUTO_VERSION) return false;
  const age = now - Number(song.autoAttemptAt || 0);
  if (song.autoStatus === 'empty' && song.autoVersion === AUTO_VERSION && age < 7 * 86400000) return false;
  if (song.autoStatus === 'failed' && age < 10 * 60000) return false;
  return true;
}

export function moodsFromTags(tags = []) {
  const matched = [];
  for (const tag of tags) {
    const text = String(tag || '');
    for (const [pattern, key] of moodRules) {
      if (pattern.test(text) && !matched.includes(key)) { matched.push(key); break; }
    }
  }
  return matched;
}

export function scenesFromTags(tags = []) {
  return [...new Set(tags.map(tag => String(tag || '').trim()).filter(tag => tag && sceneWords.test(tag)))].slice(0, 8);
}

// 从 song_wiki_info 的返回体里抽出 曲风 / 推荐标签 / BPM / 语种 / 场景。
export function parseWikiBody(body) {
  const fields = Object.create(null);
  const blocks = Array.isArray(body?.data?.blocks) ? body.data.blocks : [];
  for (const block of blocks) {
    const inner = Array.isArray(block?.rnData?.blocks) ? block.rnData.blocks : [];
    for (const part of inner) {
      const subs = part?.blockInfo?.wikiSubElementVos;
      if (!Array.isArray(subs)) continue;
      for (const sub of subs) {
        const title = String(sub?.title || '').trim();
        if (!title) continue;
        const values = [];
        for (const meta of Array.isArray(sub?.wikiSubMetaVos) ? sub.wikiSubMetaVos : []) {
          const text = String(meta?.text ?? '').trim();
          if (text) values.push(text);
        }
        if (!values.length && typeof sub.content === 'string' && sub.content.trim().length <= 200) values.push(sub.content.trim());
        if (!values.length) continue;
        if (!fields[title]) fields[title] = [];
        for (const value of values) if (!fields[title].includes(value)) fields[title].push(value);
      }
    }
  }
  const styles = [...(fields['曲风'] || []), ...(fields['分类'] || [])].filter(value => !/^[0-9]+$/.test(value));
  const tags = (fields['推荐标签'] || []).filter(value => value.length <= 12);
  const bpmText = (fields['BPM'] || [])[0] || '';
  const bpmMatch = /(\d{2,3})(?:\s*-\s*(\d{2,3}))?/.exec(bpmText);
  const bpm = bpmMatch ? Number(bpmMatch[1]) : null;
  return { styles, tags, scenes: scenesFromTags(tags), bpm: Number.isFinite(bpm) && bpm >= 30 && bpm <= 260 ? bpm : null, language: [...(fields['语种'] || []), ...(fields['歌曲语种'] || []), ...(fields['语言'] || [])].join(' / ') || null, fields: Object.keys(fields) };
}

// 把解析结果压成可直接写进本地库的自动分类。
export function classificationFromWiki(body) {
  const parsed = parseWikiBody(body);
  if (!parsed.styles.length && !parsed.tags.length && !normalizeLanguages(parsed.language).length) return null;
  const genre = genreFromStyles(parsed.styles);
  const moods = moodsFromTags(parsed.tags);
  return {
    source: AUTO_SOURCE,
    language: parsed.language,
    languageKeys: normalizeLanguages(parsed.language),
    version: AUTO_VERSION,
    genre: genre || null,
    genreKeys: genreKeysFromStyles(parsed.styles),
    mood: moods[0] || null,
    moods,
    genres: parsed.styles.slice(0, 4),
    tags: parsed.tags.slice(0, 12),
    scenes: parsed.scenes,
    bpm: parsed.bpm,
    confidence: parsed.styles.length ? 'style' : parsed.tags.length ? 'tag' : 'language',
  };
}

// 只写 auto* 字段，绝不覆盖用户手工保存的 local* 字段。
export function applyAutoClassification(song, classification) {
  if (!song || !classification) return song;
  return {
    ...song,
    autoSource: classification.source,
    ...(classification.languageKeys?.length ? { autoLanguageKeys: normalizeLanguages(classification.languageKeys), autoLanguageSource: classification.source } : {}),
    autoVersion: classification.version || AUTO_VERSION,
    autoGenreKeys: [...(classification.genreKeys || (classification.genre ? [classification.genre] : []))],
    autoGenre: classification.genre,
    autoMood: classification.mood,
    autoMoods: [...classification.moods],
    autoGenres: [...classification.genres],
    autoTags: [...classification.tags],
    autoScenes: [...classification.scenes],
    autoBpm: classification.bpm,
    autoConfidence: classification.confidence,
    autoAt: classification.at || null,
  };
}

export function clearAutoClassification(song) {
  const next = { ...song };
  for (const key of Object.keys(next)) if (key.startsWith('auto')) delete next[key];
  return next;
}
