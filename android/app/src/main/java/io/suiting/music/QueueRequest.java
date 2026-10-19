package io.suiting.music;

import org.json.JSONObject;

public final class QueueRequest {
    public final boolean autoplay;
    public final String queueId;

    public QueueRequest(JSONObject parameters) throws Exception {
        Object play = parameters.opt("autoplay");
        Object identifier = parameters.opt("queueId");
        if (play != null && !(play instanceof Boolean)) throw new IllegalArgumentException("Invalid autoplay");
        if (identifier != null && (!(identifier instanceof String) || !((String) identifier).matches("[A-Za-z0-9_-]{0,80}"))) throw new IllegalArgumentException("Invalid queue identifier");
        autoplay = play == null || (Boolean) play;
        queueId = identifier == null ? "" : (String) identifier;
    }
}
