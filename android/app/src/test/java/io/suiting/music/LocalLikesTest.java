package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class LocalLikesTest {
    @Test public void localMusicNeverEntersThePlatformLikesJournal() throws Exception {
        LocalLikes likes = new LocalLikes(new MemoryStore(), () -> 1000);
        String localId = "local-" + "a".repeat(64);
        assertThrows(IllegalArgumentException.class, () -> likes.stage("42", song(localId), true));
        assertThrows(IllegalArgumentException.class, () -> likes.get(localId));
        assertThrows(IllegalArgumentException.class, () -> likes.observe("42", new JSONArray().put(localId)));
        assertEquals(0, likes.get("42").getJSONArray("records").length());
    }
    private static final class MemoryStore implements LocalLikes.Store {
        String data = "{}";
        boolean writable = true;
        @Override public String load() { return data; }
        @Override public boolean save(String value) { if (!writable) return false; data = value; return true; }
    }
    private static JSONObject song(String id) throws Exception { return new JSONObject().put("id", id).put("title", "合成歌曲"); }

    @Test public void notificationLikesSurviveRestartAndArePartitionedByAccount() throws Exception {
        MemoryStore store = new MemoryStore();
        LocalLikes likes = new LocalLikes(store, () -> 1000);
        likes.stage("42", song("1"), true);
        LocalLikes restored = new LocalLikes(store, () -> 2000);
        assertTrue(restored.liked("42", "1"));
        assertFalse(restored.liked("43", "1"));
        assertTrue(restored.get("42").getJSONArray("records").getJSONObject(0).getBoolean("pending"));
    }

    @Test public void localCancelBeforeFirstSyncCannotUnlikeUnknownRemoteSongs() throws Exception {
        LocalLikes likes = new LocalLikes(new MemoryStore(), () -> 1000);
        likes.stage("42", song("1"), true);
        JSONObject canceled = likes.stage("42", song("1"), false);
        assertFalse(canceled.getJSONArray("records").getJSONObject(0).getBoolean("pending"));
        likes.observe("42", new JSONArray("[\"1\"]"));
        assertTrue(likes.liked("42", "1"));
    }

    @Test public void readbackClearsOnlyMatchingIntentAndExternalChangesDoNotReplayIt() throws Exception {
        LocalLikes likes = new LocalLikes(new MemoryStore(), () -> 1000);
        likes.observe("42", new JSONArray()); likes.stage("42", song("1"), true);
        assertTrue(likes.observe("42", new JSONArray()).getJSONArray("records").getJSONObject(0).getBoolean("pending"));
        assertFalse(likes.observe("42", new JSONArray("[\"1\"]")).getJSONArray("records").getJSONObject(0).getBoolean("pending"));
        assertFalse(likes.observe("42", new JSONArray()).getJSONArray("records").getJSONObject(0).getBoolean("pending"));
        assertFalse(likes.liked("42", "1"));
    }

    @Test public void failedDiskWritesDoNotChangeMemoryOrRevision() throws Exception {
        MemoryStore store = new MemoryStore(); LocalLikes likes = new LocalLikes(store, () -> 1000);
        store.writable = false;
        assertThrows(IllegalStateException.class, () -> likes.stage("42", song("1"), true));
        assertFalse(likes.liked("42", "1")); assertEquals(0, likes.version());
    }

    @Test public void newerCancellationSurvivesAnOlderWriteReadback() throws Exception {
        LocalLikes likes = new LocalLikes(new MemoryStore(), () -> 1000);
        likes.observe("42", new JSONArray());
        likes.stage("42", song("1"), true);
        likes.stage("42", song("1"), false);
        JSONObject record = likes.observe("42", new JSONArray("[\"1\"]")).getJSONArray("records").getJSONObject(0);
        assertTrue(record.getBoolean("pending")); assertFalse(record.getBoolean("liked"));
    }

    @Test public void invalidReadbackAndCorruptStorageCannotErasePendingFavorites() throws Exception {
        MemoryStore store = new MemoryStore(); LocalLikes likes = new LocalLikes(store, () -> 1000);
        likes.stage("42", song("1"), true);
        assertThrows(IllegalArgumentException.class, () -> likes.observe("42", new JSONArray("[\"demo-1\"]")));
        assertTrue(likes.liked("42", "1"));
        store.data = "broken";
        LocalLikes corrupt = new LocalLikes(store, () -> 1000);
        assertThrows(IllegalStateException.class, () -> corrupt.get("42"));
        assertEquals("broken", store.data);
    }
}
