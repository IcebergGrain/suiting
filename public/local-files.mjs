import { audioFileAllowed, localSong } from '../src/local-library.mjs';
import { normalizeLyrics } from '../src/lyrics.mjs';

export function createLocalFiles({ indexedDB = globalThis.indexedDB, url = URL } = {}) {
  let opened;
  const urls = new Map();
  async function database() {
    if (!indexedDB) throw new Error('本地音频存储不可用，请使用安卓版或允许此网站使用设备存储。');
    if (!opened) opened = new Promise((resolve,reject)=>{
      const request=indexedDB.open('suiting.public.audio.v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>{opened=null;reject(new Error('无法打开本地音频存储。'));};
    });
    return opened;
  }
  async function transact(mode, action) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction('files',mode), store=transaction.objectStore('files');
      let result;
      try { const request=action(store); request.onsuccess=()=>{result=request.result;}; }
      catch(error) {transaction.abort();reject(error);return;}
      transaction.oncomplete=()=>resolve(result);
      transaction.onabort=transaction.onerror=()=>reject(new Error('音频未保存：设备存储不足或存储权限不可用；旧曲库保留。'));
    });
  }
  return {
    async importFiles(files) {
      if (files.length>1000) throw new Error('请每次选择不超过 1000 个文件。');
      const songs=[],failures=[];
      for(const file of files) {
        if(!audioFileAllowed(file)) { failures.push(file.name);continue; }
        const signature=new Blob([file.name+'|'+file.size+'|'+file.lastModified+'|',file.slice(0,65536),file.slice(Math.max(0,file.size-65536))]);
        const digest=await crypto.subtle.digest('SHA-256',await signature.arrayBuffer());
        const id='local-'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
        const previous=await transact('readonly',store=>store.get(id));
        const song=localSong({id,name:file.name,title:file.name.replace(/\.[^.]+$/u,''),size:file.size,format:file.type,addedAt:previous?.song?.addedAt||Date.now()});
        await transact('readwrite',store=>store.put({id,song,file,lyrics:previous?.lyrics||''}));
        songs.push(song);
      }
      return {songs,failed:failures.length};
    },
    async list() { return (await transact('readonly',store=>store.getAll())).map(item=>item.song); },
    async preview(id) {
      const entry=await transact('readonly',store=>store.get(id));
      if(!entry?.file) throw new Error('此设备没有对应音频，请重新导入本地文件；JSON 备份不包含音频。');
      if(!urls.has(id)) urls.set(id,url.createObjectURL(entry.file));
      return {url:urls.get(id),actualLevel:'local',format:entry.song.format,requestedQuality:'original'};
    },
    async lyrics(id) { const entry=await transact('readonly',store=>store.get(id)); return {id,...normalizeLyrics({lrc:{lyric:entry?.lyrics||''}})}; },
    async saveLyrics(id,text) {
      const entry=await transact('readonly',store=>store.get(id));
      if(!entry) throw new Error('请先重新选择这首歌的音频。');
      await transact('readwrite',store=>store.put({...entry,lyrics:text}));
      return {saved:true};
    },
    async remove(ids) { for(const id of ids) {await transact('readwrite',store=>store.delete(id));if(urls.has(id)){url.revokeObjectURL(urls.get(id));urls.delete(id);}} },
  };
}
