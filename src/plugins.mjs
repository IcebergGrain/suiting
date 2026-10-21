import { shuffledPlaybackIds } from './playback.mjs';
import { normalizeQueueOptions } from './shuffle.mjs';

const orderingRules = ['reverse', 'artist-spacing', 'shuffle'];
const presetKeys = ['moods', 'genres', 'languages', 'excludeMoods', 'excludeGenres', 'excludeLanguages', 'excludeUnclassified', 'count', 'countMode', 'cooldownDays', 'variation', 'recentPriority', 'recentTaste', 'referenceStrength', 'classificationMode', 'includeUnknown', 'tag'];
const label = (value, maximum) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/gu, '').trim().slice(0, maximum) : '';

export const builtinPlugins = [{
  apiVersion: 1, id: 'suiting.artist-spacing', name: '歌手错开一点', version: '1.0.0',
  description: '只重排已经选好的歌曲，尽量避免同一歌手连着出现；不改变歌单范围或首数。',
  kind: 'queue-order', rule: 'artist-spacing', builtin: true,
}];

export function normalizePlugin(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.apiVersion !== 1) throw new Error('仅支持 apiVersion 为 1 的 JSON 扩展。');
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9.-]{2,79}$/.test(value.id) || ['constructor', 'prototype', '__proto__'].includes(value.id)) throw new Error('扩展 ID 无效。');
  const name = label(value.name, 60);
  const version = label(value.version, 30);
  if (!name || !version) throw new Error('扩展需要名称和版本。');
  const allowed = new Set(['apiVersion', 'id', 'name', 'version', 'description', 'kind', 'rule', 'preset']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('JSON 扩展包含不支持的字段；不允许脚本、联网地址或账号操作。');
  const plugin = { apiVersion: 1, id: value.id, name, version, description: label(value.description, 400), kind: value.kind };
  if (value.kind === 'queue-order') {
    if (!orderingRules.includes(value.rule) || value.preset !== undefined) throw new Error('不支持的队列重排规则。');
    return { ...plugin, rule: value.rule };
  }
  if (value.kind !== 'preset' || !value.preset || typeof value.preset !== 'object' || Array.isArray(value.preset) || value.rule !== undefined) throw new Error('扩展类型仅支持 queue-order 或 preset。');
  if (Object.keys(value.preset).some(key => !presetKeys.includes(key))) throw new Error('预设不能修改曲库范围、账号或登录信息。');
  const normalized = normalizeQueueOptions(value.preset);
  return { ...plugin, preset: Object.fromEntries(Object.keys(value.preset).map(key => [key, normalized[key]])) };
}

export function restorePlugins(values) {
  const result = [];
  for (const value of Array.isArray(values) ? values.slice(0, 20) : []) {
    try {
      const plugin = normalizePlugin(value);
      if (!plugin.id.startsWith('suiting.') && !result.some(item => item.id === plugin.id)) result.push(plugin);
    } catch {}
  }
  return result;
}

export function validateQueueOrder(original, proposed) {
  if (!Array.isArray(proposed) || proposed.length !== original.length) throw new Error('扩展必须保留原队列的全部歌曲。');
  const known = new Map(original.map(song => [String(song.id), song]));
  const seen = new Set();
  const result = proposed.map(value => {
    const id = String(value?.id ?? value);
    if (!known.has(id) || seen.has(id)) throw new Error('扩展不能增加外部歌曲、重复歌曲或覆盖歌曲元数据。');
    seen.add(id);
    return known.get(id);
  });
  return result;
}

export function applyQueuePlugins(queue, plugins, enabled, random = Math.random) {
  let result = [...queue];
  const warnings = [];
  for (const plugin of plugins.filter(value => value.kind === 'queue-order' && enabled.includes(value.id))) {
    try {
      let ordered;
      if (plugin.rule === 'reverse') ordered = [...result].reverse();
      else if (plugin.rule === 'shuffle') {
        const ids = shuffledPlaybackIds(result.map(song => song.id), null, random);
        const songs = new Map(result.map(song => [String(song.id), song]));
        ordered = ids.map(id => songs.get(id));
      } else if (plugin.rule === 'artist-spacing') {
        const remaining = [...result];
        ordered = [];
        while (remaining.length) {
          const artist = ordered.at(-1)?.artist;
          const index = remaining.findIndex(song => song.artist !== artist);
          ordered.push(remaining.splice(index < 0 ? 0 : index, 1)[0]);
        }
      } else throw new Error('未知重排规则');
      result = validateQueueOrder(result, ordered);
    } catch (error) { warnings.push(`扩展「${plugin.name}」未应用：${error.message}`); }
  }
  return { queue: result, warnings };
}

export async function applyQueueProviders(queue, providers, enabled, timeoutMs = 5000) {
  let result = [...queue];
  const warnings = [];
  for (const provider of providers.filter(value => enabled.includes(value.id))) {
    const controller = new AbortController();
    let timer;
    try {
      const context = Object.freeze({
        apiVersion: 1,
        songs: Object.freeze(result.map(song => Object.freeze({ id: String(song.id), title: String(song.title || ''), artist: String(song.artist || '') }))),
        signal: controller.signal,
      });
      const pending = Promise.resolve().then(() => provider.transformQueue(context));
      const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('扩展超时，已保留原队列')); }, timeoutMs); });
      const proposed = await Promise.race([pending, timeout]);
      result = validateQueueOrder(result, proposed);
    } catch (error) { warnings.push(`扩展「${provider.name}」未应用：${error.message}`); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  return { queue: result, warnings };
}
