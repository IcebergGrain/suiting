package io.suiting.music;

public final class OverlayState {
    private OverlayState() {}

    public static String describe(boolean permission, boolean enabled, boolean track, boolean visible, boolean hidden, boolean testing, String error) {
        if (!permission) return "permission";
        if (error != null && !error.isEmpty()) return "error";
        if (!enabled && !testing) return "disabled";
        if (hidden) return "hidden";
        if (visible) return testing ? "testing" : "attached";
        if (!track && !testing) return "waiting";
        return "pending";
    }
}
