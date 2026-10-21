package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;
import java.util.function.LongSupplier;
import java.util.function.BooleanSupplier;

public final class OverlayLikes {
    public interface Transport { JSONObject call(String operation, JSONObject parameters, long epoch) throws Exception; }
    public static final class State {
        public final String id;
        public final String accountId;
        public final long epoch;
        public final boolean liked;
        State(String id, String accountId, long epoch, boolean liked) { this.id = id; this.accountId = accountId; this.epoch = epoch; this.liked = liked; }
    }

    private final Transport transport;
    private final LongSupplier session;
    private final LongSupplier clock;
    private Set<String> cached = new HashSet<>();
    private long cachedEpoch = -1;
    private volatile long expiresAt;
    private String accountId = "";

    public OverlayLikes(Transport transport, LongSupplier session, LongSupplier clock) { this.transport = transport; this.session = session; this.clock = clock; }
    public void invalidate() { expiresAt = 0; }

    public State read(String id) throws Exception {
        id = PlaybackSource.songId(id);
        long epoch = session.getAsLong();
        if (epoch != cachedEpoch || clock.getAsLong() >= expiresAt) refresh(epoch);
        requireSession(epoch);
        return new State(id, accountId, epoch, cached.contains(id));
    }

    public State toggle(String id) throws Exception {
        id = PlaybackSource.songId(id);
        long epoch = session.getAsLong();
        refresh(epoch);
        boolean target = !cached.contains(id);
        return write(id, target, epoch, () -> true);
    }

    public State set(String id, boolean target, long epoch, BooleanSupplier allowed) throws Exception {
        id = PlaybackSource.songId(id);
        requireSession(epoch);
        refresh(epoch);
        if (!allowed.getAsBoolean()) throw new IllegalStateException("歌曲已切换，请使用当前通知中的红心");
        if (cached.contains(id) == target) return new State(id, accountId, epoch, target);
        return write(id, target, epoch, allowed);
    }

    private State write(String id, boolean target, long epoch, BooleanSupplier allowed) throws Exception {
        String expectedAccount = accountId;
        requireSession(epoch);
        if (!allowed.getAsBoolean()) throw new IllegalStateException("歌曲已切换，请使用当前通知中的红心");
        JSONObject response;
        try { response = body(transport.call("like", new JSONObject().put("id", id).put("like", target), epoch)); }
        catch (Exception uncertain) { throw new IllegalStateException("喜欢结果待确认，请到网易云核对后再操作", uncertain); }
        if (response.optInt("code", -1) != 200) throw new IllegalStateException("网易云未确认喜欢操作，请稍后检查");
        try {
            requireSession(epoch);
            refresh(epoch);
            if (!expectedAccount.equals(accountId) || cached.contains(id) != target) throw new IllegalStateException("Unconfirmed like state");
        } catch (Exception uncertain) { throw new IllegalStateException("喜欢结果待确认，请到网易云核对后再操作", uncertain); }
        return new State(id, accountId, epoch, target);
    }

    private void refresh(long epoch) throws Exception {
        requireSession(epoch);
        JSONObject status = body(transport.call("login_status", new JSONObject(), epoch)).optJSONObject("data");
        JSONObject profile = status == null ? null : status.optJSONObject("profile");
        if (profile == null) throw new IllegalStateException("请先在随听连接网易云账号，再使用红心");
        String userId = PlaybackSource.songId(String.valueOf(profile.get("userId")));
        requireSession(epoch);
        JSONObject response = body(transport.call("likelist", new JSONObject().put("uid", userId), epoch));
        JSONArray ids = response.optJSONArray("ids");
        if (response.optInt("code", -1) != 200 || ids == null) throw new IllegalStateException("未能读取网易云喜欢列表");
        Set<String> next = new HashSet<>();
        for (int index = 0; index < ids.length(); index++) next.add(PlaybackSource.songId(String.valueOf(ids.get(index))));
        requireSession(epoch);
        cached = next; cachedEpoch = epoch; accountId = userId; expiresAt = clock.getAsLong() + 60000;
    }

    private void requireSession(long expected) {
        if (session.getAsLong() != expected) throw new IllegalStateException("网易云账号已变化，请重新检查红心状态");
    }

    private static JSONObject body(JSONObject response) throws Exception { return response.getJSONObject("body"); }
}
