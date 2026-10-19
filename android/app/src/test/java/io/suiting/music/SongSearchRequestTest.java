package io.suiting.music;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class SongSearchRequestTest {
    @Test public void searchIsFixedToTwentySongsAndCannotChangeTheEndpoint() throws Exception {
        JSONObject data = SongSearchRequest.data(new JSONObject().put("keywords", "测试").put("limit", 100000).put("type", 1000));
        assertEquals("测试", data.getString("s")); assertEquals(20, data.getInt("limit")); assertEquals(1, data.getInt("type"));
        assertThrows(IllegalArgumentException.class, () -> SongSearchRequest.data(new JSONObject().put("keywords", "x".repeat(101))));
        assertThrows(IllegalArgumentException.class, () -> SongSearchRequest.data(new JSONObject().put("keywords", "x\ny")));
        assertThrows(IllegalArgumentException.class, () -> SongSearchRequest.data(new JSONObject().put("keywords", 123)));
    }
}
