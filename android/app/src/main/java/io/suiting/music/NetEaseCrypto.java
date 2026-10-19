package io.suiting.music;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class NetEaseCrypto {
    private static final String PRESET_KEY = "0CoJUm6Qyw8W8jud";
    private static final String IV = "0102030405060708";
    private static final String EAPI_KEY = "e82ckenh8dichen8";
    private static final String BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final BigInteger MODULUS = new BigInteger("00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7", 16);
    private static final SecureRandom RANDOM = new SecureRandom();

    private NetEaseCrypto() {}

    public static String secretKey() {
        StringBuilder secret = new StringBuilder();
        for (int index = 0; index < 16; index++) secret.append(BASE62.charAt(RANDOM.nextInt(BASE62.length())));
        return secret.toString();
    }

    private static byte[] aes(String value, String key, boolean chained) throws Exception {
        Cipher cipher = Cipher.getInstance(chained ? "AES/CBC/PKCS5Padding" : "AES/ECB/PKCS5Padding");
        SecretKeySpec keySpec = new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "AES");
        if (chained) cipher.init(Cipher.ENCRYPT_MODE, keySpec, new IvParameterSpec(IV.getBytes(StandardCharsets.UTF_8)));
        else cipher.init(Cipher.ENCRYPT_MODE, keySpec);
        return cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
    }

    public static String weapiParams(String json, String secret) throws Exception {
        String first = Base64.getEncoder().encodeToString(aes(json, PRESET_KEY, true));
        return Base64.getEncoder().encodeToString(aes(first, secret, true));
    }

    public static String weapiKey(String secret) {
        byte[] reversed = new StringBuilder(secret).reverse().toString().getBytes(StandardCharsets.UTF_8);
        String encrypted = new BigInteger(1, reversed).modPow(BigInteger.valueOf(65537), MODULUS).toString(16);
        StringBuilder padded = new StringBuilder();
        for (int index = encrypted.length(); index < 256; index++) padded.append('0');
        return padded.append(encrypted).toString();
    }

    public static String eapiParams(String path, String json) throws Exception {
        String message = "nobody" + path + "use" + json + "md5forencrypt";
        String digest = hex(MessageDigest.getInstance("MD5").digest(message.getBytes(StandardCharsets.UTF_8)));
        return hex(aes(path + "-36cd479b6b5-" + json + "-36cd479b6b5-" + digest, EAPI_KEY, false)).toUpperCase(java.util.Locale.ROOT);
    }

    public static String hex(byte[] bytes) {
        StringBuilder output = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) output.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return output.toString();
    }
}
