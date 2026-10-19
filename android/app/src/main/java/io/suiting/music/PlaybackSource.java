package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class PlaybackSource {
    private static final Set<String> QUALITIES = new HashSet<>(Arrays.asList("standard", "higher", "exhigh", "lossless"));

    private PlaybackSource() {}

    public static String quality(String value) {
        if (!QUALITIES.contains(value)) throw new IllegalArgumentException("Unsupported quality");
        return value;
    }

    public static String songId(String value) {
        if (value == null || !(value.matches("[1-9][0-9]{0,17}") || LocalLibrary.validId(value))) throw new IllegalArgumentException("Invalid song ID");
        return value;
    }

    public static JSONObject parse(JSONObject response, String id, String requested) throws Exception {
        songId(id); quality(requested);
        JSONObject body = response.optJSONObject("body");
        JSONArray data = body == null ? null : body.optJSONArray("data");
        JSONObject track = null;
        if (data != null) for (int index = 0; index < data.length(); index++) {
            JSONObject candidate = data.optJSONObject(index);
            if (candidate != null && id.equals(candidate.optString("id"))) { track = candidate; break; }
        }
        if (track == null || track.optInt("code") != 200 || !track.isNull("freeTrialInfo")) throw new IllegalArgumentException("Audio unavailable or trial only");
        URI uri = new URI(track.optString("url"));
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) throw new IllegalArgumentException("Invalid audio URL");
        String secure = new URI("https", uri.getUserInfo(), uri.getHost(), uri.getPort(), uri.getPath(), uri.getQuery(), null).toString();
        if (!BridgePolicy.mediaUrlAllowed(secure)) throw new IllegalArgumentException("Audio host not allowed");
        String level = track.optString("level");
        String format = track.optString("type").toUpperCase(java.util.Locale.ROOT);
        return new JSONObject().put("url", secure).put("requestedQuality", requested)
            .put("actualLevel", QUALITIES.contains(level) ? level : JSONObject.NULL)
            .put("bitrate", track.optLong("br") > 0 ? track.optLong("br") : JSONObject.NULL)
            .put("format", format.matches("[A-Z0-9]{1,12}") ? format : JSONObject.NULL)
            .put("expiresAt", System.currentTimeMillis() + Math.max(0, Math.min(3600, track.optInt("expi", 60)) - 30) * 1000L);
    }
}
