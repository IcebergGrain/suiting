package io.suiting.music;

public final class OverlayGeometry {
    private OverlayGeometry() {}

    public static int width(int screenWidth, int minimumWidth, int percent) {
        return Math.min(screenWidth, Math.max(minimumWidth, Math.round(screenWidth * percent / 100f)));
    }

    public static int clamp(int position, int screenSize, int windowSize) {
        return Math.max(0, Math.min(Math.max(0, screenSize - windowSize), position));
    }

    public static float touchSafeAlpha(float systemMaximum) {
        return Float.isFinite(systemMaximum) && systemMaximum > 0 && systemMaximum <= 1 ? Math.min(0.8f, systemMaximum) : 0.8f;
    }

    public static boolean editing(boolean locked, long deadline, long now) {
        return !locked && deadline > now;
    }
}
