package io.suiting.music;

public final class NotificationLikeGate {
    public static final class Target {
        public final String id;
        public final long epoch;
        public final long revision;
        private Target(String id, long epoch, long revision) { this.id = id; this.epoch = epoch; this.revision = revision; }
    }

    private volatile Target current = new Target("", -1, 0);
    private boolean busy;

    public synchronized Target select(String id, long epoch) {
        if (!current.id.equals(id) || current.epoch != epoch) current = new Target(id, epoch, current.revision + 1);
        return current;
    }

    public boolean matches(String id, long epoch, long revision) {
        Target selected = current;
        return !id.isEmpty() && selected.id.equals(id) && selected.epoch == epoch && selected.revision == revision;
    }

    public boolean matches(Target target) { return matches(target.id, target.epoch, target.revision); }

    public synchronized boolean begin(String id, long epoch, long revision) {
        if (busy || !matches(id, epoch, revision)) return false;
        busy = true;
        return true;
    }

    public synchronized boolean busy() { return busy; }
    public synchronized void invalidate() { current = new Target(current.id, current.epoch, current.revision + 1); }
    public synchronized void finish() { busy = false; }
}
