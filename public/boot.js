try {
  const preference = JSON.parse(localStorage.getItem('suiting.public.library.v1') || '{}').appearance;
  document.documentElement.dataset.theme = ['light', 'dark'].includes(preference) ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
window.__suitingBootTimer = setTimeout(() => {
  const app = document.getElementById('app');
  if (app?.querySelector('.boot')) app.innerHTML = '<main class="boot"><p>随听</p><span>启动没有完成，请重新打开并检查系统 WebView。本机资料没有被清空。</span></main>';
}, 8000);
