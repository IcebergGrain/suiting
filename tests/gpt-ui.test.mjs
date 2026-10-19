import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDaily, renderPersonal } from '../public/day-personal.mjs';
import { dailyCollectionId } from '../src/collection.mjs';

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function fixture(overrides = {}) {
  const tracks = [];
  const playlists = [];
  const state = {
    features: { desktopLyrics: true }, status: { loggedIn: true, profile: { userId: '42', nickname: '合成账号', avatarUrl: '' } },
    blacklist: {}, sources: [], profileSection: 'home', profileSearch: '', profileVisible: 60,
    daily: { accountId: '42', day: '2026-10-18', fetchedAt: Date.parse('2026-10-18T06:00:00Z'), playlists: [], warnings: [] },
    dailyLoading: false, dailyError: '', dailySection: 'songs', dailyVisible: 60,
    likesError: '', likesLoading: false, exportOpen: false, exportScope: 'queue',
    ...overrides,
  };
  const helpers = {
    escape,
    icon: name => `<svg data-icon="${escape(name)}"></svg>`,
    safeImage: value => /^https:\/\//.test(value || '') ? value : '',
    trackRow: (song, index, inLibrary) => {
      tracks.push({ song, index, inLibrary });
      return `<article data-song="${escape(song.id)}">${escape(song.title)}</article>`;
    },
    libraryPlaylistRow: source => {
      playlists.push(source);
      return `<article data-playlist="${escape(source.id)}">${escape(source.name)}</article>`;
    },
    overlayPanel: () => '<section data-overlay-panel></section>',
    queueSaver: () => '<section data-queue-saver></section>',
  };
  return { state, helpers, tracks, playlists };
}

test('daily signed-out view offers login without showing cached private recommendations or write controls', () => {
  const app = fixture({ status: { loggedIn: false, profile: null } });
  const html = renderDaily({ ...app, songs: [{ id: '1', title: '不应泄漏的缓存标题' }] });
  assert.match(html, /data-tab="sync"/);
  assert.doesNotMatch(html, /不应泄漏的缓存标题|data-action="play-daily"|data-action="refresh-daily"/);
  assert.equal(app.tracks.length, 0);
});

test('daily song view separates local collection and official likes, and excludes blacklist from playable count', () => {
  const app = fixture({ blacklist: { '2': { id: '2' } }, dailyVisible: 2 });
  const songs = [{ id: '1', title: '合成歌曲一' }, { id: '2', title: '合成歌曲二' }, { id: '3', title: '合成歌曲三' }];
  const before = JSON.stringify(songs);
  const html = renderDaily({ ...app, songs });
  assert.match(html, /播放日推 · 2 首/);
  assert.match(html, /「收藏」只收入本机我的收藏/);
  assert.match(html, /「喜欢到网易云」才会写入官方账号/);
  assert.match(html, /data-action="show-more-daily"/);
  assert.equal(app.tracks.length, 2);
  assert.ok(app.tracks.every(entry => entry.song.dailyRecommendation === true));
  assert.equal(JSON.stringify(songs), before);
});

test('daily account mismatch hides old song rows, playlist cards and warnings', () => {
  const app = fixture();
  app.state.daily = { ...app.state.daily, accountId: '43', warnings: ['旧账号的敏感错误'], playlists: [{ id: '81', name: '旧账号歌单' }] };
  const html = renderDaily({ ...app, songs: [{ id: '1', title: '旧账号歌曲' }] });
  assert.doesNotMatch(html, /旧账号的敏感错误|旧账号歌单|旧账号歌曲|data-action="play-daily"/);
  assert.equal(app.tracks.length, 0);
  assert.equal(app.playlists.length, 0);
});

test('daily nickname, errors and upstream warnings are HTML-escaped rather than executable markup', () => {
  const app = fixture({ dailyError: '<img src=x onerror=alert(1)>', likesError: '"<script>danger</script>' });
  app.state.status.profile.nickname = '<svg onload=alert(1)>';
  app.state.daily.warnings = ['<iframe src="bad"></iframe>'];
  const html = renderDaily({ ...app, songs: [] });
  assert.doesNotMatch(html, /<img src=x|<script>|<svg onload|<iframe/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&lt;script&gt;danger/);
  assert.match(html, /&lt;svg onload/);
  assert.match(html, /&lt;iframe/);
});

test('daily playlist cards retain recommended intent and remote track counts without mutating upstream data', () => {
  const app = fixture({ dailySection: 'playlists' });
  const playlist = { id: '81', name: '合成推荐歌单', trackCount: 127, owned: false };
  app.state.daily.playlists = [playlist];
  const html = renderDaily({ ...app, songs: [] });
  assert.match(html, /data-action="import-daily-playlist" data-id="81"/);
  assert.match(html, /只读导入，不等于在网易云账号收藏歌单/);
  assert.equal(app.playlists[0].trackCount, 127);
  assert.equal(app.playlists[0].recommended, true);
  assert.equal(Object.hasOwn(playlist, 'recommended'), false);
  assert.equal(Object.hasOwn(playlist, 'songs'), false);
});

test('personal home centralizes blacklist, collection and desktop lyric entry while escaping profile identity', () => {
  const app = fixture();
  app.state.status.profile.nickname = '"<script>not-executable</script>';
  const html = renderPersonal({ ...app, songs: [], native: true });
  assert.match(html, /data-action="profile-blacklist"/);
  assert.match(html, /data-action="profile-collection"/);
  assert.match(html, /data-action="profile-overlay"/);
  assert.match(html, /需要系统悬浮窗授权/);
  assert.match(html, /data-overlay-panel/);
  assert.doesNotMatch(html, /<script>not-executable/);
  assert.match(html, /&lt;script&gt;not-executable/);
});

test('personal avatar is local-only, validated and links directly to customization', () => {
  const app = fixture({ localAvatar: 'data:image/webp;base64,YWJjZA==' });
  const html = renderPersonal({ ...app, songs: [], native: false });
  assert.match(html, /data-action="profile-appearance" aria-label="自定义我的头像"/);
  assert.match(html, /src="data:image\/webp;base64,YWJjZA=="/);
  app.state.localAvatar = 'javascript:alert(1)';
  assert.doesNotMatch(renderPersonal({ ...app, songs: [], native: false }), /javascript:/);
});

test('personal blacklist search keeps reversible blocked rows in newest-first order without changing records', () => {
  const blacklist = {
    '1': { id: '1', title: '合成风一', artist: '甲', blockedAt: 10 },
    '2': { id: '2', title: '合成风二', artist: '乙', blockedAt: 20 },
    '3': { id: '3', title: '其他', artist: '丙', blockedAt: 30 },
  };
  const app = fixture({ blacklist, profileSection: 'blacklist', profileSearch: '合成风' });
  const before = JSON.stringify(blacklist);
  const html = renderPersonal({ ...app, songs: [], native: false });
  assert.match(html, /只在随听排除，不删除网易云歌曲/);
  assert.match(html, /data-action="profile-home"/);
  assert.deepEqual(app.tracks.map(entry => entry.song.id), ['2', '1']);
  assert.ok(app.tracks.every(entry => entry.song.blocked === true));
  assert.equal(JSON.stringify(blacklist), before);
});

test('personal collection displays only local members and renders export form only for collection scope', () => {
  const app = fixture({ profileSection: 'collection', exportOpen: true, exportScope: 'queue' });
  const songs = [{ id: '1', title: '日推收藏', artist: '甲', playlistIds: [dailyCollectionId] }, { id: '2', title: '其他曲库', artist: '乙', playlistIds: ['11'] }];
  const queueHtml = renderPersonal({ ...app, songs, native: false });
  assert.match(queueHtml, /data-action="export-collection"/);
  assert.doesNotMatch(queueHtml, /data-queue-saver/);
  assert.deepEqual(app.tracks.map(entry => entry.song.id), ['1']);
  assert.equal(app.tracks[0].inLibrary, true);
  app.state.exportScope = 'collection';
  assert.match(renderPersonal({ ...app, songs, native: false }), /data-queue-saver/);
});
