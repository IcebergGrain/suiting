const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export const easterDefinitions = Object.freeze([
  Object.freeze({ id: 'ouye', words: ['欧耶'], title: '欧耶！', query: '邦友的酒 DJ HALO', song: '邦友的酒(DJ版) · 夢ノ結唱 HALO' }),
  Object.freeze({ id: 'deepseek', words: ['deepseek', '大肥鱼', '蓝色大肥鱼', '肥鱼'], title: '大肥鱼，冒个泡。', query: 'Let me go 星落落', song: 'Let me go · 星落落_oi版' }),
]);
export function resolveEasterEgg(value) {
  return easterDefinitions.find(egg => egg.words.some(word => normalize(word) === normalize(value))) || null;
}
export function easterSearchTrigger({ id, value, composing = false, enabled = false }) {
  return enabled && id === 'search' && !composing ? resolveEasterEgg(value) : null;
}
export function matchingEasterSong(egg, songs = []) {
  return songs.find(song => {
    const title = normalize(song.title), artist = normalize(song.artist);
    return egg.id === 'ouye'
      ? title.includes('邦友的酒') && title.includes('dj') && (/halo|梦的结唱|夢ノ結唱/u.test(artist) || artist === '活跃黑江乐' && title.includes('halo'))
      : title.includes('letmego') && /星落落/u.test(title + artist);
  }) || null;
}
export function easterFileAllowed(file, type) {
  if (!file || file.size <= 0) return false;
  return type === 'image'
    ? file.size <= 5 * 1024 * 1024 && /^image\/(gif|png|jpeg|webp)$/u.test(file.type)
    : type === 'audio' && file.size <= 40 * 1024 * 1024 && /^audio\//u.test(file.type);
}
