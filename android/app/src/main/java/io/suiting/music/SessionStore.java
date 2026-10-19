package io.suiting.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 登录会话的本地加密存储。
 *
 * 只有一份密钥在 Android Keystore（TEE / StrongBox）里，且不可导出；
 * 落盘的是这个密钥加密过的 Cookie 快照。应用被 root、被备份、被拷贝走都拿不到明文。
 * 系统备份与设备迁移已在 Manifest 关闭，这份文件不会跟着走。
 */
public final class SessionStore implements NetEaseClient.SessionPersistence {
    private static final String PREFS = "suiting-session";
    private static final String SLOT = "session";
    private static final String ALIAS = "suiting-session-key";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SharedPreferences prefs;

    public SessionStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    @Override public synchronized JSONObject load() {
        String stored = prefs.getString(SLOT, null);
        if (stored == null) return null;
        try {
            byte[] bundle = Base64.decode(stored, Base64.NO_WRAP);
            if (bundle.length <= IV_BYTES) return null;
            byte[] iv = new byte[IV_BYTES];
            System.arraycopy(bundle, 0, iv, 0, IV_BYTES);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            byte[] plain = cipher.doFinal(bundle, IV_BYTES, bundle.length - IV_BYTES);
            return new JSONObject(new String(plain, StandardCharsets.UTF_8));
        } catch (Exception error) {
            // 密钥被系统重置或数据被篡改：宁可让用户重新扫码，也不保留可疑内容。
            clear();
            return null;
        }
    }

    @Override public synchronized void save(JSONObject snapshot) {
        if (snapshot == null) return;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(snapshot.toString().getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            if (iv == null || iv.length != IV_BYTES) return;
            byte[] bundle = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, bundle, 0, iv.length);
            System.arraycopy(encrypted, 0, bundle, iv.length, encrypted.length);
            prefs.edit().putString(SLOT, Base64.encodeToString(bundle, Base64.NO_WRAP)).apply();
        } catch (Exception error) {
            clear();
        }
    }

    @Override public synchronized void clear() {
        prefs.edit().remove(SLOT).apply();
    }
}
