package com.myjourneywithchrist.lifewithchrist;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.UUID;

/**
 * Scan notes, on this device.
 *
 * ML Kit Text Recognition v2 with the BUNDLED Latin model reads the page.
 * Bundled is the point: recognition works the moment the app is installed, with
 * no network and no Play Services dependency. The unbundled variant is 78 KB
 * instead of ~12 MB but downloads its model on first use, which would break the
 * offline promise this journal is built on.
 *
 * Nothing leaves the phone. There is no HTTP client in this file, no endpoint,
 * and no fallback. Recognised text is never written to logcat.
 *
 * Temporary scans live in a dedicated directory inside the app's own cache with
 * random names, are deleted on discard, and any left by a crashed run are swept
 * at launch. A photo the person picked from their library is never touched —
 * only our copy of it.
 */
@CapacitorPlugin(
    name = "ScanNotes",
    permissions = {
        // Requested only when Take photo is invoked, never at launch and never
        // during onboarding. Denying it leaves the rest of the app untouched.
        @Permission(alias = "camera", strings = { android.Manifest.permission.CAMERA })
    }
)
public class ScanNotesPlugin extends Plugin {

    /** Our own corner of the cache. Never external storage, never shared. */
    private static final String DIRECTORY = "scan-notes";
    /** A scan older than this is certainly abandoned. */
    /** Beyond this the working image is downscaled; see decodeBounded. */
    private static final int MAX_WORKING_DIMENSION = 2600;
    /** Refuse absurd input before decoding it. */
    private static final long MAX_SOURCE_BYTES = 40L * 1024 * 1024;
    /** Below this a page is likely motion-blurred. Warns; never refuses. */
    private static final double BLUR_WARNING_BELOW = 120;

    private File scanDirectory() {
        File directory = new File(getContext().getCacheDir(), DIRECTORY);
        if (!directory.exists()) {
            //noinspection ResultOfMethodCallIgnored
            directory.mkdirs();
        }
        return directory;
    }

    /**
     * A handle is a UUID and nothing else.
     *
     * It carries nothing about the page — no entry title, no date, no Scripture
     * — and a crafted value cannot walk out of our directory.
     */
    private File fileFor(String handle) {
        try {
            UUID.fromString(handle);
        } catch (Exception invalid) {
            return null;
        }
        return new File(scanDirectory(), handle + ".jpg");
    }

    // ---------------------------------------------------------------- capture

    @PluginMethod
    public void capture(PluginCall call) {
        if (getPermissionState("camera") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionResult");
            return;
        }
        launchCamera(call);
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void cameraPermissionResult(PluginCall call) {
        if (getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED) {
            launchCamera(call);
        } else {
            call.resolve(failure("permission-denied"));
        }
    }

    private void launchCamera(PluginCall call) {
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.resolve(failure("unsupported"));
            return;
        }
        startActivityForResult(call, intent, "pictureResult");
    }

    @PluginMethod
    public void choose(PluginCall call) {
        // The system photo picker hands over only what was selected. The app
        // asks for no storage permission and never enumerates the library.
        Intent intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
        }
        startActivityForResult(call, intent, "pictureResult");
    }

    @ActivityCallback
    private void pictureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.resolve(failure("cancelled"));
            return;
        }
        try {
            Bitmap bitmap = null;
            Intent data = result.getData();
            if (data != null && data.getData() != null) {
                bitmap = decodeBounded(data.getData());
            } else if (data != null && data.getExtras() != null) {
                // Some camera apps return a thumbnail in the extras.
                Object extra = data.getExtras().get("data");
                if (extra instanceof Bitmap) bitmap = (Bitmap) extra;
            }
            if (bitmap == null) {
                call.resolve(failure("unreadable"));
                return;
            }
            call.resolve(store(bitmap));
        } catch (OutOfMemoryError tooBig) {
            call.resolve(failure("too-large"));
        } catch (Exception failed) {
            // Deliberately not surfacing the message: an exception can carry a
            // content URI, and a path to somebody's notebook is not for logs.
            call.resolve(failure("failed"));
        }
    }

    /**
     * Decode without letting an enormous photograph become an enormous bitmap.
     *
     * Recognition stayed at 0.00% character error through 0.28x downscaling in
     * the benchmark, so there is no accuracy reason to decode a 48-megapixel
     * image at full size, and a good memory reason not to.
     */
    private Bitmap decodeBounded(Uri uri) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream probe = getContext().getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(probe, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        if ((long) bounds.outWidth * bounds.outHeight > 80_000_000L) {
            throw new OutOfMemoryError("image dimensions beyond supported range");
        }

        int sample = 1;
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        while (longest / sample > MAX_WORKING_DIMENSION) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
            return BitmapFactory.decodeStream(stream, null, options);
        }
    }

    private JSObject store(Bitmap bitmap) throws Exception {
        String handle = UUID.randomUUID().toString();
        File destination = fileFor(handle);
        ByteArrayOutputStream encoded = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 92, encoded);
        byte[] bytes = encoded.toByteArray();
        try (FileOutputStream out = new FileOutputStream(destination)) {
            out.write(bytes);
        }

        JSObject page = new JSObject();
        page.put("handle", handle);
        // A data URL, so the review screen never receives a file path.
        page.put("preview", "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
        page.put("width", bitmap.getWidth());
        page.put("height", bitmap.getHeight());
        page.put("blurScore", blurScore(bitmap));
        return page;
    }

    // ------------------------------------------------------------ recognition

    @PluginMethod
    public void recognise(PluginCall call) {
        String handle = call.getString("handle");
        File file = handle == null ? null : fileFor(handle);
        if (file == null || !file.exists()) {
            call.resolve(failure("failed"));
            return;
        }
        if (file.length() > MAX_SOURCE_BYTES) {
            call.resolve(failure("too-large"));
            return;
        }

        Bitmap bitmap = BitmapFactory.decodeFile(file.getAbsolutePath());
        if (bitmap == null) {
            call.resolve(failure("unreadable"));
            return;
        }

        read(call, bitmap);
    }

    /**
     * Recognise an image handed over directly, with no file behind it.
     *
     * This is the scanned-PDF path. A page rendered from a PDF never becomes a
     * file: it arrives as encoded bytes, is decoded here, read, and dropped.
     * Writing it to disk first would mean a picture of somebody's handout
     * sitting in a cache for no reason, and a second thing to clean up.
     *
     * The SAME recogniser as a photographed page. There is one Apple Vision
     * implementation and one ML Kit implementation in this product, and adding
     * a second for PDFs would be two things to keep honest instead of one.
     */
    @PluginMethod
    public void recogniseImage(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.resolve(failure("unreadable"));
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException malformed) {
            call.resolve(failure("unreadable"));
            return;
        }
        if (bytes.length > MAX_SOURCE_BYTES) {
            call.resolve(failure("too-large"));
            return;
        }

        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) {
            call.resolve(failure("unreadable"));
            return;
        }

        read(call, bitmap);
    }

    /** The one place a bitmap is turned into text, whatever produced it. */
    private void read(PluginCall call, Bitmap bitmap) {
        // DEFAULT_OPTIONS is the bundled Latin recogniser. Changing this to the
        // Play-Services variant would silently make first use require a model
        // download; ScanNotesBundledModelTest exists to catch that.
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        long started = System.nanoTime();

        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener(text -> {
                long elapsedMs = (System.nanoTime() - started) / 1_000_000;
                JSArray lines = new JSArray();
                StringBuilder joined = new StringBuilder();
                for (Text.TextBlock block : text.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        JSObject entry = new JSObject();
                        entry.put("text", line.getText());
                        Float confidence = line.getConfidence();
                        if (confidence != null) entry.put("confidence", confidence.doubleValue());
                        if (line.getBoundingBox() != null) {
                            JSObject box = new JSObject();
                            // Normalised 0-1 from the top-left, matching iOS, so
                            // the review screen never learns which engine ran.
                            box.put("x", (double) line.getBoundingBox().left / bitmap.getWidth());
                            box.put("y", (double) line.getBoundingBox().top / bitmap.getHeight());
                            box.put("width", (double) line.getBoundingBox().width() / bitmap.getWidth());
                            box.put("height", (double) line.getBoundingBox().height() / bitmap.getHeight());
                            entry.put("box", box);
                        }
                        lines.put(entry);
                        if (joined.length() > 0) joined.append('\n');
                        joined.append(line.getText());
                    }
                }

                JSObject result = new JSObject();
                // No logging of recognised text anywhere in this file.
                result.put("text", joined.toString());
                result.put("lines", lines);
                result.put("imageWidth", bitmap.getWidth());
                result.put("imageHeight", bitmap.getHeight());
                result.put("engine", "MLKitTextRecognitionV2");
                result.put("elapsedMs", elapsedMs);
                recognizer.close();
                bitmap.recycle();
                call.resolve(result);
            })
            .addOnFailureListener(error -> {
                recognizer.close();
                bitmap.recycle();
                call.resolve(failure("failed"));
            });
    }

    // --------------------------------------------------------------- cleanup

    @PluginMethod
    public void discard(PluginCall call) {
        String handle = call.getString("handle");
        File file = handle == null ? null : fileFor(handle);
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
        call.resolve();
    }

    /**
     * Delete every temporary scan, at launch.
     *
     * Called once from the app's entry point, before anything can photograph a
     * page. Nothing in this directory can belong to the process that is
     * starting: a scan waiting to be claimed lives in memory, and memory is
     * what a cold start does not have. So everything here is an orphan from a
     * run that crashed, was killed, or was swiped away.
     *
     * This used to spare anything under six hours old, which was a safety
     * margin against a question nobody had asked. It matters more now: a page
     * is deliberately NOT deleted when the screen goes away, because that is
     * what App Lock looks like and the person is coming back for it. The cost
     * of that decision is more orphans, and this is where they are paid for.
     */
    @PluginMethod
    public void cleanupStale(PluginCall call) {
        int removed = 0;
        File[] entries = scanDirectory().listFiles();
        if (entries != null) {
            for (File entry : entries) {
                if (entry.delete()) removed += 1;
            }
        }
        JSObject result = new JSObject();
        result.put("removed", removed);
        call.resolve(result);
    }

    // ---------------------------------------------------------------- helpers

    private JSObject failure(String reason) {
        JSObject object = new JSObject();
        object.put("failure", reason);
        return object;
    }

    /**
     * A rough variance-of-Laplacian focus score.
     *
     * Only ever used to decide whether to OFFER a warning. Blur was the single
     * catastrophic failure mode in the benchmark — 93% character error on the
     * heavily blurred sample, against 0.00% for low resolution, heavy JPEG and
     * very dim light — so it is worth saying something before a person finds it
     * in the transcription. A score is not a verdict; they may always proceed.
     */
    private double blurScore(Bitmap source) {
        int width = Math.min(source.getWidth(), 512);
        int height = Math.max(1, (int) (source.getHeight() * ((double) width / source.getWidth())));
        Bitmap small = Bitmap.createScaledBitmap(source, width, height, true);
        int[] pixels = new int[width * height];
        small.getPixels(pixels, 0, width, 0, 0, width, height);

        double[] grey = new double[pixels.length];
        for (int i = 0; i < pixels.length; i++) {
            int p = pixels[i];
            grey[i] = 0.299 * ((p >> 16) & 0xff) + 0.587 * ((p >> 8) & 0xff) + 0.114 * (p & 0xff);
        }

        double sum = 0;
        int count = 0;
        double[] laplacian = new double[Math.max(1, (width - 2) * (height - 2))];
        for (int y = 1; y < height - 1; y++) {
            for (int x = 1; x < width - 1; x++) {
                int i = y * width + x;
                double value = -4 * grey[i] + grey[i - 1] + grey[i + 1] + grey[i - width] + grey[i + width];
                laplacian[count++] = value;
                sum += value;
            }
        }
        if (small != source) small.recycle();
        if (count == 0) return 1000;

        double mean = sum / count;
        double variance = 0;
        for (int i = 0; i < count; i++) variance += (laplacian[i] - mean) * (laplacian[i] - mean);
        return variance / count;
    }
}
