/**
 * Deliberately broken documents, in bulk.
 *
 * Not a fuzzer: a deterministic corpus built by damaging two valid documents
 * in every way a damaged document actually arrives — truncated partway, a byte
 * flipped, a size field made impossible, an offset pointed at nothing, XML cut
 * off mid-tag. The same seed produces the same corpus every run, so a failure
 * can be reproduced rather than merely reported.
 *
 * What is being asserted is not that each one is rejected for the *right*
 * reason. It is the weaker and more important claim that the importer always
 * ends in one of two places — a proposal, or a sentence a person can read —
 * and never in a crash, an unbounded allocation, or a half-written journal.
 *
 * Every document here is fictional.
 */
import { describe, expect, it } from 'vitest';

import { parseDocument } from './candidates';
import { readSermonNotes } from './sermon-notes';
import { ImportError } from './limits';
import { makeDocx, pdf } from './fixtures';

const latin1 = (text: string) => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** A small deterministic generator, so the corpus is the same every run. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const GOOD_PDF = () => latin1(pdf([['BT /F1 12 Tf (FICTIONAL-CORPUS one) Tj ET']]));

interface Damaged {
  name: string;
  bytes: Uint8Array;
}

/** Every way a document arrives broken, applied to one set of good bytes. */
function damage(good: Uint8Array, label: string): Damaged[] {
  const random = seeded(20261015);
  const out: Damaged[] = [];

  // Truncated at a series of points, including mid-structure.
  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.95, 0.99]) {
    out.push({
      name: `${label} truncated at ${Math.round(fraction * 100)}%`,
      bytes: good.slice(0, Math.max(1, Math.floor(good.length * fraction))),
    });
  }

  // Single byte flips, scattered deterministically.
  for (let i = 0; i < 24; i += 1) {
    const copy = good.slice();
    const at = Math.floor(random() * copy.length);
    copy[at] = copy[at] ^ 0xff;
    out.push({ name: `${label} byte ${at} flipped`, bytes: copy });
  }

  // Runs of bytes overwritten, which is what a bad transfer looks like.
  for (let i = 0; i < 8; i += 1) {
    const copy = good.slice();
    const at = Math.floor(random() * Math.max(1, copy.length - 64));
    copy.fill(0x00, at, at + 64);
    out.push({ name: `${label} 64 bytes zeroed at ${at}`, bytes: copy });
  }

  // Impossible lengths: a 32-bit field set to its maximum, wherever one fits.
  for (const at of [0x10, 0x40, Math.floor(good.length / 2)]) {
    if (at + 4 > good.length) continue;
    const copy = good.slice();
    copy[at] = 0xff;
    copy[at + 1] = 0xff;
    copy[at + 2] = 0xff;
    copy[at + 3] = 0xff;
    out.push({ name: `${label} impossible size at ${at}`, bytes: copy });
  }

  // Nothing but the header, and nothing at all.
  out.push({ name: `${label} header only`, bytes: good.slice(0, 8) });
  out.push({ name: `${label} one byte`, bytes: good.slice(0, 1) });

  return out;
}

/**
 * Drive one broken document through one doorway.
 *
 * A rejection must be an ImportError carrying a sentence; anything else — a
 * RangeError, a TypeError, a stack with offsets in it — is the failure this
 * test exists to find.
 */
async function survives(run: () => Promise<unknown>, name: string): Promise<'parsed' | 'refused'> {
  try {
    await run();
    return 'parsed';
  } catch (cause) {
    expect(cause, `${name} threw something that is not an import error`).toBeInstanceOf(ImportError);
    const message = (cause as ImportError).message;
    expect(message.length, `${name} has an empty message`).toBeGreaterThan(10);
    // Nothing internal reaches the person.
    expect(message, name).not.toMatch(/\.ts:|\bat \w+ \(|RangeError|TypeError|undefined|NaN|0x[0-9a-f]{4}/i);
    return 'refused';
  }
}

describe('malformed documents end in a sentence, never in a crash', () => {
  it('survives a corpus of damaged PDFs through both doorways', async () => {
    const corpus = damage(GOOD_PDF(), 'pdf');
    // A floor: a corpus that collapsed to nothing would pass silently.
    expect(corpus.length).toBeGreaterThanOrEqual(40);

    let refused = 0;
    for (const { name, bytes } of corpus) {
      // Each doorway gets its own copy: pdf.js transfers the buffer it is
      // given, and a shared one would be empty by the second call.
      const outcome = await survives(() => parseDocument(bytes.slice(), 'handout.pdf'), name);
      await survives(() => readSermonNotes(bytes.slice(), 'handout.pdf'), name);
      if (outcome === 'refused') refused += 1;
    }

    // Not every damaged PDF is unreadable — pdf.js recovers from a great deal,
    // and a document it can still read is allowed through. What matters is
    // that the ones it cannot were refused in words.
    expect(refused).toBeGreaterThan(0);
  }, 120_000);

  it('survives a corpus of damaged Word packages through both doorways', async () => {
    const good = await makeDocx([
      { text: 'FICTIONAL-CORPUS heading', style: 'Heading1' },
      { text: 'FICTIONAL-CORPUS body text for the corpus' },
    ]);
    const corpus = damage(good, 'docx');
    expect(corpus.length).toBeGreaterThanOrEqual(40);

    let refused = 0;
    for (const { name, bytes } of corpus) {
      const outcome = await survives(() => parseDocument(bytes.slice(), 'handout.docx'), name);
      await survives(() => readSermonNotes(bytes.slice(), 'handout.docx'), name);
      if (outcome === 'refused') refused += 1;
    }

    // A ZIP is far less forgiving than a PDF: damage almost anywhere breaks a
    // checksum, a header or the central directory.
    expect(refused).toBeGreaterThan(corpus.length / 2);
  }, 120_000);

  it('survives malformed XML inside an otherwise valid package', async () => {
    const cases: Array<{ label: string; replace: Record<string, string> }> = [
      { label: 'document cut mid-tag', replace: { 'word/document.xml': '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>FICTIONAL' } },
      { label: 'content types cut mid-tag', replace: { '[Content_Types].xml': '<?xml version="1.0"?><Types><Over' } },
      { label: 'relationships are not XML at all', replace: { '_rels/.rels': 'FICTIONAL-CORPUS not xml' } },
      { label: 'relationship with no target', replace: { '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>' } },
      { label: 'empty document part', replace: { 'word/document.xml': '' } },
    ];

    for (const { label, replace } of cases) {
      const file = await makeDocx([{ text: 'FICTIONAL-CORPUS' }], [], { replace });
      await survives(() => parseDocument(file.slice(), 'handout.docx'), label);
      await survives(() => readSermonNotes(file.slice(), 'handout.docx'), label);
    }
  });
});
