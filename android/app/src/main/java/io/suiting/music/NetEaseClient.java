package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Set;
import java.util.HashSet;
import java.util.zip.GZIPInputStream;

public final class NetEaseClient {
    /** 会话快照的持久化出口。真机由 SessionStore（Keystore 加密）实现；单元测试传 null 走纯内存。 */
    public interface SessionPersistence {
        JSONObject load();
        void save(JSONObject snapshot);
        void clear();
    }

    private static final String WEB_AGENT = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    private static final int RESPONSE_LIMIT = 12 * 1024 * 1024;
    private final Map<String, String> cookies = new LinkedHashMap<>();
    private final Set<String> createdPlaylistIds = new HashSet<>();
    private final String deviceId = UUID.randomUUID().toString().replace("-", "");
    private final SessionPersistence persistence;
    private long sessionEpoch;
    private long likesVersion;
    private long lastPersisted;
    private java.util.function.BooleanSupplier networkPermission = () -> true;
    public void setNetworkPermission(java.util.function.BooleanSupplier permission) { networkPermission = permission; }

    public NetEaseClient() {
        this(null);
    }

    public NetEaseClient(SessionPersistence persistence) {
        this.persistence = persistence;
        restoreSession();
    }

    private void restoreSession() {
        if (persistence == null) return;
        try {
            JSONObject snapshot = persistence.load();
            JSONObject saved = snapshot == null ? null : snapshot.optJSONObject("cookies");
            if (saved == null) return;
            for (java.util.Iterator<String> names = saved.keys(); names.hasNext(); ) {
                String name = names.next();
                String value = saved.optString(name, "");
                if (!name.matches("[\\w-]+") || value.isEmpty()) continue;
                if (name.matches("(?i)path|domain|expires|max-age|samesite|priority")) continue;
                cookies.put(name, value);
            }
        } catch (Exception ignored) {
            cookies.clear();
        }
    }

    private synchronized void persistSession() {
        if (persistence == null || !cookies.containsKey("MUSIC_U")) return;
        long now = System.currentTimeMillis();
        if (now - lastPersisted < 700) return;
        lastPersisted = now;
        try {
            JSONObject saved = new JSONObject();
            for (Map.Entry<String, String> entry : cookies.entrySet()) saved.put(entry.getKey(), entry.getValue());
            persistence.save(new JSONObject().put("cookies", saved).put("savedAt", now));
        } catch (Exception ignored) {
        }
    }

    public synchronized void clearCookies() {
        cookies.clear();
        createdPlaylistIds.clear();
        sessionEpoch++;
        lastPersisted = 0;
        if (persistence != null) persistence.clear();
    }

    public JSONObject call(String operation, JSONObject parameters) throws Exception {
        return callForSession(operation, parameters, -1);
    }

    public synchronized long sessionVersion() { return sessionEpoch; }
    public synchronized long likesVersion() { return likesVersion; }

    public JSONObject callForSession(String operation, JSONObject parameters, long expectedSession) throws Exception {
        if (!networkPermission.getAsBoolean()) throw new IllegalStateException("网易云连接插件已关闭。");
        if (!BridgePolicy.operationAllowed(operation)) throw new IllegalArgumentException("Unsupported operation");
        synchronized (this) {
            if (operation.equals("login_status") && !cookies.containsKey("MUSIC_U")) return new JSONObject().put("status", 200).put("body", new JSONObject().put("data", new JSONObject().put("code", 200).put("profile", JSONObject.NULL)));
        }
        if (operation.equals("logout")) { clearCookies(); return new JSONObject().put("loggedIn", false); }
        if (operation.equals("share_redirect")) return shareRedirect(parameters.getString("url"));
        JSONObject data = new JSONObject();
        String path;
        boolean web = false;
        switch (operation) {
            case "login_qr_key": path = "/api/login/qrcode/unikey"; data.put("type", 3); break;
            case "login_qr_check":
                path = "/api/login/qrcode/client/login";
                String key = parameters.getString("key");
                if (!key.matches("[\\w-]{8,160}")) throw new IllegalArgumentException("Invalid login key");
                data.put("key", key).put("type", 3); break;
            case "login_status": path = "/api/w/nuser/account/get"; web = true; break;
            case "recommend_songs":
            case "recommend_resource":
            case "likelist":
            case "like":
                RecommendationRequest recommendation = RecommendationRequest.create(operation, parameters);
                synchronized (this) { if (!cookies.containsKey("MUSIC_U")) throw new IllegalStateException("Login required for recommendations and account likes"); }
                path = recommendation.path; web = recommendation.web; data = recommendation.data; break;
            case "user_playlist":
                path = "/api/user/playlist"; web = true;
                data.put("uid", validId(parameters.get("uid"))).put("limit", Math.min(1000, parameters.optInt("limit", 1000))).put("offset", Math.max(0, parameters.optInt("offset", 0))).put("includeVideo", true); break;
            case "playlist_detail": path = "/api/v6/playlist/detail"; data.put("id", validId(parameters.get("id"))).put("n", 100000).put("s", 8); break;
            case "song_detail":
                path = "/api/v3/song/detail"; web = true;
                JSONArray details = new JSONArray();
                for (String id : validIds(parameters.getString("ids"), 1000)) details.put(new JSONObject().put("id", Long.parseLong(id)));
                data.put("c", details.toString()); break;
            case "cloudsearch": path = "/api/cloudsearch/pc"; data = SongSearchRequest.data(parameters); break;
            case "lyric":
                path = "/api/song/lyric";
                data.put("id", validId(parameters.get("id"))).put("tv", -1).put("lv", -1).put("rv", -1).put("kv", -1).put("_nmclfl", 1); break;
            case "song_url":
                path = "/api/song/enhance/player/url";
                data.put("ids", new JSONArray().put(validId(parameters.get("id"))).toString()).put("br", 128000); break;
            case "song_url_v1":
                path = "/api/song/enhance/player/url/v1";
                String level = parameters.optString("level", "exhigh");
                if (!java.util.Arrays.asList("standard", "higher", "exhigh", "lossless").contains(level)) throw new IllegalArgumentException("Unsupported quality");
                data.put("ids", new JSONArray().put(validId(parameters.get("id"))).toString()).put("level", level).put("encodeType", "flac"); break;
            case "song_wiki_info":
                path = "/api/link/page/parent/relation/construct/info";
                JSONObject wikiStates = new JSONObject().put("playingResource", new JSONObject()
                        .put("current", validId(parameters.get("id"))).put("scene", "songWiki"));
                data.put("extJson", new JSONObject().put("states", wikiStates).toString()).put("positionCode", "songWikiMainPosition"); break;
            case "playlist_create":
                path = "/api/playlist/create"; web = true;
                String name = parameters.getString("name").trim();
                int privacy = parameters.getInt("privacy");
                if (name.isEmpty() || name.codePointCount(0, name.length()) > 40 || privacy != 0 && privacy != 10) throw new IllegalArgumentException("Invalid playlist");
                data.put("name", name).put("privacy", privacy).put("type", "NORMAL"); break;
            case "playlist_tracks":
                path = "/api/playlist/manipulate/tracks";
                if (!parameters.optString("op").equals("add")) throw new IllegalArgumentException("Only adding to a prepared new playlist is supported");
                requireNewPlaylist(validId(parameters.get("pid")));
                data.put("op", "add").put("pid", validId(parameters.get("pid"))).put("trackIds", new JSONArray(validIds(parameters.getString("tracks"), 200)).toString()).put("imme", "true"); break;
            case "song_order_update":
                path = "/api/playlist/manipulate/tracks";
                requireNewPlaylist(validId(parameters.get("pid")));
                JSONArray order = new JSONArray(parameters.getString("ids"));
                if (order.length() < 1 || order.length() > 5000) throw new IllegalArgumentException("Invalid queue size");
                JSONArray normalized = new JSONArray();
                for (int index = 0; index < order.length(); index++) normalized.put(validId(order.get(index)));
                data.put("pid", validId(parameters.get("pid"))).put("trackIds", normalized.toString()).put("op", "update"); break;
            default: throw new IllegalArgumentException("Unsupported network operation");
        }
        JSONObject body = encryptedRequest(path, data, web, expectedSession);
        if (operation.equals("like") && body.optInt("code", -1) == 200) { synchronized (this) { likesVersion++; } }
        if (operation.equals("playlist_create") && body.optInt("code", 200) == 200) {
            JSONObject playlist = body.optJSONObject("playlist");
            String id = validId(playlist == null ? body.opt("id") : playlist.opt("id"));
            synchronized (this) { createdPlaylistIds.add(id); }
        }
        if (operation.equals("login_qr_key")) body = new JSONObject().put("code", body.optInt("code", 200)).put("data", body);
        else if (operation.equals("login_qr_check")) body = new JSONObject().put("code", body.optInt("code", 502)).put("message", body.optString("message", ""));
        else if (operation.equals("login_status")) {
            JSONObject profile = body.optJSONObject("profile");
            JSONObject safe = new JSONObject().put("code", body.optInt("code", 502));
            if (profile != null) safe.put("profile", new JSONObject().put("userId", profile.opt("userId")).put("nickname", profile.optString("nickname")).put("avatarUrl", profile.optString("avatarUrl")));
            body = new JSONObject().put("data", safe);
        }
        removeSecrets(body);
        return new JSONObject().put("status", 200).put("body", body);
    }

    private JSONObject encryptedRequest(String path, JSONObject data, boolean web, long expectedSession) throws Exception {
        Map<String, String> snapshot;
        long epoch;
        synchronized (this) {
            if (expectedSession >= 0 && expectedSession != sessionEpoch) throw new java.io.IOException("Session changed");
            snapshot = new LinkedHashMap<>(cookies); epoch = sessionEpoch;
        }
        snapshot.put("os", "pc"); snapshot.put("appver", "3.1.29.205117"); snapshot.put("osver", "Windows10");
        snapshot.put("deviceId", deviceId); snapshot.put("channel", "netease"); snapshot.put("__remember_me", "true");
        snapshot.putIfAbsent("_ntes_nuid", deviceId);
        String csrf = snapshot.getOrDefault("__csrf", "");
        String form;
        String target;
        if (web) {
            data.put("csrf_token", csrf);
            String secret = NetEaseCrypto.secretKey();
            form = "params=" + encode(NetEaseCrypto.weapiParams(data.toString(), secret)) + "&encSecKey=" + NetEaseCrypto.weapiKey(secret);
            target = "https://music.163.com/weapi/" + path.substring(5);
        } else {
            JSONObject header = new JSONObject();
            for (String name : new String[]{"os", "appver", "osver", "deviceId", "channel", "MUSIC_U", "MUSIC_A", "__csrf", "NMTID"}) if (snapshot.containsKey(name)) header.put(name, snapshot.get(name));
            header.put("versioncode", "140").put("mobilename", "").put("resolution", "1920x1080").put("buildver", String.valueOf(System.currentTimeMillis() / 1000)).put("requestId", UUID.randomUUID().toString());
            data.put("header", header).put("e_r", false);
            form = "params=" + NetEaseCrypto.eapiParams(path, data.toString());
            target = "https://interfacepc.music.163.com/eapi/" + path.substring(5);
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
        connection.setRequestProperty("User-Agent", WEB_AGENT);
        connection.setRequestProperty("Referer", "https://music.163.com/");
        connection.setRequestProperty("Accept-Encoding", "gzip");
        StringBuilder headerCookies = new StringBuilder();
        for (Map.Entry<String, String> entry : snapshot.entrySet()) headerCookies.append(encode(entry.getKey())).append('=').append(encode(entry.getValue())).append("; ");
        connection.setRequestProperty("Cookie", headerCookies.toString());
        byte[] requestBytes = form.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(requestBytes.length);
        try {
            try (OutputStream output = connection.getOutputStream()) { output.write(requestBytes); }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new java.io.IOException("Unexpected API redirect");
            synchronized (this) {
                if (epoch != sessionEpoch) throw new java.io.IOException("Session changed");
                for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                    if ("Set-Cookie".equalsIgnoreCase(entry.getKey())) for (String value : entry.getValue()) storeCookie(value);
                }
            }
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) throw new java.io.IOException("Empty API response");
            if ("gzip".equalsIgnoreCase(connection.getContentEncoding())) stream = new GZIPInputStream(stream);
            JSONObject body;
            try (InputStream input = stream) { body = new JSONObject(new String(readLimited(input), StandardCharsets.UTF_8)); }
            synchronized (this) {
                if (epoch != sessionEpoch) throw new java.io.IOException("Session changed");
                if (body.opt("cookie") instanceof String) for (String value : body.getString("cookie").split(";")) storeCookie(value);
            }
            return body;
        } finally { connection.disconnect(); }
    }

    private void storeCookie(String value) throws Exception {
        String item = value.split(";", 2)[0];
        int separator = item.indexOf('=');
        if (separator < 1) return;
        String name = item.substring(0, separator).trim();
        if (!name.matches("[\\w-]+") || name.matches("(?i)path|domain|expires|max-age|samesite|priority")) return;
        String content = URLDecoder.decode(item.substring(separator + 1).trim().replace("+", "%2B"), "UTF-8");
        if (content.isEmpty()) cookies.remove(name); else cookies.put(name, content);
        persistSession();
    }

    private synchronized void requireNewPlaylist(String id) {
        if (!createdPlaylistIds.contains(id)) throw new IllegalArgumentException("Source playlists are read-only");
    }

    private static JSONObject shareRedirect(String value) throws Exception {
        if (!BridgePolicy.shareUrlAllowed(value)) throw new IllegalArgumentException("Untrusted share host");
        HttpURLConnection connection = (HttpURLConnection) new URI(value).toURL().openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", WEB_AGENT);
        try {
            int status = connection.getResponseCode();
            return new JSONObject().put("status", status).put("location", connection.getHeaderField("Location") == null ? JSONObject.NULL : connection.getHeaderField("Location"));
        } finally { connection.disconnect(); }
    }

    private static byte[] readLimited(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > RESPONSE_LIMIT) throw new java.io.IOException("API response too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static String validId(Object value) {
        String id = String.valueOf(value);
        if (!id.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException("Invalid music ID");
        return id;
    }

    private static List<String> validIds(String value, int maximum) {
        String[] ids = value.split(",");
        if (ids.length < 1 || ids.length > maximum) throw new IllegalArgumentException("Invalid batch size");
        for (String id : ids) validId(id);
        return java.util.Arrays.asList(ids);
    }

    private static String encode(String value) throws Exception { return URLEncoder.encode(value, "UTF-8").replace("+", "%20"); }

    private static void removeSecrets(JSONObject value) throws Exception {
        JSONArray names = value.names();
        if (names == null) return;
        for (int index = 0; index < names.length(); index++) {
            String name = names.getString(index);
            if (name.matches("(?i)cookie|music_u|music_a|__csrf|csrf_token|logintoken")) { value.remove(name); continue; }
            Object item = value.opt(name);
            if (item instanceof JSONObject) removeSecrets((JSONObject) item);
        }
    }
}
