package io.suiting.music;

import android.app.AppOpsManager;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.input.InputManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@UnstableApi
public final class DesktopLyrics {
    private final Context context;
    private final ExoPlayer player;
    private final NetEaseClient client;
    private final WindowManager windows;
    private final SharedPreferences preferences;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, NativeLyricTimeline> cache = new LinkedHashMap<String, NativeLyricTimeline>(24, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, NativeLyricTimeline> eldest) { return size() > 20; }
    };
    private final AppOpsManager operations;
    private final AppOpsManager.OnOpChangedListener permissionListener;
    private OverlaySettings settings;
    private LinearLayout root;
    private LinearLayout controls;
    private TextView title;
    private TextView lyric;
    private TextView translation;
    private TextView nextLyric;
    private Button lock;
    private WindowManager.LayoutParams layout;
    private NativeLyricTimeline timeline = NativeLyricTimeline.empty("正在获取歌词…");
    private String songId = "";
    private Future<?> request;
    private long generation;
    private boolean destroyed;
    private long previewUntil;
    private String lastError = "";
    private long editUntil;

    public DesktopLyrics(Context context, ExoPlayer player, NetEaseClient client) {
        this.context = context; this.player = player; this.client = client;
        windows = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        preferences = context.getSharedPreferences("desktop-lyrics", Context.MODE_PRIVATE);
        try {
            settings = new OverlaySettings(preferences.getBoolean("enabled", false), true, preferences.getInt("fontSize", 22), preferences.getFloat("opacity", 0.8f), preferences.getString("alignment", "center"), preferences.getInt("lines", 1), preferences.getBoolean("showTranslation", true), preferences.getInt("widthPercent", 72));
        } catch (RuntimeException invalid) { settings = OverlaySettings.defaults(); }
        operations = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        permissionListener = (operation, packageName) -> {
            if (context.getPackageName().equals(packageName)) handler.post(() -> { if (!destroyed) checkPermission(); });
        };
        try { operations.startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, context.getPackageName(), permissionListener); }
        catch (RuntimeException ignored) {}
        checkPermission();
        handler.post(tick);
    }

    public boolean permission() {
        try { return Settings.canDrawOverlays(context); }
        catch (RuntimeException unavailable) { return false; }
    }

    public JSONObject status() throws Exception {
        checkPermission();
        MediaItem current = player.getCurrentMediaItem();
        boolean visible = root != null && root.isAttachedToWindow() && root.isShown();
        return settings.status(permission()).put("visible", visible).put("hasTrack", current != null)
            .put("showControls", false).put("controlsVisible", false)
            .put("touchThrough", settings.locked).put("editSeconds", Math.max(0, (editUntil - SystemClock.elapsedRealtime() + 999) / 1000))
            .put("testing", previewUntil > System.currentTimeMillis()).put("error", lastError)
            .put("state", OverlayState.describe(permission(), settings.enabled, current != null, visible, screenHidden(), previewUntil > System.currentTimeMillis(), lastError));
    }

    public JSONObject enable(JSONObject parameters) throws Exception {
        Object enabled = parameters.get("enabled");
        if (!(enabled instanceof Boolean)) throw new IllegalArgumentException("Invalid desktop lyrics switch");
        lastError = "";
        settings = settings.withEnabled((Boolean) enabled && permission());
        save();
        if (!settings.enabled) stop();
        else update();
        return status();
    }

    public JSONObject testWindow() throws Exception {
        lastError = "";
        if (!permission()) return status();
        previewUntil = System.currentTimeMillis() + 10000;
        update();
        return status();
    }

    private boolean screenHidden() {
        KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return keyguard != null && keyguard.isKeyguardLocked() || power != null && !power.isInteractive();
    }

    public JSONObject style(JSONObject parameters) throws Exception {
        if (parameters.has("resetPosition") && !(parameters.get("resetPosition") instanceof Boolean)) throw new IllegalArgumentException("Invalid position reset");
        OverlaySettings next = settings.update(parameters);
        if (parameters.has("locked")) {
            editUntil = next.locked ? 0 : SystemClock.elapsedRealtime() + 20000;
            if (!next.locked && (!next.enabled || player.getCurrentMediaItem() == null)) previewUntil = System.currentTimeMillis() + 20000;
        }
        settings = next;
        if (parameters.optBoolean("resetPosition", false)) {
            DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            int width = OverlayGeometry.width(metrics.widthPixels, pixels(180), settings.widthPercent);
            preferences.edit().putInt("x", (metrics.widthPixels - width) / 2).putInt("y", pixels(120)).apply();
            if (layout != null) { layout.x = (metrics.widthPixels - width) / 2; layout.y = pixels(120); }
        }
        save(); applyStyle(); update();
        return status();
    }

    private void save() {
        preferences.edit().putBoolean("enabled", settings.enabled).putBoolean("locked", settings.locked).putInt("fontSize", settings.fontSize).putFloat("opacity", (float) settings.opacity).putString("alignment", settings.alignment).putInt("lines", settings.lines).putBoolean("showTranslation", settings.showTranslation).putInt("widthPercent", settings.widthPercent).apply();
    }

    private void checkPermission() {
        if (!permission()) {
            if (settings.enabled) { settings = settings.withEnabled(false); save(); }
            stop();
        }
    }

    private int pixels(float dp) { return Math.round(dp * context.getResources().getDisplayMetrics().density); }

    private void createWindow() {
        if (root != null || (!settings.enabled && previewUntil <= System.currentTimeMillis()) || !permission()) return;
        root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pixels(8), pixels(4), pixels(8), pixels(4));
        root.setElevation(pixels(6));
        root.setContentDescription("随听桌面歌词，歌词文字穿透点击，播放器可直接开关和调整");
        controls = new LinearLayout(context);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        title = new DragHandle(context);
        title.setTextSize(13); title.setTextColor(Color.rgb(214, 234, 221));
        title.setSingleLine(true); title.setEllipsize(TextUtils.TruncateAt.END);
        title.setMinHeight(pixels(48)); title.setGravity(Gravity.CENTER_VERTICAL);
        title.setContentDescription("拖动标题或歌词调整位置，20秒后自动锁定穿透");
        controls.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        lock = button("完成", "完成调整并恢复穿透点击");
        lock.setOnClickListener(view -> {
                try { style(new JSONObject().put("locked", true)); } catch (Exception ignored) {}
        });
        controls.addView(lock);
        Button close = button("关闭", "关闭桌面歌词，音乐继续播放");
        close.setOnClickListener(view -> {
            lastError = ""; settings = settings.withEnabled(false); save(); stop();
        });
        controls.addView(close);
        root.addView(controls);
        lyric = new DragHandle(context);
        lyric.setTextColor(Color.rgb(199, 243, 211)); lyric.setMaxLines(1); lyric.setEllipsize(TextUtils.TruncateAt.END);
        lyric.setShadowLayer(pixels(2), 0, pixels(1), Color.BLACK);
        root.addView(lyric, new LinearLayout.LayoutParams(-1, -2));
        translation = new DragHandle(context);
        translation.setTextColor(Color.WHITE); translation.setMaxLines(1); translation.setEllipsize(TextUtils.TruncateAt.END);
        translation.setShadowLayer(pixels(2), 0, pixels(1), Color.BLACK);
        root.addView(translation, new LinearLayout.LayoutParams(-1, -2));
        nextLyric = new DragHandle(context);
        nextLyric.setTextColor(Color.rgb(180, 203, 187)); nextLyric.setMaxLines(1); nextLyric.setEllipsize(TextUtils.TruncateAt.END);
        nextLyric.setShadowLayer(pixels(2), 0, pixels(1), Color.BLACK);
        root.addView(nextLyric, new LinearLayout.LayoutParams(-1, -2));
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        layout = new WindowManager.LayoutParams(OverlayGeometry.width(metrics.widthPixels, pixels(180), settings.widthPercent), -2,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
        layout.gravity = Gravity.TOP | Gravity.START;
        layout.x = preferences.getInt("x", (metrics.widthPixels - layout.width) / 2);
        layout.y = preferences.getInt("y", pixels(120));
        clampPosition();
        applyStyle();
        try { windows.addView(root, layout); }
        catch (RuntimeException unavailable) { failWindow(); }
    }

    private final class DragHandle extends TextView {
        private float startX;
        private float startY;
        private int windowX;
        private int windowY;
        private boolean moved;

        DragHandle(Context context) { super(context); setClickable(true); }

        @Override public boolean onTouchEvent(MotionEvent event) {
            if (!OverlayGeometry.editing(settings.locked, editUntil, SystemClock.elapsedRealtime()) || layout == null) return false;
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startX = event.getRawX(); startY = event.getRawY(); windowX = layout.x; windowY = layout.y; moved = false; return true;
                case MotionEvent.ACTION_MOVE:
                    float deltaX = event.getRawX() - startX;
                    float deltaY = event.getRawY() - startY;
                    if (Math.abs(deltaX) + Math.abs(deltaY) > pixels(4)) moved = true;
                    int horizontalDirection = context.getResources().getConfiguration().getLayoutDirection() == View.LAYOUT_DIRECTION_RTL ? -1 : 1;
                    layout.x = windowX + horizontalDirection * Math.round(deltaX); layout.y = windowY + Math.round(deltaY);
                    clampPosition(); updateLayout(); return true;
                case MotionEvent.ACTION_UP:
                    preferences.edit().putInt("x", layout.x).putInt("y", layout.y).apply();
                    if (!moved) performClick();
                    return true;
                case MotionEvent.ACTION_CANCEL: return true;
                default: return super.onTouchEvent(event);
            }
        }

        @Override public boolean performClick() { super.performClick(); return true; }
    }

    private Button button(String text, String description) {
        Button result = new Button(context);
        result.setText(text); result.setTextSize(12); result.setTextColor(Color.WHITE);
        result.setContentDescription(description);
        result.setBackgroundColor(Color.TRANSPARENT);
        result.setMinimumWidth(pixels(48)); result.setMinWidth(pixels(48)); result.setMinHeight(pixels(48));
        result.setPadding(pixels(6), 0, pixels(6), 0);
        return result;
    }

    private void applyStyle() {
        if (root == null) return;
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb((int) Math.round(235 * settings.opacity), 20, 35, 27));
        background.setCornerRadius(pixels(14));
        root.setBackground(background);
        lyric.setTextSize(settings.fontSize);
        translation.setTextSize(Math.max(14, settings.fontSize - 5));
        nextLyric.setTextSize(settings.fontSize);
        int alignment = settings.alignment.equals("left") ? Gravity.START : settings.alignment.equals("right") ? Gravity.END : Gravity.CENTER_HORIZONTAL;
        lyric.setGravity(alignment); translation.setGravity(alignment); nextLyric.setGravity(alignment);
        controls.setVisibility(settings.locked ? View.GONE : View.VISIBLE);
        layout.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
            | (settings.locked ? WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE : 0);
        float maximum = 0.8f;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            InputManager input = (InputManager) context.getSystemService(Context.INPUT_SERVICE);
            if (input != null) maximum = input.getMaximumObscuringOpacityForTouch();
        }
        layout.alpha = OverlayGeometry.touchSafeAlpha(maximum);
        clampPosition(); updateLayout();
    }

    private void clampPosition() {
        if (layout == null) return;
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        layout.width = OverlayGeometry.width(metrics.widthPixels, pixels(180), settings.widthPercent);
        layout.x = OverlayGeometry.clamp(layout.x, metrics.widthPixels, layout.width);
        int height = root != null && root.getHeight() > 0 ? root.getHeight() : pixels(settings.locked ? 80 : 140);
        layout.y = OverlayGeometry.clamp(layout.y, metrics.heightPixels - pixels(48), height);
    }

    private void updateLayout() {
        if (root == null || !root.isAttachedToWindow()) return;
        try { windows.updateViewLayout(root, layout); }
        catch (RuntimeException unavailable) { failWindow(); }
    }

    private void failWindow() {
        lastError = "系统拒绝创建悬浮窗。请检查「显示在其他应用上层」；红米/HyperOS 还可能需要允许后台弹出界面。";
        settings = settings.withEnabled(false); save(); stop();
    }

    private void hide() {
        if (root != null) {
            try { windows.removeViewImmediate(root); } catch (RuntimeException ignored) {}
            root = null; controls = null; title = null; lyric = null; translation = null; nextLyric = null; lock = null; layout = null;
        }
    }

    public void stop() {
        finishEditing();
        previewUntil = 0;
        generation++;
        if (request != null) { request.cancel(true); request = null; }
        songId = ""; timeline = NativeLyricTimeline.empty("暂无歌词"); cache.clear(); hide();
    }

    private void load(String id) {
        songId = id;
        generation++;
        long expected = generation;
        if (request != null) request.cancel(true);
        NativeLyricTimeline cached = cache.get(id);
        if (cached != null) { timeline = cached; return; }
        timeline = NativeLyricTimeline.empty("正在获取歌词…");
        request = executor.submit(() -> {
            NativeLyricTimeline result;
            try {
                SuiTingApplication application=(SuiTingApplication)context.getApplicationContext();
                if(!application.features().enabled("lyrics") || !application.features().enabled("desktopLyrics")) throw new IllegalStateException("Lyrics disabled");
                JSONObject body = LocalLibrary.validId(id) ? application.localLibrary().lyrics(id) : client.call("lyric", new JSONObject().put("id", id)).getJSONObject("body");
                if (body.optInt("code", 200) != 200) throw new IllegalStateException("Lyrics unavailable");
                result = NativeLyricTimeline.fromResponse(body);
            } catch (Exception unavailable) { result = NativeLyricTimeline.empty("歌词暂不可用，音乐继续播放"); }
            NativeLyricTimeline loaded = result;
            handler.post(() -> {
                if (destroyed || generation != expected || !settings.enabled || !id.equals(songId) || !permission()) return;
                timeline = loaded; cache.put(id, loaded); update();
            });
        });
    }

    private void text(TextView target, String value) {
        if (!TextUtils.equals(target.getText(), value)) target.setText(value);
    }

    private void update() {
        PublicFeatures features=((SuiTingApplication)context.getApplicationContext()).features();
        if(!features.enabled("desktopLyrics") || !features.enabled("lyrics")) { hide();return; }
        if (!settings.locked && !OverlayGeometry.editing(settings.locked, editUntil, SystemClock.elapsedRealtime())) finishEditing();
        boolean testing = previewUntil > System.currentTimeMillis();
        if (destroyed || (!settings.enabled && !testing)) { hide(); return; }
        checkPermission();
        if (!settings.enabled && !testing) return;
        if (screenHidden()) { hide(); return; }
        if (testing) {
            createWindow();
            if (root != null) {
                text(title, "拖动歌词 · " + Math.max(1, (editUntil - SystemClock.elapsedRealtime() + 999) / 1000) + "秒");
                text(lyric, "切到手机桌面，检查这行是否还在");
                text(translation, "文字穿透点击；播放器可直接开关或调整");
                translation.setVisibility(settings.showTranslation ? View.VISIBLE : View.GONE);
                text(nextLyric, "下一行歌词会显示在这里");
                nextLyric.setVisibility(settings.lines == 2 ? View.VISIBLE : View.GONE);
            }
            return;
        }
        MediaItem current = player.getCurrentMediaItem();
        if (current == null || player.getPlaybackState() == Player.STATE_IDLE || player.getPlaybackState() == Player.STATE_ENDED) {
            if (root != null || !songId.isEmpty()) stop();
            return;
        }
        if (!current.mediaId.equals(songId)) load(current.mediaId);
        createWindow();
        if (root == null) return;
        String name = current.mediaMetadata.title == null ? "随听桌面歌词" : current.mediaMetadata.title.toString();
        text(title, "拖动歌词 · " + Math.max(1, (editUntil - SystemClock.elapsedRealtime() + 999) / 1000) + "秒");
        int index = timeline.indexAt(player.getCurrentPosition());
        String currentText = timeline.lines.isEmpty() ? timeline.fallback : index < 0 ? "前奏 · " + name : timeline.lines.get(index).text;
        String translated = index < 0 || timeline.lines.isEmpty() ? "" : timeline.lines.get(index).translation;
        text(lyric, currentText); text(translation, translated);
        translation.setVisibility(settings.showTranslation && !translated.isEmpty() ? View.VISIBLE : View.GONE);
        String following = index + 1 >= 0 && index + 1 < timeline.lines.size() ? timeline.lines.get(index + 1).text : "";
        text(nextLyric, following);
        nextLyric.setVisibility(settings.lines == 2 && !following.isEmpty() ? View.VISIBLE : View.GONE);
        int previousX = layout.x;
        int previousY = layout.y;
        int previousWidth = layout.width;
        clampPosition();
        if (previousX != layout.x || previousY != layout.y || previousWidth != layout.width) updateLayout();
    }


    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            try { update(); } catch (RuntimeException unavailable) { failWindow(); }
            handler.postDelayed(this, settings.enabled || previewUntil > System.currentTimeMillis() ? 250 : 1000);
        }
    };

    private void finishEditing() {
        editUntil = 0;
        if (settings.locked) return;
        try { settings = settings.update(new JSONObject().put("locked", true)); save(); applyStyle(); }
        catch (Exception ignored) { hide(); }
    }

    public void destroy() {
        destroyed = true; stop(); handler.removeCallbacksAndMessages(null); executor.shutdownNow();
        try { operations.stopWatchingMode(permissionListener); } catch (RuntimeException ignored) {}
    }
}
