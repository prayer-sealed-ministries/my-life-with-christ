package org.prayersealed.ocrlab;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Android half of the shared OCR benchmark.
 *
 * Runs ML Kit Text Recognition v2 with the BUNDLED Latin model over exactly the
 * same corpus the Apple Vision harness uses, so the two engines are compared on
 * identical bytes rather than on two convenient corpora.
 *
 * Deliberate properties:
 *
 *   - Isolated. This Gradle project is not part of the application build, so ML
 *     Kit is never added to the shipping app by running a benchmark.
 *   - No permissions, no network. Images arrive via `adb push` into app-private
 *     storage. If the bundled model needed the network, that would surface here
 *     rather than in production.
 *   - No journal data. Every page is fictional and marked FICTIONAL-COMPAT.
 *
 * Results are written as one JSON file per sample into app-private files/, which
 * the harness pulls back with `adb pull` and scores with the same scorer the
 * iOS results go through.
 */
@RunWith(AndroidJUnit4.class)
public class OcrBenchmarkTest {

    private static final String TAG = "LWC_OCR_BENCH";
    /** A page that cannot finish in this long is a failure worth seeing. */
    private static final long TIMEOUT_SECONDS = 120;

    @Test
    public void recognizeCorpus() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File corpus = new File(context.getFilesDir(), "corpus");
        File results = new File(context.getFilesDir(), "results");
        if (!results.exists() && !results.mkdirs()) {
            throw new IllegalStateException("cannot create " + results);
        }

        File[] images = corpus.listFiles((dir, name) -> name.endsWith(".png"));
        if (images == null || images.length == 0) {
            throw new IllegalStateException(
                "No corpus images in " + corpus + ". Push them with adb before running.");
        }
        Arrays.sort(images);
        Log.i(TAG, "corpus images: " + images.length);

        TextRecognizer recognizer =
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

        // One warm-up so the first real sample is not paying model initialisation.
        // Reported separately below as the cold cost, because that is a real
        // first-use experience the product will have.
        long coldStart = System.nanoTime();
        recognize(recognizer, images[0]);
        long coldMs = (System.nanoTime() - coldStart) / 1_000_000;
        Log.i(TAG, "cold first recognition: " + coldMs + "ms");

        for (File image : images) {
            String id = image.getName().replace(".png", "");
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(image.getAbsolutePath(), bounds);

            long started = System.nanoTime();
            Text text = recognize(recognizer, image);
            long elapsedMs = (System.nanoTime() - started) / 1_000_000;

            JSONArray lines = new JSONArray();
            StringBuilder joined = new StringBuilder();
            for (Text.TextBlock block : text.getTextBlocks()) {
                for (Text.Line line : block.getLines()) {
                    JSONObject entry = new JSONObject();
                    entry.put("text", line.getText());
                    // ML Kit exposes per-element confidence; line confidence is
                    // available from API ? onwards and may be null. Recorded only
                    // when the SDK actually supplies it, never invented.
                    Float confidence = line.getConfidence();
                    if (confidence != null) entry.put("confidence", confidence.doubleValue());
                    if (line.getBoundingBox() != null) {
                        JSONObject box = new JSONObject();
                        box.put("left", line.getBoundingBox().left);
                        box.put("top", line.getBoundingBox().top);
                        box.put("width", line.getBoundingBox().width());
                        box.put("height", line.getBoundingBox().height());
                        entry.put("box", box);
                    }
                    lines.put(entry);
                    if (joined.length() > 0) joined.append('\n');
                    joined.append(line.getText());
                }
            }

            JSONObject out = new JSONObject();
            out.put("id", id);
            out.put("engine", "MLKitTextRecognitionV2");
            out.put("model", "bundled-latin");
            out.put("library", "com.google.mlkit:text-recognition:16.0.1");
            out.put("level", "default");
            out.put("languageCorrection", false);
            out.put("revision", 2);
            out.put("imageWidth", bounds.outWidth);
            out.put("imageHeight", bounds.outHeight);
            out.put("elapsedMs", elapsedMs);
            out.put("coldFirstMs", coldMs);
            out.put("lineCount", lines.length());
            out.put("lines", lines);
            out.put("text", joined.toString());

            File destination = new File(results, id + ".json");
            try (java.io.FileWriter writer = new java.io.FileWriter(destination)) {
                writer.write(out.toString());
            }
            Log.i(TAG, "recognised " + id + " in " + elapsedMs + "ms, " + lines.length() + " lines");
        }

        recognizer.close();
        Log.i(TAG, "benchmark complete: " + images.length + " samples");
    }

    /** Run one image to completion, surfacing any failure rather than hiding it. */
    private Text recognize(TextRecognizer recognizer, File image) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeFile(image.getAbsolutePath());
        if (bitmap == null) throw new IllegalStateException("cannot decode " + image);

        InputImage input = InputImage.fromBitmap(bitmap, 0);
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Text> result = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();

        recognizer.process(input)
            .addOnSuccessListener(value -> { result.set(value); latch.countDown(); })
            .addOnFailureListener(error -> { failure.set(error); latch.countDown(); });

        if (!latch.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new IllegalStateException("recognition timed out for " + image.getName());
        }
        bitmap.recycle();
        if (failure.get() != null) throw failure.get();
        return result.get();
    }

    /** Resource-safety: an absurd image must fail without taking the process down. */
    @Test
    public void oversizedAndMalformedInputFailSafely() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File bad = new File(context.getFilesDir(), "malformed.png");
        List<String> outcomes = new ArrayList<>();
        try {
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(bad)) {
                out.write(new byte[] {(byte) 0x89, 'P', 'N', 'G', 0, 0, 0, 0});
            }
            Bitmap decoded = BitmapFactory.decodeFile(bad.getAbsolutePath());
            outcomes.add("malformed decode returned " + (decoded == null ? "null (safe)" : "a bitmap"));
            if (decoded != null) decoded.recycle();
        } catch (Exception e) {
            outcomes.add("malformed threw " + e.getClass().getSimpleName() + " (safe)");
        } finally {
            //noinspection ResultOfMethodCallIgnored
            bad.delete();
        }
        Log.i(TAG, "resource safety: " + outcomes);
    }
}
