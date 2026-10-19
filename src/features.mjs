export const featureCatalog = Object.freeze([
  { id:'netease', name:'网易云连接', kind:'source', default:false, description:'本人授权后同步歌单、日推和喜欢；不下载、不解锁。关闭后阻止新的平台请求。', network:true },
  { id:'metadata', name:'本地文件信息', kind:'metadata', default:true, description:'安卓版在本机读取歌曲内嵌的标题、歌手、专辑、语种与风格；关闭后新导入只用文件名。', network:false },
  { id:'lyrics', name:'歌词与翻译', kind:'lyrics', default:true, description:'本地歌曲使用你导入的 LRC；平台歌曲只向该平台读取歌词。可单独关闭。', network:false },
  { id:'desktopLyrics', name:'Android 桌面歌词', kind:'presentation', default:false, description:'需要系统悬浮窗授权；默认锁定并穿透点击。关闭扩展立即关闭浮窗。', network:false },
]);
export function normalizeFeatures(value = {}) {
  return Object.fromEntries(featureCatalog.map(feature => [feature.id, typeof value?.[feature.id] === 'boolean' ? value[feature.id] : feature.default]));
}
export function updateFeature(value, id, enabled) {
  if (!featureCatalog.some(feature => feature.id === id) || typeof enabled !== 'boolean') throw new Error('扩展开关无效。');
  return { ...normalizeFeatures(value), [id]:enabled };
}
export function canUseSong(song, features) {
  return /^local-/u.test(String(song?.id)) || song?.demo || normalizeFeatures(features).netease;
}
