package io.suiting.music;

import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class SessionPersistenceTest {
    private static final class MemoryStore implements NetEaseClient.SessionPersistence {
        JSONObject snapshot;
        int loads;
        int saves;
        int clears;

        @Override public JSONObject load() { loads++; return snapshot; }
        @Override public void save(JSONObject value) { saves++; snapshot = value; }
        @Override public void clear() { clears++; snapshot = null; }
    }

    @Test public void clientLoadsSavedSessionOnStartup() throws Exception {
        MemoryStore store = new MemoryStore();
        store.snapshot = new JSONObject().put("cookies", new JSONObject().put("MUSIC_U", "token-value"));
        new NetEaseClient(store);
        assertEquals(1, store.loads);
    }

    @Test public void logoutClearsThePersistedSessionAndKeepsClientUsable() throws Exception {
        MemoryStore store = new MemoryStore();
        NetEaseClient client = new NetEaseClient(store);
        JSONObject result = client.call("logout", new JSONObject());
        assertFalse(result.getBoolean("loggedIn"));
        assertEquals(1, store.clears);
        assertNull(store.snapshot);
        assertTrue(client.call("login_status", new JSONObject()).getJSONObject("body").getJSONObject("data").isNull("profile"));
    }

    @Test public void corruptedSnapshotCannotCrashStartup() throws Exception {
        MemoryStore store = new MemoryStore();
        store.snapshot = new JSONObject().put("cookies", new JSONObject().put("MUSIC_U", "x").put("bad name", "y"));
        NetEaseClient client = new NetEaseClient(store);
        assertNotNull(client);
    }

    @Test public void nullPersistenceIsStillSupportedForTests() throws Exception {
        NetEaseClient client = new NetEaseClient(null);
        assertNotNull(client);
    }

    @Test public void wikiOperationIsWhitelistedAndValidatesItsIdBeforeNetwork() throws Exception {
        assertTrue(BridgePolicy.operationAllowed("song_wiki_info"));
        NetEaseClient client = new NetEaseClient();
        try {
            client.call("song_wiki_info", new JSONObject().put("id", "abc"));
            fail("Invalid music id must be rejected");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("Invalid music ID"));
        }
    }
}
