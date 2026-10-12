/**
 * A minimal ZIP writer.
 *
 * The project takes no runtime dependencies beyond React, Dexie and Tailwind,
 * and the export is the one artefact that has to outlive this app — so it is
 * written here, in full, rather than pulled from a library that may not resolve
 * in 2060. The output is a plain PKZIP archive: any unzip tool, on any platform,
 * for the last thirty years, can open it.
 *
 * Deflate comes from the platform's CompressionStream where available; where it
 * is not, entries are stored uncompressed. Both are valid ZIP and both open
 * everywhere, so a missing CompressionStream costs bytes, never readability.
 */

import { readZipLimited } from '../import/zip-limits';
import {
  MAX_JOURNAL_ARCHIVE_BYTES,
  MAX_JOURNAL_ARCHIVE_MEMBERS,
  MAX_JOURNAL_COMPRESSION_RATIO,
  MAX_JOURNAL_MEMBER_BYTES,
} from '../lib/journal-limits';

export interface ZipEntry {
  /** Path within the archive, using forward slashes. */
  path: string;
  content: string | Uint8Array;
}

const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** CRC-32 (IEEE 802.3), as ZIP requires. Table built once, lazily. */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Deflate if the platform can; otherwise say so and store. */
async function deflate(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
  if (typeof CompressionStream === 'undefined' || data.length === 0) {
    return { bytes: data, method: METHOD_STORE };
  }
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    // Compression is not guaranteed to help; never let it make a file larger.
    if (compressed.length >= data.length) return { bytes: data, method: METHOD_STORE };
    return { bytes: compressed, method: METHOD_DEFLATE };
  } catch {
    return { bytes: data, method: METHOD_STORE };
  }
}

/** MS-DOS date/time, which is what the ZIP header carries. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const encoder = new TextEncoder();

const toBytes = (content: string | Uint8Array): Uint8Array =>
  typeof content === 'string' ? encoder.encode(content) : content;

/** Little-endian writer over a growable buffer. */
class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    this.push(bytes);
  }

  u32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.push(bytes);
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Build a ZIP archive.
 *
 * @param entries files to include, in the order they should appear
 * @param now timestamp stamped into each entry's header
 */
export async function createZip(entries: ZipEntry[], now = new Date()): Promise<Uint8Array> {
  const { time, date } = dosDateTime(now);
  const writer = new ByteWriter();

  const directory: Array<{
    path: Uint8Array;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    method: number;
    offset: number;
  }> = [];

  for (const entry of entries) {
    const pathBytes = encoder.encode(entry.path);
    const raw = toBytes(entry.content);
    const crc = crc32(raw);
    const { bytes, method } = await deflate(raw);
    const offset = writer.length;

    writer.u32(SIGNATURE_LOCAL);
    writer.u16(20); // version needed
    writer.u16(0x0800); // flags: filename is UTF-8
    writer.u16(method);
    writer.u16(time);
    writer.u16(date);
    writer.u32(crc);
    writer.u32(bytes.length);
    writer.u32(raw.length);
    writer.u16(pathBytes.length);
    writer.u16(0); // no extra field
    writer.push(pathBytes);
    writer.push(bytes);

    directory.push({
      path: pathBytes,
      crc,
      compressedSize: bytes.length,
      uncompressedSize: raw.length,
      method,
      offset,
    });
  }

  const centralStart = writer.length;
  for (const item of directory) {
    writer.u32(SIGNATURE_CENTRAL);
    writer.u16(20); // version made by
    writer.u16(20); // version needed
    writer.u16(0x0800); // flags: filename is UTF-8
    writer.u16(item.method);
    writer.u16(time);
    writer.u16(date);
    writer.u32(item.crc);
    writer.u32(item.compressedSize);
    writer.u32(item.uncompressedSize);
    writer.u16(item.path.length);
    writer.u16(0); // extra
    writer.u16(0); // comment
    writer.u16(0); // disk number
    writer.u16(0); // internal attributes
    writer.u32(0); // external attributes
    writer.u32(item.offset);
    writer.push(item.path);
  }
  const centralSize = writer.length - centralStart;

  writer.u32(SIGNATURE_EOCD);
  writer.u16(0); // this disk
  writer.u16(0); // disk with central directory
  writer.u16(directory.length);
  writer.u16(directory.length);
  writer.u32(centralSize);
  writer.u32(centralStart);
  writer.u16(0); // no archive comment

  return writer.concat();
}

/**
 * SHA-256 of a file's bytes, lowercase hex, for the manifest.
 *
 * Re-exported rather than implemented here so that the side that WRITES a
 * manifest and the side that VERIFIES one cannot drift into two hashes. The
 * implementation lives beside the manifest grammar, in a module the plain-Node
 * CLI can import too.
 */
export { sha256 } from './manifest.mjs';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read a ZIP archive.
 *
 * Only what the importer needs: locate the central directory, walk its entries,
 * and inflate each one. Enough to read an archive this app wrote, and enough to
 * read a plain archive anything else wrote.
 */
export interface ReadZipEntry {
  path: string;
  bytes: Uint8Array;
}

const decoder = new TextDecoder();

export async function readZip(data: Uint8Array): Promise<ReadZipEntry[]> {
  return readZipLimited(data, {
    maxEntries: MAX_JOURNAL_ARCHIVE_MEMBERS,
    maxEntryBytes: MAX_JOURNAL_MEMBER_BYTES,
    maxTotalBytes: MAX_JOURNAL_ARCHIVE_BYTES,
    maxCompressionRatio: MAX_JOURNAL_COMPRESSION_RATIO,
  });
}

/** Read one entry's bytes as UTF-8 text. */
export function zipEntryText(entry: ReadZipEntry): string {
  return decoder.decode(entry.bytes);
}
