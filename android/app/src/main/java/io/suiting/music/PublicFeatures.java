package io.suiting.music;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

public final class PublicFeatures {
    private final SharedPreferences preferences;
    public PublicFeatures(Context context) { preferences=context.getSharedPreferences("public-features",Context.MODE_PRIVATE); }
    public static boolean valid(String id) { return java.util.Arrays.asList("netease","metadata","lyrics","desktopLyrics").contains(id); }
    public static boolean defaultValue(String id) { return id.equals("metadata") || id.equals("lyrics"); }
    public boolean enabled(String id) { if(!valid(id)) throw new IllegalArgumentException("Invalid feature"); return preferences.getBoolean(id,defaultValue(id)); }
    public JSONObject snapshot() throws Exception {
        JSONObject result=new JSONObject();
        for(String id:java.util.Arrays.asList("netease","metadata","lyrics","desktopLyrics")) result.put(id,enabled(id));
        return result;
    }
    public JSONObject set(String id,Object enabled) throws Exception {
        if(!valid(id) || !(enabled instanceof Boolean)) throw new IllegalArgumentException("Invalid feature switch");
        if(!preferences.edit().putBoolean(id,(Boolean)enabled).commit()) throw new IllegalStateException("Feature was not saved");
        return snapshot();
    }
}
