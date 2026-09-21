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
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        SharedDocument.remember(intent);
    }
}
