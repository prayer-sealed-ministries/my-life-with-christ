/**
 * The bridge to on-device text recognition.
 *
 * Apple Vision on iOS, ML Kit Text Recognition v2 with its bundled Latin model
 * on Android. Both run entirely on the device: there is no endpoint here, no
 * fallback, and nothing in this file can send an image or a line of recognised
 * text anywhere. If the device cannot read the page, the answer is that it
 * could not read the page.
 *
 * Everything platform-specific stops at this file. The review screen receives
 * `Recognition` and `ScannedPage` and never learns which engine produced them,
 * which is the same boundary the rest of `src/platform/` keeps.
 */
import { registerPlugin } from '@capacitor/core';

import type { PageScanner, Recognition, ScanFailure, ScannedPage } from './ports';

/**
 * What the native plugins implement.
 *
 * Deliberately small. Each call either returns a result or a `failure` string
 * the shared layer maps to wording; natives never compose user-facing prose,
 * so there is one place where what a person reads is decided.
 */
interface ScanNotesPlugin {
  /** Photograph a page. Requests camera permission at this moment and no earlier. */
  capture(): Promise<NativePage | NativeFailure>;
  /** Choose an existing photo through the system picker. */
  choose(): Promise<NativePage | NativeFailure>;
  /** Recognise text in a page the plugin is holding. */
  recognise(options: { handle: string }): Promise<NativeRecognition | NativeFailure>;
  /** Delete our temporary copy. Never touches a photo in the person's library. */
  discard(options: { handle: string }): Promise<void>;
  /** Remove temporary scans left behind by a previous run that crashed. */
  cleanupStale(): Promise<{ removed: number }>;
}

interface NativePage {
  handle: string;
  preview: string;
  width: number;
  height: number;
  blurScore?: number;
}

interface NativeRecognition {
  text: string;
  lines: Array<{
    text: string;
    confidence?: number;
    box?: { x: number; y: number; width: number; height: number };
  }>;
  imageWidth: number;
  imageHeight: number;
  engine: string;
  elapsedMs: number;
}

interface NativeFailure {
  failure: string;
}

const ScanNotes = registerPlugin<ScanNotesPlugin>('ScanNotes');

/**
 * Below this, a page is likely to be motion-blurred.
 *
 * Blur was the one catastrophic failure mode in the benchmark: every other
 * degradation — 0.28x downscaling, JPEG at quality 0.12, very dim light with a
 * shadow — was recognised at 0.00% character error, while heavy blur reached
 * 77% on iOS and 93% on Android. The natives report a variance-of-Laplacian
 * score; this threshold only decides whether to *offer a warning*, and the
 * person may always proceed.
 */
const BLUR_WARNING_BELOW = 120;

const isFailure = (value: unknown): value is NativeFailure =>
  typeof value === 'object' && value !== null && 'failure' in value;

/** Map a native failure string onto the shared vocabulary. Unknown means failed. */
function toFailure(value: NativeFailure): ScanFailure {
  switch (value.failure) {
    case 'cancelled':
      return { reason: 'cancelled' };
    case 'no-text':
      return { reason: 'no-text' };
    case 'unreadable':
      return { reason: 'unreadable' };
    case 'too-large':
      return { reason: 'too-large' };
    case 'permission-denied':
      return { reason: 'permission-denied' };
    case 'unsupported':
      return { reason: 'unsupported' };
    default:
      return { reason: 'failed' };
  }
}

function toPage(page: NativePage): ScannedPage {
  return {
    handle: page.handle,
    preview: page.preview,
    width: page.width,
    height: page.height,
    blurWarning: typeof page.blurScore === 'number' ? page.blurScore < BLUR_WARNING_BELOW : undefined,
  };
}

function toRecognition(result: NativeRecognition): Recognition | ScanFailure {
  // An engine that returns nothing is not an error; it is a page with no
  // readable text on it, and the person is told exactly that.
  if (result.text.trim().length === 0) return { reason: 'no-text' };
  return {
    text: result.text,
    lines: result.lines ?? [],
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    engine: result.engine,
    elapsedMs: result.elapsedMs,
  };
}

/**
 * Anything the native layer throws becomes a plain failure.
 *
 * Deliberately swallowing the message: a platform exception can carry a file
 * path, and a path to a scan of somebody's notebook is not something to put in
 * front of a reader or into a log.
 */
async function guard<T>(run: () => Promise<T | NativeFailure>): Promise<T | ScanFailure> {
  try {
    const value = await run();
    return isFailure(value) ? toFailure(value) : value;
  } catch {
    return { reason: 'failed' };
  }
}

export const nativePageScanner: PageScanner = {
  supported: true,

  async capture() {
    const result = await guard(() => ScanNotes.capture());
    return 'reason' in result ? result : toPage(result);
  },

  async choose() {
    const result = await guard(() => ScanNotes.choose());
    return 'reason' in result ? result : toPage(result);
  },

  async recognise(page: ScannedPage) {
    const result = await guard(() => ScanNotes.recognise({ handle: page.handle }));
    return 'reason' in result ? result : toRecognition(result);
  },

  async discard(page: ScannedPage) {
    try {
      await ScanNotes.discard({ handle: page.handle });
    } catch {
      // Cleanup is best-effort by design. A temporary file that outlives one
      // attempt is swept by `cleanupStale` on the next launch, and failing
      // loudly here would turn a tidy-up into an error in front of a reader.
    }
  },
};

/**
 * Sweep temporary scans a previous run left behind.
 *
 * Called once at startup. Scoped to our own scan directory — it never deletes
 * anything a person chose from their own photo library, and never touches the
 * rest of the cache.
 */
export async function cleanupStaleScans(): Promise<number> {
  try {
    const { removed } = await ScanNotes.cleanupStale();
    return removed;
  } catch {
    return 0;
  }
}
