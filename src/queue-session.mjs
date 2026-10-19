import { playableSongs } from './library.mjs';

export async function loadGeneratedQueue(player, songs, queueId, autoplay = false) {
  const eligible = playableSongs(songs);
  if (!eligible.length) return { loaded: false, reason: '本批没有可播放的歌曲，未替换播放器。' };
  const accepted = await player.start(eligible, undefined, { queueId, autoplay });
  const current = player.snapshot();
  if (accepted === false || current.queueId !== queueId || current.count !== eligible.length) return { loaded: false, reason: current.error || '播放器没有确认接收新队列，请点「替换并播放本批」重试。' };
  return { loaded: true, count: eligible.length };
}
