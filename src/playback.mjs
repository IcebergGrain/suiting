export const qualityDefinitions = {
  standard: { name: '标准 · 请求128 kbps', bitrate: 128000 },
  higher: { name: '较高 · 请求192 kbps', bitrate: 192000 },
  exhigh: { name: '极高 · 请求320 kbps', bitrate: 320000 },
  lossless: { name: '无损请求 · 账号许可为准', bitrate: null },
};

export const playbackModes = { order: '顺序播放', single: '单曲循环', loop: '列表循环', shuffle: '随机播放' };

export function shuffledPlaybackIds(ids, currentId, random = Math.random) {
  const remaining = [...new Set(ids.map(String))].filter(id => id !== currentId);
  for (let cursor = remaining.length - 1; cursor > 0; cursor--) {
    const sample = Number(random());
    const selected = Math.floor(Math.max(0, Math.min(0.999999999999, Number.isFinite(sample) ? sample : 0)) * (cursor + 1));
    [remaining[cursor], remaining[selected]] = [remaining[selected], remaining[cursor]];
  }
  return ids.map(String).includes(currentId) ? [currentId, ...remaining] : remaining;
}

export function normalizePlaybackPreferences(value = {}) {
  return { quality: Object.hasOwn(qualityDefinitions, value?.quality) ? value.quality : 'exhigh', volume: Number.isFinite(Number(value?.volume)) ? Math.max(0, Math.min(1, Number(value.volume))) : 0.7, mode: Object.hasOwn(playbackModes, value?.mode) ? value.mode : 'order' };
}

export function formatTime(value) {
  const seconds = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function qualityDescription(info) {
  if (!info) return '实际音质：尚未取得播放地址';
  if (info.actualLevel === 'local') return `本地原文件 · ${info.format || '设备解码'} · 不转码；音质取决于原文件及设备。`;
  const bitrate = info.bitrate ? `${Math.round(info.bitrate / 1000)} kbps` : '码率未返回';
  return `接口报告：${info.format ? info.format.toUpperCase() : '格式未返回'} · ${bitrate}${qualityDefinitions[info.actualLevel] ? ` · ${qualityDefinitions[info.actualLevel].name.split(' · ')[0]}` : ''}`;
}
