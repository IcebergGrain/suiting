package io.suiting.music;

import java.net.URI;
import java.util.Set;
import java.util.Arrays;
import java.util.HashSet;

public final class BridgePolicy {
    public static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final Set<String> SHARE_HOSTS = new HashSet<>(Arrays.asList("music.163.com", "y.music.163.com", "m.music.163.com", "163cn.tv", "www.163cn.tv"));
    private static final Set<String> OPERATIONS = new HashSet<>(Arrays.asList("login_qr_key", "login_qr_check", "login_status", "user_playlist", "playlist_detail", "song_detail", "song_url", "song_url_v1", "song_wiki_info", "cloudsearch", "lyric", "recommend_songs", "recommend_resource", "likelist", "like", "playlist_create", "playlist_tracks", "song_order_update", "share_redirect", "qr_image", "open_netease", "logout"));

    private BridgePolicy() {}

    public static boolean operationAllowed(String operation) {
        return OPERATIONS.contains(operation);
    }

    public static boolean trustedPage(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null;
        } catch (Exception error) { return false; }
    }

    public static boolean shareUrlAllowed(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && SHARE_HOSTS.contains(uri.getHost()) && uri.getUserInfo() == null && uri.getPort() == -1;
        } catch (Exception error) { return false; }
    }

    public static boolean externalLinkAllowed(String value) {
        try {
            URI uri = new URI(value);
            return shareUrlAllowed(value) && uri.getHost().endsWith("music.163.com") && (uri.getPath().matches("/(?:m/)?(?:song|playlist)(?:/[0-9]+)?/?") || uri.getFragment() != null && uri.getFragment().matches("/(?:song|playlist)\\?id=[0-9]+.*"));
        } catch (Exception error) { return false; }
    }

    public static boolean mediaUrlAllowed(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getPort() == -1 && host != null && (host.endsWith(".music.126.net") || host.endsWith(".music.163.com") || host.equals("music.163.com"));
        } catch (Exception error) { return false; }
    }
}
