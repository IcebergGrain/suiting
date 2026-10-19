import * as runtime from './mobile-api.mjs';

window.SuiTingMobileRuntime = runtime;
import('./app.mjs').catch(() => {
  document.querySelector('#app').textContent = '随听未能打开，请先更新 Android System WebView 后重试。你的本机歌单没有被清空。';
});
