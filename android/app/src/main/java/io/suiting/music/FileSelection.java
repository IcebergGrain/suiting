package io.suiting.music;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class FileSelection {
    public final String type;
    public final String[] mimeTypes;

    private FileSelection(String type, String[] mimeTypes) { this.type = type; this.mimeTypes = mimeTypes; }

    public static FileSelection from(String[] accepted) {
        List<String> images = new ArrayList<>();
        for (String group : accepted) {
            for (String value : group.split(",")) {
                String mime = value.trim();
                if (mime.equals("text/plain") || mime.equals(".lrc") || mime.equals(".txt")) return new FileSelection("*/*",new String[]{"*/*"});
                if (mime.equals("audio/*")) return new FileSelection("audio/*", new String[]{"audio/*"});
                if (Arrays.asList("image/gif", "image/png", "image/jpeg", "image/webp").contains(mime) && !images.contains(mime)) images.add(mime);
            }
        }
        return images.isEmpty() ? new FileSelection("application/json", new String[]{"application/json"}) : new FileSelection("image/*", images.toArray(new String[0]));
    }
}
