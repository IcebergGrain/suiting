package io.suiting.music;

import org.json.JSONObject;
import org.junit.Test;
import java.util.TreeMap;
import static org.junit.Assert.*;

public class NativeLyricsTest {
    @Test public void lrcHandlesRepeatedStampsFractionsOffsetAndDuplicates() {
        TreeMap<Long, String> lines = NativeLyricTimeline.parse("[ar:测试]\n[offset:-100]\n[00:01.2][00:03.45]合成歌词\n[00:01.200]另一行\n[00:63]无效秒数\n[00:04.009]结尾");
        assertEquals(3, lines.size());
        assertEquals("合成歌词 / 另一行", lines.get(1100L));
        assertEquals("合成歌词", lines.get(3350L));
        assertEquals("结尾", lines.get(3909L));
        assertFalse(lines.containsValue("无效秒数"));
    }

    @Test public void seekPositionUsesSortedTimelineAndExactTranslations() throws Exception {
        JSONObject body = new JSONObject().put("lrc", new JSONObject().put("lyric", "[00:06]第二行\n[00:02]第一行"))
            .put("tlyric", new JSONObject().put("lyric", "[00:02]译文"));
        NativeLyricTimeline timeline = NativeLyricTimeline.fromResponse(body);
        assertEquals(-1, timeline.indexAt(1999));
        assertEquals(0, timeline.indexAt(2000));
        assertEquals(1, timeline.indexAt(8000));
        assertEquals(0, timeline.indexAt(3000));
        assertEquals("译文", timeline.lines.get(0).translation);
        assertEquals("", timeline.lines.get(1).translation);
        assertThrows(UnsupportedOperationException.class, () -> timeline.lines.clear());
    }

    @Test public void instrumentalPlainAndMissingLyricsAreHonestFallbacks() throws Exception {
        assertEquals("纯音乐 · 请欣赏", NativeLyricTimeline.fromResponse(new JSONObject().put("nolyric", true)).fallback);
        assertEquals("暂无歌词", NativeLyricTimeline.fromResponse(new JSONObject()).fallback);
        assertEquals("暂无时间轴歌词", NativeLyricTimeline.fromResponse(new JSONObject().put("lrc", new JSONObject().put("lyric", "没有时间轴的歌词"))).fallback);
        assertTrue(NativeLyricTimeline.parse(null).isEmpty());
    }

    @Test public void parserCapsRemoteInputAndTimelineSize() {
        StringBuilder input = new StringBuilder();
        for (int index = 0; index < 6000; index++) input.append(String.format("[%02d:%02d]行\n", index / 60, index % 60));
        assertEquals(5000, NativeLyricTimeline.parse(input.toString()).size());
        assertTrue(NativeLyricTimeline.parse("[00:01]" + "长".repeat(200000)).firstEntry().getValue().length() <= 600);
    }

    @Test public void styleUsesStrictFiniteBoundsAndPermissionAwareStatus() throws Exception {
        OverlaySettings settings = OverlaySettings.defaults().withEnabled(true).update(new JSONObject().put("fontSize", 36).put("opacity", 0).put("locked", true));
        assertFalse(settings.status(false).getBoolean("enabled"));
        assertTrue(settings.status(true).getBoolean("enabled"));
        assertTrue(settings.locked);
        assertEquals(36, settings.fontSize);
        assertEquals(0, settings.opacity, 0);
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("fontSize", 36.5)));
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("fontSize", 15)));
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("opacity", 1.1)));
        assertThrows(IllegalArgumentException.class, () -> new OverlaySettings(true, false, 22, Double.NaN));
        assertThrows(IllegalArgumentException.class, () -> settings.update(new JSONObject().put("locked", "false")));
    }

    @Test public void lyricLayoutDefaultsToCenterAndPersistsWhenEnabledChanges() throws Exception {
        OverlaySettings initial = OverlaySettings.defaults();
        assertEquals("center", initial.alignment);
        assertEquals(1, initial.lines);
        assertTrue(initial.locked);
        assertTrue(initial.showTranslation);
        OverlaySettings customized = initial.update(new JSONObject().put("alignment", "right").put("lines", 1).put("showTranslation", false)).withEnabled(true);
        assertEquals("right", customized.alignment);
        assertEquals(1, customized.lines);
        assertFalse(customized.showTranslation);
        assertEquals("right", customized.status(true).getString("alignment"));
        assertEquals(1, customized.status(true).getInt("lines"));
        assertFalse(customized.status(true).getBoolean("showTranslation"));
        assertEquals("left", customized.update(new JSONObject().put("alignment", "left")).alignment);
        assertThrows(IllegalArgumentException.class, () -> initial.update(new JSONObject().put("alignment", "justify")));
        assertThrows(IllegalArgumentException.class, () -> initial.update(new JSONObject().put("lines", 1.5)));
        assertThrows(IllegalArgumentException.class, () -> initial.update(new JSONObject().put("lines", 3)));
        assertThrows(IllegalArgumentException.class, () -> initial.update(new JSONObject().put("showTranslation", "false")));
    }
}
