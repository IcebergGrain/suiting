package io.suiting.music;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;
import java.util.function.LongSupplier;

public final class LocalLikes {
    public interface Store {
        String load();
        boolean save(String value);
    }
    private final Store store;
    private final LongSupplier clock;
    private JSONObject accounts;
    private long version;

    public LocalLikes(Store store, LongSupplier clock) {
        this.store = store; this.clock = clock;
        try { accounts = new JSONObject(store.load()); }
        catch (Exception invalid) { accounts = null; }
    }

    public synchronized long version() { return version; }

    public synchronized JSONObject get(String accountId) throws Exception {
        musicId(accountId);
        if (accounts == null) throw new IllegalStateException("本机喜欢记录无法读取，未覆盖原数据。请保留应用数据并检查存储空间。");
        JSONObject journal = accounts.optJSONObject(accountId);
        return journal == null ? new JSONObject().put("accountId", accountId).put("remoteIds", new JSONArray()).put("remoteKnown", false).put("checkedAt", 0).put("addedIds", new JSONArray()).put("records", new JSONArray()) : new JSONObject(journal.toString());
    }

    public synchronized boolean liked(String accountId, String id) throws Exception {
        JSONObject journal = get(accountId);
        JSONArray records = journal.getJSONArray("records");
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            if (id.equals(record.getString("id")) && record.getBoolean("pending")) return record.getBoolean("liked");
        }
        return ids(journal.getJSONArray("remoteIds")).contains(id);
    }

    public synchronized JSONObject stage(String accountId, JSONObject song, boolean liked) throws Exception {
        String id = musicId(song.getString("id"));
        JSONObject journal = get(accountId);
        JSONArray records = journal.getJSONArray("records");
        JSONArray next = new JSONArray();
        long revision = 0;
        boolean previousPending = false;
        long now = clock.getAsLong();
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            if (id.equals(record.getString("id"))) { revision = record.getLong("revision"); previousPending = record.getBoolean("pending"); }
            else if (record.getBoolean("pending") || now - record.getLong("changedAt") < 30L * 86400000) next.put(record);
        }
        if (next.length() >= 10000) throw new IllegalStateException("喜欢记录已满，请先同步后再试。");
        boolean pending = journal.getBoolean("remoteKnown") ? previousPending || ids(journal.getJSONArray("remoteIds")).contains(id) != liked : liked;
        String title = song.optString("title", "未知歌曲"), artist = song.optString("artist", "");
        next.put(new JSONObject().put("id", id).put("title", title.substring(0, Math.min(300, title.length()))).put("artist", artist.substring(0, Math.min(300, artist.length())))
            .put("liked", liked).put("changedAt", now).put("revision", revision + 1).put("pending", pending));
        journal.put("records", next);
        return commit(accountId, journal);
    }

    public synchronized JSONObject observe(String accountId, JSONArray values) throws Exception {
        Set<String> remote = ids(values);
        JSONObject journal = get(accountId);
        Set<String> previous = ids(journal.getJSONArray("remoteIds"));
        JSONArray added = new JSONArray();
        if (journal.getBoolean("remoteKnown")) for (String id : remote) if (!previous.contains(id)) added.put(id);
        journal.put("comparisonFrom", journal.getLong("checkedAt")).put("addedIds", added).put("remoteIds", new JSONArray(remote)).put("remoteKnown", true).put("checkedAt", clock.getAsLong());
        JSONArray records = journal.getJSONArray("records");
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            if (record.getBoolean("pending") && record.getBoolean("liked") == remote.contains(record.getString("id"))) record.put("pending", false);
        }
        return commit(accountId, journal);
    }

    private JSONObject commit(String accountId, JSONObject journal) throws Exception {
        JSONObject next = new JSONObject(accounts.toString()).put(accountId, journal);
        if (!store.save(next.toString())) throw new IllegalStateException("喜欢未保存成功，请检查手机存储空间后重试。");
        accounts = next; version++;
        return new JSONObject(journal.toString());
    }

    private static String musicId(String value) {
        if (value == null || !value.matches("[1-9][0-9]{0,17}")) throw new IllegalArgumentException("Invalid NetEase music or account ID");
        return value;
    }

    private static Set<String> ids(JSONArray values) throws Exception {
        if (values.length() > 100000) throw new IllegalArgumentException("喜欢列表过大，未覆盖本机记录。");
        Set<String> result = new HashSet<>();
        for (int index = 0; index < values.length(); index++) result.add(musicId(String.valueOf(values.get(index))));
        return result;
    }
}
