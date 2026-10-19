package io.suiting.music;

import org.json.JSONArray;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public final class PlaybackRules {
    private PlaybackRules() {}

    public static int repeatMode(String mode) {
        switch (mode) {
            case "order": return 0;
            case "single": return 1;
            case "loop":
            case "shuffle": return 2;
            default: throw new IllegalArgumentException("Invalid repeat mode");
        }
    }

    public static String repeatName(int mode) {
        return mode == 1 ? "single" : mode == 2 ? "loop" : "order";
    }

    public static String modeName(int mode, boolean shuffle) {
        return shuffle ? "shuffle" : repeatName(mode);
    }

    public static Set<String> blockedIds(JSONArray ids) throws Exception {
        if (ids.length() > 30000) throw new IllegalArgumentException("Too many blocked IDs");
        Set<String> result = new HashSet<>();
        for (int index = 0; index < ids.length(); index++) result.add(PlaybackSource.songId(ids.getString(index)));
        return Collections.unmodifiableSet(result);
    }
}
