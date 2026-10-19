import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { normalizeFeatures, updateFeature, canUseSong } from '../src/features.mjs';
import { localSong, mergeLocalLibrary, audioFileAllowed, parseLocalLyrics } from '../src/local-library.mjs';
import { createExtensionHost } from '../src/extension-host.mjs';
import { generateQueue } from '../src/shuffle.mjs';
import { playableSongs } from '../src/library.mjs';
import { collectRecommendation } from '../src/collection.mjs';
import { qualityDescription } from '../src/playback.mjs';
import { createMobileApi } from '../public/mobile-api.mjs';
import { renderFeatureSettings } from '../public/public-view.mjs';

const id='local-'+ 'a'.repeat(64), other='local-'+'b'.repeat(64);
test('public defaults are offline and feature import never grants unknown or truthy permissions',()=>{
  assert.deepEqual(normalizeFeatures(),{netease:false,metadata:true,lyrics:true,desktopLyrics:false,easterEggs:false});
  assert.equal(normalizeFeatures({netease:'true',custom:true}).netease,false);
  assert.throws(()=>updateFeature({},'unknown',true));
  assert.throws(()=>updateFeature({},'netease','true'));
  assert.equal(canUseSong({id:'123'},{}),false);
  assert.equal(canUseSong({id},{}),true);
});
test('local identity is namespaced and file import rejects encrypted or empty files',()=>{
  assert.equal(audioFileAllowed({name:'track.flac',size:200}),true);
  for(const file of [{name:'track.qmc',size:100},{name:'track.ncm',size:100},{name:'track.mp3',size:0},{name:'track.exe',size:5}]) assert.equal(audioFileAllowed(file),false);
  assert.throws(()=>localSong({id:'file:///private.mp3'}));
  assert.equal(localSong({id,language:'英语',genre:'爵士'}).languages[0],'en');
});
test('reimport preserves first addition date, metadata has no document URL and refresh can remove absent local files',()=>{
  let sources=mergeLocalLibrary([],[{id,title:'A',addedAt:100}],200);
  sources=mergeLocalLibrary(sources,[{id,title:'new',addedAt:500},{id:other,title:'B',addedAt:500}],600);
  assert.equal(sources[0].songs[0].addedAt,100);
  sources=mergeLocalLibrary(sources,[{id:other,title:'B',uri:'content://secret',addedAt:500}],700,true);
  assert.equal(sources[0].songs.length,1);
  assert.equal('uri' in sources[0].songs[0],false);
  assert.equal(sources[0].provider,'local');
});
test('portable local IDs retain hard language, cooldown and blacklist boundaries and can be collected',()=>{
  const songs=[{id,title:'A',artist:'one',languages:['ja'],playlistIds:['local-library'],addedAt:200},{id:other,title:'B',artist:'two',languages:['en'],playlistIds:['local-library'],addedAt:100}];
  assert.equal(playableSongs(songs).length,2);
  assert.equal(playableSongs(songs,[id]).length,1);
  const selected=generateQueue({songs,options:{languages:['ja'],cooldownDays:0,count:10}},()=>.5).queue;
  assert.deepEqual(selected.map(song=>song.id),[id]);
  assert.equal(generateQueue({songs,history:[{songId:id,playedAt:1000}],options:{languages:['ja'],now:1000,cooldownDays:3,count:10}}).queue.length,0);
  const favorites=collectRecommendation([],songs[0]);
  assert.equal(favorites[0].songs[0].id,id);
});
test('new local arrivals participate in the real recent-100 quota without listening reinforcement',()=>{
  const songs=Array.from({length:180},(_,index)=>({id:'local-'+index.toString(16).padStart(64,'0'),title:String(index),artist:'artist',playlistIds:['local-library'],addedAt:100000-index}));
  const result=generateQueue({songs,options:{recentPriority:100,count:20,cooldownDays:0}},()=>.5);
  assert.equal(result.queue.length,20);
  assert.ok(result.queue.every(song=>parseInt(song.id.slice(6),16)<100));
});
test('extension host refuses disabled or undeclared capabilities before invoking trusted adapters',async()=>{
  let calls=0;
  const plugin={id:'test.source',kind:'source',methods:{read:()=>{calls++;return 'data';}}};
  const disabled=createExtensionHost({plugins:[plugin]});
  await assert.rejects(disabled.invoke('test.source','read',{}),/关闭/u);assert.equal(calls,0);
  const enabled=createExtensionHost({plugins:[plugin],isEnabled:()=>true});
  assert.equal(await enabled.invoke('test.source','read',{}),'data');
  await assert.rejects(enabled.invoke('test.source','erase',{}),/尚未注册/u);
  assert.throws(()=>createExtensionHost({plugins:[plugin,plugin]}));
});
test('local lyrics and native routes never call the NetEase adapter',async()=>{
  const calls=[];
  const api=createMobileApi(async(operation,parameters)=>{calls.push({operation,parameters});if(operation==='local_lyrics') return {lrc:{lyric:'[00:01.00]本地歌词'}};return {songs:[]};});
  await api('/api/local');
  await api('/api/local/import',{method:'POST',body:'{}'});
  await api('/api/preview',{method:'POST',body:JSON.stringify({id})});
  const lyrics=await api('/api/lyrics',{method:'POST',body:JSON.stringify({id})});
  assert.deepEqual(calls.map(call=>call.operation),['local_list','local_import','local_preview','local_lyrics']);
  assert.equal(lyrics.lines[0].text,'本地歌词');
  assert.equal(parseLocalLyrics('\uFEFF[00:01.00]Hi\r\n'), '[00:01.00]Hi\n');
  assert.match(qualityDescription({actualLevel:'local'}),/原文件/u);
});
test('server blocks all platform work by default and disabling one session invalidates only that session',async t=>{
  let calls=0;
  const service={status:async()=>{calls++;return {loggedIn:false,profile:null};},invalidateSession:()=>{}};
  const server=createApp({service});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  const easterModule=await fetch(base+'/src/easter.mjs');
  assert.equal(easterModule.status,200);
  assert.match(await easterModule.text(),/resolveEasterEgg/u);
  const first=await fetch(base+'/api/features'),cookie=first.headers.get('set-cookie').split(';')[0];
  assert.equal((await first.json()).netease,false);
  assert.equal((await fetch(base+'/api/login/qr',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
  await fetch(base+'/api/status',{headers:{Cookie:cookie}});assert.equal(calls,0);
  const set=enabled=>fetch(base+'/api/features',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({id:'netease',enabled})});
  await set(true);await fetch(base+'/api/status',{headers:{Cookie:cookie}});assert.equal(calls,1);
  await set(false);await fetch(base+'/api/status',{headers:{Cookie:cookie}});assert.equal(calls,1);
  const otherSession=await fetch(base+'/api/features');assert.equal((await otherSession.json()).netease,false);
});
test('public UI exposes switch states and ships no unverified GIF or hidden network startup',async()=>{
  const html=renderFeatureSettings({state:{features:normalizeFeatures()},escape:String});
  assert.match(html,/role="switch" aria-checked="false"/u);
  assert.match(html,/网易云连接/u);
  const app=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8');
  assert.match(app,/createEasterEggs/u);
  assert.equal(normalizeFeatures().easterEggs,false);
  assert.match(app,/suiting\.public\.library\.v1/u);
  assert.match(app,/initializePublic\(\)/u);
});
