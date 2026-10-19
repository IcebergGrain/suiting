package io.suiting.music;

import org.json.JSONArray;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackRulesTest {
    @Test public void repeatModesMapToNativePlayerConstants() {
        assertEquals(0, PlaybackRules.repeatMode("order"));
        assertEquals(1, PlaybackRules.repeatMode("single"));
        assertEquals(2, PlaybackRules.repeatMode("loop"));
        assertEquals("single", PlaybackRules.repeatName(1));
        assertThrows(IllegalArgumentException.class, () -> PlaybackRules.repeatMode("random"));
    }

    @Test public void blockedIdsDeduplicateAndRemainImmutable() throws Exception {
        java.util.Set<String> ids = PlaybackRules.blockedIds(new JSONArray("[\"1\",\"1\",\"2\"]"));
        assertEquals(2, ids.size());
        assertTrue(ids.contains("1"));
        assertThrows(UnsupportedOperationException.class, () -> ids.add("3"));
    }

    @Test public void invalidOrOversizedBlocklistsCannotReachThePlayer() {
        assertThrows(IllegalArgumentException.class, () -> PlaybackRules.blockedIds(new JSONArray("[\"demo-1\"]")));
        assertThrows(IllegalArgumentException.class, () -> PlaybackRules.blockedIds(new JSONArray("[\"0\"]")));
    }
}
