package io.suiting.music;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationLikeGateTest {
    @Test public void staleTrackAndReturnedTrackCannotUseAnOldNotification() {
        NotificationLikeGate gate = new NotificationLikeGate();
        NotificationLikeGate.Target first = gate.select("1", 3);
        gate.select("2", 3);
        assertFalse(gate.begin(first.id, first.epoch, first.revision));
        gate.select("1", 3);
        assertFalse(gate.matches(first));
    }

    @Test public void unchangedTrackKeepsItsTokenButAccountChangesInvalidateIt() {
        NotificationLikeGate gate = new NotificationLikeGate();
        NotificationLikeGate.Target first = gate.select("1", 3);
        assertSame(first, gate.select("1", 3));
        gate.select("1", 4);
        assertFalse(gate.matches(first));
    }

    @Test public void doubleClicksAreRejectedUntilTheWriteCompletes() {
        NotificationLikeGate gate = new NotificationLikeGate();
        NotificationLikeGate.Target target = gate.select("1", 1);
        assertTrue(gate.begin(target.id, target.epoch, target.revision));
        assertFalse(gate.begin(target.id, target.epoch, target.revision));
        gate.finish();
        assertTrue(gate.begin(target.id, target.epoch, target.revision));
    }

    @Test public void clearingPlaybackInvalidatesTheTargetAndCannotWriteAnEmptyId() {
        NotificationLikeGate gate = new NotificationLikeGate();
        NotificationLikeGate.Target target = gate.select("1", 1);
        NotificationLikeGate.Target empty = gate.select("", 1);
        assertFalse(gate.matches(target));
        assertFalse(gate.begin(empty.id, empty.epoch, empty.revision));
    }
}
