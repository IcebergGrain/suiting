package io.suiting.music;

import org.json.JSONObject;

public final class RecommendationRequest {
    public final String path;
    public final boolean web;
    public final JSONObject data;

    private RecommendationRequest(String path, boolean web, JSONObject data) {
        this.path = path; this.web = web; this.data = data;
    }

    public static RecommendationRequest create(String operation, JSONObject parameters) throws Exception {
        switch (operation) {
            case "recommend_songs":
                if (parameters.has("afresh") && !Boolean.FALSE.equals(parameters.get("afresh"))) throw new IllegalArgumentException("Only the current daily recommendations are supported");
                return new RecommendationRequest("/api/v3/discovery/recommend/songs", true, new JSONObject().put("afresh", false));
            case "recommend_resource":
                return new RecommendationRequest("/api/v1/discovery/recommend/resource", true, new JSONObject());
            case "likelist":
                return new RecommendationRequest("/api/song/like/get", false, new JSONObject().put("uid", PlaybackSource.songId(String.valueOf(parameters.get("uid")))));
            case "like":
                String id = PlaybackSource.songId(String.valueOf(parameters.get("id")));
                Object target = parameters.get("like");
                if (!(target instanceof Boolean)) throw new IllegalArgumentException("A boolean like target is required");
                return new RecommendationRequest("/api/radio/like", true, new JSONObject().put("alg", "itembased").put("trackId", id).put("like", target).put("time", "3"));
            default: throw new IllegalArgumentException("Unknown recommendation operation");
        }
    }
}
