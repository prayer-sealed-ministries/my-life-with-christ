package com.myjourneywithchrist.lifewithchrist;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;

public class DocumentSaveOperationTest {
    private static final byte[] ARCHIVE = new byte[] { 1, 2, 3, 4 };

    private static final class RecordingCompletion implements DocumentSaveOperation.Completion {
        int saved;
        int cancelled;
        int failed;
        DocumentSaveOperation.Failure failure;
        TrackingStream stream;

        @Override
        public void saved() {
            saved += 1;
            if (stream != null) {
                assertTrue("success arrived before flush", stream.flushed);
                assertTrue("success arrived before close", stream.closed);
            }
        }

        @Override
        public void cancelled() {
            cancelled += 1;
        }

        @Override
        public void failed(DocumentSaveOperation.Failure value) {
            failed += 1;
            failure = value;
        }

        void assertExactlyOnce() {
            assertEquals(1, saved + cancelled + failed);
        }
    }

    private static final class TrackingStream extends OutputStream {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        final boolean failWrite;
        final boolean failFlush;
        final boolean failClose;
        boolean flushed;
        boolean closed;

        TrackingStream(boolean failWrite, boolean failFlush, boolean failClose) {
            this.failWrite = failWrite;
            this.failFlush = failFlush;
            this.failClose = failClose;
        }

        @Override
        public void write(int value) throws IOException {
            if (failWrite) {
                throw new IOException("write failed");
            }
            bytes.write(value);
        }

        @Override
        public void flush() throws IOException {
            if (failFlush) {
                throw new IOException("flush failed");
            }
            flushed = true;
        }

        @Override
        public void close() throws IOException {
            closed = true;
            if (failClose) {
                throw new IOException("close failed");
            }
        }
    }

    @Test
    public void reportsSuccessOnlyAfterWriteFlushAndClose() {
        TrackingStream stream = new TrackingStream(false, false, false);
        RecordingCompletion completion = new RecordingCompletion();
        completion.stream = stream;

        DocumentSaveOperation.write(() -> stream, ARCHIVE, completion);

        assertArrayEquals(ARCHIVE, stream.bytes.toByteArray());
        assertEquals(1, completion.saved);
        assertEquals(0, completion.failed);
        completion.assertExactlyOnce();
    }

    @Test
    public void reportsOpenFailureExactlyOnce() {
        RecordingCompletion completion = new RecordingCompletion();

        DocumentSaveOperation.write(() -> {
            throw new IOException("open failed");
        }, ARCHIVE, completion);

        assertEquals(DocumentSaveOperation.Failure.IO, completion.failure);
        completion.assertExactlyOnce();
    }

    @Test
    public void reportsWriteFailureAndStillClosesExactlyOnce() {
        TrackingStream stream = new TrackingStream(true, false, false);
        RecordingCompletion completion = new RecordingCompletion();

        DocumentSaveOperation.write(() -> stream, ARCHIVE, completion);

        assertTrue(stream.closed);
        assertFalse(stream.flushed);
        assertEquals(DocumentSaveOperation.Failure.IO, completion.failure);
        completion.assertExactlyOnce();
    }

    @Test
    public void reportsFlushFailureAndStillClosesExactlyOnce() {
        TrackingStream stream = new TrackingStream(false, true, false);
        RecordingCompletion completion = new RecordingCompletion();

        DocumentSaveOperation.write(() -> stream, ARCHIVE, completion);

        assertTrue(stream.closed);
        assertEquals(DocumentSaveOperation.Failure.IO, completion.failure);
        completion.assertExactlyOnce();
    }

    @Test
    public void reportsCloseFailureInsteadOfSuccess() {
        TrackingStream stream = new TrackingStream(false, false, true);
        RecordingCompletion completion = new RecordingCompletion();
        completion.stream = stream;

        DocumentSaveOperation.write(() -> stream, ARCHIVE, completion);

        assertTrue(stream.flushed);
        assertTrue(stream.closed);
        assertEquals(0, completion.saved);
        assertEquals(DocumentSaveOperation.Failure.IO, completion.failure);
        completion.assertExactlyOnce();
    }

    @Test
    public void rejectsANullProviderStreamExactlyOnce() {
        RecordingCompletion completion = new RecordingCompletion();

        DocumentSaveOperation.write(() -> null, ARCHIVE, completion);

        assertEquals(DocumentSaveOperation.Failure.NO_STREAM, completion.failure);
        completion.assertExactlyOnce();
    }

    @Test
    public void reportsCancellationWithoutOpeningAStream() {
        RecordingCompletion completion = new RecordingCompletion();

        DocumentSaveOperation.cancelled(completion);

        assertEquals(1, completion.cancelled);
        assertEquals(0, completion.saved);
        assertEquals(0, completion.failed);
        completion.assertExactlyOnce();
    }
}
