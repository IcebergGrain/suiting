package io.suiting.music;

import org.junit.Test;
import static org.junit.Assert.*;

public final class FileSelectionTest {
    @Test public void fileChooserAllowsGifOnlyWhereRequestedAndKeepsAvatarTypes() {
        FileSelection avatar = FileSelection.from(new String[]{"image/png,image/jpeg,image/webp"});
        assertEquals("image/*", avatar.type); assertEquals(3, avatar.mimeTypes.length);
        FileSelection meme = FileSelection.from(new String[]{"image/gif", "image/png"});
        assertEquals("image/gif", meme.mimeTypes[0]);
        assertEquals("audio/*", FileSelection.from(new String[]{"audio/*"}).type);
        assertEquals("application/json", FileSelection.from(new String[]{".json"}).type);
        assertEquals("application/json", FileSelection.from(new String[]{"image/svg+xml"}).type);
    }
}
