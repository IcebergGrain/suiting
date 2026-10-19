import { generateQueue } from '/src/shuffle.mjs';

self.onmessage = event => {
  try { self.postMessage({ ok: true, result: generateQueue(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error.message || '随机队列生成失败，请重试。' }); }
};
