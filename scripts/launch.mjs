import { spawn, execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4392);
const url = `http://127.0.0.1:${port}/`;
let existing = false;
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(800) });
  existing = response.ok && (await response.text()).includes('<title>随听 0.1.1 ·');
} catch {}

function openBrowser() {
  if (process.platform === 'win32') execFile('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], { windowsHide: true }, () => {});
  else if (process.platform === 'darwin') execFile('open', [url], () => {});
  else execFile('xdg-open', [url], () => {});
}

if (existing) {
  console.log(`随听已经在运行：${url}`);
  if (process.env.HOST === '0.0.0.0') console.log('如果当前是普通模式，请先关闭原终端，再重新启动手机同网模式。');
  openBrowser();
  process.exit(0);
}

const server = spawn(process.execPath, ['server.mjs'], { cwd: directory, env: process.env, stdio: 'inherit', windowsHide: true });
let opened = false;
const interval = setInterval(async () => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (!response.ok || opened) return;
    opened = true; clearInterval(interval);
    openBrowser();
    if (process.env.HOST === '0.0.0.0') {
      console.log('\n手机与电脑连接同一可信 Wi-Fi 后，用手机浏览器打开：');
      for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses || []) {
          if (address.family === 'IPv4' && !address.internal) console.log(`  http://${address.address}:${port}/`);
        }
      }
      console.log('浏览器之间的资料与登录相互独立，可通过 JSON 备份转移。\n');
    }
  } catch {}
}, 400);
server.on('error', () => { console.error('启动失败，请确认 Node.js 22 或更高版本已安装。'); clearInterval(interval); process.exitCode = 1; });
server.on('exit', code => { clearInterval(interval); process.exitCode = code || 0; });
process.on('SIGINT', () => { server.kill('SIGINT'); clearInterval(interval); });
process.on('SIGTERM', () => { server.kill('SIGTERM'); clearInterval(interval); });
