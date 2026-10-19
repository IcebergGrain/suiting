package io.suiting.music;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

public final class LocalLibrary {
    private final Context context;
    private final SharedPreferences preferences;
    public LocalLibrary(Context context) { this.context=context.getApplicationContext();preferences=context.getSharedPreferences("local-audio",Context.MODE_PRIVATE); }
    public static boolean validId(String id) { return id!=null && id.matches("local-[a-f0-9]{32,64}"); }
    public static String idFor(String uri) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(uri.getBytes(StandardCharsets.UTF_8));
        StringBuilder result=new StringBuilder("local-");
        for(byte value:digest) result.append(String.format(java.util.Locale.ROOT,"%02x",value & 255));
        return result.toString();
    }
    private JSONObject read() throws Exception { return new JSONObject(preferences.getString("index","{}")); }
    private void save(JSONObject index) {
        if(!preferences.edit().putString("index",index.toString()).commit()) throw new IllegalStateException("本地索引没有保存成功，请检查存储空间。");
    }
    private JSONObject publicSong(JSONObject entry) throws Exception { JSONObject song=new JSONObject(entry.toString());song.remove("uri");song.remove("lyrics");return song; }
    public synchronized JSONArray list() throws Exception {
        JSONObject index=read();JSONArray result=new JSONArray();
        for(java.util.Iterator<String> ids=index.keys();ids.hasNext();) result.put(publicSong(index.getJSONObject(ids.next())));
        return result;
    }
    public synchronized JSONObject importDocuments(List<Uri> uris,int flags,boolean metadata) throws Exception {
        if(uris.size()>1000) throw new IllegalArgumentException("每次最多导入1000首。");
        JSONObject index=read();JSONArray songs=new JSONArray();int failed=0,temporary=0;
        for(Uri uri:uris) {
            try {
                if(!"content".equals(uri.getScheme())) throw new IllegalArgumentException("Only picked documents");
                String id=idFor(uri.toString());
                if(!index.has(id) && index.length()>=10000) throw new IllegalStateException("本地曲库最多10000首。");
                String name="";long size=0;
                try(Cursor cursor=context.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)) {
                    if(cursor!=null && cursor.moveToFirst()) {
                        int nameIndex=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME),sizeIndex=cursor.getColumnIndex(OpenableColumns.SIZE);
                        if(nameIndex>=0) name=cursor.getString(nameIndex);
                        if(sizeIndex>=0 && !cursor.isNull(sizeIndex)) size=cursor.getLong(sizeIndex);
                    }
                }
                if(name==null || !name.matches("(?i).+\\.(mp3|flac|m4a|aac|wav|ogg|opus|aiff|aif|alac)$")) throw new IllegalArgumentException("Unsupported audio file");
                try(android.content.res.AssetFileDescriptor descriptor=context.getContentResolver().openAssetFileDescriptor(uri,"r")) { if(descriptor==null) throw new IllegalStateException("Audio unavailable"); }
                boolean persistent=false;
                try { context.getContentResolver().takePersistableUriPermission(uri,flags & Intent.FLAG_GRANT_READ_URI_PERMISSION);persistent=true; }
                catch(SecurityException unavailable) { temporary++; }
                JSONObject entry=index.optJSONObject(id);
                entry=entry==null?new JSONObject():new JSONObject(entry.toString());
                long added=entry.optLong("addedAt",System.currentTimeMillis());
                entry.put("id",id).put("uri",uri.toString()).put("name",name).put("title",name.replaceFirst("\\.[^.]+$","")).put("artist","未知歌手").put("size",size).put("provider","local").put("persistent",persistent).put("addedAt",added);
                String mime=context.getContentResolver().getType(uri);entry.put("format",mime==null?"":mime);
                if(metadata) {
                    MediaMetadataRetriever reader=new MediaMetadataRetriever();
                    try {
                        reader.setDataSource(context,uri);
                        String title=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),artist=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
                        if(title!=null && !title.isBlank()) entry.put("title",title);
                        if(artist!=null && !artist.isBlank()) entry.put("artist",artist);
                        entry.put("album",reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
                        android.media.MediaExtractor extractor=new android.media.MediaExtractor();
                        try {
                            extractor.setDataSource(context,uri,null);
                            for(int track=0;track<extractor.getTrackCount();track++) {
                                android.media.MediaFormat format=extractor.getTrackFormat(track);
                                if(format.containsKey(android.media.MediaFormat.KEY_LANGUAGE)) { entry.put("language",format.getString(android.media.MediaFormat.KEY_LANGUAGE));break; }
                            }
                        } finally {extractor.release();}
                        entry.put("genre",reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE));
                        String duration=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                        if(duration!=null) entry.put("duration",Long.parseLong(duration)/1000d);
                    } catch(Exception missing) { entry.put("metadataPartial",true); }
                    finally { reader.release(); }
                }
                index.put(id,entry);songs.put(publicSong(entry));
            } catch(Exception unavailable) { failed++; }
        }
        save(index);
        return new JSONObject().put("songs",songs).put("failed",failed).put("temporary",temporary);
    }
    private synchronized JSONObject entry(String id) throws Exception {
        if(!validId(id)) throw new IllegalArgumentException("Invalid local song");
        JSONObject entry=read().optJSONObject(id);
        if(entry==null) throw new IllegalStateException("此设备没有对应音频，请重新选择本地音乐。");
        return entry;
    }
    public Uri resolve(String id) throws Exception {
        Uri uri=Uri.parse(entry(id).getString("uri"));
        if(!"content".equals(uri.getScheme())) throw new IllegalStateException("Invalid stored document");
        return uri;
    }
    public synchronized JSONObject preview(String id) throws Exception {
        JSONObject entry=entry(id);
        return new JSONObject().put("url",resolve(id).toString()).put("actualLevel","local").put("format",entry.optString("format")).put("expiresAt",Long.MAX_VALUE);
    }
    public synchronized JSONObject lyrics(String id) throws Exception {
        return new JSONObject().put("code",200).put("lrc",new JSONObject().put("lyric",entry(id).optString("lyrics")));
    }
    public synchronized JSONObject saveLyrics(String id,String lyrics) throws Exception {
        if(lyrics.length()>300000) throw new IllegalArgumentException("歌词过大");
        JSONObject index=read();JSONObject song=entry(id);song.put("lyrics",lyrics);index.put(id,song);save(index);
        return new JSONObject().put("saved",true);
    }
    public synchronized void remove(JSONArray ids) throws Exception {
        JSONObject index=read();
        for(int cursor=0;cursor<ids.length();cursor++) {
            String id=ids.getString(cursor);if(!validId(id)) throw new IllegalArgumentException("Invalid local ID");
            JSONObject entry=index.optJSONObject(id);
            if(entry!=null) {
                try {context.getContentResolver().releasePersistableUriPermission(Uri.parse(entry.getString("uri")),Intent.FLAG_GRANT_READ_URI_PERMISSION);} catch(Exception ignored) {}
                index.remove(id);
            }
        }
        save(index);
    }
}
