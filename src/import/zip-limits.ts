/**
 * A bounded ZIP read, for archives this app did not write.
 *
 * `src/export/zip.ts` reads journals the app produced. Its `readZip` inflates
 * every member unconditionally and has no size ceiling, which is correct for
 * its own archives and wrong for a .docx somebody was handed by email. This
 * wraps the same format with limits rather than changing that function, so the
 * native journal path keeps behaving exactly as it did and as its tests assert.
 *
 * Three separate ceilings, and they are separate on purpose:
 *
 *   entries           how MANY members. A bomb need not be big, only numerous.
 *   per-entry bytes   how large ONE member may inflate to.
 *   total bytes       how large EVERYTHING inflated may come to together.
 *
 * The last two do not imply one another in either direction. A 10,000:1 ratio
 * spread across two hundred small members passes any single-member check; one
 * enormous member passes any average. A compressed-size check catches neither,
 * because compressed size is exactly what a bomb makes small — so the count
 * that matters is measured AFTER inflation, streaming, with the budget checked
 * as it is spent.
 */

import { ImportError, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_TOTAL_BYTES, describeBytes } from './limits';

/**
 * A decompression ceiling, and WHERE it was hit.
 *
 * `stoppedEarly` distinguishes the two checks. One aborts the stream partway
 * through, having read only as much as the budget allows; the other notices
 * afterwards, once everything is already in memory. Both refuse the file and
 * both say the same thing to the reader — but only the first actually protects
 * the browser, and without a way to tell them apart a test cannot prove the
 * early one ever runs. Deleting it as a deliberate sabotage left the suite
 * green, because the late one caught everything.
 */
export class DecompressionLimit extends ImportError {
  readonly stoppedEarly: boolean;
  constructor(message: string, stoppedEarly: boolean) {
    super(message);
    this.name = 'DecompressionLimit';
    this.stoppedEarly = stoppedEarly;
  }
}

const SIGNATURE_EOCD = 0x06054b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const METHOD_DEFLATE = 8;

const decoder = new TextDecoder();

export interface LimitedZipEntry {
  path: string;
  bytes: Uint8Array;
}

export interface ZipLimitOptions {
  /** Only members matching this are inflated at all. Everything else is skipped. */
  only?: (path: string) => boolean;
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

/**
 * Inflate with a hard ceiling, without buffering the whole output first.
 *
 * `new Response(stream).arrayBuffer()` — what the unbounded reader uses — would
 * happily materialise a gigabyte before anyone could object. Reading chunk by
 * chunk means the budget is checked while it is being spent, and the stream is
 * cancelled the moment it is exceeded.
 */
async function inflateBounded(data: Uint8Array, limit: number, path: string): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ImportError('This browser cannot read compressed documents.');
  }

  // A ReadableStream built here rather than `new Blob([...]).stream()`.
  //
  // Not a style choice: jsdom's Blob has no `stream()` method, so the Blob form
  // throws there and every caller falls back to treating the data as stored.
  // The DOCX path would then be exercised by no test at all — a deflated Word
  // document, which is every real Word document, would go down a code path the
  // suite never ran. This form works in both.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as BufferSource);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        // Cancelled mid-stream: the remaining chunks are never produced, so a
        // 3GB payload costs `limit` bytes rather than 3GB.
        await reader.cancel();
        throw new DecompressionLimit(
          `That file expands to more than ${describeBytes(limit)} when opened, which is far larger than a document. It has not been read.`,
          true,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  void path;
  return out;
}

/** Read a ZIP, refusing anything that looks like a decompression attack. */
export async function readZipLimited(
  data: Uint8Array,
  options: ZipLimitOptions = {},
): Promise<LimitedZipEntry[]> {
  const maxEntries = options.maxEntries ?? MAX_ZIP_ENTRIES;
  const maxEntryBytes = options.maxEntryBytes ?? MAX_ZIP_ENTRY_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_ZIP_TOTAL_BYTES;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let eocd = -1;
  for (let i = data.length - 22; i >= 0 && i >= data.length - 22 - 0xffff; i -= 1) {
    if (view.getUint32(i, true) === SIGNATURE_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new ImportError('That file is not a readable Word document or archive.');
  }

  const count = view.getUint16(eocd + 10, true);
  if (count > maxEntries) {
    throw new ImportError(
      `That file contains ${count} parts, far more than a document should. It has not been read.`,
    );
  }

  let cursor = view.getUint32(eocd + 16, true);
  const entries: LimitedZipEntry[] = [];
  let inflatedTotal = 0;

  for (let i = 0; i < count; i += 1) {
    // A truncated or hand-edited archive must fail as a message, not as a
    // RangeError with byte offsets in it.
    if (cursor + 46 > data.length || view.getUint32(cursor, true) !== SIGNATURE_CENTRAL) {
      throw new ImportError('That file is damaged and cannot be read.');
    }

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const path = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength));

    cursor += 46 + nameLength + extraLength + commentLength;

    // Skip directories, and anything the caller did not ask for. A member that
    // is never inflated cannot cost anything, which is why `only` is the first
    // and cheapest defence: for a .docx exactly one member is ever opened.
    if (path.endsWith('/')) continue;
    if (options.only && !options.only(path)) continue;

    if (localOffset + 30 > data.length) {
      throw new ImportError('That file is damaged and cannot be read.');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > data.length) {
      throw new ImportError('That file is damaged and cannot be read.');
    }
    const raw = data.subarray(dataStart, dataStart + compressedSize);

    // The per-entry budget is the smaller of its own ceiling and what is left
    // of the total, so the total cannot be overshot by one large final member.
    const remaining = maxTotalBytes - inflatedTotal;
    const budget = Math.min(maxEntryBytes, remaining);

    const bytes =
      method === METHOD_DEFLATE ? await inflateBounded(raw, budget, path) : raw.slice(0, budget + 1);

    // The stored path has no stream to cancel, so its ceiling is applied here.
    if (bytes.byteLength > budget) {
      throw new DecompressionLimit(
        `That file expands to more than ${describeBytes(maxTotalBytes)} when opened, which is far larger than a document. It has not been read.`,
        false,
      );
    }

    inflatedTotal += bytes.byteLength;
    entries.push({ path, bytes });
  }

  return entries;
}
