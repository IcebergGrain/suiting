package io.suiting.music;

import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class NativeCoreTest {
    @Test public void freshNativeSessionReportsLoggedOutWithoutNetwork() throws Exception {
        NetEaseClient client = new NetEaseClient();
        assertTrue(client.call("login_status", new JSONObject()).getJSONObject("body").getJSONObject("data").isNull("profile"));
    }

    @Test public void cryptoMatchesPinnedUpstreamFixtures() throws Exception {
        String json = "{\"id\":123,\"csrf_token\":\"\"}";
        assertEquals("CLDD+DdPkibsXQi558ASK3fQufUZOm8UMZu1BjXirW8DhUiezS9M/pwzrGWI5uXc", NetEaseCrypto.weapiParams(json, "aaaaaaaaaaaaaaaa"));
        assertEquals("d473b9eca232f1b4090dd606b0df86de318748dd2eec307e4ed4345030fc4ee30331e598f41d5a6f5befaab94630ea1a1eda7cfade84fbec1a907913d2e4d2c8744bc572b99a050075e075b4537f645ecfa994f95906c32818e076aeda6bdb906bfa0bb96c4cf4bc3ed6d9ab76cf08441153d9d85e1ea3d78fa8d9210d581cee", NetEaseCrypto.weapiKey("aaaaaaaaaaaaaaaa"));
        assertEquals("4DC723619A991588865191FD2F319BAD3685FE9763EC6B583EF8EE54A9618FB798007EEFA3048CBA32F5B941256641BA24364BC1A42C7877A3F9C9A3F76BA61BB895367097192C3792DBD418C25D80E219CF1C518A6B69DA0799216CBBBC3257", NetEaseCrypto.eapiParams("/api/test", json));
    }

    @Test public void originAndShareHostsAreStrict() {
        assertTrue(BridgePolicy.trustedPage("https://appassets.androidplatform.net/index.html"));
        assertFalse(BridgePolicy.trustedPage("https://appassets.androidplatform.net.evil.example/index.html"));
        assertFalse(BridgePolicy.trustedPage("http://appassets.androidplatform.net/"));
        assertFalse(BridgePolicy.trustedPage("https://user@appassets.androidplatform.net/"));
        assertTrue(BridgePolicy.shareUrlAllowed("https://163cn.tv/test"));
        assertFalse(BridgePolicy.shareUrlAllowed("https://163cn.tv.evil.example/"));
        assertFalse(BridgePolicy.shareUrlAllowed("https://music.163.com:443/playlist?id=1"));
    }

    @Test public void externalAndMediaSchemesCannotEscapeToArbitraryApps() {
        assertTrue(BridgePolicy.externalLinkAllowed("https://music.163.com/playlist?id=123"));
        assertTrue(BridgePolicy.externalLinkAllowed("https://music.163.com/song?id=123"));
        assertFalse(BridgePolicy.externalLinkAllowed("intent://anything"));
        assertFalse(BridgePolicy.externalLinkAllowed("javascript:alert(1)"));
        assertFalse(BridgePolicy.externalLinkAllowed("https://music.163.com/login"));
        assertTrue(BridgePolicy.mediaUrlAllowed("https://p1.music.126.net/cover.jpg"));
        assertFalse(BridgePolicy.mediaUrlAllowed("http://p1.music.126.net/cover.jpg"));
        assertFalse(BridgePolicy.mediaUrlAllowed("https://music.126.net.evil.example/cover.jpg"));
    }

    @Test public void nativeWriteGuardRejectsSourcePlaylistsBeforeNetwork() throws Exception {
        NetEaseClient client = new NetEaseClient();
        try {
            client.call("playlist_tracks", new JSONObject().put("pid", "12").put("op", "add").put("tracks", "1"));
            fail("Source write must be blocked");
        } catch (IllegalArgumentException expected) { assertTrue(expected.getMessage().contains("read-only")); }
        try {
            client.call("song_order_update", new JSONObject().put("pid", "12").put("ids", "[1]"));
            fail("Source reorder must be blocked");
        } catch (IllegalArgumentException expected) { assertTrue(expected.getMessage().contains("read-only")); }
    }
}
