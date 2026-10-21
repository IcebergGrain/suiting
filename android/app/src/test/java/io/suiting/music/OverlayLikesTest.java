package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.HashSet;
import java.util.Set;
import static org.junit.Assert.*;

public class OverlayLikesTest {
    private static final class Fixture implements OverlayLikes.Transport {
        long epoch = 1;
        long now;
        boolean loggedIn = true;
        boolean reject;
        boolean ignoreWrite;
        boolean failReadback;
        boolean changeSession;
        int writes;
        int lists;
        final Set<String> ids = new HashSet<>();
        final OverlayLikes likes = new OverlayLikes(this, () -> epoch, () -> now);
        @Override public JSONObject call(String operation, JSONObject parameters, long expected) throws Exception {
            if (expected != epoch) throw new IllegalStateException("Session changed");
            JSONObject body = new JSONObject();
            if (operation.equals("login_status")) body.put("data", new JSONObject().put("profile", loggedIn ? new JSONObject().put("userId", "42") : JSONObject.NULL));
            else if (operation.equals("likelist")) {
                lists++;
                assertEquals("42", parameters.getString("uid"));
                if (failReadback && writes > 0) throw new IllegalStateException("Network failed");
                body.put("code", 200).put("ids", new JSONArray(ids));
                if (changeSession) epoch++;
            } else if (operation.equals("like")) {
                writes++;
                if (!ignoreWrite && !reject) { if (parameters.getBoolean("like")) ids.add(parameters.getString("id")); else ids.remove(parameters.getString("id")); }
                body.put("code", reject ? 403 : 200);
            } else throw new IllegalArgumentException("Unexpected operation");
            return new JSONObject().put("body", body);
        }
    }

    @Test public void displayReadsAreCachedButExpireAndNeverWrite() throws Exception {
        Fixture fixture = new Fixture();
        assertFalse(fixture.likes.read("1").liked);
        fixture.ids.add("1");
        assertFalse(fixture.likes.read("1").liked);
        assertEquals(1, fixture.lists);
        fixture.now = 60001;
        assertTrue(fixture.likes.read("1").liked);
        assertEquals(0, fixture.writes);
    }

    @Test public void toggleReadsActualStateAndVerifiesAdditionAndRemoval() throws Exception {
        Fixture fixture = new Fixture();
        assertTrue(fixture.likes.toggle("1").liked);
        assertTrue(fixture.ids.contains("1"));
        assertFalse(fixture.likes.toggle("1").liked);
        assertFalse(fixture.ids.contains("1"));
        assertEquals(2, fixture.writes);
    }

    @Test public void appSideLikeChangesCanInvalidateTheOverlayDisplayCache() throws Exception {
        Fixture fixture = new Fixture();
        assertFalse(fixture.likes.read("1").liked);
        fixture.ids.add("1"); fixture.likes.invalidate();
        assertTrue(fixture.likes.read("1").liked);
        assertEquals(0, fixture.writes);
    }

    @Test public void staleDisplayCannotTurnAnAlreadyLikedSongIntoAnotherLike() throws Exception {
        Fixture fixture = new Fixture();
        fixture.likes.read("1"); fixture.ids.add("1");
        assertFalse(fixture.likes.toggle("1").liked);
        assertEquals(1, fixture.writes);
    }

    @Test public void unavailableLoginAndChangedSessionCannotWrite() {
        Fixture loggedOut = new Fixture(); loggedOut.loggedIn = false;
        assertThrows(IllegalStateException.class, () -> loggedOut.likes.toggle("1"));
        assertEquals(0, loggedOut.writes);
        Fixture changed = new Fixture(); changed.changeSession = true;
        assertThrows(IllegalStateException.class, () -> changed.likes.toggle("1"));
        assertEquals(0, changed.writes);
    }

    @Test public void failedOrUnconfirmedWritesNeverPretendSuccessOrRetry() {
        Fixture rejected = new Fixture(); rejected.reject = true;
        assertThrows(IllegalStateException.class, () -> rejected.likes.toggle("1"));
        assertEquals(1, rejected.writes);
        Fixture ignored = new Fixture(); ignored.ignoreWrite = true;
        assertTrue(assertThrows(IllegalStateException.class, () -> ignored.likes.toggle("1")).getMessage().contains("待确认"));
        assertEquals(1, ignored.writes);
        Fixture uncertain = new Fixture(); uncertain.failReadback = true;
        assertTrue(assertThrows(IllegalStateException.class, () -> uncertain.likes.toggle("1")).getMessage().contains("待确认"));
        assertEquals(1, uncertain.writes);
    }

    @Test public void notificationWritesAreExplicitAndIdempotentInsteadOfBlindToggles() throws Exception {
        Fixture fixture = new Fixture();
        fixture.ids.add("1");
        assertTrue(fixture.likes.set("1", true, 1, () -> true).liked);
        assertEquals(0, fixture.writes);
        assertFalse(fixture.likes.set("1", false, 1, () -> true).liked);
        assertEquals(1, fixture.writes);
        assertFalse(fixture.likes.set("1", false, 1, () -> true).liked);
        assertEquals(1, fixture.writes);
    }

    @Test public void oldAccountAndChangedTrackAreRejectedBeforeAnyNotificationWrite() {
        Fixture fixture = new Fixture();
        assertThrows(IllegalStateException.class, () -> fixture.likes.set("1", true, 0, () -> true));
        assertThrows(IllegalStateException.class, () -> fixture.likes.set("1", true, 1, () -> false));
        assertEquals(0, fixture.writes);
    }

    @Test public void aTrackChangeAfterTheReadStillCancelsTheWrite() {
        Fixture fixture = new Fixture();
        java.util.concurrent.atomic.AtomicInteger checks = new java.util.concurrent.atomic.AtomicInteger();
        assertThrows(IllegalStateException.class, () -> fixture.likes.set("1", true, 1, () -> checks.incrementAndGet() == 1));
        assertEquals(0, fixture.writes);
    }
}
