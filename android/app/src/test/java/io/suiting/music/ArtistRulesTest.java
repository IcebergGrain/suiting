package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ArtistRulesTest {
    private ArtistRules rules() throws Exception { return new ArtistRules(new JSONArray("[{\"id\":\"7\",\"name\":\"甲\",\"blockedAt\":123}]")); }

    @Test public void matchesAnOfficialCollaboratorByIdEvenAfterRename() throws Exception {
        assertTrue(rules().blocks(new JSONObject("{\"artists\":[{\"id\":\"8\",\"name\":\"乙\"},{\"id\":\"7\",\"name\":\"新名字\"}]}")));
        assertFalse(rules().blocks(new JSONObject("{\"artists\":[{\"id\":\"8\",\"name\":\"甲\"}]}")));
    }

    @Test public void legacyNamesMatchCompleteCreditsNotSubstrings() throws Exception {
        assertTrue(rules().blocks(new JSONObject().put("artist", "乙 / 甲")));
        assertFalse(rules().blocks(new JSONObject().put("artist", "甲乙")));
        assertFalse(rules().blocks(new JSONObject().put("artist", "未知歌手")));
        assertEquals("AC/DC", ArtistRules.credits(new JSONObject().put("artist", "AC/DC")).getJSONObject(0).getString("name"));
    }

    @Test public void nameOnlyRulesNormalizeWidthAndCaseAndCanMatchKnownIds() throws Exception {
        ArtistRules names = new ArtistRules(new JSONArray().put(new JSONObject().put("name", "Ａlice  Band")));
        assertTrue(names.blocks(new JSONObject("{\"artists\":[{\"id\":\"8\",\"name\":\"alice band\"}]}")));
        assertFalse(names.blocks(new JSONObject().put("artist", "Alice Band Live")));
    }

    @Test public void rulesSurviveJsonAndEmptyRulesRestoreArtists() throws Exception {
        ArtistRules restored = new ArtistRules(new JSONArray(rules().encoded().toString()));
        assertEquals(123, restored.encoded().getJSONObject(0).getLong("blockedAt"));
        assertTrue(restored.blocks(new JSONObject().put("artist", "甲")));
        assertFalse(ArtistRules.empty().blocks(new JSONObject().put("artist", "甲")));
    }

    @Test public void invalidIdsNeverBecomeIdentityAndEmptyNamesAreIgnored() throws Exception {
        ArtistRules names = new ArtistRules(new JSONArray("[{\"id\":\"../7\",\"name\":\"甲\"},{\"name\":\"\"},{\"name\":\"未知歌手\"}]"));
        assertEquals(1, names.encoded().length());
        assertEquals("", names.encoded().getJSONObject(0).getString("id"));
    }
}
