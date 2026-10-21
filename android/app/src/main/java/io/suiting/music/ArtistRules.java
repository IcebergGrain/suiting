package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import java.text.Normalizer;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class ArtistRules {
    private final Set<String> ids = new HashSet<>();
    private final Set<String> names = new HashSet<>();
    private final Set<String> fallbackNames = new HashSet<>();
    private final JSONArray records = new JSONArray();

    private ArtistRules() {}
    public static ArtistRules empty() { return new ArtistRules(); }

    public ArtistRules(JSONArray input) throws Exception {
        if (input.length() > 10000) throw new IllegalArgumentException("Too many blocked artists");
        Set<String> seen = new HashSet<>();
        for (int index = 0; index < input.length(); index++) {
            JSONObject entry = input.getJSONObject(index);
            String name = entry.optString("name", "").trim();
            if (name.isEmpty() || name.length() > 300 || key(name).equals("未知歌手")) continue;
            String id = validId(entry.optString("id", ""));
            String identity = id.isEmpty() ? "name:" + key(name) : "id:" + id;
            if (!seen.add(identity)) continue;
            records.put(new JSONObject().put("id", id).put("name", name).put("blockedAt", Math.max(0, entry.optLong("blockedAt", 0))));
            names.add(key(name));
            if (id.isEmpty()) fallbackNames.add(key(name)); else ids.add(id);
        }
    }

    public JSONArray encoded() { return records; }

    public boolean blocks(JSONObject song) throws Exception {
        JSONArray credits = credits(song);
        for (int index = 0; index < credits.length(); index++) {
            JSONObject artist = credits.getJSONObject(index);
            String id = artist.getString("id");
            String name = key(artist.getString("name"));
            if (id.isEmpty() ? names.contains(name) : ids.contains(id) || fallbackNames.contains(name)) return true;
        }
        return false;
    }

    public static JSONArray credits(JSONObject song) throws Exception {
        JSONArray entries = song.optJSONArray("artists");
        if (entries == null || entries.length() == 0) {
            entries = new JSONArray();
            for (String name : song.optString("artist", "").split("\\s+/\\s+|、")) entries.put(name);
        }
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (int index = 0; index < Math.min(100, entries.length()); index++) {
            Object entry = entries.get(index);
            String name = (entry instanceof JSONObject ? ((JSONObject) entry).optString("name", "") : entry instanceof String ? (String) entry : "").trim();
            if (name.length() > 300) name = name.substring(0, 300);
            if (name.isEmpty() || key(name).equals("未知歌手")) continue;
            String id = validId(entry instanceof JSONObject ? ((JSONObject) entry).optString("id", "") : "");
            result.putIfAbsent(id.isEmpty() ? "name:" + key(name) : "id:" + id, new JSONObject().put("id", id).put("name", name));
        }
        return new JSONArray(result.values());
    }

    private static String validId(String id) { return id.matches("[1-9][0-9]{0,17}") ? id : ""; }
    private static String key(String name) { return Normalizer.normalize(name, Normalizer.Form.NFKC).trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT); }
}
