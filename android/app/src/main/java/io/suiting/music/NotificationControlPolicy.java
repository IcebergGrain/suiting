package io.suiting.music;

public final class NotificationControlPolicy {
    public static boolean canLike(String songId, boolean neteaseEnabled) {
        return neteaseEnabled && songId != null && songId.matches("[1-9][0-9]{0,17}");
    }

    public static boolean canShowLyrics(boolean lyricsEnabled, boolean desktopEnabled) {
        return lyricsEnabled && desktopEnabled;
    }
}
