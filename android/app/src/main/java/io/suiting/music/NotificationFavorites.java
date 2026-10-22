package io.suiting.music;

import android.content.Context;
import android.os.Bundle;
import android.widget.Toast;
import androidx.media3.common.MediaItem;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionError;
import androidx.media3.session.SessionResult;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;

@UnstableApi
public final class NotificationFavorites {
    public static final String ACTION = "io.suiting.music.NOTIFICATION_FAVORITE";
    public static final SessionCommand COMMAND = new SessionCommand(ACTION, Bundle.EMPTY);
    public static final String ACTION_LYRICS = "io.suiting.music.NOTIFICATION_LYRICS";
    public static final SessionCommand COMMAND_LYRICS = new SessionCommand(ACTION_LYRICS, Bundle.EMPTY);
    private final Context context;
    private final ExoPlayer player;
    private final NetEaseClient client;
    private final LocalLikes likes;
    private final DesktopLyrics lyrics;
    private final NotificationLyricsGate lyricsGate = new NotificationLyricsGate();
    private final NotificationLikeGate gate = new NotificationLikeGate();
    private MediaSession session;
    private NotificationLikeGate.Target target;
    private Boolean liked;
    private boolean destroyed;
    private long observedVersion = -1;
    private String accountId = "";
    private String controlsState = "";

    public NotificationFavorites(Context context, ExoPlayer player, NetEaseClient client, DesktopLyrics lyrics) {
        this.context = context; this.player = player; this.client = client;
        this.lyrics = lyrics;
        likes = ((SuiTingApplication) context.getApplicationContext()).localLikes();
    }

    public void attach(MediaSession session) { this.session = session; refresh(); }

    public void refresh() {
        if (destroyed || session == null) return;
        refreshLyrics();
        String configuration = features().enabled("netease") + ":" + lyricsAllowed();
        if (!configuration.equals(controlsState)) { controlsState = configuration; observedVersion = -1; }
        MediaItem current = player.getCurrentMediaItem();
        NotificationLikeGate.Target selected = gate.select(current == null ? "" : current.mediaId, client.sessionVersion());
        String account = client.accountId();
        if (selected == target && observedVersion == likes.version() && account.equals(accountId)) return;
        target = selected; accountId = account; observedVersion = likes.version();
        try { liked = NotificationControlPolicy.canLike(selected.id, features().enabled("netease")) && !account.isEmpty() && likes.liked(account, selected.id); }
        catch (Exception unavailable) { liked = null; }
        publish();
    }

    private void publish() {
        if (destroyed || session == null || target == null) return;
        if (player.getCurrentMediaItem() == null) { session.setMediaButtonPreferences(Collections.emptyList()); return; }
        List<CommandButton> buttons = new ArrayList<>();
        if (NotificationControlPolicy.canLike(target.id, features().enabled("netease"))) {
            Bundle extras = new Bundle();
            extras.putString("songId", target.id); extras.putLong("epoch", target.epoch); extras.putLong("revision", target.revision);
            extras.putString("accountId", accountId); extras.putLong("likesRevision", observedVersion);
            extras.putBoolean("liked", !Boolean.TRUE.equals(liked));
            String label = Boolean.TRUE.equals(liked) ? "暂存取消喜欢" : "暂存喜欢，稍后同步";
            CommandButton button = new CommandButton.Builder(Boolean.TRUE.equals(liked) ? CommandButton.ICON_HEART_FILLED : CommandButton.ICON_HEART_UNFILLED)
                .setDisplayName(label).setSessionCommand(new SessionCommand(ACTION, extras)).build();
            buttons.add(button);
        }
        if (lyricsAllowed()) {
            Bundle lyricsExtras = new Bundle();
            lyricsExtras.putLong("revision", lyricsGate.revision()); lyricsExtras.putBoolean("enabled", !lyricsGate.enabled());
            CommandButton lyricsButton = new CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                .setCustomIconResId(lyricsGate.enabled() ? R.drawable.ic_notification_lyrics : R.drawable.ic_notification_lyrics_off)
                .setDisplayName(lyricsGate.enabled() ? "关闭桌面歌词" : "开启桌面歌词")
                .setSessionCommand(new SessionCommand(ACTION_LYRICS, lyricsExtras)).build();
            buttons.add(lyricsButton);
        }
        session.setMediaButtonPreferences(buttons);
    }

    private PublicFeatures features() { return ((SuiTingApplication) context.getApplicationContext()).features(); }
    private boolean lyricsAllowed() { return NotificationControlPolicy.canShowLyrics(features().enabled("lyrics"), features().enabled("desktopLyrics")); }

    private void refreshLyrics() {
        try {
            org.json.JSONObject status = lyrics.status();
            if (lyricsGate.observe(status.optBoolean("enabled"), status.optBoolean("permission"))) publish();
        } catch (Exception unavailable) { if (lyricsGate.observe(false, false)) publish(); }
    }

    private ListenableFuture<SessionResult> lyricsCommand(Bundle request) {
        if (!lyricsAllowed()) {
            Toast.makeText(context, "请先在随听的功能插件中开启歌词与桌面歌词", Toast.LENGTH_LONG).show();
            return Futures.immediateFuture(new SessionResult(SessionError.ERROR_NOT_SUPPORTED));
        }
        refreshLyrics();
        if (!request.containsKey("enabled") || !lyricsGate.accepts(request.getLong("revision", -1), request.getBoolean("enabled"))) {
            Toast.makeText(context, lyricsGate.permission() ? "歌词状态已变化，请使用当前通知的歌词按钮" : "请先在随听中授权「显示在其他应用上层」", Toast.LENGTH_LONG).show();
            publish();
            return Futures.immediateFuture(new SessionResult(SessionError.ERROR_INVALID_STATE));
        }
        try {
            boolean desired = request.getBoolean("enabled");
            org.json.JSONObject result = lyrics.enable(new org.json.JSONObject().put("enabled", desired));
            refreshLyrics(); publish();
            if (result.optBoolean("enabled") != desired) throw new IllegalStateException("桌面歌词未开启，请在应用内检查悬浮窗权限");
            Toast.makeText(context, desired ? "桌面歌词已开启" : "桌面歌词已关闭", Toast.LENGTH_SHORT).show();
            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        } catch (Exception unavailable) {
            Toast.makeText(context, "歌词切换未完成，请在随听内检查权限后重试", Toast.LENGTH_LONG).show();
            return Futures.immediateFuture(new SessionResult(SessionError.ERROR_UNKNOWN));
        }
    }

    public ListenableFuture<SessionResult> command(SessionCommand command, Bundle arguments) {
        if (ACTION_LYRICS.equals(command.customAction) && !destroyed) {
            Bundle request = new Bundle(command.customExtras); request.putAll(arguments);
            return lyricsCommand(request);
        }
        if (!ACTION.equals(command.customAction) || destroyed) return Futures.immediateFuture(new SessionResult(SessionError.ERROR_NOT_SUPPORTED));
        Bundle request = new Bundle(command.customExtras); request.putAll(arguments);
        MediaItem current = player.getCurrentMediaItem();
        gate.select(current == null ? "" : current.mediaId, client.sessionVersion());
        String id = request.getString("songId", "");
        if (!NotificationControlPolicy.canLike(id, features().enabled("netease"))) return Futures.immediateFuture(new SessionResult(SessionError.ERROR_PERMISSION_DENIED));
        long epoch = request.getLong("epoch", -1);
        long revision = request.getLong("revision", -1);
        String account = client.accountId();
        if (!request.containsKey("liked") || account.isEmpty() || !account.equals(request.getString("accountId", "")) || request.getLong("likesRevision", -1) != likes.version() || !gate.begin(id, epoch, revision)) {
            refresh();
            Toast.makeText(context, account.isEmpty() ? "请先在随听连接网易云账号" : "歌曲或喜欢状态已变化，请使用当前通知的红心", Toast.LENGTH_SHORT).show();
            return Futures.immediateFuture(new SessionResult(SessionError.ERROR_INVALID_STATE));
        }
        boolean desired = request.getBoolean("liked");
        String title = current == null || current.mediaMetadata.title == null ? "当前歌曲" : current.mediaMetadata.title.toString();
        try {
            likes.stage(account, new org.json.JSONObject().put("id", id).put("title", title).put("artist", current == null ? "" : current.mediaMetadata.artist), desired);
            gate.invalidate();
            Toast.makeText(context, title + " · 已保存本机，稍后到「我的 → 喜欢同步」核对", Toast.LENGTH_SHORT).show();
            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        } catch (Exception unavailable) {
            Toast.makeText(context, "喜欢未保存成功，请回随听重试", Toast.LENGTH_LONG).show();
            return Futures.immediateFuture(new SessionResult(SessionError.ERROR_UNKNOWN));
        } finally { gate.finish(); refresh(); }
    }

    public void destroy() {
        destroyed = true; gate.select("", -1);
    }
}
