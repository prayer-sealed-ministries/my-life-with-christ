package com.myjourneywithchrist.lifewithchrist;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * App Lock, on the native side.
 *
 * The PIN never crosses this boundary in any form the web layer could store.
 * It arrives as a string to be checked or set, and what comes back is a
 * yes or a no. The verifier, the salt, the Keystore key and the attempt
 * penalty all stay here.
 *
 * AUTHORISATION IS ENFORCED HERE, NOT IN THE VIEW
 *
 * Changing or removing a PIN requires proof: either the current PIN, or a
 * device-credential authentication that this plugin itself conducted moments
 * ago. A view that simply asked nicely would be one `evaluateJavascript` away
 * from being asked nicely by something else, and an already-unlocked session is
 * not proof — §15 of the brief exists because "the app is open" is exactly the
 * situation an unattended phone is in.
 */
@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {

    /**
     * How long a successful device-credential authentication stays usable.
     *
     * Short, and single-use: it exists to carry the user from "I proved who I
     * am" to "here is my new PIN" across one dialog, not to leave a standing
     * permission lying around.
     */
    private static final long RECOVERY_GRANT_MS = 60_000L;

    private AppLockStore store;
    private long recoveryGrantedAtElapsed = -1L;
    private String recoveryGrantedBoot = null;

    @Override
    public void load() {
        store = new AppLockStore(getContext());
    }

    // ---------------------------------------------------------------- state

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", store.isEnabled());
        result.put("timeoutMs", store.timeoutMs());
        result.put("failures", store.failures());
        result.put("lastFailureElapsedMs", store.lastFailureElapsed());
        result.put("lastFailureBootId", store.lastFailureBootId());
        result.put("recoveryAvailable", deviceCredentialAvailable());
        result.put("elapsedMs", SystemClock.elapsedRealtime());
        result.put("bootId", AppLockStore.bootId());
        call.resolve(result);
    }

    /**
     * The monotonic clock, for the timeout decision.
     *
     * Wall-clock time is not usable here: changing the system clock would
     * otherwise be a way to make a fifteen-minute grace period never expire.
     */
    @PluginMethod
    public void now(PluginCall call) {
        JSObject result = new JSObject();
        result.put("elapsedMs", SystemClock.elapsedRealtime());
        result.put("bootId", AppLockStore.bootId());
        call.resolve(result);
    }

    // ------------------------------------------------------------ verifying

    @PluginMethod
    public void verifyPin(PluginCall call) {
        String pin = call.getString("pin", "");
        JSObject result = new JSObject();

        if (!store.isEnabled()) {
            result.put("ok", false);
            result.put("reason", "not-enabled");
            call.resolve(result);
            return;
        }

        try {
            boolean ok = pin != null && !pin.isEmpty() && store.verify(pin);
            if (ok) {
                store.clearFailures();
            } else {
                store.recordFailure();
            }
            result.put("ok", ok);
            result.put("failures", store.failures());
            result.put("lastFailureElapsedMs", store.lastFailureElapsed());
            result.put("lastFailureBootId", store.lastFailureBootId());
            result.put("elapsedMs", SystemClock.elapsedRealtime());
            result.put("bootId", AppLockStore.bootId());
            call.resolve(result);
        } catch (Exception error) {
            // A verifier that cannot be computed must not read as a correct
            // PIN. It also must not read as a wrong one and burn an attempt.
            call.reject("App Lock could not check that PIN.");
        }
    }

    // -------------------------------------------------------------- setting

    /**
     * Turn App Lock on, or replace the PIN.
     *
     * Replacing requires the current PIN or a fresh device-credential grant.
     * Turning it on for the first time requires neither, because there is
     * nothing yet to protect.
     */
    @PluginMethod
    public void setPin(PluginCall call) {
        String pin = call.getString("pin", "");
        if (pin == null || pin.length() < 6 || pin.length() > 12 || !pin.matches("\\d+")) {
            call.reject("That PIN does not meet the rules.");
            return;
        }

        if (store.isEnabled() && !authorised(call.getString("currentPin"))) {
            call.reject("App Lock could not confirm it was you.");
            return;
        }

        try {
            store.setPin(pin);
            consumeRecoveryGrant();
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("App Lock could not be set up on this device.");
        }
    }

    @PluginMethod
    public void disable(PluginCall call) {
        if (store.isEnabled() && !authorised(call.getString("currentPin"))) {
            call.reject("App Lock could not confirm it was you.");
            return;
        }
        store.clearAll();
        consumeRecoveryGrant();
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void setTimeout(PluginCall call) {
        Integer ms = call.getInt("timeoutMs", 0);
        store.setTimeoutMs(ms == null ? 0L : ms.longValue());
        call.resolve();
    }

    /**
     * Is this call allowed to change the lock?
     *
     * Two acceptable proofs and no third. In particular there is no "the
     * session is unlocked, so it must be them" branch — see the class comment.
     */
    private boolean authorised(String currentPin) {
        if (currentPin != null && !currentPin.isEmpty()) {
            try {
                if (store.verify(currentPin)) return true;
            } catch (Exception ignored) {
                return false;
            }
        }
        return hasRecoveryGrant();
    }

    // ------------------------------------------------------------- recovery

    /**
     * Recovery is the device's own credential, and nothing else.
     *
     * No secret question, no e-mail, no master PIN, no "forgot?" that simply
     * switches the lock off. Somebody who can unlock the phone can reset the
     * app's PIN; somebody who cannot, cannot. That is the same standard the
     * rest of the device holds, and it is honest about what App Lock is.
     *
     * `createConfirmDeviceCredentialIntent` rather than BiometricPrompt: this
     * app supports API 24, and a DEVICE_CREDENTIAL-only BiometricPrompt is not
     * supported below API 30. The Keyguard intent has worked since API 21 and
     * still does. It is marked deprecated from API 29 onward — noted, and
     * revisit if minSdk ever rises to 30.
     */
    @PluginMethod
    public void authenticateDeviceCredential(PluginCall call) {
        if (!deviceCredentialAvailable()) {
            call.reject("This device has no screen lock set up.");
            return;
        }

        KeyguardManager keyguard =
                (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        Intent intent = keyguard.createConfirmDeviceCredentialIntent(
                "Unlock My Life With Christ",
                "Use your device screen lock to reset your App Lock PIN.");
        if (intent == null) {
            call.reject("This device has no screen lock set up.");
            return;
        }

        startActivityForResult(call, intent, "deviceCredentialResult");
    }

    @ActivityCallback
    private void deviceCredentialResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        boolean ok = result.getResultCode() == Activity.RESULT_OK;
        if (ok) {
            recoveryGrantedAtElapsed = SystemClock.elapsedRealtime();
            recoveryGrantedBoot = AppLockStore.bootId();
        }
        JSObject payload = new JSObject();
        payload.put("ok", ok);
        call.resolve(payload);
    }

    private boolean deviceCredentialAvailable() {
        KeyguardManager keyguard =
                (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguard == null) return false;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && keyguard.isDeviceSecure();
    }

    private boolean hasRecoveryGrant() {
        if (recoveryGrantedAtElapsed < 0) return false;
        if (!AppLockStore.bootId().equals(recoveryGrantedBoot)) return false;
        long since = SystemClock.elapsedRealtime() - recoveryGrantedAtElapsed;
        return since >= 0 && since <= RECOVERY_GRANT_MS;
    }

    private void consumeRecoveryGrant() {
        recoveryGrantedAtElapsed = -1L;
        recoveryGrantedBoot = null;
    }

    // ------------------------------------------------------------- recents

    /**
     * Keep the journal out of the app switcher while App Lock is on.
     *
     * Two mechanisms, because the good one is new:
     *
     *  - API 33+: `setRecentsScreenshotEnabled(false)` asks the system not to
     *    snapshot this activity for Recents. Screenshots the reader takes
     *    themselves still work, which is the behaviour to want.
     *  - Below 33: FLAG_SECURE, set as the app goes away and cleared as it
     *    comes back, so screenshots work while somebody is actually using it.
     *    This is best-effort: the snapshot and the flag are a race, and on some
     *    versions a frame can be captured first. Said plainly rather than
     *    claimed away.
     */
    @PluginMethod
    public void setRecentsPrivacy(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> RecentsPrivacy.apply(activity, enabled));
        call.resolve();
    }
}
