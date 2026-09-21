package com.myjourneywithchrist.lifewithchrist;

import android.content.Intent;
import android.net.Uri;

/**
 * The one document the system has shared with this app and nobody has collected.
 *
 * A single static slot, held between the Activity receiving an intent and the
 * web layer asking for it. Static because the Activity may be recreated —
 * rotation, process restart after a configuration change — while the same
 * shared document is still waiting, and a field on the Activity would go with
 * it.
 *
 * TAKE-ONCE. `take()` clears the slot. Android redelivers intents more readily
 * than one would like, and an intent that is handed over twice would otherwise
 * become two copies of one handout. Clearing on collection is what makes that
 * impossible rather than merely unlikely.
 *
 * Only the URI is held, never the bytes: the grant is alive for as long as the
 * activity that received it, so reading is deferred to collection time and the
 * app never sits on a copy of somebody's document it was not asked to keep.
 */
final class SharedDocument {

    private static Uri pending;
    private static String declaredType;

    private SharedDocument() {}

    /**
     * Remember a document from an incoming intent, if it carries one.
     *
     * Accepts the two ways a document arrives: SEND puts it in EXTRA_STREAM,
     * VIEW puts it in the data. Anything else — a launcher tap, the sermon-note
     * shortcut, an intent with no document — leaves the slot alone, so a normal
     * launch is never mistaken for a share.
     */
    static synchronized void remember(Intent intent) {
        if (intent == null) {
            return;
        }

        final String action = intent.getAction();
        Uri uri = null;

        if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        } else if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        }

        if (uri == null) {
            return;
        }

        // The launcher shortcut is also an ACTION_VIEW, carrying this app's own
        // scheme. That is an action name, not a document, and it is handled by
        // src/app/launch-actions.ts — reading it here would turn a shortcut tap
        // into a failed import.
        final String scheme = uri.getScheme();
        if (scheme == null || "mylifewithchrist".equalsIgnoreCase(scheme)) {
            return;
        }

        pending = uri;
        declaredType = intent.getType();
    }

    /** The waiting document, cleared as it is handed over. Null when there is none. */
    static synchronized Uri take() {
        final Uri uri = pending;
        pending = null;
        return uri;
    }

    /** The media type the sender declared, for the document `take()` just returned. */
    static synchronized String takeDeclaredType() {
        final String type = declaredType;
        declaredType = null;
        return type;
    }
}
