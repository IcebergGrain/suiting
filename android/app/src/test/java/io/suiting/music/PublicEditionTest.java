package io.suiting.music;

import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class PublicEditionTest {
    @Test public void publicIdentityNeverTreatsUnregisteredUrisAsSongs() throws Exception {
        String id=LocalLibrary.idFor("content://fixture/audio/1");
        assertTrue(LocalLibrary.validId(id));assertEquals(id,LocalLibrary.idFor("content://fixture/audio/1"));
        assertNotEquals(id,LocalLibrary.idFor("content://fixture/audio/2"));
        assertEquals(id,PlaybackSource.songId(id));
        assertEquals(2,PlaybackRules.blockedIds(new JSONArray().put(id).put("123")).size());
        for(String invalid:new String[]{"content://arbitrary/audio","file:///data/private","local-invalid"}) {
            try {PlaybackSource.songId(invalid);fail();} catch(IllegalArgumentException expected) {}
        }
    }
    @Test public void platformNetworkIsOffByDefaultAndClientGatePrecedesTransport() throws Exception {
        assertFalse(PublicFeatures.defaultValue("netease"));assertFalse(PublicFeatures.defaultValue("desktopLyrics"));
        assertTrue(PublicFeatures.defaultValue("metadata"));assertFalse(PublicFeatures.valid("arbitrary-network"));
        NetEaseClient client=new NetEaseClient();client.setNetworkPermission(()->false);
        try {client.call("login_status",new JSONObject());fail();} catch(IllegalStateException expected) {assertTrue(expected.getMessage().contains("关闭"));}
    }
}
