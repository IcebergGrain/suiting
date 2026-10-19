package io.suiting.music;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@UnstableApi
public final class PlaybackService extends MediaSessionService {
    public static final String LOCAL_BIND = "io.suiting.music.LOCAL_PLAYBACK";
    private final IBinder binder = new LocalBinder();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, JSONObject> sources = new ConcurrentHashMap<>();
    private ExoPlayer player;
    private MediaSession session;
    private DesktopLyrics desktopLyrics;
    private SharedPreferences journal;
    private JSONArray heard = new JSONArray();
    private String quality = "exhigh";
    private String error = "";
    private long lastPosition;
    private long lastClock;
    private long heardMillis;
    private boolean recorded;
    private boolean rebuilding;
    private volatile long sourceGeneration;
    private String queueId = "";
    public void refreshLyrics() { if(desktopLyrics!=null) desktopLyrics.stop(); }
    public void featuresChanged() {
        SuiTingApplication application=(SuiTingApplication)getApplication();
        if(!application.features().enabled("netease")) { sourceGeneration++; sources.clear(); for(int index=player.getMediaItemCount()-1;index>=0;index--) if(!LocalLibrary.validId(player.getMediaItemAt(index).mediaId)) player.removeMediaItem(index); }
        if(!application.features().enabled("desktopLyrics") || !application.features().enabled("lyrics")) { try {desktopLyrics.enable(new JSONObject().put("enabled",false));} catch(Exception ignored) {desktopLyrics.stop();} }
    }
    private volatile java.util.Set<String> blocked = java.util.Collections.emptySet();

    public final class LocalBinder extends Binder {
        public PlaybackService service() { return PlaybackService.this; }
    }

    @Override public void onCreate() {
        super.onCreate();
        journal = getSharedPreferences("playback-journal", MODE_PRIVATE);
        try { heard = new JSONArray(journal.getString("heard", "[]")); } catch (Exception ignored) {}
        try { blocked = PlaybackRules.blockedIds(new JSONArray(journal.getString("blocked", "[]"))); } catch (Exception ignored) {}
        ResolvingDataSource.Factory factory = new ResolvingDataSource.Factory(
            new DefaultDataSource.Factory(this, new DefaultHttpDataSource.Factory().setUserAgent("SuiTing/0.1.1-public").setConnectTimeoutMs(15000).setReadTimeoutMs(20000).setAllowCrossProtocolRedirects(false)),
            dataSpec -> {
                Uri uri = dataSpec.uri;
                long generation = sourceGeneration;
                try {
                    if (!"suiting-song".equals(uri.getScheme()) || !"track".equals(uri.getHost())) throw new IllegalArgumentException("Invalid source");
                    String id = PlaybackSource.songId(uri.getLastPathSegment());
                    if (blocked.contains(id)) throw new IOException("Blocked song");
                    if (LocalLibrary.validId(id)) { sources.put(id+":"+quality,((SuiTingApplication)getApplication()).localLibrary().preview(id)); return dataSpec.withUri(((SuiTingApplication)getApplication()).localLibrary().resolve(id)); }
                    if (!((SuiTingApplication)getApplication()).features().enabled("netease")) throw new IOException("网易云插件已关闭");
                    String level = PlaybackSource.quality(uri.getQueryParameter("quality"));
                    String key = id + ":" + level;
                    JSONObject source = sources.get(key);
                    if (source == null || source.getLong("expiresAt") <= System.currentTimeMillis()) {
                        JSONObject response = ((SuiTingApplication) getApplication()).client().call("song_url_v1", new JSONObject().put("id", id).put("level", level));
                        source = PlaybackSource.parse(response, id, level);
                        if (generation != sourceGeneration) throw new IOException("Playback changed");
                        if (sources.size() >= 100) sources.clear();
                        sources.put(key, source);
                    }
                    if (blocked.contains(id)) throw new IOException("Blocked song");
                    return dataSpec.withUri(Uri.parse(source.getString("url")));
                } catch (Exception unavailable) { throw new IOException("音频不可用：本地文件可能已移动或撤权，平台歌曲需检查网络及授权。"); }
            });
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new ProgressiveMediaSource.Factory(factory))
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_LOCAL).build();
        player.setVolume(0.7f);
        try { String mode = journal.getString("mode", "order"); player.setRepeatMode(PlaybackRules.repeatMode(mode)); player.setShuffleModeEnabled(mode.equals("shuffle")); } catch (Exception ignored) {}
        player.addListener(new Player.Listener() {
            @Override public void onMediaItemTransition(MediaItem item, int reason) {
                if (!rebuilding) { heardMillis = 0; recorded = false; }
                error = ""; resetClock();
            }
            @Override public void onPositionDiscontinuity(Player.PositionInfo previous, Player.PositionInfo current, int reason) { resetClock(); }
            @Override public void onIsPlayingChanged(boolean playing) { resetClock(); }
            @Override public void onRepeatModeChanged(int mode) { journal.edit().putString("mode", PlaybackRules.modeName(mode, player.getShuffleModeEnabled())).apply(); }
            @Override public void onShuffleModeEnabledChanged(boolean enabled) { journal.edit().putString("mode", PlaybackRules.modeName(player.getRepeatMode(), enabled)).apply(); }
            @Override public void onPlayerError(PlaybackException failure) {
                player.pause();
                error = "播放未完成：文件已移动、授权失效或设备不支持解码。请重新选择音频或检查平台授权。";
            }
        });
        PendingIntent activity = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this, player).setSessionActivity(activity).setCallback(new MediaSession.Callback() {
            @Override public MediaSession.ConnectionResult onConnect(MediaSession mediaSession, MediaSession.ControllerInfo controller) {
                if (controller.getUid() != android.os.Process.myUid() && !controller.isTrusted() && !mediaSession.isMediaNotificationController(controller)) return MediaSession.ConnectionResult.reject();
                Player.Commands commands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                    .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS).remove(Player.COMMAND_SET_MEDIA_ITEM).build();
                return new MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession).setAvailablePlayerCommands(commands).build();
            }
        }).build();
        addSession(session);
        desktopLyrics = new DesktopLyrics(this, player, ((SuiTingApplication) getApplication()).client());
        handler.post(tick);
    }

    @Override public IBinder onBind(Intent intent) {
        return LOCAL_BIND.equals(intent.getAction()) ? binder : super.onBind(intent);
    }

    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }

    public JSONObject overlayCommand(String operation, JSONObject arguments) throws Exception {
        if ((!((SuiTingApplication)getApplication()).features().enabled("desktopLyrics") || !((SuiTingApplication)getApplication()).features().enabled("lyrics")) && !operation.equals("overlay_status")) throw new IllegalStateException("请先开启歌词与桌面歌词插件。");
        if (desktopLyrics == null) throw new IllegalStateException("Desktop lyrics not ready");
        switch (operation) {
            case "overlay_status": return desktopLyrics.status();
            case "overlay_enable": return desktopLyrics.enable(arguments);
            case "overlay_style": return desktopLyrics.style(arguments);
            case "overlay_test": return desktopLyrics.testWindow();
            default: throw new IllegalArgumentException("Unknown desktop lyrics operation");
        }
    }

    private MediaItem item(JSONObject track) throws Exception {
        String id = PlaybackSource.songId(track.getString("id"));
        String title = track.optString("title", "未知歌曲");
        String artist = track.optString("artist", "未知歌手");
        MediaMetadata.Builder metadata = new MediaMetadata.Builder().setTitle(title.substring(0, Math.min(300, title.length()))).setArtist(artist.substring(0, Math.min(300, artist.length())));
        String cover = track.optString("cover");
        if (BridgePolicy.mediaUrlAllowed(cover)) metadata.setArtworkUri(Uri.parse(cover));
        return new MediaItem.Builder().setMediaId(id).setUri("suiting-song://track/" + id + "?quality=" + quality).setMediaMetadata(metadata.build()).build();
    }

    public JSONObject command(String operation, JSONObject arguments) throws Exception {
        switch (operation) {
            case "player_queue": {
                QueueRequest options = new QueueRequest(arguments);
                JSONArray queue = arguments.getJSONArray("queue");
                int index = arguments.getInt("index");
                if (queue.length() < 1 || queue.length() > 5000 || index < 0 || index >= queue.length()) throw new IllegalArgumentException("Invalid queue");
                String nextQuality = PlaybackSource.quality(arguments.optString("quality", quality));
                String previousQuality = quality; quality = nextQuality;
                List<MediaItem> items = new ArrayList<>();
                try { for (int cursor = 0; cursor < queue.length(); cursor++) {
                    JSONObject track = queue.getJSONObject(cursor);
                    if (blocked.contains(track.getString("id"))) throw new IllegalArgumentException("Blocked song");
                    items.add(item(track));
                } }
                catch (Exception invalid) { quality = previousQuality; throw invalid; }
                sourceGeneration++; sources.clear(); queueId = options.queueId;
                error = ""; heardMillis = 0; recorded = false;
                player.setPlayWhenReady(false); player.setMediaItems(items, index, 0); player.prepare(); player.setPlayWhenReady(options.autoplay); break;
            }
            case "player_play":
                error = "";
                if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                if (player.getPlayerError() != null || player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                player.play(); break;
            case "player_pause": player.pause(); break;
            case "player_mode": {
                String mode = arguments.getString("mode");
                PlaybackRules.repeatMode(mode);
                player.setShuffleModeEnabled(mode.equals("shuffle"));
                player.setRepeatMode(PlaybackRules.repeatMode(mode));
                journal.edit().putString("mode", mode).apply(); break;
            }
            case "player_blocked": return new JSONObject().put("ids", new JSONArray(blocked));
            case "player_blocklist": {
                blocked = PlaybackRules.blockedIds(arguments.getJSONArray("ids"));
                journal.edit().putString("blocked", new JSONArray(blocked).toString()).apply();
                for (int index = player.getMediaItemCount() - 1; index >= 0; index--) if (blocked.contains(player.getMediaItemAt(index).mediaId)) player.removeMediaItem(index);
                sources.keySet().removeIf(key -> blocked.contains(key.substring(0, key.indexOf(':'))));
                if (player.getMediaItemCount() == 0) { player.pause(); player.stop(); desktopLyrics.stop(); }
                break;
            }
            case "player_next": if (player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.prepare(); player.play(); } break;
            case "player_previous": if (player.hasPreviousMediaItem()) { player.seekToPreviousMediaItem(); player.prepare(); player.play(); } else player.seekTo(0); break;
            case "player_seek": {
                double seconds = arguments.getDouble("seconds");
                long duration = player.getDuration();
                if (!Double.isFinite(seconds) || duration == C.TIME_UNSET || duration <= 0) throw new IllegalArgumentException("Seek unavailable");
                player.seekTo(Math.max(0, Math.min(duration, (long) (seconds * 1000)))); resetClock(); break;
            }
            case "player_quality": {
                String level = PlaybackSource.quality(arguments.getString("quality"));
                if (!level.equals(quality)) {
                    quality = level; sourceGeneration++; sources.clear();
                    if (player.getMediaItemCount() > 0) {
                        List<MediaItem> items = new ArrayList<>();
                        for (int cursor = 0; cursor < player.getMediaItemCount(); cursor++) items.add(player.getMediaItemAt(cursor).buildUpon().setUri("suiting-song://track/" + player.getMediaItemAt(cursor).mediaId + "?quality=" + quality).build());
                        int index = player.getCurrentMediaItemIndex(); long position = player.getCurrentPosition(); boolean resume = player.getPlayWhenReady();
                        rebuilding = true; player.setMediaItems(items, index, position); rebuilding = false;
                        player.prepare(); player.setPlayWhenReady(resume); resetClock();
                    }
                }
                break;
            }
            case "player_volume": {
                double volume = arguments.getDouble("volume");
                if (!Double.isFinite(volume)) throw new IllegalArgumentException("Invalid volume");
                player.setVolume((float) Math.max(0, Math.min(1, volume))); break;
            }
            case "player_stop": sourceGeneration++; queueId = ""; error = ""; player.pause(); player.stop(); player.clearMediaItems(); sources.clear(); desktopLyrics.stop(); break;
            case "player_ack": {
                JSONArray ids = arguments.getJSONArray("ids");
                java.util.Set<String> acknowledged = new java.util.HashSet<>();
                for (int index = 0; index < Math.min(10000, ids.length()); index++) acknowledged.add(ids.optString(index));
                JSONArray remaining = new JSONArray();
                for (int index = 0; index < heard.length(); index++) if (!acknowledged.contains(heard.getJSONObject(index).getString("eventId"))) remaining.put(heard.getJSONObject(index));
                heard = remaining; saveJournal(); break;
            }
            case "player_clear_history": heard = new JSONArray(); saveJournal(); break;
            case "player_status": break;
            default: throw new IllegalArgumentException("Unknown player operation");
        }
        return status();
    }

    private JSONObject status() throws Exception {
        MediaItem current = player.getCurrentMediaItem();
        JSONObject track = current == null ? null : new JSONObject().put("id", current.mediaId).put("title", current.mediaMetadata.title).put("artist", current.mediaMetadata.artist).put("cover", current.mediaMetadata.artworkUri);
        JSONObject source = current == null ? null : sources.get(current.mediaId + ":" + quality);
        JSONObject info = source == null ? null : new JSONObject().put("requestedQuality", quality).put("actualLevel", source.opt("actualLevel")).put("bitrate", source.opt("bitrate")).put("format", source.opt("format"));
        long duration = player.getDuration();
        return new JSONObject().put("song", track == null ? JSONObject.NULL : track).put("queueId", queueId).put("index", player.getCurrentMediaItemIndex()).put("count", player.getMediaItemCount())
            .put("paused", current == null || !player.getPlayWhenReady() || player.getPlayerError() != null).put("loading", player.getPlaybackState() == Player.STATE_BUFFERING)
            .put("ended", player.getPlaybackState() == Player.STATE_ENDED).put("currentTime", player.getCurrentPosition() / 1000.0)
            .put("duration", duration > 0 && duration != C.TIME_UNSET ? duration / 1000.0 : 0).put("quality", quality).put("volume", player.getVolume()).put("mode", PlaybackRules.modeName(player.getRepeatMode(), player.getShuffleModeEnabled()))
            .put("canNext", player.hasNextMediaItem()).put("canPrevious", player.hasPreviousMediaItem())
            .put("info", info == null ? JSONObject.NULL : info).put("error", error).put("heard", pendingHeard());
    }

    private JSONArray pendingHeard() throws Exception {
        JSONArray batch = new JSONArray();
        for (int index = 0; index < Math.min(100, heard.length()); index++) batch.put(heard.getJSONObject(index));
        return batch;
    }

    private void resetClock() { lastClock = SystemClock.elapsedRealtime(); lastPosition = player.getCurrentPosition(); }
    private void saveJournal() { journal.edit().putString("heard", heard.toString()).apply(); }
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            long clock = SystemClock.elapsedRealtime(); long position = player.getCurrentPosition();
            if (player.isPlaying() && !recorded) {
                heardMillis += Math.max(0, Math.min(Math.min(clock - lastClock, position - lastPosition), 2000));
                if (heardMillis >= 15000 && player.getCurrentMediaItem() != null) {
                    try {
                        heard.put(new JSONObject().put("songId", player.getCurrentMediaItem().mediaId).put("playedAt", System.currentTimeMillis()).put("source", "native-player").put("eventId", UUID.randomUUID().toString()));
                        if (heard.length() > 10000) heard.remove(0);
                        saveJournal(); recorded = true;
                    } catch (Exception ignored) {}
                }
            }
            lastClock = clock; lastPosition = position; handler.postDelayed(this, 1000);
        }
    };

    @Override public void onDestroy() {
        handler.removeCallbacks(tick);
        if (desktopLyrics != null) desktopLyrics.destroy();
        if (session != null) session.release();
        if (player != null) player.release();
        sources.clear(); super.onDestroy();
    }
}
