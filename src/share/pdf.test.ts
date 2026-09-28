/**
 * The shared PDF, read back by the app's own extractor.
 *
 * Generated with the writer the product ships and parsed with the reader the
 * product ships. That is the strongest available check on "is this document
 * actually readable": not "did a function return bytes", not "does the header
 * say %PDF", but the words coming back out of a real PDF parser in the order
 * somebody would read them.
 *
 * It also means the ABSENCE assertions mean something. A section that was not
 * selected is not merely missing from a model — it is not in the file.
 */

import { describe, expect, it } from 'vitest';

import { parsePdf } from '../import/pdf';
import {
  PRIVATE_BY_DEFAULT,
  buildSharedEntryDocument,
  type ShareScope,
} from './entry-document';
import { renderSharedEntryPdf } from './pdf';
import type { Entry } from '../types';

const NOTES = 'Vinedresser prunes the branch that bears';
const REFLECTION = 'Abiding is not a feeling I manufacture';
const PRAYER = 'Keep me in you this week';
const PROVIDED = 'City Gate Church outline point one';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'share-pdf-1',
    kind: 'sermon',
    title: 'Abiding in Christ',
    date: '2026-09-23',
    place: 'First Baptist Church',
    speaker: 'Pastor James',
    anchors: [],
    scriptureRefs: ['John 15:1-17'],
    notes: NOTES,
    reflection: REFLECTION,
    prayer: PRAYER,
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-09-23T10:00:00.000Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
    sourceMaterial: {
      format: 'pdf',
      filename: 'handout.pdf',
      importedAt: '2026-09-23T09:00:00.000Z',
      body: PROVIDED,
      parserVersion: 1,
    },
    ...overrides,
  };
}

const everything: ShareScope = {
  includeScripture: true,
  includeDetails: true,
  includeNotes: true,
  includeReflection: true,
  includePrayer: true,
  includeProvidedNotes: true,
  includeLinks: true,
};

/** Generate, then read back with the shipped extractor. */
async function readBack(e: Entry, selection: ShareScope): Promise<string> {
  const bytes = await renderSharedEntryPdf(buildSharedEntryDocument(e, selection));
  expect(bytes.byteLength).toBeGreaterThan(500);
  const extraction = await parsePdf(bytes);
  return extraction.pages.map((page) => page.text).join('\n');
}

describe('the shared PDF', () => {
  it('is a real PDF a parser can read', async () => {
    const bytes = await renderSharedEntryPdf(buildSharedEntryDocument(entry(), PRIVATE_BY_DEFAULT));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  }, 30_000);

  it('carries the heading, the day, the passage and the notes', async () => {
    const text = await readBack(entry(), PRIVATE_BY_DEFAULT);

    expect(text).toContain('MY LIFE WITH CHRIST');
    expect(text).toContain('Abiding in Christ');
    expect(text).toContain('John 15:1-17');
    expect(text).toContain('Pastor James');
    expect(text).toContain(NOTES);
  }, 30_000);

  it('leaves out what was not selected', async () => {
    const text = await readBack(entry(), PRIVATE_BY_DEFAULT);

    expect(text).not.toContain(REFLECTION);
    expect(text).not.toContain(PRAYER);
    expect(text).not.toContain(PROVIDED);
  }, 30_000);

  it('includes what was selected, under its own heading', async () => {
    const text = await readBack(entry(), everything);

    expect(text).toContain('MY NOTES');
    expect(text).toContain('MY REFLECTION');
    expect(text).toContain('PRAYER');
    expect(text).toContain('PROVIDED NOTES');
    expect(text).toContain(REFLECTION);
    expect(text).toContain(PRAYER);
    expect(text).toContain(PROVIDED);
  }, 30_000);

  it('keeps the church’s words under the provided heading, after the reader’s', async () => {
    const text = await readBack(entry(), everything);
    expect(text.indexOf('MY NOTES')).toBeLessThan(text.indexOf('PROVIDED NOTES'));
    expect(text.indexOf('PROVIDED NOTES')).toBeLessThan(text.indexOf(PROVIDED));
  }, 30_000);

  it('signs off without anything to track a reader by', async () => {
    const text = await readBack(entry(), everything);

    expect(text).toContain('My Life With Christ');
    expect(text).toContain('Your walk, remembered.');
    // No address, no code, no identifier of any kind.
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('share-pdf-1');
    expect(text).not.toContain('2026-09-23T');
  }, 30_000);

  it('runs a long entry onto more pages rather than off the edge', async () => {
    // A realistic long entry: fifteen thousand characters of notes.
    const long = entry({ notes: 'Abide in the vine. '.repeat(790) });
    const bytes = await renderSharedEntryPdf(buildSharedEntryDocument(long, PRIVATE_BY_DEFAULT));
    const extraction = await parsePdf(bytes);

    expect(extraction.pages.length).toBeGreaterThan(1);
    // The footer is on every page, not only the first.
    for (const page of extraction.pages) {
      expect(page.text).toContain('Your walk, remembered.');
    }
  }, 60_000);

  it('does not fall over on an entry with almost nothing in it', async () => {
    const bare = entry({
      title: '',
      notes: '',
      reflection: '',
      prayer: '',
      scriptureRefs: [],
      place: undefined,
      speaker: undefined,
      sourceMaterial: undefined,
    });
    const text = await readBack(bare, everything);
    expect(text).toContain('Untitled entry');
  }, 30_000);
});
