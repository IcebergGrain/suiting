package io.suiting.music;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationLyricsGateTest {
    @Test public void permissionIsRequiredForEnableButNotForDisable() {
        NotificationLyricsGate gate = new NotificationLyricsGate();
        assertFalse(gate.accepts(gate.revision(), true));
        gate.observe(false, true);
        assertTrue(gate.accepts(gate.revision(), true));
        gate.observe(true, false);
        assertTrue(gate.accepts(gate.revision(), false));
    }

    @Test public void oldAndDoubleTappedNotificationsNeverRetoggleState() {
        NotificationLyricsGate gate = new NotificationLyricsGate();
        gate.observe(false, true);
        long token = gate.revision();
        assertTrue(gate.accepts(token, true));
        gate.observe(true, true);
        assertFalse(gate.accepts(token, true));
        assertFalse(gate.accepts(token, false));
        assertTrue(gate.accepts(gate.revision(), false));
    }

    @Test public void permissionChangesInvalidateOldButtonsWhileStablePollsDoNot() {
        NotificationLyricsGate gate = new NotificationLyricsGate();
        gate.observe(false, true);
        long token = gate.revision();
        assertFalse(gate.observe(false, true));
        assertEquals(token, gate.revision());
        gate.observe(false, false);
        assertFalse(gate.accepts(token, true));
    }
}
