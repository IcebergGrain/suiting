import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { AppError, upstreamError, createNetEaseService as createCoreService } from './netease-core.mjs';

export { AppError };
const operations = new Set(['login_qr_key', 'login_qr_check', 'login_status', 'user_playlist', 'playlist_detail', 'song_detail', 'song_url', 'song_url_v1', 'song_wiki_info', 'cloudsearch', 'lyric', 'recommend_songs', 'recommend_resource', 'likelist', 'like', 'playlist_create', 'playlist_tracks', 'song_order_update']);

if (!isMainThread && workerData?.mixtapeNetEaseWorker) {
  try {
    if (!operations.has(workerData.operation)) throw new Error('Unsupported operation');
    const require = createRequire(import.meta.url);
    const api = require('@neteasecloudmusicapienhanced/api');
    const result = await api[workerData.operation](workerData.parameters);
    parentPort.postMessage({ ok: true, result: { status: result.status, body: result.body, cookie: result.cookie } });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: Number(error?.body?.code) || Number(error?.status) || 502 });
  }
}

export function createPackageUpstream({ timeoutMs = 15_000 } = {}) {
  return Object.fromEntries([...operations].map(operation => [operation, parameters => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { mixtapeNetEaseWorker: true, operation, parameters: { ...parameters, timeout: timeoutMs } },
      execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')),
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new AppError('网易云响应超时，请稍后重试。', 'UPSTREAM_TIMEOUT', 504)), timeoutMs + 2000);
    worker.once('message', message => {
      if (message.ok) finish(null, message.result);
      else finish(upstreamError(message.code));
    });
    worker.once('error', () => finish(new AppError('网易云连接失败，请稍后重试。')));
    worker.once('exit', () => finish(new AppError('网易云连接已中断，请稍后重试。')));
  })]));
}

export function createNetEaseService(options = {}) {
  // 允许调用方显式传 upstream: undefined（例如 createApp 的解构默认值），
  // 这种键不能覆盖真正的上游实现，否则所有接口都会变成 TypeError。
  const provided = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  return createCoreService({
    upstream: createPackageUpstream(),
    qrImage: async url => (await import('qrcode')).default.toDataURL(url, { width: 320, margin: 2 }),
    ...provided,
  });
}
