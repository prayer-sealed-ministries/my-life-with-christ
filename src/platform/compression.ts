/**
 * Reading a compressed archive, on every runtime this app supports.
 *
 * THE RISK THIS FILE EXISTS TO REMOVE
 *
 * Writing an archive and reading one are not equally supported. `export/zip.ts`
 * degrades when `CompressionStream` is missing — it stores instead of deflating,
 * and still produces a valid, readable archive. Reading had no such fallback:
 * without `DecompressionStream` there was no way to inflate a deflated member,
 * so import failed outright.
 *
 * The consequence was specific and bad: a person could export a journal for
 * years and then be unable to restore it. Not "a degraded experience" — an
 * archive they could not open on the device that made it.
 *
 * MEASURED, AND WHY THERE IS NOW A BUNDLED INFLATE
 *
 * The supported range is not a guess. The generated projects say
 * `IPHONEOS_DEPLOYMENT_TARGET = 15.0` (Capacitor 8's SPM manifest requires
 * `.iOS(.v15)`) and `minSdkVersion = 24`. Compression Streams arrived in WebKit
 * years after iOS 15.0 shipped, so part of the range this app declares it runs
 * on cannot inflate at all. Phase 1 measured iOS 26.5 and Android 15 passing,
 * which says nothing about the floor.
 *
 * Raising the minimum OS to dodge this would be trading away the oldest
 * devices — often the ones a person still uses precisely because it holds their
 * journal — to avoid carrying ten kilobytes. So the inflate is carried.
 *
 * `fflate` (MIT, actively maintained) provides it: pure JavaScript, no network,
 * no wasm, deterministic, and streaming, which is what lets the bounded reader
 * keep enforcing its ceiling chunk by chunk. It is imported *dynamically* and
 * only when the platform has no `DecompressionStream`, so a modern runtime pays
 * nothing for it.
 *
 * Whichever path runs, the caller's limits and validation are identical. There
 * is one archive format and one set of rules about reading it.
 */

/** Can this runtime inflate at all? True everywhere now: see the bundled path. */
export function canDecompress(): boolean {
  return true;
}

/** Does the platform provide inflate itself, or will the bundled one be used? */
export function hasNativeDecompression(): boolean {
  return typeof DecompressionStream !== 'undefined';
}

/** Can this runtime deflate? Only affects archive SIZE, never readability. */
export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/**
 * The message shown when an archive cannot be read here.
 *
 * "Device", not "browser": this string is reachable inside an installed
 * application, where there is no browser from the reader's point of view. Kept
 * even though the bundled inflate makes it unreachable in normal use, because
 * the bounded reader still refuses archives that are too large to open safely.
 */
export const CANNOT_DECOMPRESS =
  'This device cannot open compressed archives, so this file cannot be read here.';

/**
 * Throw unless this runtime can inflate.
 *
 * Retained as the single place that would refuse, so removing the bundled
 * fallback later cannot silently turn "cannot read" into a crash somewhere
 * else. It no longer throws in practice.
 */
export function requireDecompression(): void {
  if (!canDecompress()) throw new Error(CANNOT_DECOMPRESS);
}

/** Loaded at most once, and only where the platform cannot inflate. */
let fflate: Promise<typeof import('fflate')> | null = null;
const loadFallback = () => (fflate ??= import('fflate'));

/**
 * Inflate a raw DEFLATE member whole.
 *
 * Used where the caller has already bounded the input — reading an archive this
 * app wrote. For untrusted input prefer `inflateRawChunks`, which can stop.
 */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (hasNativeDecompression()) {
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(data as BufferSource);
        controller.close();
      },
    });
    const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const { inflateSync } = await loadFallback();
  return inflateSync(data);
}

/**
 * Inflate a raw DEFLATE member chunk by chunk.
 *
 * `onChunk` may throw to abandon the work, and that is the mechanism the
 * bounded reader uses to enforce its ceiling: a member that expands to three
 * gigabytes costs the limit rather than three gigabytes, on both paths. A
 * fallback that buffered the whole output first would have quietly removed that
 * protection, which is why the streaming API is used rather than `inflateSync`.
 */
export async function inflateRawChunks(
  data: Uint8Array,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  if (hasNativeDecompression()) {
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(data as BufferSource);
        controller.close();
      },
    });
    const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return;
  }

  const { Inflate } = await loadFallback();
  await new Promise<void>((resolve, reject) => {
    let failed = false;
    const inflater = new Inflate((chunk, final) => {
      if (failed) return;
      try {
        if (chunk.length) onChunk(chunk);
        if (final) resolve();
      } catch (error) {
        // The caller stopped us — a limit was exceeded, or the data was
        // rejected. Surface it as the rejection rather than losing it inside
        // the library's callback.
        failed = true;
        reject(error);
      }
    });

    try {
      inflater.push(data, true);
      if (!failed) resolve();
    } catch (error) {
      if (!failed) reject(error);
    }
  });
}
