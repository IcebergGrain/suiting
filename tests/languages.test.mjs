import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLanguages, songLanguages, languageMatches, languageCoverage, needsLanguageLookup, qqLanguageLabels } from '../src/languages.mjs';
import { lookupLanguages } from '../src/language-service.mjs';
import { generateQueue, normalizeQueueOptions, getRecentSongs } from '../src/shuffle.mjs';
import { classificationFromWiki, applyAutoClassification, AUTO_VERSION } from '../src/classify.mjs';
import { renderLanguageControls, renderLanguageEditor } from '../public/language-view.mjs';

const escape = value => String(value).replaceAll('<','&lt;');
const wiki = labels => ({ data: { blocks: [{ rnData: { blocks: [{ blockInfo: { wikiSubElementVos: labels.map(text => ({ title: '语种', wikiSubMetaVos: [{text}] })) } }] } }] } });
test('language aliases group vocals rather than artist nationality, region or spelling', () => {
  assert.deepEqual(normalizeLanguages(['国语','粤语','en-US','French','俄语','德语','日语','韩语']),['zh','en','fr','ru','de','ja','ko']);
  assert.deepEqual(normalizeLanguages('中英 / 中文 / English'),['zh','en']);
  assert.deepEqual(normalizeLanguages(['欧美','美国','日本歌手','Hello World',0,3,null]),[]);
  assert.deepEqual(normalizeLanguages(['西班牙语','葡萄牙语','other']),['other']);
});
test('unknown is distinct from instrumental and confirmed other language', () => {
  assert.deepEqual(songLanguages({title:'English words',artist:'USA singer'}),[]);
  assert.equal(languageMatches({language:'瑞典语'},['other']),true);
  assert.equal(languageMatches({},['other']),false);
  assert.equal(languageMatches({},['unknown']),true);
  assert.equal(languageMatches({language:'纯音乐'},['unknown']),false);
  assert.deepEqual(languageCoverage([{}, {language:'instrumental'}, {language:'Thai'}, {language:'中英'}]), {total:4,known:3,counts:{zh:1,ja:0,ko:0,en:1,fr:0,ru:0,de:0,other:1,instrumental:1,unknown:1}});
});
test('manual language overrides survive automatic updates, including deliberate unknown and reset', () => {
  const song=applyAutoClassification({localLanguages:['fr'],autoLanguageKeys:['en']},{source:'netease-wiki',languageKeys:['ja'],genre:null,mood:null,moods:[],genres:[],tags:[],scenes:[]});
  assert.deepEqual(songLanguages(song),['fr']);
  assert.deepEqual(songLanguages({...song,localLanguages:[]}),[]);
  delete song.localLanguages;
  assert.deepEqual(songLanguages(song),['ja']);
  assert.equal(needsLanguageLookup({id:'1',localLanguages:[]}),false);
});
test('wiki language alone is a useful classification, retained through application', () => {
  const classification=classificationFromWiki(wiki(['日语','英语']));
  assert.equal(classification.version,AUTO_VERSION);
  assert.deepEqual(classification.languageKeys,['ja','en']);
  assert.equal(classification.confidence,'language');
  assert.deepEqual(songLanguages(applyAutoClassification({id:'1'},classification)),['ja','en']);
  assert.equal(classificationFromWiki(wiki(['未知'])),null);
});
test('language filtering is hard even with strong recency, reference preferences and unknown supplementation', () => {
  const songs=[{id:'1',title:'中文',artist:'A',language:'中文',playlistIds:['p']},{id:'2',title:'日语',artist:'B',language:'日语',playlistIds:['p']},{id:'3',title:'未知',artist:'C',playlistIds:['p']},{id:'4',title:'混合',artist:'D',language:'中英',playlistIds:['p']}];
  const options={languages:['ja'],count:10,cooldownDays:0,recentPriority:100,recentTaste:100,referenceStrength:100,includeUnknown:true};
  assert.deepEqual(generateQueue({songs,referenceSongs:[songs[0]],options},()=>0.5).queue.map(song=>song.id),['2']);
  assert.deepEqual(getRecentSongs(songs,options).songs.map(song=>song.id),['2']);
  assert.ok(generateQueue({songs,options:{...options,languages:['fr']}},()=>0.5).queue.length===0);
  assert.deepEqual(new Set(generateQueue({songs,options:{...options,languages:['en','ja']}},()=>0.5).queue.map(song=>song.id)),new Set(['2','4']));
  assert.deepEqual(generateQueue({songs,options:{...options,languages:['unknown']}},()=>0.5).queue.map(song=>song.id),['3']);
  assert.deepEqual(normalizeQueueOptions({languages:['ja','ja','other','unknown','bogus']}).languages,['ja','other','unknown']);
});
test('metadata language results validate source identity and never infer numeric QQ enums', () => {
  assert.deepEqual(qqLanguageLabels({track_info:{mid:'TestMid00001',language:0},info:{lan:{content:[{value:'国语'}]}}},'TestMid00001'),['国语']);
  assert.deepEqual(qqLanguageLabels({track_info:{mid:'TestMid00001',language:4}},'TestMid00001'),[]);
  assert.throws(()=>qqLanguageLabels({track_info:{mid:'OtherMid0001'}},'TestMid00001'));
});
test('language lookup isolates providers and partial failures without confusing unknown with other', async () => {
  const calls=[];
  const result=await lookupLanguages({ids:['1','qq-TestMid00001']},{netease:async ids=>{calls.push(ids);return {items:[{id:'1',languageKeys:['ru']}]};},qq:async id=>({id,labels:['日语']})});
  assert.deepEqual(calls,[['1']]);
  assert.deepEqual(result.items.map(item=>item.languages),[['ru'],['ja']]);
  const failed=await lookupLanguages({ids:['1','qq-TestMid00001']},{netease:async()=>{throw new Error('offline');},qq:async()=>({labels:[]})});
  assert.equal(failed.failed,1);
  assert.deepEqual(failed.items[1].languages,[]);
  for(const ids of [[],['bad'],Array.from({length:6},(_,index)=>String(index+1))]) await assert.rejects(lookupLanguages({ids}));
});
test('lookup caches failure briefly and missing metadata for seven days, not forever', () => {
  const now=10*86400000;
  assert.equal(needsLanguageLookup({id:'1',autoLanguageStatus:'empty',autoLanguageAttemptAt:now-1000},now),false);
  assert.equal(needsLanguageLookup({id:'1',autoLanguageStatus:'empty',autoLanguageAttemptAt:now-8*86400000},now),true);
  assert.equal(needsLanguageLookup({id:'1',autoLanguageStatus:'failed',autoLanguageAttemptAt:now-1000},now),false);
  assert.equal(needsLanguageLookup({id:'1',autoLanguageStatus:'failed',autoLanguageAttemptAt:now-11*60000},now),true);
});
test('language controls expose counts, multi-selection, honest unknown and manual override', () => {
  const html=renderLanguageControls({state:{options:{languages:['ja','en']},languagePickerOpen:true},songs:[{language:'日语'},{}],escape});
  assert.match(html,/演唱语言多选/u);
  assert.match(html,/英语包含美英/u);
  assert.match(html,/“其他”仅指已知的其他语言/u);
  assert.match(html,/data-language="ja" aria-pressed="true"/u);
  assert.match(html,/已识别 1 \/ 2/u);
  assert.match(renderLanguageEditor({id:'1',autoLanguageKeys:['de']},escape),/value="de" checked/u);
});
