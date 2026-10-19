package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackSourceTest {
    private JSONObject response(JSONObject track) throws Exception {
        return new JSONObject().put("body", new JSONObject().put("data", new JSONArray().put(track)));
    }

    private JSONObject track() throws Exception {
        return new JSONObject().put("id", 123).put("code", 200).put("url", "http://m7.music.126.net/test.mp3?key=memory-only").put("level", "standard").put("br", 128000).put("type", "mp3").put("freeTrialInfo", JSONObject.NULL);
    }

    @Test public void authorizedSourceUsesHttpsAndReportsActualQuality() throws Exception {
        JSONObject parsed = PlaybackSource.parse(response(track()), "123", "lossless");
        assertTrue(parsed.getString("url").startsWith("https://m7.music.126.net/"));
        assertEquals("lossless", parsed.getString("requestedQuality"));
        assertEquals("standard", parsed.getString("actualLevel"));
        assertEquals(128000, parsed.getInt("bitrate"));
    }

    @Test public void trialAndWrongTrackAreRejected() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> PlaybackSource.parse(response(track().put("freeTrialInfo", new JSONObject().put("start", 0))), "123", "exhigh"));
        assertThrows(IllegalArgumentException.class, () -> PlaybackSource.parse(response(track()), "124", "exhigh"));
        assertThrows(IllegalArgumentException.class, () -> PlaybackSource.parse(response(track().put("code", 404)), "123", "exhigh"));
    }

    @Test public void arbitraryHostsCredentialsPortsAndSchemesAreRejected() throws Exception {
        for (String url : new String[]{"https://example.com/a.mp3", "https://m7.music.126.net.evil.com/a", "https://user@m7.music.126.net/a", "https://m7.music.126.net:8080/a", "file:///data/local/private"}) {
            assertThrows(IllegalArgumentException.class, () -> PlaybackSource.parse(response(track().put("url", url)), "123", "exhigh"));
        }
    }

    @Test public void invalidIdsAndQualityNeverResolve() {
        assertThrows(IllegalArgumentException.class, () -> PlaybackSource.songId("demo-1"));
        assertThrows(IllegalArgumentException.class, () -> PlaybackSource.songId("0"));
        assertThrows(IllegalArgumentException.class, () -> PlaybackSource.quality("unlock"));
    }
}
