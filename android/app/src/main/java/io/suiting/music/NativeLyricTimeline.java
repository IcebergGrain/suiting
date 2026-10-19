package io.suiting.music;

import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class NativeLyricTimeline {
    private static final Pattern STAMP = Pattern.compile("\\[(\\d{1,4}):(\\d{2})(?:[.:](\\d{1,3}))?\\]");
    private static final Pattern OFFSET = Pattern.compile("\\[offset:([+-]?\\d{1,8})\\]", Pattern.CASE_INSENSITIVE);
    public static final class Line {
        public final long milliseconds;
        public final String text;
        public final String translation;
        Line(long milliseconds, String text, String translation) { this.milliseconds = milliseconds; this.text = text; this.translation = translation; }
    }
    public final List<Line> lines;
    public final String fallback;

    private NativeLyricTimeline(List<Line> lines, String fallback) {
        this.lines = Collections.unmodifiableList(lines); this.fallback = fallback;
    }

    public static NativeLyricTimeline empty(String message) { return new NativeLyricTimeline(new ArrayList<>(), message); }

    public static NativeLyricTimeline fromResponse(JSONObject body) {
        if (body.optBoolean("nolyric")) return empty("纯音乐 · 请欣赏");
        JSONObject lyric = body.optJSONObject("lrc");
        JSONObject translation = body.optJSONObject("tlyric");
        String raw = lyric == null ? "" : lyric.optString("lyric", "");
        TreeMap<Long, String> primary = parse(raw);
        TreeMap<Long, String> translated = parse(translation == null ? "" : translation.optString("lyric", ""));
        List<Line> result = new ArrayList<>();
        for (Map.Entry<Long, String> entry : primary.entrySet()) result.add(new Line(entry.getKey(), entry.getValue(), translated.getOrDefault(entry.getKey(), "")));
        return new NativeLyricTimeline(result, raw.trim().isEmpty() ? "暂无歌词" : "暂无时间轴歌词");
    }

    public static TreeMap<Long, String> parse(String value) {
        TreeMap<Long, String> result = new TreeMap<>();
        if (value == null) return result;
        String source = value.substring(0, Math.min(120000, value.length()));
        long offset = 0;
        Matcher offsetMatch = OFFSET.matcher(source);
        while (offsetMatch.find()) offset = Long.parseLong(offsetMatch.group(1));
        int count = 0;
        for (String row : source.split("\\r?\\n")) {
            String text = row.replaceAll("\\[[^\\]]*\\]", "").replaceAll("\\p{Cntrl}", " ").trim();
            if (text.isEmpty()) continue;
            if (text.length() > 600) text = text.substring(0, 600);
            Matcher timestamp = STAMP.matcher(row);
            while (timestamp.find() && count < 5000) {
                int seconds = Integer.parseInt(timestamp.group(2));
                if (seconds > 59) continue;
                String fraction = timestamp.group(3);
                long milliseconds = fraction == null ? 0 : Long.parseLong((fraction + "000").substring(0, 3));
                long time = Math.max(0, Long.parseLong(timestamp.group(1)) * 60000 + seconds * 1000L + milliseconds + offset);
                String existing = result.get(time);
                if (existing == null) result.put(time, text);
                else if (!existing.equals(text) && existing.length() < 1200) result.put(time, existing + " / " + text);
                count++;
            }
            if (count >= 5000) break;
        }
        return result;
    }

    public int indexAt(long milliseconds) {
        int first = 0;
        int last = lines.size() - 1;
        int found = -1;
        while (first <= last) {
            int middle = first + (last - first) / 2;
            if (lines.get(middle).milliseconds <= milliseconds) { found = middle; first = middle + 1; }
            else last = middle - 1;
        }
        return found;
    }
}
