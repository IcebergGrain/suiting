import { featureCatalog } from '../src/features.mjs';

export function renderListeningWelcome({ state, songCount, escape }) {
  const connected = state.features.netease && state.status.loggedIn;
  const ready = songCount > 0;
  const title = ready ? '让熟悉的歌，重新心动。' : '你的音乐，从这里开始。';
  const description = connected
    ? ready ? '曲库已就位。选一种心情，把下一首交给随听。' : '账号已连接。下一步，选一个歌单同步到曲库。'
    : ready ? '曲库已就位，选好心情就能生成。也可以连接网易云，带来更多喜欢的歌。' : '先导入本地音乐，再选范围和心情，生成属于此刻的播放列表。网易云可以按需开启。';
  return `<section class="listening-welcome ${ready ? 'has-library' : ''}" aria-label="开始听歌">
    <div class="welcome-copy"><h2>${title}</h2><p>${description}</p>
    <div class="welcome-actions"><button class="button primary welcome-connect" data-action="connect-netease" ${state.busy ? 'disabled' : ''}>${connected ? '管理网易云歌单' : '连接网易云音乐'} <span aria-hidden="true">↗</span></button><button class="button welcome-local" data-action="local-import" ${state.busy ? 'disabled' : ''}>导入本地音乐</button></div>
    <span class="welcome-note">${connected ? `已连接 · ${escape(state.status.profile?.nickname || '网易云账号')}` : '扫码登录 · 连接后选择歌单 · 也可以只听本地音乐'}</span></div>
    <div class="welcome-art" aria-hidden="true"><div class="welcome-sleeve"><span>随 听</span><small>SIDE A · PLAY YOUR MOOD</small></div><div class="welcome-vinyl"><span>随听<br>33⅓ RPM</span></div></div>
    <ol class="listening-steps" aria-label="听歌步骤"><li class="${!ready ? 'current' : 'complete'}" ${!ready ? 'aria-current="step"' : ''}><span>01</span><div><strong>带上你的歌</strong><small>${ready ? `曲库已有 ${songCount} 首` : connected ? '选择歌单并同步' : '连接网易云或导入本地'}</small></div></li><li class="${ready ? state.queue.length ? 'complete' : 'current' : ''}" ${ready && !state.queue.length ? 'aria-current="step"' : ''}><span>02</span><div><strong>选一种听法</strong><small>范围、心情与歌曲数量</small></div></li><li class="${ready && state.queue.length ? 'current' : ''}" ${ready && state.queue.length ? 'aria-current="step"' : ''}><span>03</span><div><strong>开始听，发现惊喜</strong><small>播放这一批，或存回网易云</small></div></li></ol>
  </section>`;
}

export function renderLocalImport({busy,native,escape}) {
  return '<section class="local-import" aria-label="本地音乐导入"><div><h2>把你的音乐带进来</h2><p>'+(native?'选择本地音频，授权保存在本机。重启后可继续使用；文件移动或撤权时需要重新选择。':'音频保存在当前浏览器的本地存储，不上传。存储不足时会明确提示；JSON 备份不包含音频。')+'</p></div><div class="actions"><button class="button primary" data-action="local-import" '+(busy?'disabled':'')+'>导入本地音乐</button><button class="button" data-action="local-refresh" '+(busy?'disabled':'')+'>检查本地曲库</button></div><p class="public-note">本地文件不转码、不上传、不修改原文件。仅支持普通音频文件，NCM／QMC 等加密文件不能直接播放。浏览器版每首上限512 MB、每次最多1000首；Android不复制音频。</p></section>';
}
export function renderFeatureSettings({state,escape}) {
  return '<section class="feature-settings" aria-label="功能插件"><button class="button quiet" data-action="profile-home">返回个人主页</button><h2>功能由你决定</h2><p class="public-note">本地曲库与可控随机是核心，始终可用。其余能力按插件独立开启；关闭不删歌单、分类或听过记录。</p>'+featureCatalog.map(feature=>'<article class="feature-row"><div><h3>'+escape(feature.name)+'</h3><p>'+escape(feature.description)+'</p><small>'+escape(feature.kind)+(feature.network?' · 联网／需本人授权':' · 本机能力')+'</small></div><button class="button '+(state.features[feature.id]?'primary':'')+'" data-action="toggle-feature" data-feature="'+feature.id+'" role="switch" aria-checked="'+state.features[feature.id]+'" aria-label="'+escape(feature.name)+'" '+(state.busy || feature.id==='desktopLyrics' && !state.nativeDevice ? 'disabled':'')+'>'+ (state.features[feature.id]?'已开启 · 关闭':'已关闭 · 开启')+'</button></article>').join('')+'<p class="public-note">JSON 预设与重排扩展默认关闭。开发者可扩展数据源、元数据、歌词或队列重排；源码插件是可信代码，不是任意 JS 沙箱。平台连接关闭时，核心不会向平台发起新请求；已发出的请求无法撤回。</p></section>';
}
