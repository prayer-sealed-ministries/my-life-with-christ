package com.myjourneywithchrist.lifewithchrist;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

/**
 * Where App Lock keeps its secret, which is to say: nowhere.
 *
 * WHAT IS STORED
 *
 * A per-install random salt and a verifier. The verifier is
 * HMAC-SHA256(salt || pin) under a key that lives in the Android Keystore and
 * cannot be read out of it — not by this app, not by anything with the file.
 *
 * WHY A KEYSTORE-BACKED HMAC AND NOT A PASSWORD HASH
 *
 * A six-digit PIN is about twenty bits. Any password hash — PBKDF2, scrypt,
 * whatever iteration count — is a delaying tactic against an attacker holding
 * the file, and a million PINs is not a long wait. What actually helps is
 * making the file useless on its own: the HMAC key is generated inside the
 * Keystore, is non-exportable, and on most devices lives in hardware. Somebody
 * who copies this app's private storage gets a salt and a digest they cannot
 * check a single guess against without the original device.
 *
 * On the device, guessing is bounded instead by the attempt penalty, which is
 * enforced in `AppLockState` and persisted here so that force-stopping the app
 * does not shed it.
 *
 * WHAT THIS IS NOT
 *
 * It is not encryption of the journal. The SQLite database is exactly as
 * readable as it was before App Lock existed. This controls access through the
 * application's own screens and claims nothing further.
 *
 * WHY ITS OWN PREFERENCES FILE
 *
 * This file is excluded from Android backup and device-to-device transfer (see
 * res/xml/backup_rules.xml and data_extraction_rules.xml). It has to be: the
 * Keystore key is bound to the device and does not travel, so a verifier
 * restored onto a new phone could never be satisfied by any PIN at all. A
 * journal that restores but cannot be opened is worse than one that restores
 * unlocked, and the honest behaviour on a new device is "App Lock is off,
 * turn it on again".
 */
final class AppLockStore {

    static final String PREFS = "app_lock";
    private static final String KEY_ALIAS = "mlwc_app_lock_hmac";

    private static final String K_SALT = "salt";
    private static final String K_VERIFIER = "verifier";
    private static final String K_TIMEOUT = "timeout_ms";
    private static final String K_FAILURES = "failures";
    private static final String K_LAST_FAIL_ELAPSED = "last_failure_elapsed";
    private static final String K_LAST_FAIL_BOOT = "last_failure_boot";

    private final SharedPreferences prefs;

    AppLockStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    boolean isEnabled() {
        return prefs.contains(K_VERIFIER) && prefs.contains(K_SALT);
    }

    long timeoutMs() {
        return prefs.getLong(K_TIMEOUT, 0L);
    }

    void setTimeoutMs(long ms) throws Exception {
        if (!prefs.edit().putLong(K_TIMEOUT, ms).commit()) {
            throw new Exception("App Lock timeout was not persisted.");
        }
    }

    int failures() {
        return prefs.getInt(K_FAILURES, 0);
    }

    long lastFailureElapsed() {
        return prefs.getLong(K_LAST_FAIL_ELAPSED, -1L);
    }

    String lastFailureBootId() {
        return prefs.getString(K_LAST_FAIL_BOOT, null);
    }

    /**
     * An identifier for this boot.
     *
     * `elapsedRealtime` counts from boot, so a reading taken before a restart
     * cannot be compared with one taken after. Wall clock minus elapsed gives
     * the moment the device booted, which is stable within a boot; the division
     * absorbs the small drift from clock adjustments. A large NTP correction
     * changes it, and the callers all treat an unrecognised boot as "assume the
     * worst", so the failure direction is a needless lock rather than a free
     * unlock.
     */
    static String bootId() {
        long booted = System.currentTimeMillis() - SystemClock.elapsedRealtime();
        return Long.toString(booted / 10_000L);
    }

    /** Record a wrong PIN. Persisted, so force-stop does not clear the penalty. */
    void recordFailure() throws Exception {
        boolean written = prefs.edit()
                .putInt(K_FAILURES, failures() + 1)
                .putLong(K_LAST_FAIL_ELAPSED, SystemClock.elapsedRealtime())
                .putString(K_LAST_FAIL_BOOT, bootId())
                .commit();
        if (!written) throw new Exception("App Lock attempt state was not persisted.");
    }

    void clearFailures() throws Exception {
        boolean written = prefs.edit()
                .remove(K_FAILURES)
                .remove(K_LAST_FAIL_ELAPSED)
                .remove(K_LAST_FAIL_BOOT)
                .commit();
        if (!written) throw new Exception("App Lock attempt state was not cleared.");
    }

    /**
     * Set or replace the PIN.
     *
     * The caller is responsible for having authorised the change; this writes
     * what it is told. Salt and verifier are written in one commit so that a
     * process death mid-write cannot leave a salt from one PIN beside a
     * verifier from another, which would lock the owner out permanently.
     */
    void setPin(String pin) throws Exception {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        byte[] verifier = mac(salt, pin);

        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(K_SALT, Base64.encodeToString(salt, Base64.NO_WRAP));
        editor.putString(K_VERIFIER, Base64.encodeToString(verifier, Base64.NO_WRAP));
        editor.remove(K_FAILURES);
        editor.remove(K_LAST_FAIL_ELAPSED);
        editor.remove(K_LAST_FAIL_BOOT);
        // commit, not apply: the caller is about to tell somebody their PIN is
        // set, and that sentence must not outrun the write. The verifier and
        // cleared attempt state share this one commit so the method cannot
        // report failure after already installing the new PIN.
        if (!editor.commit()) {
            throw new Exception("App Lock PIN was not persisted.");
        }
    }

    /** Constant-time check of a candidate PIN. Does not touch failure counts. */
    boolean verify(String pin) throws Exception {
        String storedSalt = prefs.getString(K_SALT, null);
        String storedVerifier = prefs.getString(K_VERIFIER, null);
        if (storedSalt == null || storedVerifier == null) return false;

        byte[] salt = Base64.decode(storedSalt, Base64.NO_WRAP);
        byte[] expected = Base64.decode(storedVerifier, Base64.NO_WRAP);
        byte[] actual = mac(salt, pin);
        return MessageDigest.isEqual(expected, actual);
    }

    /**
     * Forget everything, including the Keystore key.
     *
     * Deleting the key matters: leaving it behind would mean a later enable
     * reused the same key, and the point of per-install randomness is that two
     * installs of this app share nothing.
     */
    void clearAll() throws Exception {
        if (!prefs.edit().clear().commit()) {
            throw new Exception("App Lock state was not cleared.");
        }
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // A key we cannot delete is not a correctness problem: the verifier
            // it protected is already gone.
        }
    }

    private byte[] mac(byte[] salt, String pin) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(hmacKey());
        mac.update(salt);
        mac.update(pin.getBytes("UTF-8"));
        return mac.doFinal();
    }

    /**
     * The device-bound key, created once per install.
     *
     * Deliberately NOT requiring user authentication to use: this key verifies
     * the PIN, so gating it behind the device credential would make the PIN
     * pointless on a device with no secure lock screen and circular on one
     * with.
     */
    private SecretKey hmacKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);

        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build());
        return generator.generateKey();
    }
}
