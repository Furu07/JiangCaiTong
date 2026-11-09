package com.jxufe.jct;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Separately encrypts the Chaoxing cookie jar and 798 session with Android Keystore. */
final class CredStore {
    private static final String PREFS = "jiangcaitong";
    private static final String FIELD_CX = "cx.cookies";
    private static final String FIELD_WATER = "water.state";
    private static final String KEY_ALIAS = "jiangcaitong.cred.v1";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;

    private CredStore() {}

    static String saveCx(String json) { return savePlain(FIELD_CX, json); }
    static String loadCx() { return loadPlain(FIELD_CX); }
    static void clearCx() { clearField(FIELD_CX); }
    static String saveWater(String json) { return savePlain(FIELD_WATER, json); }
    static String loadWater() { return loadPlain(FIELD_WATER); }
    static void clearWater() { clearField(FIELD_WATER); }

    static String waterState() {
        if (readBlob(FIELD_WATER).isEmpty()) return "none";
        return loadWater().isEmpty() ? "broken" : "ok";
    }

    private static synchronized String savePlain(String field, String plain) {
        try {
            String blob = "k1:" + encryptWithKeystore(plain);
            if (prefs().edit().putString(field, blob).commit()) return "";
        } catch (Exception ignored) { }
        return "无法使用 Android Keystore 保存登录状态";
    }

    private static synchronized String loadPlain(String field) {
        String blob = readBlob(field);
        if (!blob.startsWith("k1:")) return "";
        try {
            return decryptWithKeystore(blob.substring(3));
        } catch (Exception ignored) {
            return "";
        }
    }

    private static synchronized void clearField(String field) {
        if (!prefs().edit().remove(field).commit()) {
            throw new IllegalStateException("无法清除登录状态");
        }
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    private static String encryptWithKeystore(String plain) throws Exception {
        Cipher c = Cipher.getInstance(TRANSFORM);
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] ct = c.doFinal(plain.getBytes("UTF-8"));
        return b64(c.getIV()) + ":" + b64(ct);
    }

    private static String decryptWithKeystore(String body) throws Exception {
        int i = body.indexOf(':');
        if (i <= 0) throw new IllegalArgumentException("格式不对");
        byte[] iv = unB64(body.substring(0, i));
        byte[] ct = unB64(body.substring(i + 1));
        Cipher c = Cipher.getInstance(TRANSFORM);
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
        return new String(c.doFinal(ct), "UTF-8");
    }

    private static SharedPreferences prefs() {
        Context ctx = App.ctx();
        if (ctx == null) throw new IllegalStateException("应用上下文为空");
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String readBlob(String field) {
        try {
            String b = prefs().getString(field, "");
            return b == null ? "" : b;
        } catch (Throwable t) {
            return "";
        }
    }

    private static String b64(byte[] b) {
        return Base64.encodeToString(b, Base64.NO_WRAP);
    }

    private static byte[] unB64(String s) {
        return Base64.decode(s, Base64.NO_WRAP);
    }

}
