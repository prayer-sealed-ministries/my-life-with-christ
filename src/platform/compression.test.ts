/**
 * Both inflate paths, exercised as paths rather than as a capability flag.
 *
 * The supported OS range declares `IPHONEOS_DEPLOYMENT_TARGET = 15.0` and
 * `minSdkVersion = 24`, and part of that range has no `DecompressionStream`.
 * So there are two implementations of reading an archive, and the one that runs
 * on the oldest device is the one no developer's simulator exercises by
 * default — which is exactly the one that would ship broken.
 *
 * These force each path explicitly and demand the same answers from both:
 * the same bytes out for a good archive, and a refusal for a damaged one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createZip, readZip, zipEntryText } from '../export/zip';
import { hasNativeDecompression, inflateRaw, inflateRawChunks } from './compression';

/**
 * Content long and repetitive enough that the writer really deflates it.
 *
 * A short string would be stored rather than compressed, and the test would
 * then prove nothing about inflating at all — it would pass on a runtime with
 * no inflate whatsoever.
 */
const PROSE = 'He maketh me to lie down in green pastures. '.repeat(200);

const archive = () =>
  createZip([
    { path: 'README.txt', content: PROSE },
    { path: 'data/journey.json', content: JSON.stringify({ format: 'journey-export', version: 1 }) },
  ]);

/** Run `work` with the platform's inflate hidden, as an old webview would. */
async function withoutNativeDecompression<T>(work: () => Promise<T>): Promise<T> {
  vi.stubGlobal('DecompressionStream', undefined);
  try {
    return await work();
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('the two inflate paths agree', () => {
  it('the test environment really does have the platform inflate', () => {
    // A floor. Without it, "both paths pass" could mean the fallback ran twice
    // and the platform path was never exercised at all.
    expect(hasNativeDecompression(), 'no native DecompressionStream to compare against').toBe(true);
  });

  it('reads a deflated archive with the platform inflate', async () => {
    const entries = await readZip(await archive());
    expect(zipEntryText(entries.find((e) => e.path === 'README.txt')!)).toBe(PROSE);
  });

  it('reads the same archive with the bundled inflate', async () => {
    const bytes = await archive();
    const entries = await withoutNativeDecompression(() => readZip(bytes));

    expect(hasNativeDecompression.call(null)).toBe(true); // restored afterwards
    expect(zipEntryText(entries.find((e) => e.path === 'README.txt')!)).toBe(PROSE);
    expect(
      JSON.parse(zipEntryText(entries.find((e) => e.path === 'data/journey.json')!)).format,
    ).toBe('journey-export');
  });

  it('produces byte-identical output from both paths', async () => {
    const bytes = await archive();
    const withPlatform = await readZip(bytes);
    const withBundled = await withoutNativeDecompression(() => readZip(bytes));

    expect(withBundled.map((e) => e.path)).toEqual(withPlatform.map((e) => e.path));
    for (const entry of withPlatform) {
      const other = withBundled.find((e) => e.path === entry.path)!;
      expect(Array.from(other.bytes), `${entry.path} differs between inflate paths`).toEqual(
        Array.from(entry.bytes),
      );
    }
    // A floor on the comparison: an empty archive would satisfy the loop above.
    expect(withPlatform.length).toBeGreaterThanOrEqual(2);
  });
});

describe('both paths refuse damaged data rather than inventing some', () => {
  const rubbish = new Uint8Array([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9]);

  it('the platform inflate rejects it', async () => {
    await expect(inflateRaw(rubbish)).rejects.toThrow();
  });

  it('the bundled inflate rejects it', async () => {
    await expect(withoutNativeDecompression(() => inflateRaw(rubbish))).rejects.toThrow();
  });

  it('a truncated deflate stream fails on both paths', async () => {
    const whole = await archive();
    const truncated = whole.subarray(0, Math.floor(whole.length / 2));

    await expect(readZip(truncated)).rejects.toThrow();
    await expect(withoutNativeDecompression(() => readZip(truncated))).rejects.toThrow();
  });
});

describe('the chunked reader can be stopped, on both paths', () => {
  // This is what the bounded reader relies on to enforce its ceiling: a member
  // that expands to three gigabytes must cost the limit, not three gigabytes.
  // A fallback that buffered the whole output first would have removed that
  // protection without failing any existing test.
  const deflated = async () => {
    // Built from a ReadableStream rather than `new Blob([...]).stream()`:
    // jsdom's Blob has no `stream()`, which is the same trap `zip-limits.ts`
    // documents. The Blob form throws here and the test would prove nothing.
    const bytes = new TextEncoder().encode(PROSE);
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(bytes as BufferSource);
        controller.close();
      },
    });
    const stream = source.pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  it('stops when the platform inflate is used', async () => {
    const data = await deflated();
    let seen = 0;
    await expect(
      inflateRawChunks(data, (chunk) => {
        seen += chunk.byteLength;
        if (seen > 100) throw new Error('over the limit');
      }),
    ).rejects.toThrow(/over the limit/);
    expect(seen, 'no chunks were delivered, so nothing was actually bounded').toBeGreaterThan(0);
  });

  it('stops when the bundled inflate is used', async () => {
    const data = await deflated();
    let seen = 0;
    await expect(
      withoutNativeDecompression(() =>
        inflateRawChunks(data, (chunk) => {
          seen += chunk.byteLength;
          if (seen > 100) throw new Error('over the limit');
        }),
      ),
    ).rejects.toThrow(/over the limit/);
    expect(seen, 'no chunks were delivered, so nothing was actually bounded').toBeGreaterThan(0);
  });
});
