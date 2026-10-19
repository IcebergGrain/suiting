package io.suiting.music;

import org.junit.Test;
import static org.junit.Assert.*;

public final class OverlayStateTest {
    @Test public void distinguishesPermissionEnabledAndRealWindow() {
        assertEquals("permission", OverlayState.describe(false, true, true, false, false, false, ""));
        assertEquals("disabled", OverlayState.describe(true, false, true, false, false, false, ""));
        assertEquals("waiting", OverlayState.describe(true, true, false, false, false, false, ""));
        assertEquals("pending", OverlayState.describe(true, true, true, false, false, false, ""));
        assertEquals("attached", OverlayState.describe(true, true, true, true, false, false, ""));
    }

    @Test public void distinguishesPreviewHiddenAndSystemRejection() {
        assertEquals("testing", OverlayState.describe(true, false, false, true, false, true, ""));
        assertEquals("hidden", OverlayState.describe(true, true, true, false, true, false, ""));
        assertEquals("error", OverlayState.describe(true, false, true, false, false, false, "System rejected window"));
        assertEquals(2, PlaybackRules.repeatMode("shuffle"));
        assertEquals("shuffle", PlaybackRules.modeName(2, true));
        assertEquals("loop", PlaybackRules.modeName(2, false));
    }
}
