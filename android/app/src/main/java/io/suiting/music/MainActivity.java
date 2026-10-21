package io.suiting.music;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.ComponentName;
import android.content.Context;
import android.content.ServiceConnection;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Collections;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@androidx.media3.common.util.UnstableApi
public final class MainActivity extends Activity {
    private static final int FILE_OPEN = 101;
    private static final int FILE_SAVE = 102;
    private static final int LOCAL_OPEN = 103;
    private PendingFile pendingLocal;
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PendingFile pendingFile;
    private String sharedText;
    private boolean pageReady;
    private boolean dark;
    private FrameLayout frame;
    private PlaybackService playback;
    private boolean playbackBound;
    private final ServiceConnection playbackConnection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) { playback = ((PlaybackService.LocalBinder) binder).service(); notifyNativeState(); }
        @Override public void onServiceDisconnected(ComponentName name) { playback = null; }
    };

    private static final class PendingFile {
        final byte[] bytes;
        final String requestId;
        final JavaScriptReplyProxy proxy;
        PendingFile(byte[] bytes, String requestId, JavaScriptReplyProxy proxy) {
            this.bytes = bytes; this.requestId = requestId; this.proxy = proxy;
        }
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        setTheme(dark ? R.style.AppThemeDark : R.style.AppTheme);
        super.onCreate(savedInstanceState);
        playbackBound = bindService(new Intent(this, PlaybackService.class).setAction(PlaybackService.LOCAL_BIND), playbackConnection, Context.BIND_AUTO_CREATE);
        captureShare(getIntent());
        webView = new WebView(this);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setText(R.string.webview_update_required);
            message.setPadding(32, 64, 32, 32); message.setTextSize(18); setContentView(message);
            return;
        }
        frame = new FrameLayout(this);
        frame.setBackgroundColor(dark ? Color.rgb(24, 34, 29) : Color.rgb(246, 245, 240));
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        getWindow().setStatusBarColor(Color.TRANSPARENT); getWindow().setNavigationBarColor(Build.VERSION.SDK_INT >= 27 ? Color.TRANSPARENT : Color.rgb(35, 77, 60));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                webView.evaluateJavascript("window.SuiTingMobile?.setKeyboardVisible(" + insets.isVisible(WindowInsets.Type.ime()) + ")", null);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        frame.requestApplyInsets();
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setTextZoom(Math.round(100 * getResources().getConfiguration().fontScale));
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        paintTheme(getSharedPreferences("appearance", MODE_PRIVATE).getString("theme", "system"));
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (BridgePolicy.trustedPage(url)) {
                    WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                    if (response == null) return blocked();
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.music.126.net https://*.music.163.com; media-src blob: https://*.music.126.net https://*.music.163.com; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
                    headers.put("X-Content-Type-Options", "nosniff"); headers.put("Referrer-Policy", "no-referrer"); headers.put("Cache-Control", "no-store");
                    response.setResponseHeaders(headers);
                    if (request.getUrl().getPath() != null && request.getUrl().getPath().endsWith(".mjs")) response.setMimeType("text/javascript");
                    return response;
                }
                return request.getMethod().equals("GET") && BridgePolicy.mediaUrlAllowed(url) ? null : blocked();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return true;
                if (BridgePolicy.trustedPage(request.getUrl().toString())) return false;
                openExternal(request.getUrl().toString()); return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (!BridgePolicy.trustedPage(view.getUrl())) { callback.onReceiveValue(null); return true; }
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                FileSelection selection = FileSelection.from(parameters.getAcceptTypes());
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(selection.type);
                intent.putExtra(Intent.EXTRA_MIME_TYPES, selection.mimeTypes);
                try { startActivityForResult(intent, FILE_OPEN); }
                catch (ActivityNotFoundException error) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(webView, "SuiTingNative", Collections.singleton(BridgePolicy.APP_ORIGIN), (view, message, sourceOrigin, isMainFrame, proxy) -> {
            if (!isMainFrame || !BridgePolicy.trustedPage(sourceOrigin.toString()) || !BridgePolicy.trustedPage(view.getUrl())) return;
            String raw = message.getData();
            if (raw == null || raw.length() > 26 * 1024 * 1024) return;
            receiveMessage(raw, proxy);
        });
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        webView.loadUrl(BridgePolicy.APP_ORIGIN + "/index.html");
    }

    private void receiveMessage(String raw, JavaScriptReplyProxy proxy) {
        receiveMessage(raw, proxy, 0);
    }

    private void receiveMessage(String raw, JavaScriptReplyProxy proxy, int attempt) {
        if (isFinishing() || isDestroyed()) return;
        String requestId = "";
        try {
            JSONObject message = new JSONObject(raw);
            requestId = message.getString("requestId");
            if (!requestId.matches("[\\w-]{1,100}")) return;
            String operation = message.getString("operation");
            JSONObject parameters = message.optJSONObject("parameters");
            if (parameters == null) parameters = new JSONObject();
            final String id = requestId;
            if ((operation.startsWith("overlay_") || operation.startsWith("player_")) && playback == null && attempt < 30 && webView != null) {
                webView.postDelayed(() -> receiveMessage(raw, proxy, attempt + 1), 100);
                return;
            }
            if (operation.equals("ready")) {
                pageReady = true;
                JSONObject result = new JSONObject().put("appVersion", "0.1.3-public").put("systemTheme", dark ? "dark" : "light").put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT).put("sharedText", sharedText == null ? JSONObject.NULL : sharedText);
                sharedText = null; reply(proxy, id, result, null); return;
            }
            if (operation.equals("appearance")) {
                String theme = parameters.getString("theme");
                if (!theme.equals("system") && !theme.equals("light") && !theme.equals("dark")) throw new IllegalArgumentException("Invalid appearance");
                getSharedPreferences("appearance", MODE_PRIVATE).edit().putString("theme", theme).apply();
                paintTheme(theme);
                reply(proxy, id, new JSONObject().put("systemTheme", dark ? "dark" : "light"), null); return;
            }
            if (operation.equals("open_link")) {
                if (!openExternal(parameters.getString("url"))) throw new IllegalArgumentException("Link unavailable");
                reply(proxy, id, new JSONObject().put("opened", true), null); return;
            }
            if (operation.equals("copy_text")) {
                String text = parameters.getString("text");
                if (text.length() > 3000) throw new IllegalArgumentException("Text too long");
                ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("网易云歌单链接", text));
                reply(proxy, id, new JSONObject().put("copied", true), null); return;
            }
            if (operation.equals("export_file")) {
                String mime = parameters.getString("mime");
                if (!mime.equals("application/json") && !mime.equals("text/plain")) throw new IllegalArgumentException("Unsupported file type");
                byte[] bytes = parameters.getString("content").getBytes(StandardCharsets.UTF_8);
                createFile(parameters.getString("name"), mime, bytes, id, proxy); return;
            }
            if (operation.equals("save_qr")) {
                String image = parameters.getString("image");
                if (!image.startsWith("data:image/png;base64,") || image.length() > 500000) throw new IllegalArgumentException("Invalid QR image");
                byte[] bytes = Base64.getDecoder().decode(image.substring("data:image/png;base64,".length()));
                if (Build.VERSION.SDK_INT < 29) createFile("随听-网易云登录二维码.png", "image/png", bytes, id, proxy);
                else executor.execute(() -> saveQrImage(bytes, id, proxy));
                return;
            }
            final JSONObject arguments = parameters;
            SuiTingApplication application=(SuiTingApplication)getApplication();
            if(operation.equals("features_get") || operation.equals("features_set")) {
                JSONObject features=operation.equals("features_get") ? application.features().snapshot() : application.features().set(arguments.getString("id"),arguments.get("enabled"));
                if(operation.equals("features_set")) {
                    if(!application.features().enabled("netease")) application.client().clearCookies();
                    if(playback!=null) playback.featuresChanged();
                }
                reply(proxy,id,features,null);return;
            }
            if(operation.equals("local_import")) {
                if(pendingLocal!=null) throw new IllegalStateException("文件选择器已打开");
                pendingLocal=new PendingFile(new byte[0],id,proxy);
                Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try {startActivityForResult(picker,LOCAL_OPEN);} catch(Exception unavailable) {pendingLocal=null;throw unavailable;}
                return;
            }
            if(java.util.Arrays.asList("local_list","local_preview","local_lyrics","local_lyrics_save","local_remove").contains(operation)) {
                if(operation.equals("local_lyrics") && !application.features().enabled("lyrics")) throw new IllegalStateException("歌词插件已关闭");
                executor.execute(()->{
                    try {
                        JSONObject result;
                        if(operation.equals("local_list")) result=new JSONObject().put("songs",application.localLibrary().list());
                        else if(operation.equals("local_preview")) result=application.localLibrary().preview(arguments.getString("id"));
                        else if(operation.equals("local_lyrics")) result=application.localLibrary().lyrics(arguments.getString("id"));
                        else if(operation.equals("local_lyrics_save")) {result=application.localLibrary().saveLyrics(arguments.getString("id"),arguments.getString("text"));runOnUiThread(()->{if(playback!=null)playback.refreshLyrics();});}
                        else {application.localLibrary().remove(arguments.getJSONArray("ids"));result=new JSONObject().put("removed",true);}
                        reply(proxy,id,result,null);
                    } catch(Exception unavailable) {reply(proxy,id,null,"本地文件不可用，请重新选择音频；原文件没有被修改。");}
                });return;
            }
            if (operation.startsWith("overlay_")) {
                if (raw.length() > 4096 || playback == null) throw new IllegalArgumentException("Desktop lyrics not ready");
                try {
                    if (operation.equals("overlay_permission")) {
                        if (!Settings.canDrawOverlays(this)) {
                            try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); }
                            catch (ActivityNotFoundException unavailable) { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); }
                        }
                        reply(proxy, id, playback.overlayCommand("overlay_status", new JSONObject()), null);
                    } else if (operation.equals("overlay_app_settings")) {
                        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                        reply(proxy, id, playback.overlayCommand("overlay_status", new JSONObject()), null);
                    } else reply(proxy, id, playback.overlayCommand(operation, arguments), null);
                } catch (Exception unavailable) { reply(proxy, id, null, "桌面歌词未开启。可在系统设置允许随听显示在其他应用上层；拒绝授权不影响听歌，也可回个人主页关闭或解锁歌词。"); }
                return;
            }
            if (operation.startsWith("player_")) {
                if (raw.length() > 3 * 1024 * 1024 || playback == null) throw new IllegalArgumentException("Player not ready");
                try { reply(proxy, id, playback.command(operation, arguments), null); }
                catch (Exception unavailable) { reply(proxy, id, null, "播放器尚未就绪或参数不可用，请稍后重试；后台已在播放时不要重复启动队列。"); }
                return;
            }
            if (!application.features().enabled("netease")) throw new IllegalStateException("网易云插件已关闭");
            if (operation.equals("lyric") && !application.features().enabled("lyrics")) throw new IllegalStateException("歌词插件已关闭");
            if (!BridgePolicy.operationAllowed(operation) || raw.length() > 512000) throw new IllegalArgumentException("Operation not allowed");
            executor.execute(() -> {
                try {
                    JSONObject result;
                    if (operation.equals("qr_image")) result = qrImage(arguments.getString("url"));
            else if (operation.equals("open_netease")) result = openNetEase();
                    else result = ((SuiTingApplication) getApplication()).client().call(operation, arguments);
                    reply(proxy, id, result, null);
                } catch (Exception error) { reply(proxy, id, null, "手机与网易云连接未完成，请检查网络或重新扫码。涉及建单时先在网易云查看，避免重复新建。"); }
            });
        } catch (Exception error) { reply(proxy, requestId, null, "手机操作未完成，请检查输入和系统文件选择器后重试。"); }
    }

    private void reply(JavaScriptReplyProxy proxy, String requestId, JSONObject result, String error) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                JSONObject response = new JSONObject().put("requestId", requestId);
                if (error == null) response.put("result", result);
                else response.put("error", new JSONObject().put("message", error).put("code", "NATIVE_ERROR").put("status", 502));
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) proxy.postMessage(response.toString());
            } catch (Exception ignored) {}
        });
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private boolean openExternal(String value) {
        if (!BridgePolicy.externalLinkAllowed(value)) return false;
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(value));
        try { startActivity(new Intent(intent).setPackage("com.netease.cloudmusic")); return true; }
        catch (ActivityNotFoundException unavailable) {
            try { startActivity(intent); return true; }
            catch (ActivityNotFoundException noBrowser) { return false; }
        }
    }

    private JSONObject openNetEase() {
        String opened = "none";
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage("com.netease.cloudmusic");
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(launch);
                opened = "app";
            }
        } catch (Exception ignored) {
        }
        if (!"app".equals(opened)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("orpheus://")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                opened = "app";
            } catch (Exception ignored) {
            }
        }
        if (!"app".equals(opened)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://music.163.com")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                opened = "web";
            } catch (Exception ignored) {
            }
        }
        JSONObject reply = new JSONObject();
        try { reply.put("opened", opened); } catch (Exception ignored) { }
        return reply;
    }

    private static JSONObject qrImage(String value) throws Exception {
        if (!value.matches("https://music\\.163\\.com/login\\?codekey=[\\w-]{8,160}")) throw new IllegalArgumentException("Invalid QR URL");
        EnumMap<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.MARGIN, 2); hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
        BitMatrix matrix = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 320, 320, hints);
        Bitmap bitmap = Bitmap.createBitmap(320, 320, Bitmap.Config.ARGB_8888);
        int[] pixels = new int[320 * 320];
        for (int row = 0; row < 320; row++) for (int column = 0; column < 320; column++) pixels[row * 320 + column] = matrix.get(column, row) ? Color.BLACK : Color.WHITE;
        bitmap.setPixels(pixels, 0, 320, 0, 0, 320, 320);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle();
        return new JSONObject().put("image", "data:image/png;base64," + Base64.getEncoder().encodeToString(output.toByteArray()));
    }

    private void createFile(String name, String mime, byte[] bytes, String requestId, JavaScriptReplyProxy proxy) throws Exception {
        if (pendingFile != null || bytes.length > 25 * 1024 * 1024) throw new IllegalArgumentException("Export unavailable");
        String filename = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (filename.length() > 180) filename = filename.substring(0, 180);
        pendingFile = new PendingFile(bytes, requestId, proxy);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, filename);
        try { startActivityForResult(intent, FILE_SAVE); }
        catch (ActivityNotFoundException error) { pendingFile = null; throw error; }
    }

    private void saveQrImage(byte[] bytes, String requestId, JavaScriptReplyProxy proxy) {
        Uri created = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "随听-网易云登录二维码-" + System.currentTimeMillis() + ".png");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/SuiTing");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            created = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (created == null) throw new java.io.IOException("Photo store unavailable");
            try (OutputStream output = getContentResolver().openOutputStream(created)) {
                if (output == null) throw new java.io.IOException("Photo output unavailable");
                output.write(bytes);
            }
            values.clear(); values.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContentResolver().update(created, values, null, null);
            runOnUiThread(() -> Toast.makeText(this, "二维码已保存到相册的 SuiTing 文件夹。切到网易云扫一扫，从相册识别。", Toast.LENGTH_LONG).show());
            reply(proxy, requestId, new JSONObject().put("saved", true), null);
        } catch (Exception error) {
            if (created != null) getContentResolver().delete(created, null, null);
            reply(proxy, requestId, null, "二维码未保存成功，请检查相册存储空间后重新保存。");
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if(requestCode==LOCAL_OPEN && pendingLocal!=null) {
            PendingFile pending=pendingLocal;pendingLocal=null;
            if(resultCode!=RESULT_OK || data==null) {try {reply(pending.proxy,pending.requestId,new JSONObject().put("cancelled",true),null);}catch(Exception ignored){}return;}
            java.util.List<Uri> uris=new java.util.ArrayList<>();
            if(data.getClipData()!=null) for(int index=0;index<data.getClipData().getItemCount();index++) uris.add(data.getClipData().getItemAt(index).getUri());
            else if(data.getData()!=null) uris.add(data.getData());
            int flags=data.getFlags();
            executor.execute(()->{try {SuiTingApplication application=(SuiTingApplication)getApplication();reply(pending.proxy,pending.requestId,application.localLibrary().importDocuments(uris,flags,application.features().enabled("metadata")),null);}catch(Exception unavailable){reply(pending.proxy,pending.requestId,null,"本地导入未完成，请重试。旧索引保留，原音频不修改。");}});
            return;
        }
        if (requestCode == FILE_OPEN && fileCallback != null) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null); fileCallback = null;
        }
        if (requestCode == FILE_SAVE && pendingFile != null) {
            PendingFile file = pendingFile; pendingFile = null;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            executor.execute(() -> {
                try {
                    if (uri != null && "content".equals(uri.getScheme())) {
                        try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                            if (output == null) throw new java.io.IOException("No file output");
                            output.write(file.bytes);
                        }
                        runOnUiThread(() -> Toast.makeText(this, "文件已保存，请妥善保管歌单备份。", Toast.LENGTH_LONG).show());
                    }
                    reply(file.proxy, file.requestId, new JSONObject().put("saved", uri != null).put("cancelled", uri == null), null);
                } catch (Exception error) { reply(file.proxy, file.requestId, null, "文件没有保存成功，请重新选择位置。"); }
            });
        }
    }

    private void captureShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text != null && text.length() <= 3000) sharedText = text.toString();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); captureShare(intent);
        if (pageReady && sharedText != null && webView != null) {
            webView.evaluateJavascript("window.SuiTingMobile?.receiveShare(" + JSONObject.quote(sharedText) + ")", null); sharedText = null;
        }
    }

    private void handleBack() {
        if (webView == null || !pageReady) { finish(); return; }
        webView.evaluateJavascript("Boolean(window.SuiTingMobile?.handleBack())", handled -> { if (!"true".equals(handled)) finish(); });
    }

    @Override public void onBackPressed() { handleBack(); }

    private void paintTheme(String theme) {
        boolean night = theme.equals("dark") || theme.equals("system") && dark;
        int color = night ? Color.rgb(24, 34, 29) : Color.rgb(251, 251, 248);
        if (frame != null) frame.setBackgroundColor(color);
        if (webView != null) webView.setBackgroundColor(color);
        if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
            int flags = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(night ? 0 : flags, flags);
        } else {
            int flags = getWindow().getDecorView().getSystemUiVisibility();
            flags = night ? flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            flags = night ? flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void notifyNativeState() {
        if (pageReady && webView != null) webView.evaluateJavascript("window.SuiTingMobile?.onNativeState(" + JSONObject.quote(dark ? "dark" : "light") + ")", null);
    }

    @Override protected void onResume() {
        super.onResume();
        notifyNativeState();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (webView != null) webView.getSettings().setTextZoom(Math.round(100 * configuration.fontScale));
        boolean changedDark = (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        dark = changedDark;
        paintTheme(getSharedPreferences("appearance", MODE_PRIVATE).getString("theme", "system"));
        notifyNativeState();
    }

    @Override protected void onDestroy() {
        if (playbackBound) { unbindService(playbackConnection); playbackBound = false; playback = null; }
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; }
        executor.shutdownNow(); super.onDestroy();
    }
}
