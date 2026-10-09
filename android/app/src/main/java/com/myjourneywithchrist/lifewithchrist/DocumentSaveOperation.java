package com.myjourneywithchrist.lifewithchrist;

import java.io.OutputStream;

/**
 * The failure-sensitive part of a Storage Access Framework save.
 *
 * Success is deliberately emitted after the try-with-resources statement has
 * closed the provider stream. Some document providers defer their final write
 * until close; acknowledging the archive from inside that block would turn a
 * close failure into a false successful backup.
 */
final class DocumentSaveOperation {
    enum Failure {
        NO_STREAM,
        IO
    }

    interface StreamFactory {
        OutputStream open() throws Exception;
    }

    interface Completion {
        void saved();

        void cancelled();

        void failed(Failure failure);
    }

    private DocumentSaveOperation() {
    }

    static void cancelled(Completion completion) {
        completion.cancelled();
    }

    static void write(StreamFactory factory, byte[] bytes, Completion completion) {
        try {
            OutputStream opened = factory.open();
            if (opened == null) {
                completion.failed(Failure.NO_STREAM);
                return;
            }

            try (OutputStream out = opened) {
                out.write(bytes);
                out.flush();
            }
        } catch (Exception failure) {
            completion.failed(Failure.IO);
            return;
        }

        // Reaching here proves open, write, flush AND close completed. It does
        // not claim physical-media durability or cloud-provider synchrony.
        completion.saved();
    }
}
