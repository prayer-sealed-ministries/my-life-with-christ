package com.myjourneywithchrist.lifewithchrist;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The in-repository document bridge, registered before the bridge starts.
        // Three methods only: save a document the user places, pick one they
        // choose, and collect one the system shared. Everything about what an
        // archive or a sermon handout IS stays in shared TypeScript.
        registerPlugin(JourneyDocumentsPlugin.class);
        // App Lock: the PIN verifier, the attempt penalty and the device-credential
        // recovery path all live natively, so none of it is reachable from the
        // web layer except through these methods.
        registerPlugin(AppLockPlugin.class);
        super.onCreate(savedInstanceState);

        // A cold share: the intent this process was created for.
        SharedDocument.remember(getIntent());
    }

    /**
     * A warm share. The activity is `singleTask`, so a second share while the
     * app is running arrives here rather than as a new process.
     *
     * `setIntent` matters: without it `getIntent()` keeps returning the one the
     * activity was created with, and anything asking later would see the old
     * document instead of this one.
     */
    /**
     * Going away. While App Lock is on, the journal must not stay readable in
     * the app switcher; below API 33 that means FLAG_SECURE, set here and
     * cleared on the way back so ordinary screenshots keep working.
     */
    @Override
    public void onPause() {
        RecentsPrivacy.onLeaving(this);
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        RecentsPrivacy.onReturning(this);
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        SharedDocument.remember(intent);
    }
}
