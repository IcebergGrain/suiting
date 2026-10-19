package io.suiting.music;

import org.json.JSONObject;

public final class OverlaySettings {
    public final boolean enabled;
    public final boolean locked;
    public final int fontSize;
    public final double opacity;
    public final String alignment;
    public final int lines;
    public final boolean showTranslation;
    public final int widthPercent;

    public OverlaySettings(boolean enabled, boolean locked, int fontSize, double opacity) {
        this(enabled, locked, fontSize, opacity, "center", 1, true);
    }

    public OverlaySettings(boolean enabled, boolean locked, int fontSize, double opacity, String alignment, int lines, boolean showTranslation) {
        this(enabled, locked, fontSize, opacity, alignment, lines, showTranslation, 72);
    }

    public OverlaySettings(boolean enabled, boolean locked, int fontSize, double opacity, String alignment, int lines, boolean showTranslation, int widthPercent) {
        if (fontSize < 16 || fontSize > 36 || !Double.isFinite(opacity) || opacity < 0 || opacity > 1) throw new IllegalArgumentException("Invalid overlay style");
        if (!java.util.Arrays.asList("left", "center", "right").contains(alignment) || (lines != 1 && lines != 2)) throw new IllegalArgumentException("Invalid lyric layout");
        if (widthPercent < 40 || widthPercent > 100) throw new IllegalArgumentException("Invalid overlay width");
        this.enabled = enabled; this.locked = locked; this.fontSize = fontSize; this.opacity = opacity;
        this.alignment = alignment; this.lines = lines; this.showTranslation = showTranslation;
        this.widthPercent = widthPercent;
    }

    public static OverlaySettings defaults() { return new OverlaySettings(false, true, 22, 0.8); }

    public OverlaySettings withEnabled(boolean value) { return new OverlaySettings(value, locked, fontSize, opacity, alignment, lines, showTranslation, widthPercent); }

    public OverlaySettings update(JSONObject parameters) throws Exception {
        int size = fontSize;
        double alpha = opacity;
        boolean fixed = locked;
        String align = alignment;
        int count = lines;
        boolean translated = showTranslation;
        int width = widthPercent;
        if (parameters.has("fontSize")) {
            Object value = parameters.get("fontSize");
            if (!(value instanceof Number) || ((Number) value).doubleValue() != ((Number) value).intValue()) throw new IllegalArgumentException("Invalid font size");
            size = ((Number) value).intValue();
        }
        if (parameters.has("opacity")) {
            Object value = parameters.get("opacity");
            if (!(value instanceof Number)) throw new IllegalArgumentException("Invalid opacity");
            alpha = ((Number) value).doubleValue();
        }
        if (parameters.has("locked")) {
            Object value = parameters.get("locked");
            if (!(value instanceof Boolean)) throw new IllegalArgumentException("Invalid lock state");
            fixed = (Boolean) value;
        }
        if (parameters.has("alignment")) {
            Object value = parameters.get("alignment");
            if (!(value instanceof String)) throw new IllegalArgumentException("Invalid alignment");
            align = (String) value;
        }
        if (parameters.has("lines")) {
            Object value = parameters.get("lines");
            if (!(value instanceof Number) || ((Number) value).doubleValue() != ((Number) value).intValue()) throw new IllegalArgumentException("Invalid line count");
            count = ((Number) value).intValue();
        }
        if (parameters.has("showTranslation")) {
            Object value = parameters.get("showTranslation");
            if (!(value instanceof Boolean)) throw new IllegalArgumentException("Invalid translation switch");
            translated = (Boolean) value;
        }
        if (parameters.has("widthPercent")) {
            Object value = parameters.get("widthPercent");
            if (!(value instanceof Number) || ((Number) value).doubleValue() != ((Number) value).intValue()) throw new IllegalArgumentException("Invalid overlay width");
            width = ((Number) value).intValue();
        }
        return new OverlaySettings(enabled, fixed, size, alpha, align, count, translated, width);
    }

    public JSONObject status(boolean permission) throws Exception {
        return new JSONObject().put("available", true).put("permission", permission).put("enabled", enabled && permission).put("locked", locked).put("fontSize", fontSize).put("opacity", opacity).put("alignment", alignment).put("lines", lines).put("showTranslation", showTranslation).put("widthPercent", widthPercent);
    }
}
