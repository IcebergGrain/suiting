import { normalizeLanguages } from './languages.mjs';
import { genreKeysFromStyles } from './classify.mjs';
import { isLocalSongId } from './song-id.mjs';

export const localLibraryId = 'local-library';
export const audioExtension = /\.(?:mp3|flac|m4a|aac|wav|ogg|opus|aiff|aif|alac)$/iu;
export function audioFileAllowed(file) {
  return Boolean(file && audioExtension.test(file.name) && Number(file.size) > 0 && Number(file.size) <= 512 * 1024 * 1024);
}
export function localSong(value, now = Date.now()) {
  if (!isLocalSongId(value?.id)) throw new Error('本地歌曲 ID 无效。');
  return { id:value.id, title:String(value.title || value.name || '未命名音乐').slice(0,300),
    artist:String(value.artist || '未知歌手').slice(0,300), album:String(value.album || '').slice(0,300),
    duration:Math.max(0,Number(value.duration)||0), provider:'local', addedAt:Number(value.addedAt)||now,
    languages:normalizeLanguages(value.language ?? value.languages), autoGenreKeys:genreKeysFromStyles(value.genre ? [value.genre] : []),
    fileName:String(value.name || value.fileName || '').slice(0,300), format:String(value.format || '').slice(0,100),
    size:Math.max(0,Number(value.size)||0), persistent:value.persistent !== false };
}
export function mergeLocalLibrary(sources, incoming, now = Date.now(), replace = false) {
  const existing = sources.find(source=>source.id===localLibraryId);
  const songs = new Map((replace ? [] : existing?.songs || []).map(song=>[song.id,song]));
  for (const value of incoming) {
    const song=localSong(value,now), previous=songs.get(song.id) || existing?.songs?.find(item=>item.id===song.id);
    songs.set(song.id,{...previous,...song,addedAt:previous?.addedAt || song.addedAt});
  }
  const source={id:localLibraryId,name:'本地音乐',local:true,origin:'files',provider:'local',owned:true,owner:{nickname:'仅此设备'},songs:[...songs.values()],trackCount:songs.size,syncedAt:new Date(now).toISOString()};
  return sources.filter(item=>item.id!==localLibraryId).concat(source);
}
export function parseLocalLyrics(text) {
  if (typeof text !== 'string' || text.length > 300000) throw new Error('歌词须为小于 300 KB 的 UTF-8 文本。');
  return text.replace(/^\uFEFF/u,'').replace(/\r\n?/gu,'\n');
}
