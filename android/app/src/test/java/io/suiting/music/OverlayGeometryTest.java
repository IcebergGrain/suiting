package io.suiting.music;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class OverlayGeometryTest {
    @Test public void windowCanBeNarrowedAndAlwaysFitsTheScreen() {
        assertEquals(720, OverlayGeometry.width(1000, 180, 72));
        assertEquals(180, OverlayGeometry.width(360, 180, 40));
        assertEquals(150, OverlayGeometry.width(150, 180, 100));
        assertEquals(0, OverlayGeometry.clamp(-100, 1000, 720));
        assertEquals(280, OverlayGeometry.clamp(9999, 1000, 720));
        assertEquals(0, OverlayGeometry.clamp(100, 100, 720));
    }

    @Test public void touchThroughUsesTheSystemWindowOpacityLimitNotTheBackgroundColor() {
        assertEquals(0.8f, OverlayGeometry.touchSafeAlpha(1), 0);
        assertEquals(0.6f, OverlayGeometry.touchSafeAlpha(0.6f), 0);
        assertEquals(0.8f, OverlayGeometry.touchSafeAlpha(Float.NaN), 0);
        assertFalse(OverlayGeometry.editing(true, 20000, 0));
        assertTrue(OverlayGeometry.editing(false, 20000, 19999));
        assertFalse(OverlayGeometry.editing(false, 20000, 20000));
    }

    @Test public void widthIsStrictAndRetainedByOtherStyleChanges() throws Exception {
        OverlaySettings settings = OverlaySettings.defaults().update(new JSONObject().put("widthPercent", 40)).withEnabled(true);
        assertEquals(40, settings.update(new JSONObject().put("lines", 2)).widthPercent);
        assertEquals(40, settings.status(true).getInt("widthPercent"));
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("widthPercent", 39)));
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("widthPercent", 101)));
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("widthPercent", 72.5)));
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("widthPercent", "72")));
    }
}
