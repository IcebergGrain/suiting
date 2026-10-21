package io.suiting.music;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationControlPolicyTest {
    @Test public void localTracksNeverOfferOrWritePlatformFavorites() {
        assertFalse(NotificationControlPolicy.canLike("local-" + "a".repeat(64), true));
        assertFalse(NotificationControlPolicy.canLike("", true));
        assertFalse(NotificationControlPolicy.canLike(null, true));
        assertTrue(NotificationControlPolicy.canLike("123", true));
    }

    @Test public void disabledPluginsCannotBeBypassedFromNotifications() {
        assertFalse(NotificationControlPolicy.canLike("123", false));
        assertFalse(NotificationControlPolicy.canShowLyrics(false, true));
        assertFalse(NotificationControlPolicy.canShowLyrics(true, false));
        assertTrue(NotificationControlPolicy.canShowLyrics(true, true));
    }
}
