/**
 * What a PDF asks the reader to *do*, as opposed to what it says.
 *
 * This application extracts the words from a church handout. It is not trying
 * to be a PDF viewer, so there is no product reason to accept a document that
 * wants to run a script, launch a program, carry an executable attachment, or
 * play a film. Those features exist, they are occasionally used maliciously,
 * and nothing here needs any of them.
 *
 * WHY THIS IS NOT A SUBSTRING SEARCH
 *
 * Looking for the text `/JS` in a PDF is wrong in both directions, and the
 * security project this work drew on hardened exactly this after finding it
 * insufficient:
 *
 *   FALSE POSITIVES. A handout about a programming course contains the word
 *   JavaScript in its visible text. A dictionary key `/JSON` contains `/JS`.
 *   Refusing either would refuse ordinary documents for no reason.
 *
 *   FALSE NEGATIVES, which are worse. Name objects may be written with hex
 *   escapes — `/J#53` is `/JS` — so a search for the plain spelling misses the
 *   obfuscated one. And most of a modern PDF lives inside compressed streams,
 *   where a raw search sees only deflate output: a document can declare
 *   anything it likes in an object stream and a scanner that never inflates
 *   one will report it clean.
 *
 * So names are lexed rather than matched: strings, hex strings and comments
 * are skipped so their contents cannot be mistaken for structure, `#xx`
 * escapes are decoded, and compressed streams are inflated and scanned with
 * the same lexer. Everything is bounded.
 */

import { inflateRaw, canDecompress } from '../platform/compression';

/**
 * Execution primitives with no legitimate place in a handout.
 *
 * Deliberately NOT here:
 *
 *   /XObject — in virtually every PDF that contains an image.
 *   /URI     — an ordinary hyperlink. Church handouts are full of them, and a
 *              link is not an action: nothing in this app will follow it.
 *   /OpenAction, /AA — a document that opens at a particular page is normal.
 *              They are only dangerous as a trigger for something else, and
 *              that something else is already on this list.
 */
export const DANGEROUS_PDF_NAMES = [
  'JS',
  'JavaScript',
  'Launch',
  'EmbeddedFile',
  'RichMedia',
  'XFA',
  'Movie',
  'Sound',
  '3D',
];

/** Bounds. A hostile document must not be able to make this expensive. */
const MAX_STREAMS_INFLATED = 300;
const MAX_INFLATED_TOTAL = 8 * 1024 * 1024;

const isWhitespace = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
const isDelimiter = (c: string) => '()<>[]{}/%'.includes(c);

/**
 * Every name object in a region of PDF syntax.
 *
 * A name begins with `/` and runs to the next delimiter or whitespace. Inside
 * it, `#` introduces two hex digits standing for one byte, which is how `/JS`
 * can be spelled `/J#53`.
 */
export function pdfNamesIn(region: string): Set<string> {
  const names = new Set<string>();
  let i = 0;

  while (i < region.length) {
    const c = region[i];

    // A comment runs to the end of the line and contains no structure.
    if (c === '%') {
      while (i < region.length && region[i] !== '\n' && region[i] !== '\r') i += 1;
      continue;
    }

    // A literal string. Parentheses nest, and a backslash escapes the next
    // byte — including a parenthesis. Its contents are text, never structure,
    // which is what stops a handout that *mentions* JavaScript from being
    // mistaken for one that runs it.
    if (c === '(') {
      let depth = 1;
      i += 1;
      while (i < region.length && depth > 0) {
        if (region[i] === '\\') i += 2;
        else {
          if (region[i] === '(') depth += 1;
          else if (region[i] === ')') depth -= 1;
          i += 1;
        }
      }
      continue;
    }

    // A dictionary opens with `<<`. Both angle brackets have to be consumed
    // together: taking them one at a time leaves the second looking like the
    // start of a hex string, which then swallows the dictionary's contents up
    // to the first `>` — and with them every name inside it.
    if (c === '<' && region[i + 1] === '<') {
      i += 2;
      continue;
    }
    if (c === '>' && region[i + 1] === '>') {
      i += 2;
      continue;
    }

    // A hex string.
    if (c === '<') {
      while (i < region.length && region[i] !== '>') i += 1;
      i += 1;
      continue;
    }

    if (c === '/') {
      i += 1;
      let name = '';
      while (i < region.length && !isWhitespace(region[i]) && !isDelimiter(region[i])) {
        if (region[i] === '#' && i + 2 < region.length) {
          const hex = region.slice(i + 1, i + 3);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            name += String.fromCharCode(Number.parseInt(hex, 16));
            i += 3;
            continue;
          }
        }
        name += region[i];
        i += 1;
      }
      if (name) names.add(name);
      continue;
    }

    i += 1;
  }

  return names;
}

interface StreamRegion {
  /** The dictionary that introduced it, where the filter is declared. */
  dictionary: string;
  payload: Uint8Array;
}

/**
 * Split a document into the syntax outside its streams, and the streams.
 *
 * Deliberately simple and forgiving: this is a security scan, not a renderer,
 * and it only has to find the boundaries well enough that nothing structural
 * is skipped. Anything it cannot pair up stays in the outside region, where it
 * is lexed rather than ignored.
 */
function splitStreams(text: string): { outside: string; streams: StreamRegion[] } {
  const streams: StreamRegion[] = [];
  let outside = '';
  let at = 0;

  for (;;) {
    const start = text.indexOf('stream', at);
    if (start === -1) break;
    // `endstream` also contains `stream`; skip the ones we are standing on.
    if (start >= 3 && text.slice(start - 3, start) === 'end') {
      outside += text.slice(at, start + 6);
      at = start + 6;
      continue;
    }

    let payloadStart = start + 6;
    if (text[payloadStart] === '\r') payloadStart += 1;
    if (text[payloadStart] === '\n') payloadStart += 1;

    const end = text.indexOf('endstream', payloadStart);
    if (end === -1) break;

    outside += text.slice(at, start);
    const dictionary = text.slice(Math.max(0, start - 400), start);

    /*
      The end-of-line before `endstream` is not part of the stream's data.

      Writers conventionally put one there, and including it leaves one byte
      too many on the end of the payload — which, after the zlib trailer is
      removed by length, left a stray byte that made every compressed stream
      fail to inflate. The symptom was indistinguishable from "this stream
      cannot be read", and the result was that compressed documents were
      silently never searched at all.
    */
    let payloadEnd = end;
    if (payloadEnd > payloadStart && text[payloadEnd - 1] === '\n') payloadEnd -= 1;
    if (payloadEnd > payloadStart && text[payloadEnd - 1] === '\r') payloadEnd -= 1;

    const payload = new Uint8Array(payloadEnd - payloadStart);
    for (let i = 0; i < payload.length; i += 1) payload[i] = text.charCodeAt(payloadStart + i) & 0xff;
    streams.push({ dictionary, payload });
    at = end;
  }

  outside += text.slice(at);
  return { outside, streams };
}

/**
 * The raw deflate inside a FlateDecode payload.
 *
 * PDF writes zlib, which is a two-byte header, the deflate data, and a
 * four-byte Adler-32 checksum. The platform's inflater reads raw deflate, so
 * BOTH ends have to come off: leaving the checksum on makes it trailing
 * garbage and the whole stream is rejected — which looked exactly like a
 * stream that could not be read, and quietly turned every compressed
 * document into a blind spot.
 */
function rawDeflateOf(data: Uint8Array): Uint8Array {
  const looksLikeZlib =
    data.length >= 6 && (data[0] & 0x0f) === 8 && ((data[0] << 8) | data[1]) % 31 === 0;
  return looksLikeZlib ? data.subarray(2, data.length - 4) : data;
}

export interface ActiveContentFinding {
  /** Names found that this application will not open a document for. */
  found: string[];
  /** How many compressed streams were actually inflated and searched. */
  streamsInflated: number;
  /** True when a bound stopped the search before it finished. */
  bounded: boolean;
}

/**
 * Look for execution primitives, inside compressed streams as well as outside.
 *
 * Returns what it found AND how much it looked at, because a scan that
 * examined nothing finds nothing — and would otherwise report the same clean
 * answer as a document that genuinely has none.
 */
export async function findActiveContent(bytes: Uint8Array): Promise<ActiveContentFinding> {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);

  const { outside, streams } = splitStreams(text);
  const names = pdfNamesIn(outside);

  let streamsInflated = 0;
  let inflatedTotal = 0;
  let bounded = false;

  if (canDecompress()) {
    for (const stream of streams) {
      if (streamsInflated >= MAX_STREAMS_INFLATED || inflatedTotal >= MAX_INFLATED_TOTAL) {
        bounded = true;
        break;
      }
      if (!stream.dictionary.includes('FlateDecode')) continue;
      try {
        const inflated = await inflateRaw(rawDeflateOf(stream.payload));
        inflatedTotal += inflated.byteLength;
        streamsInflated += 1;
        let decoded = '';
        for (let i = 0; i < inflated.length; i += 1) decoded += String.fromCharCode(inflated[i]);
        for (const name of pdfNamesIn(decoded)) names.add(name);
      } catch {
        // A stream that will not inflate tells us nothing either way. The
        // document still has to satisfy the parser afterwards.
        bounded = true;
      }
    }
  } else {
    bounded = true;
  }

  return {
    found: DANGEROUS_PDF_NAMES.filter((name) => names.has(name)),
    streamsInflated,
    bounded,
  };
}
