package com.myjourneywithchrist.lifewithchrist;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The in-repository document bridge, registered before the bridge starts.
        // Two methods only: save a document the user places, and pick one they
        // choose. Everything about what an archive IS stays in shared TypeScript.
        registerPlugin(JourneyDocumentsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
