export const exampleQueueProvider = {
  id: 'developer.reverse',
  name: '可信代码示例：反转本批顺序',
  version: '1.0.0',
  description: '演示异步队列扩展协议；不联网，不读取账户，不增加歌曲。默认未注册、未启用。',
  network: false,
  async transformQueue({ songs, signal }) {
    if (signal.aborted) throw new Error('Cancelled');
    return songs.map(song => song.id).reverse();
  },
};
