package io.suiting.music;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class QueueRequestTest {
    @Test public void queueReplacementCanRemainPausedAndHasASeparateIdentity() throws Exception {
        QueueRequest defaults = new QueueRequest(new JSONObject());
        assertTrue(defaults.autoplay);
        assertEquals("", defaults.queueId);
        QueueRequest quiet = new QueueRequest(new JSONObject().put("autoplay", false).put("queueId", "batch-123"));
        assertFalse(quiet.autoplay);
        assertEquals("batch-123", quiet.queueId);
    }

    @Test public void queueOptionsRejectAmbiguousOrOversizeInputs() {
        assertThrows(IllegalArgumentException.class, () -> new QueueRequest(new JSONObject().put("autoplay", "false")));
        assertThrows(IllegalArgumentException.class, () -> new QueueRequest(new JSONObject().put("queueId", "../unsafe")));
        assertThrows(IllegalArgumentException.class, () -> new QueueRequest(new JSONObject().put("queueId", "x".repeat(81))));
    }
}
