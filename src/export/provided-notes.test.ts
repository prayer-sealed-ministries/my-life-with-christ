/**
 * Provided sermon notes, through the archive and out the other side.
 *
 * Once a reader saves an entry carrying a church's handout, that handout is
 * part of the record. An export that dropped it would be a feature that
 * disappears the day somebody restores their journal — which, for a product
 * whose whole promise is that the export is the thing you own, is worse than
 * not having built it.
 *
 * The second thing every case here watches is the labelling. The material has
 * to survive AND stay marked as somebody else's, in the JSON, in the Markdown
 * a stranger reads with no app, and in the printed book. A round-trip that
 * preserved the text and lost the attribution would pass a naive test and
 * quietly put a church's outline into one person's voice for good.
 */

import { describe, expect, it } from 'vitest';

import { buildArchive } from './archive';
import { buildNoteFilenames } from './context';
import type { ExportContext } from './context';
import { renderBook } from './book';
import { migrateExport } from './migrate';
import { renderNote } from './notes';
import { renderCsv } from './readme';
import { readZip } from './zip';
import type { Entry, JourneyExport, SourceMaterial } from '../types';

const MATERIAL: SourceMaterial = {
  format: 'sermon-notes-json',
  filename: 'sermon-notes.json',
  importedAt: '2026-09-20T15:00:00.000Z',
  sha256: 'b'.repeat(64),
  church: 'City Gate Church',
  speaker: 'Pastor John Smith',
  date: '2026-09-20',
  scripture: ['Matthew 6:19-34'],
  body: '# Setting Godly Priorities\n\n1. Where your treasure is.\n2. Two masters.',
  parserVersion: 1,
};

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  kind: 'sermon',
  title: 'Setting Godly Priorities',
  date: '2026-09-20',
  anchors: [],
  scriptureRefs: ['Matthew 6:19-34'],
  notes: 'He said storing up is a way of not trusting.',
  reflection: 'I have been storing up for years.',
  links: [],
  tags: [],
  forDescendants: true,
  visibility: 'private',
  createdAt: '2026-09-20T16:00:00.000Z',
  updatedAt: '2026-09-20T16:00:00.000Z',
  sourceMaterial: MATERIAL,
  ...overrides,
});

/** The smallest context these renderers need: no outlines, no passages. */
const context = (entries: Entry[]): ExportContext => ({
  entries,
  drafts: [],
  excludedCount: 0,
  exportedAt: '2026-09-21T09:00:00.000Z',
  profile: 'refs-only',
  bookNames: new Map(),
  bookOrder: new Map(),
  outlineBooks: new Map(),
  outlineEntries: new Map(),
  topics: new Map(),
  passages: new Map(),
  noteFilenames: buildNoteFilenames(entries),
});

async function archiveOf(entries: Entry[]) {
  const built = await buildArchive({
    entries,
    outlineBooks: [],
    topics: [],
    profile: 'refs-only',
    now: new Date('2026-09-21T09:00:00.000Z'),
  });
  const members = await readZip(built.bytes);
  const text = (path: string) => {
    const found = members.find((member) => member.path === path);
    if (!found) throw new Error(`the archive has no ${path}`);
    return new TextDecoder().decode(found.bytes);
  };
  return { built, text };
}

describe('the canonical record', () => {
  it('carries the provided material, field for field', async () => {
    const { text } = await archiveOf([entry()]);
    const journey = JSON.parse(text('data/journey.json')) as JourneyExport;

    expect(journey.entries[0].sourceMaterial).toEqual(MATERIAL);
  });

  it('restores it losslessly', async () => {
    const { text } = await archiveOf([entry()]);
    const journey = JSON.parse(text('data/journey.json')) as JourneyExport;

    const { entries, warnings } = migrateExport(journey);

    expect(warnings, 'restoring complained about something').toEqual([]);
    const restored = { entries };
    expect(restored.entries[0].sourceMaterial).toEqual(MATERIAL);
    // And the reader's own writing is still theirs, on the far side.
    expect(restored.entries[0].notes).toBe('He said storing up is a way of not trusting.');
  });

  it('survives a second trip, so a restored journal can be exported again', async () => {
    const first = await archiveOf([entry()]);
    const once = migrateExport(JSON.parse(first.text('data/journey.json')) as JourneyExport);
    const second = await archiveOf(once.entries);
    const twice = migrateExport(JSON.parse(second.text('data/journey.json')) as JourneyExport);

    expect(twice.entries[0].sourceMaterial).toEqual(MATERIAL);
  });

  it('reads an archive written before this field existed', async () => {
    // The compatibility claim, made against a file with no knowledge of the
    // feature rather than against one this build wrote and then edited.
    const old = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      entries: [
        {
          id: 'old-1',
          kind: 'sermon',
          title: 'Before all this',
          date: '2024-01-07',
          anchors: [],
          scriptureRefs: [],
          notes: 'Written years ago.',
          reflection: '',
          links: [],
          tags: [],
          forDescendants: false,
          visibility: 'private',
          createdAt: '2024-01-07T12:00:00.000Z',
          updatedAt: '2024-01-07T12:00:00.000Z',
        },
      ],
    };

    const { entries, warnings } = migrateExport(old);
    expect(warnings).toEqual([]);
    const restored = { entries };
    expect(restored.entries[0].notes).toBe('Written years ago.');
    expect(restored.entries[0].sourceMaterial).toBeUndefined();
  });

  it('keeps malformed provided material rather than dropping it, and says so', async () => {
    const { entries, warnings } = migrateExport({
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-09-21T09:00:00.000Z',
      entries: [{ ...entry(), sourceMaterial: { format: 'pdf' } }],
    });
    const restored = { entries };

    expect(restored.entries[0].sourceMaterial, 'half a record was accepted').toBeUndefined();
    expect(restored.entries[0]._unmigrated?.sourceMaterial).toEqual({ format: 'pdf' });
    expect(warnings.join(' ')).toMatch(/provided sermon notes were malformed/i);
  });
});

describe('the Markdown a stranger reads with no app', () => {
  it('puts the handout under its own heading, before the writing, attributed', () => {
    const ctx = context([entry()]);
    const note = renderNote(entry(), ctx);

    expect(note).toContain('## Provided notes');
    expect(note).toContain('Provided by City Gate Church');
    expect(note).toContain('Speaker: Pastor John Smith');
    expect(note).toContain('Imported from sermon-notes.json');
    expect(note).toContain("This section is not the writer's own words.");
    expect(note).toContain('Where your treasure is.');

    // Under its own heading and not under theirs, said as an ordering rather
    // than as two separate presence checks.
    expect(note.indexOf('## Provided notes')).toBeLessThan(note.indexOf('## Notes'));
    const ownNotes = note.slice(note.indexOf('## Notes'));
    expect(ownNotes, 'the handout appears under the writer’s own heading').not.toContain(
      'Where your treasure is.',
    );
  });

  it('says nothing at all when there is no handout', () => {
    const plain = entry({ sourceMaterial: undefined });
    const note = renderNote(plain, context([plain]));
    expect(note).not.toContain('Provided notes');
  });

  it('uses neutral wording when the file named no church', () => {
    const anonymous = entry({
      sourceMaterial: { ...MATERIAL, church: undefined, speaker: undefined },
    });
    const note = renderNote(anonymous, context([anonymous]));
    expect(note).toContain('Imported sermon notes');
    expect(note, 'a church was invented').not.toContain('Provided by');
  });
});

describe('the book', () => {
  it('labels the handout as provided, and never as the writer’s', () => {
    const html = renderBook(context([entry()]));

    expect(html).toContain('Provided notes');
    expect(html).toContain('Provided by City Gate Church');
    expect(html).toContain('Not the writer&rsquo;s own words.');
    expect(html).toContain('Imported from sermon-notes.json');

    // Before the writer's own heading, and carrying its own class so print
    // styling can keep them apart.
    expect(html).toContain('class="provided"');
    expect(html.indexOf('Provided notes')).toBeLessThan(html.indexOf('<h4>Notes</h4>'));
  });

  it('needs nothing from outside itself to show it', () => {
    // The book is read offline, possibly on paper. Provided material must not
    // introduce the first thing in it that needs fetching.
    const html = renderBook(context([entry()]));
    const provided = html.slice(html.indexOf('class="provided"'));
    expect(provided.slice(0, 2000)).not.toMatch(/src=["']https?:/);
  });
});

describe('the flat table', () => {
  it('counts the provided material and names its source, without dumping it', () => {
    const csv = renderCsv(context([entry()]));
    const [header, row] = csv.split('\r\n');

    expect(header).toContain('provided_chars');
    expect(header).toContain('provided_source');

    const columns = header.split(',');
    const cells = row.split(',');
    expect(cells[columns.indexOf('provided_chars')]).toBe(String(MATERIAL.body.length));
    expect(cells[columns.indexOf('provided_source')]).toBe('Provided by City Gate Church');

    // The body itself is not in here. A church's outline in a spreadsheet cell
    // is unreadable, and is one copy-paste from looking like the writer's.
    expect(csv, 'the provided body was dumped into the CSV').not.toContain(
      'Where your treasure is',
    );
  });
});
