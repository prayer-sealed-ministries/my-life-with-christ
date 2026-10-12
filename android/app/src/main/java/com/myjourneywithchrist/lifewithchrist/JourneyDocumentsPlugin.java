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

import androidx.core.content.FileProvider;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
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

    /** Must match MAX_PICKED_FILE_BYTES in src/platform/file-limits.ts. */
    private static final long MAX_PICKED_BYTES = 64L * 1024L * 1024L;

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
        } catch (Exception error) {
            call.reject("The archive could not be saved: " + error.getMessage());
            return;
        }

        // Resolving after the try-with-resources block is significant: close()
        // can be the operation that commits a remote/document-provider file,
        // and a close failure must reach the caller before success does.
        call.resolve(new JSObject().put("saved", true));
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

        long declaredSize = displaySizeOf(source);
        if (declaredSize > MAX_PICKED_BYTES) {
            call.reject("That file is larger than the 64MB import limit and was not read.");
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
            long total = 0;
            while ((read = in.read(chunk)) != -1) {
                total += read;
                if (total > MAX_PICKED_BYTES) {
                    call.reject("That file is larger than the 64MB import limit and was not read.");
                    return;
                }
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
        return displayNameOf(uri, "archive.zip");
    }

    private String displayNameOf(Uri uri, String fallback) {
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

    /** Size advertised by the document provider, or -1 when it is unknown. */
    private long displaySizeOf(Uri uri) {
        try (android.database.Cursor cursor =
                getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE);
                if (column >= 0 && !cursor.isNull(column)) {
                    return cursor.getLong(column);
                }
            }
        } catch (Exception ignored) {
            // The streaming count below is authoritative when metadata is absent.
        }
        return -1;
    }

    /**
     * The largest shared document this will read into memory.
     *
     * Mirrors MAX_SERMON_NOTES_BYTES in src/import/sermon-notes.ts. Checked
     * HERE as well as there, because the shared gate runs after the bytes have
     * crossed the bridge: refusing a 2GB file in TypeScript would mean having
     * base64'd 2GB into the webview first. The shared code remains the one that
     * decides what is importable; this only declines to carry the impossible.
     */
    private static final long MAX_SHARED_BYTES = 8L * 1024L * 1024L;

    /**
     * Collect a document the system shared with this app, if one is waiting.
     *
     * Take-once: the slot is cleared as it is read, so a redelivered intent
     * cannot become a second copy of the same handout.
     *
     * The content URI does not cross the bridge. It is read here, while the
     * grant is still valid, and what goes back is a name, a media type and
     * bytes — nothing that expires, and nothing that would put an Android
     * lifetime rule inside code that also runs in a browser.
     */
    @PluginMethod
    public void takeSharedDocument(PluginCall call) {
        SharedDocument.Pending pending = SharedDocument.take();

        if (pending == null) {
            call.resolve(new JSObject().put("present", false));
            return;
        }

        JSObject response = new JSObject();
        response.put("present", true);
        if (pending.error != null) {
            response.put("error", pending.error);
            call.resolve(response);
            return;
        }

        if (pending.text != null) {
            byte[] bytes = pending.text.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_SHARED_BYTES) {
                response.put("error", "That shared text is larger than the 8MB limit for sermon notes.");
            } else {
                response.put("name", "shared-text.txt");
                response.put("mimeType", "text/plain");
                response.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            }
            call.resolve(response);
            return;
        }

        Uri source = pending.uri;
        if (source == null) {
            response.put("error", "That shared item did not contain readable text or a document.");
            call.resolve(response);
            return;
        }
        response.put("name", displayNameOf(source, "shared document"));

        String type = pending.declaredType;
        if (type == null || type.isEmpty() || type.equals("*/*")) {
            // The sender said nothing useful. Ask the content resolver, which
            // asks the provider that owns the document.
            type = getContext().getContentResolver().getType(source);
        }
        response.put("mimeType", type == null ? "" : type);

        try (InputStream in = getContext().getContentResolver().openInputStream(source)) {
            if (in == null) {
                response.put("error", "That document could not be opened.");
                call.resolve(response);
                return;
            }

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            long total = 0;
            while ((read = in.read(chunk)) != -1) {
                total += read;
                if (total > MAX_SHARED_BYTES) {
                    // Stop reading rather than finish and then complain: the
                    // point of a limit is not to hold the thing it refuses.
                    response.put("error", "That document is larger than the 8MB limit for sermon notes.");
                    call.resolve(response);
                    return;
                }
                buffer.write(chunk, 0, read);
            }

            response.put("base64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            call.resolve(response);
        } catch (SecurityException denied) {
            // The grant was revoked, or never covered this process. An honest
            // message, and nothing imported.
            response.put("error", "This app no longer has permission to read that document.");
            call.resolve(response);
        } catch (Exception error) {
            response.put("error", "That document could not be read.");
            call.resolve(response);
        }
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

    /**
     * The directory shared pages are written into, inside this app's cache.
     *
     * A subdirectory rather than the cache root so that cleaning up what this
     * feature made cannot touch anything else that happens to be cached.
     */
    private static final String SHARE_DIR = "shared";

    /**
     * Offer one page of the journal to the system share sheet.
     *
     * WHERE THE FILE LIVES, AND WHY IT IS SAFE
     *
     * `getCacheDir()` is this application's private cache: no other app can
     * read it, and it needs no storage permission — this plugin still declares
     * none. The file is handed out through the FileProvider already configured
     * for this package, which mints a URI granting read access to exactly that
     * one file, to exactly the app the person chooses, for as long as the
     * chooser lives. No path ever crosses into JavaScript and no directory is
     * exposed.
     *
     * Stale pages from earlier shares are removed first. A share is meant to
     * be ephemeral; a cache quietly accumulating somebody's journal pages
     * would be the opposite of what this feature promises.
     */
    @PluginMethod
    public void shareDocument(PluginCall call) {
        String title = call.getString("title", "");
        String text = call.getString("text");
        String name = call.getString("name");
        String mimeType = call.getString("mimeType");
        String base64 = call.getString("base64");

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("There is no window to share from.");
            return;
        }

        Intent send = new Intent(Intent.ACTION_SEND);
        if (title != null && !title.isEmpty()) {
            send.putExtra(Intent.EXTRA_SUBJECT, title);
        }

        if (base64 != null && !base64.isEmpty() && name != null && !name.isEmpty()) {
            Uri uri;
            try {
                uri = writeShareFile(name, Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception failure) {
                call.reject("That page could not be prepared for sharing.");
                return;
            }
            send.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            // The grant travels with the intent and dies with the chooser.
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else if (text != null && !text.isEmpty()) {
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
        } else {
            call.reject("There was nothing to share.");
            return;
        }

        try {
            activity.startActivity(Intent.createChooser(send, title));
        } catch (Exception failure) {
            call.reject("This device has nothing to share with.");
            return;
        }

        /*
         * Resolved as soon as the chooser is shown.
         *
         * Android does not tell an app what the person picked, or whether they
         * picked anything at all — and this application deliberately does not
         * want to know. "Shared" here means "the sheet was opened", which is
         * the only honest claim available, and the journal is unchanged either
         * way.
         */
        JSObject result = new JSObject();
        result.put("shared", true);
        call.resolve(result);
    }

    /** Write one page into the private share cache, replacing what was there. */
    private Uri writeShareFile(String name, byte[] bytes) throws Exception {
        File dir = new File(getContext().getCacheDir(), SHARE_DIR);
        if (dir.exists()) {
            File[] stale = dir.listFiles();
            if (stale != null) {
                for (File file : stale) {
                    // Best effort: a file another app still holds open is not
                    // worth failing a share over, and it is overwritten below.
                    file.delete();
                }
            }
        } else if (!dir.mkdirs()) {
            throw new IllegalStateException("could not create the share directory");
        }

        // The name is rebuilt here rather than trusted: a filename is the one
        // piece of this that came from a document title somebody typed.
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "-");
        if (safe.isEmpty() || safe.equals(".") || safe.equals("..")) {
            safe = "entry";
        }

        File file = new File(dir, safe);
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }
}
