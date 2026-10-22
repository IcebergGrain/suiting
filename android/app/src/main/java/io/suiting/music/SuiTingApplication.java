package io.suiting.music;

import android.app.Application;

public final class SuiTingApplication extends Application {
    private NetEaseClient client;
    private LocalLikes localLikes;
    private LocalLibrary localLibrary;
    private PublicFeatures features;
    public LocalLibrary localLibrary() { return localLibrary; }
    public PublicFeatures features() { return features; }

    @Override public void onCreate() {
        super.onCreate();
        // 登录状态用 Keystore 加密存本机：进程被杀、手机重启后自动恢复；
        // 退出登录或卸载应用会一并清除。系统备份与设备迁移已在 Manifest 关闭。
        features = new PublicFeatures(this);
        localLibrary = new LocalLibrary(this);
        client = new NetEaseClient(new SessionStore(this));
        client.setNetworkPermission(() -> features.enabled("netease"));
        android.content.SharedPreferences preferences = getSharedPreferences("local-likes", MODE_PRIVATE);
        localLikes = new LocalLikes(new LocalLikes.Store() {
            @Override public String load() { return preferences.getString("accounts", "{}"); }
            @Override public boolean save(String value) { return preferences.edit().putString("accounts", value).commit(); }
        }, System::currentTimeMillis);
    }

    public NetEaseClient client() {
        return client;
    }

    public LocalLikes localLikes() { return localLikes; }
}
