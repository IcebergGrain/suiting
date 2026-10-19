const moods = ['gentle', 'bright', 'sad', 'energetic'];
const titles = {
  gentle: ['晚风来信', '窗边的一小片海', '月亮下班以后', '慢慢说晚安', '棉花云', '给春天留个座位', '房间里的森林', '雨停在七点', '柔软着陆'],
  bright: ['今天也去散步', '橘子味的星期天', '晴天便利店', '把烦恼晾起来', '微风恰好', '绕远路回家', '一口夏天', '好天气练习', '走向有光的地方'],
  sad: ['空座位', '未寄出的明信片', '凌晨的最后一班车', '灰色星期二', '留在雨里', '说到这里', '潮汐退去以后', '旧街道', '一个人的散场'],
  energetic: ['出发之前', '跑过红绿灯', '城市不打烊', '重力以外', '冲出回声', '下一站日出', '心跳加一拍', '把音量打开', '夜行电台']
};
export const demoPlaylist = { id: 'demo', name: '一间小小的唱片店', owner: '随听示例', trackCount: 36, demo: true, syncedAt: null };
export const demoSongs = moods.flatMap((mood, group) => titles[mood].map((title, index) => ({
  id: `demo-${group}-${index}`, title, artist: ['回声练习室', '白日信箱', '漫游电台'][index % 3],
  album: '为原型编写的合成示例', playlistIds: ['demo'], localMood: mood,
  localEnergy: [22, 48, 25, 78][group] + index * 2, demo: true,
  localTags: ['合成示例'], duration: 190000 + index * 7000
})));
