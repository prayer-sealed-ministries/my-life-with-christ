package com.myjourneywithchrist.lifewithchrist;

import android.app.Activity;
import android.os.Build;
import android.view.WindowManager;

/**
 * Keeping the journal out of the app switcher.
 *
 * Two mechanisms, chosen by what the device actually supports, and one
 * deliberate refusal: FLAG_SECURE is NOT left on permanently. Doing that would
 * stop the reader screenshotting their own journal — a thing people genuinely
 * do with a verse or a note they want to send — in exchange for a privacy
 * benefit that only matters while the app is in the background.
 *
 * HONEST LIMITATIONS
 *
 * Below API 33 this is a race. The system takes the Recents snapshot around the
 * same moment the activity pauses, and setting the flag in `onPause` is not
 * guaranteed to win. It is the best available mechanism on those versions and
 * it usually works; it is not a guarantee, and nothing in the product copy
 * should say it is.
 *
 * From API 33 the platform offers the thing actually wanted —
 * `setRecentsScreenshotEnabled(false)` — which suppresses the snapshot without
 * touching the reader's own screenshots at all.
 */
final class RecentsPrivacy {

    private RecentsPrivacy() {}

    /** Whether App Lock is on, so lifecycle callbacks know what to do. */
    private static volatile boolean armed = false;

    static void arm(boolean value) {
        armed = value;
    }

    static boolean isArmed() {
        return armed;
    }

    /**
     * Apply the standing preference: on API 33+ this is all that is needed,
     * and below it only records intent for the pause/resume pair to act on.
     */
    static void apply(Activity activity, boolean enabled) {
        arm(enabled);
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                activity.setRecentsScreenshotEnabled(!enabled);
            } catch (Throwable ignored) {
                // If the platform refuses, fall back to the flag dance below.
            }
        }
        if (!enabled) clearSecure(activity);
    }

    /** Going away: hide the window contents from the snapshot, if we must. */
    static void onLeaving(Activity activity) {
        if (!armed) return;
        if (Build.VERSION.SDK_INT >= 33) return; // handled by the platform
        activity.getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE);
    }

    /** Coming back: let the reader screenshot their own journal again. */
    static void onReturning(Activity activity) {
        if (Build.VERSION.SDK_INT >= 33) return;
        clearSecure(activity);
    }

    private static void clearSecure(Activity activity) {
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
