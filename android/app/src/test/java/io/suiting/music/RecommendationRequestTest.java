package io.suiting.music;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class RecommendationRequestTest {
    @Test public void dailyEndpointsAndCryptoArePinnedToInstalledUpstream() throws Exception {
        RecommendationRequest songs = RecommendationRequest.create("recommend_songs", new JSONObject().put("afresh", false));
        assertEquals("/api/v3/discovery/recommend/songs", songs.path);
        assertTrue(songs.web);
        assertFalse(songs.data.getBoolean("afresh"));
        assertEquals("/api/v1/discovery/recommend/resource", RecommendationRequest.create("recommend_resource", new JSONObject()).path);
        RecommendationRequest likes = RecommendationRequest.create("likelist", new JSONObject().put("uid", "42"));
        assertEquals("/api/song/like/get", likes.path);
        assertFalse(likes.web);
        assertEquals("42", likes.data.getString("uid"));
    }

    @Test public void likesRequireAnExplicitBooleanAndOnlyConstructTargetStateWrites() throws Exception {
        RecommendationRequest like = RecommendationRequest.create("like", new JSONObject().put("id", "123").put("like", false));
        assertEquals("/api/radio/like", like.path);
        assertTrue(like.web);
        assertFalse(like.data.getBoolean("like"));
        assertEquals("123", like.data.getString("trackId"));
        assertEquals("itembased", like.data.getString("alg"));
        assertThrows(IllegalArgumentException.class, () -> RecommendationRequest.create("like", new JSONObject().put("id", "123").put("like", "false")));
        assertThrows(IllegalArgumentException.class, () -> RecommendationRequest.create("like", new JSONObject().put("id", "0").put("like", true)));
        assertThrows(IllegalArgumentException.class, () -> RecommendationRequest.create("likelist", new JSONObject().put("uid", "https://example.com")));
        assertThrows(IllegalArgumentException.class, () -> RecommendationRequest.create("recommend_songs", new JSONObject().put("afresh", true)));
        assertThrows(IllegalArgumentException.class, () -> RecommendationRequest.create("request", new JSONObject()));
    }

    @Test public void freshNativeSessionCannotReadOrWriteAccountRecommendations() throws Exception {
        NetEaseClient client = new NetEaseClient();
        assertThrows(IllegalStateException.class, () -> client.call("recommend_songs", new JSONObject()));
        assertThrows(IllegalStateException.class, () -> client.call("like", new JSONObject().put("id", "123").put("like", true)));
        assertTrue(BridgePolicy.operationAllowed("recommend_resource"));
        assertTrue(BridgePolicy.operationAllowed("like"));
        assertFalse(BridgePolicy.operationAllowed("arbitrary_request"));
    }
}
