import { beforeEach, describe, expect, it } from 'vitest';

import { DexieStorageProvider } from '../storage/db';
import { buildArchive, buildContext } from './archive';
import { applyImport, parseImport, previewImport } from './importer';
import { migrateExport } from './migrate';
import { readZip, zipEntryText } from './zip';
import { renderNote } from './notes';
import { ALL_ENTRIES, AWKWARD, READING, SERMON } from './fixtures';
import { outlinesForProfile } from '../../scripts/vite-plugin-data-profile.mjs';
import outlines from '../data/outlines.json';
import topicsFile from '../data/topics.json';
import versification from '../data/kjv/versification.json';
import { referenceSpan, buildIndex } from '../lib/verse-index';
import { examinedAtLeast } from '../testing/floor';
import type { Entry, OutlineBook, Topic } from '../types';

const fullBooks = outlines as unknown as OutlineBook[];
/**
 * Exactly what a refs-only build ships of the outlines: nothing.
 *
 * Not a stripped copy — the verse-span divisions are the author's arrangement
 * and are as protected as the titles, so a publishable build carries none of it.
 */
const refsOnlyBooks = outlinesForProfile(outlines, 'refs-only') as unknown as OutlineBook[];
const topics = topicsFile.topics as Topic[];
const counts = versification as Record<string, number[]>;
const NOW = new Date('2026-09-13T12:00:00.000Z');

let db: DexieStorageProvider;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = new DexieStorageProvider(`journey-downgrade-${counter}`);
  await db.open();
});

describe('downgrade: a full-profile journal imported into a refs-only build', () => {
  it('imports every entry, losing none', async () => {
    const archive = await buildArchive({
      entries: ALL_ENTRIES,
      outlineBooks: fullBooks,
      topics,
      profile: 'full',
      now: NOW,
    });

    // The importing build has no outline data at all.
    const parsed = await parseImport(archive.bytes, {
      isTopicId: (id) => topics.some((topic) => topic.id === id),
      isBookId: (id) => id in counts,
      resolveOutlineId: () => undefined,
    });

    await applyImport(parsed, db, 'merge');
    const imported = await db.listEntries();

    expect(imported).toHaveLength(ALL_ENTRIES.length);
    expect(imported.map((entry) => entry.id).sort()).toEqual(ALL_ENTRIES.map((entry) => entry.id).sort());
  });

  it('leaves no dangling anchor — every passage anchor still resolves to scripture', async () => {
    const archive = await buildArchive({
      entries: ALL_ENTRIES, outlineBooks: fullBooks, topics, profile: 'full', now: NOW,
    });
    const parsed = await parseImport(archive.bytes, { resolveOutlineId: () => undefined });
    await applyImport(parsed, db, 'merge');

    const dangling: string[] = [];
    let anchorsChecked = 0;

    for (const entry of await db.listEntries()) {
      for (const anchor of entry.anchors) {
        anchorsChecked += 1;
        if (anchor.kind === 'topic') {
          if (!topics.some((topic) => topic.id === anchor.topicId)) dangling.push(`${entry.id}: topic ${anchor.topicId}`);
          continue;
        }
        if (!(anchor.book in counts)) {
          dangling.push(`${entry.id}: book ${anchor.book}`);
          continue;
        }
        if (anchor.kind === 'scripture') {
          const span = referenceSpan(buildIndex(counts[anchor.book]), anchor);
          if (!span) dangling.push(`${entry.id}: ${anchor.book} ${anchor.chapterStart}:${anchor.verseStart}`);
        }
      }
    }

    // Without this, an import that silently dropped every anchor would pass:
    // no anchors means no dangling anchors.
    examinedAtLeast(anchorsChecked, ALL_ENTRIES.length, 'anchors');
    expect(dangling).toEqual([]);
  });

  it('leaves no orphaned entry — every entry keeps at least one resolvable anchor', async () => {
    const archive = await buildArchive({
      entries: ALL_ENTRIES, outlineBooks: fullBooks, topics, profile: 'full', now: NOW,
    });
    const parsed = await parseImport(archive.bytes, { resolveOutlineId: () => undefined });
    await applyImport(parsed, db, 'merge');

    const imported = await db.listEntries();
    examinedAtLeast(imported.length, ALL_ENTRIES.length, 'imported entries');

    for (const entry of imported) {
      const resolvable = entry.anchors.filter(
        (anchor) => anchor.kind === 'topic' || anchor.book in counts,
      );
      expect(resolvable.length, `${entry.id} has no resolvable anchor`).toBeGreaterThan(0);
    }
  });

  it('keeps the outline id as a secondary hint, unused but not discarded', async () => {
    const archive = await buildArchive({
      entries: [SERMON], outlineBooks: fullBooks, topics, profile: 'full', now: NOW,
    });
    const parsed = await parseImport(archive.bytes, { resolveOutlineId: () => undefined });
    await applyImport(parsed, db, 'merge');

    const [entry] = await db.listEntries();
    const anchor = entry.anchors.find((a) => a.kind === 'scripture');
    expect(anchor).toMatchObject({ book: 'matthew', chapterStart: 5, outlineEntryId: 'matthew-5-1-12' });
  });

  it('still renders a complete note under refs-only, scripture and all', async () => {
    const ctx = await buildContext({
      entries: [SERMON], outlineBooks: refsOnlyBooks, topics, profile: 'refs-only', now: NOW,
    });
    const note = renderNote(SERMON, ctx);

    expect(note).toContain('Blessed are the poor in spirit');
    expect(note).toContain(SERMON.reflection.split('\n')[0]);
    expect(note).toMatch(/King James Version/i);
  });

  it('builds a whole archive under refs-only without the outline layer', async () => {
    const archive = await buildArchive({
      entries: ALL_ENTRIES, outlineBooks: refsOnlyBooks, topics, profile: 'refs-only', now: NOW,
    });
    expect(archive.paths).toContain('book/my-journey-with-christ.html');
    expect(archive.paths.filter((p) => p.startsWith('notes/'))).toHaveLength(5);

    const files = await readZip(archive.bytes);
    const book = zipEntryText(files.find((f) => f.path === 'book/my-journey-with-christ.html')!);
    expect(book).toContain('The Beatitudes');
  });
});

describe('forward migration never drops a field', () => {
  it('preserves an unknown field verbatim in _unmigrated', () => {
    const { entries, warnings } = migrateExport({
      format: 'journey-export',
      version: 99,
      entries: [{ ...SERMON, somethingNewer: { nested: [1, 2, 3] } }],
    });

    expect(entries[0]._unmigrated).toEqual({ somethingNewer: { nested: [1, 2, 3] } });
    expect(warnings.join(' ')).toMatch(/somethingNewer/);
    expect(warnings.join(' ')).toMatch(/newer version/);
  });

  it('migrates the old string-array anchor format forward', () => {
    const legacy = {
      format: 'journey-export',
      version: 1,
      entries: [{ ...SERMON, anchors: ['matthew-5-1-12', 'humility', 'matthew'] }],
    };

    const { entries } = migrateExport(legacy, {
      isTopicId: (id) => id === 'humility',
      isBookId: (id) => id === 'matthew',
      resolveOutlineId: (id) =>
        id === 'matthew-5-1-12'
          ? { book: 'matthew', chapterStart: 5, verseStart: 1, chapterEnd: 5, verseEnd: 12 }
          : undefined,
    });

    expect(entries[0].anchors).toEqual([
      { kind: 'scripture', book: 'matthew', chapterStart: 5, verseStart: 1, chapterEnd: 5, verseEnd: 12, outlineEntryId: 'matthew-5-1-12' },
      { kind: 'topic', topicId: 'humility' },
      { kind: 'book', book: 'matthew' },
    ]);
  });

  it('preserves an unresolvable legacy anchor instead of inventing one', () => {
    const { entries, warnings } = migrateExport(
      { format: 'journey-export', version: 1, entries: [{ ...SERMON, anchors: ['some-outline-id'] }] },
      { resolveOutlineId: () => undefined },
    );

    expect(entries[0].anchors).toEqual([]);
    expect(entries[0]._unmigrated?.anchors).toEqual(['some-outline-id']);
    expect(warnings.join(' ')).toMatch(/could not be resolved/);
  });

  it('reports dangling anchors in the preview rather than failing', async () => {
    const parsed = await parseImport(
      JSON.stringify({ format: 'journey-export', version: 1, entries: [SERMON, READING, AWKWARD] }),
    );
    const preview = previewImport(parsed, [], 'merge', (entry: Entry) => entry.anchors.length > 0);
    expect(preview.danglingAnchors).toBe(0);
    expect(preview.incoming).toBe(3);
  });
});
