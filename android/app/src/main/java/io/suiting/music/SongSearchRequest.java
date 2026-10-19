package io.suiting.music;

import org.json.JSONObject;

public final class SongSearchRequest {
    public static JSONObject data(JSONObject parameters) throws Exception {
        Object value = parameters.get("keywords");
        if (!(value instanceof String)) throw new IllegalArgumentException("Invalid search query");
        String keywords = ((String) value).trim();
        if (keywords.isEmpty() || keywords.length() > 100 || keywords.matches("(?s).*\\p{Cntrl}.*")) throw new IllegalArgumentException("Invalid search query");
        return new JSONObject().put("s", keywords).put("type", 1).put("limit", 20).put("offset", 0).put("total", true);
    }
}
