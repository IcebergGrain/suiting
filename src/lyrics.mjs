export function parseLrc(input) {
  const text = String(input || '').slice(0, 120000).replace(/\r/g, '');
  const offset = Number(/\[offset:\s*(-?\d+)\s*\]/i.exec(text)?.[1] || 0) / 1000;
  const entries = [];
  const plain = [];
  for (const line of text.split('\n').slice(0, 5000)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const content = line.replace(/\[[^\]]*\]/g, '').trim().slice(0, 1000);
    if (!content) continue;
    if (!stamps.length) { if (!/^\s*\[[a-z]+:/i.test(line)) plain.push(content); continue; }
    for (const stamp of stamps) {
      if (Number(stamp[2]) >= 60) continue;
      const time = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || '0'}`) + offset;
      entries.push({ time: Math.max(0, Math.round(time * 1000) / 1000), text: content });
    }
  }
  const unique = new Map();
  for (const entry of entries.sort((left, right) => left.time - right.time)) {
    const previous = unique.get(entry.time);
    if (previous && previous.text !== entry.text) previous.text += ` / ${entry.text}`;
    else if (!previous) unique.set(entry.time, { ...entry });
  }
  return { lines: [...unique.values()].slice(0, 3000), plain: plain.slice(0, 1000) };
}

export function normalizeLyrics(body = {}) {
  const original = parseLrc(body.lrc?.lyric);
  const translated = parseLrc(body.tlyric?.lyric);
  const translations = new Map(translated.lines.map(line => [Math.round(line.time * 1000), line.text]));
  const lines = original.lines.map(line => ({ ...line, translation: translations.get(Math.round(line.time * 1000)) || '' }));
  return { lines, plain: original.plain, status: body.nolyric || body.pureMusic ? 'instrumental' : lines.length ? 'timed' : original.plain.length ? 'plain' : 'unavailable' };
}

export function activeLyricIndex(lines, currentTime) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= currentTime) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}
