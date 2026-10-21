import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'android/app/build/generated/assets');
if (path.relative(root, destination) !== path.join('android', 'app', 'build', 'generated', 'assets')) throw new Error('Refusing to clean assets outside the Android generated directory');
await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, 'src'), { recursive: true });
await mkdir(path.join(destination, 'licenses'), { recursive: true });
await cp(path.join(root, 'public'), destination, { recursive: true });
// 浏览器可用的共享模块必须在这里登记；新增模块漏登记会让 APK 白屏在启动页。
// 末尾的校验会检查所有 import 是否都能在包内找到。
for (const filename of ['easter.mjs', 'extension-host.mjs', 'song-id.mjs', 'features.mjs', 'local-library.mjs', 'shuffle.mjs', 'netease-core.mjs', 'playback.mjs', 'classify.mjs', 'languages.mjs', 'language-service.mjs', 'lyrics.mjs', 'library.mjs', 'queue-session.mjs', 'listening-session.mjs', 'collection.mjs', 'search.mjs', 'appearance.mjs', 'avatar.mjs', 'plugins.mjs']) {
  await cp(path.join(root, 'src', filename), path.join(destination, 'src', filename));
}
for (const filename of ['NETEASE-LICENSE.txt', 'APACHE-LICENSE.txt', 'NOTICE.txt']) await cp(path.join(root, 'android', filename), path.join(destination, 'licenses', filename));
await cp(path.join(root, 'LICENSE'), path.join(destination, 'licenses', 'SUITING-LICENSE.txt'));
let html = await readFile(path.join(destination, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="/appearance.css">', '<link rel="stylesheet" href="/mobile-native.css">\n  <link rel="stylesheet" href="/appearance.css">');
html = html.replace('src="/app.mjs"', 'src="/mobile-bootstrap.mjs"');
await writeFile(path.join(destination, 'index.html'), html);

// 防白屏自检：包内每个模块的相对/绝对 import 都必须能在打包目录里解析到。
const scripts = (await readdir(destination, { recursive: true })).filter(name => name.endsWith('.mjs'));
const problems = [];
for (const name of scripts) {
  const full = path.join(destination, name);
  const source = await readFile(full, 'utf8');
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec.startsWith('node:')) { problems.push(`${name} 引用了浏览器不可用的 ${spec}`); continue; }
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    // 浏览器按 URL 语义解析：/mobile-api.mjs 里的 '../src/x.mjs' 指向 /src/x.mjs。
    const urlPath = '/' + name.split(path.sep).join('/');
    const resolved = spec.startsWith('/') ? spec : path.posix.resolve(path.posix.dirname(urlPath), spec);
    const target = path.join(destination, resolved);
    if (!existsSync(target)) problems.push(`${name} 引用了缺失的 ${spec}`);
  }
}
if (problems.length) {
  process.stderr.write(`Android 资源自检失败：\n- ${[...new Set(problems)].join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write(`Android assets prepared from current sources; ${scripts.length} modules verified, no missing imports.\n`);
