export function renderOverlaySettings({ open, native, overlay, busy = false, error = '', device = null }, { escape }) {
  if (!open) return '';
  if (!native) return '<section class="overlay-panel"><h3>桌面歌词</h3><p>需要安装安卓随听。网页版里的滚动歌词不是桌面悬浮歌词。</p></section>';
  const messages = { permission: '尚未获得系统悬浮窗权限', disabled: '桌面歌词开关未开启', waiting: '开关已开启，等待歌曲开始播放', pending: '尚未确认浮窗创建，请测试或重试', attached: '原生浮窗已创建；请切到手机桌面确认', testing: '10秒原生浮窗测试中，请切到手机桌面', hidden: '锁屏或熄屏时暂时隐藏', error: '系统未允许浮窗显示，请检查权限后重试' };
  const disabled = busy ? 'disabled' : '';
  return `<section class="overlay-panel" aria-label="桌面歌词设置"><h3>桌面歌词，只管显示</h3>
    <p class="overlay-intro">歌词不再附带红心或常驻按钮。下拉通知栏，在随听播放器中点红心，或点歌词按钮开关桌面歌词；空间不够时先展开通知。</p>
    ${error ? `<p class="notice error" role="alert">${escape(error)}</p>` : ''}
    ${overlay ? `<p class="overlay-state" role="status">${escape(messages[overlay.state] || (overlay.permission ? overlay.enabled ? '已请求开启，正在核对浮窗' : messages.disabled : messages.permission))}</p>
    ${overlay.error ? `<p class="notice error">${escape(overlay.error)}</p>` : ''}
    <p class="overlay-touch-state ${overlay.locked !== false ? 'is-safe' : ''}" role="status">${overlay.locked !== false ? '锁定穿透：整个歌词窗口不接收点击，不放任何常驻按钮。' : '正在调整：拖动歌词文字移位，20秒后自动恢复穿透点击。'}</p>
    <div class="actions">${!overlay.permission ? '<button class="button primary" data-action="overlay-permission">前往系统授权</button>' : ''}
    <button class="button primary" data-action="overlay-enable" ${!overlay.permission || busy ? 'disabled' : ''}>${overlay.error ? '重试开启桌面歌词' : overlay.enabled ? '关闭桌面歌词' : '开启桌面歌词'}</button>
    <button class="button" data-action="overlay-lock" ${disabled}>${overlay.locked !== false ? '调整位置（20秒）' : '完成调整并穿透'}</button></div>
    <div class="overlay-fields">
      <label for="overlay-alignment">歌词对齐<select id="overlay-alignment" ${disabled}>${[['left','靠左'],['center','居中'],['right','靠右']].map(([value, label]) => `<option value="${value}" ${(overlay.alignment || 'center') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label for="overlay-lines">原文行数<select id="overlay-lines" ${disabled}><option value="1" ${overlay.lines !== 2 ? 'selected' : ''}>一行：当前原文</option><option value="2" ${overlay.lines === 2 ? 'selected' : ''}>两行：当前＋下一句</option></select></label>
      <label class="overlay-translation" for="overlay-translation"><input id="overlay-translation" type="checkbox" ${overlay.showTranslation !== false ? 'checked' : ''} ${disabled}>显示当前句翻译（有译文时）</label>
      <label for="overlay-width">窗口宽度 ${overlay.widthPercent || 72}%<input id="overlay-width" type="range" min="40" max="100" value="${overlay.widthPercent || 72}" ${disabled}></label>
      <label for="overlay-font">字号 ${overlay.fontSize} sp<input id="overlay-font" type="range" min="16" max="36" value="${overlay.fontSize}" ${disabled}></label>
      <label for="overlay-opacity">背景不透明度 ${Math.round(overlay.opacity * 100)}%<input id="overlay-opacity" type="range" min="0" max="100" value="${Math.round(overlay.opacity * 100)}" ${disabled}></label>
    </div><p class="connection-note">翻译另占一行；无译文不留空白。长句省略显示，可调整宽度与字号。设置只保存在本机。</p>
    <details class="overlay-help"><summary>权限、测试与位置恢复</summary>
    <ol class="overlay-steps"><li>允许系统「显示在其他应用上层」权限。</li><li>点击「测试浮窗10秒」，切到桌面检查。</li><li>移动后点「完成」立即穿透；20秒超时也会自动穿透。</li></ol>
    <div class="actions"><button class="button" data-action="overlay-test" ${!overlay.permission || busy ? 'disabled' : ''}>测试浮窗10秒</button><button class="button" data-action="overlay-refresh" ${disabled}>重新检查</button><button class="button" data-action="overlay-reset" ${disabled}>恢复居中位置</button><button class="button" data-action="overlay-app-settings">打开本应用系统设置</button></div>
    <p>${device ? escape(`${device.manufacturer || ''} ${device.model || ''} · Android API ${device.sdk || '未知'}`) : '安卓手机'}：红米／HyperOS 切后台后不可见时，请检查后台弹出界面和电池限制。系统敏感界面可能主动隐藏浮窗。测试不播放音乐，不代表后台保活已验收。</p>
    <p>锁屏／熄屏隐藏歌词；喜欢与播放控制走系统媒体通知。不同系统可能需要展开媒体卡片才显示红心。喜欢写入网易云账号，只有回读确认后才显示成功，失败不自动重试。拒绝悬浮窗权限不影响听歌，不索取无障碍或录屏权限。</p></details>` : '<button class="button" data-action="overlay-refresh">检查权限与浮窗状态</button>'}
  </section>`;
}
