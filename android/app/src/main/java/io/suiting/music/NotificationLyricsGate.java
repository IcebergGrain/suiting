package io.suiting.music;

public final class NotificationLyricsGate {
    private long revision;
    private boolean enabled;
    private boolean permission;

    public boolean observe(boolean enabled, boolean permission) {
        if (this.enabled == enabled && this.permission == permission) return false;
        this.enabled = enabled; this.permission = permission; revision++;
        return true;
    }

    public long revision() { return revision; }
    public boolean enabled() { return enabled; }
    public boolean permission() { return permission; }
    public boolean accepts(long token, boolean desired) { return token == revision && desired != enabled && (!desired || permission); }
}
