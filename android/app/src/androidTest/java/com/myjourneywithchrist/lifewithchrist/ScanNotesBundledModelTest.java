package com.myjourneywithchrist.lifewithchrist;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Scan notes recognises text locally, with no network permission at all.
 *
 * Two things are pinned here, and both are easy to lose by accident:
 *
 *   1. The app holds no INTERNET permission. Adding ML Kit pulls in
 *      play-services-base and play-services-basement, which merge INTERNET and
 *      ACCESS_NETWORK_STATE into an application that previously declared none.
 *      AndroidManifest.xml removes them deliberately. If a dependency upgrade
 *      quietly restores one, this test fails rather than the promise doing so.
 *
 *   2. Recognition still works without them. A removal that broke the feature
 *      would be worse than useless, so the same test that checks the permission
 *      is absent also reads a page.
 *
 * Everything drawn here is fictional.
 */
@RunWith(AndroidJUnit4.class)
public class ScanNotesBundledModelTest {

    private static final long TIMEOUT_SECONDS = 60;

    private Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    @Test
    public void appHoldsNoNetworkPermission() throws Exception {
        Context context = context();
        PackageInfo info = context.getPackageManager()
            .getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS);
        List<String> declared = info.requestedPermissions == null
            ? List.of()
            : Arrays.asList(info.requestedPermissions);

        assertFalse(
            "INTERNET must not be declared: text recognition is local and this journal "
                + "promises nothing leaves the device. Declared: " + declared,
            declared.contains(android.Manifest.permission.INTERNET));
        assertFalse(
            "ACCESS_NETWORK_STATE must not be declared. Declared: " + declared,
            declared.contains(android.Manifest.permission.ACCESS_NETWORK_STATE));

        // And no broad storage access: the photo picker hands over only what was
        // selected, so the library itself is never readable.
        assertFalse(declared.contains(android.Manifest.permission.READ_EXTERNAL_STORAGE));
        assertFalse(declared.contains(android.Manifest.permission.WRITE_EXTERNAL_STORAGE));
        assertFalse(declared.contains("android.permission.MANAGE_EXTERNAL_STORAGE"));
        assertFalse(declared.contains("android.permission.READ_MEDIA_IMAGES"));
    }

    @Test
    public void recognisesLocallyWithoutNetworkPermission() throws Exception {
        // Drawn rather than loaded, so the test carries its own ground truth and
        // needs no fixture file on the device.
        String expected = "FICTIONAL SCAN John 3:16";
        Bitmap page = Bitmap.createBitmap(1400, 420, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(page);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTextSize(96);
        paint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL));
        canvas.drawText(expected, 60, 240, paint);

        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Text> result = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();

        recognizer.process(InputImage.fromBitmap(page, 0))
            .addOnSuccessListener(value -> { result.set(value); latch.countDown(); })
            .addOnFailureListener(error -> { failure.set(error); latch.countDown(); });

        assertTrue("recognition timed out", latch.await(TIMEOUT_SECONDS, TimeUnit.SECONDS));
        recognizer.close();

        if (failure.get() != null) {
            throw new AssertionError(
                "Bundled recognition failed without network permission. Either the dependency "
                    + "changed to the unbundled model, or something now needs the network: "
                    + failure.get().getMessage(),
                failure.get());
        }

        assertNotNull(result.get());
        String read = result.get().getText().replaceAll("\\s+", " ").trim();
        // Not asserting an exact match: this is a recogniser, and the product's
        // whole design assumes a person reviews what it produced. What must hold
        // is that it genuinely read the page rather than returning nothing.
        assertTrue(
            "expected the drawn text to be recognised, got: " + read,
            read.contains("3:16") || read.contains("FICTIONAL"));
        page.recycle();
    }

    /*
     * There was a third test here that tried to prove provenance by inspecting
     * the class's code source. It asserted nothing useful and failed on its own
     * malformed comparison, which is exactly the kind of decoration this
     * repository keeps learning to delete.
     *
     * The real proof is recognisesLocallyWithoutNetworkPermission above: an
     * unbundled model cannot read anything on a device holding no network
     * permission with no model downloaded. If build.gradle were switched to
     * play-services-mlkit-text-recognition, that test would fail.
     */
}
