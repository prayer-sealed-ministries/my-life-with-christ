package com.myjourneywithchrist.lifewithchrist;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * The native document bridge for Android.
 *
 * Two verbs, and deliberately no more: hand the user bytes and let them choose
 * where the file goes, and let them choose a file and hand us its bytes.
 *
 * This file knows nothing about journals or archives. It moves bytes and a
 * filename. The canonical archive — manifest, checksums, schema, the book — is
 * built and parsed entirely in shared TypeScript, so there is one implementation
 * of the format across every edition. Nothing here may grow an opinion about it.
 *
 * WHY THE STORAGE ACCESS FRAMEWORK
 *
 * ACTION_CREATE_DOCUMENT and ACTION_OPEN_DOCUMENT let the person choose a
 * destination or a file through the system document UI, and the app receives a
 * grant for exactly that one document. That is why this plugin needs no storage
 * permission at all: not READ_EXTERNAL_STORAGE, not WRITE_EXTERNAL_STORAGE, and
 * certainly not MANAGE_EXTERNAL_STORAGE. Asking for the filesystem in order to
 * write one file the user already pointed at would be taking far more than the
 * task requires.
 *
 * A share intent was considered and rejected for saving: it asks "send a copy to
 * an app", where the archive's whole purpose is that the person keeps it
 * somewhere of their own choosing.
 */
@CapacitorPlugin(name = "JourneyDocuments")
public class JourneyDocumentsPlugin extends Plugin {

    /** Bytes waiting for a destination the user has not chosen yet. */
    private byte[] pendingBytes;

    @PluginMethod
    public void saveDocument(PluginCall call) {
        String name = call.getString("name");
        String base64 = call.getString("base64");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (name == null || base64 == null) {
            call.reject("A document needs a name and its bytes.");
            return;
        }

        try {
            // Held in memory rather than staged to disk: Android hands us an
            // OutputStream for the destination the user picks, so there is no
            // need for a temporary file, and therefore no temporary copy of the
            // journal to leave behind.
            pendingBytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("The archive could not be prepared for saving.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, name);

        startActivityForResult(call, intent, "saveDocumentResult");
    }

    @ActivityCallback
    private void saveDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        byte[] bytes = pendingBytes;
        pendingBytes = null;

        // Backing out is an ordinary outcome, not a failure.
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }

        Uri destination = result.getData().getData();
        if (destination == null || bytes == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }

        try (OutputStream out = getContext().getContentResolver().openOutputStream(destination)) {
            if (out == null) {
                call.reject("That location could not be written to.");
                return;
            }
            out.write(bytes);
            out.flush();
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception error) {
            call.reject("The archive could not be saved: " + error.getMessage());
        }
    }

    @PluginMethod
    public void pickDocument(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");

        List<String> types = mimeTypesFrom(call.getArray("mimeTypes", null));
        if (!types.isEmpty()) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        }

        startActivityForResult(call, intent, "pickDocumentResult");
    }

    @ActivityCallback
    private void pickDocumentResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }

        Uri source = result.getData().getData();
        if (source == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }

        try (InputStream in = getContext().getContentResolver().openInputStream(source)) {
            if (in == null) {
                call.reject("That file could not be read.");
                return;
            }

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }

            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("name", displayName(source));
            response.put("base64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("That file could not be read: " + error.getMessage());
        }
    }

    /**
     * The name the user sees, not the content URI.
     *
     * The URI never crosses the bridge: no view and no part of the shared
     * importer should have to know that Android content providers exist.
     */
    private String displayName(Uri uri) {
        String fallback = "archive.zip";
        try (android.database.Cursor cursor =
                getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // Falls through to the default below.
        }
        return fallback;
    }

    /** Extensions are a web-picker idiom; Android filters on media types. */
    private List<String> mimeTypesFrom(JSArray hints) {
        List<String> types = new ArrayList<>();
        if (hints == null) {
            return types;
        }
        try {
            for (Object hint : hints.toList()) {
                String value = String.valueOf(hint);
                if (value.equals(".zip")) {
                    types.add("application/zip");
                } else if (value.contains("/")) {
                    types.add(value);
                }
            }
        } catch (Exception ignored) {
            // An unusable hint list is not worth failing a pick over.
        }
        return types;
    }
}
