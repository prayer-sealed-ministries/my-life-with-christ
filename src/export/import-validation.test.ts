import { describe, expect, it } from 'vitest';

import type { DraftForm, Entry } from '../types';
import { migrateExport } from './migrate';

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'entry-1',
  kind: 'sermon',
  title: 'Sunday',
  date: '2026-10-11',
  anchors: [],
  scriptureRefs: [],
  notes: 'Words worth keeping.',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-10-11T10:00:00.000Z',
  updatedAt: '2026-10-11T10:00:00.000Z',
  ...overrides,
});

const form = (): DraftForm => ({
  kind: 'sermon',
  title: '',
  date: '2026-10-11',
  place: '',
  speaker: '',
  sermonSeries: '',
  notes: 'Unfinished words.',
  reflection: '',
  prayer: '',
  tagsText: '',
  links: [],
  anchors: [],
  forDescendants: false,
  scriptureRefs: [],
  sourceMaterial: null,
});

const envelope = (entries: unknown[], drafts?: unknown[]) => ({
  format: 'journey-export',
  version: 1,
  entries,
  ...(drafts ? { drafts } : {}),
});

describe('journal import runtime validation', () => {
  it('preserves a malformed known entry field instead of silently defaulting it away', () => {
    const rawNotes = { markdown: 'Words from a newer schema.' };
    const result = migrateExport(envelope([{ ...entry(), notes: rawNotes }]));

    expect(result.entries[0].notes).toBe('');
    expect(result.entries[0]._unmigrated?.notes).toEqual(rawNotes);
    expect(result.warnings.join(' ')).toMatch(/notes.*preserved/i);
  });

  it('rejects duplicate entry ids before an import can mutate storage', () => {
    expect(() => migrateExport(envelope([entry(), entry({ title: 'Different' })]))).toThrow(
      /entry id.*more than once/i,
    );
  });

  it('rejects duplicate draft ids', () => {
    const draft = {
      id: 'draft-1',
      entryId: 'entry-1',
      form: form(),
      createdAt: '2026-10-11T10:01:00.000Z',
      updatedAt: '2026-10-11T10:02:00.000Z',
    };
    expect(() => migrateExport(envelope([entry()], [draft, { ...draft }]))).toThrow(
      /draft id.*more than once/i,
    );
  });

  it('rejects a malformed draft form rather than dropping unfinished writing', () => {
    expect(() =>
      migrateExport(
        envelope([entry()], [
          {
            id: 'draft-1',
            entryId: 'entry-1',
            form: { ...form(), notes: { wrong: 'shape' } },
            createdAt: '2026-10-11T10:01:00.000Z',
            updatedAt: '2026-10-11T10:02:00.000Z',
          },
        ]),
      ),
    ).toThrow(/draft.*notes/i);
  });

  it('preserves fields from a newer draft schema instead of silently dropping them', () => {
    const result = migrateExport(
      envelope([entry()], [
        {
          id: 'draft-1',
          entryId: 'entry-1',
          form: { ...form(), futureCursor: { start: 14, end: 22 } },
          createdAt: '2026-10-11T10:01:00.000Z',
          updatedAt: '2026-10-11T10:02:00.000Z',
          futureSyncState: { device: 'later-version' },
          _unmigrated: { alreadyCarried: 'still here' },
        },
      ]),
    );

    expect(result.drafts[0]._unmigrated).toEqual({
      alreadyCarried: 'still here',
      futureSyncState: { device: 'later-version' },
      form: { futureCursor: { start: 14, end: 22 } },
    });
    expect(result.warnings.join(' ')).toMatch(/unrecognised.*preserved/i);
  });

  it('rejects a draft whose parent is absent from the backup', () => {
    expect(() =>
      migrateExport(
        envelope([entry()], [
          {
            id: 'draft-1',
            entryId: 'missing-parent',
            form: form(),
            createdAt: '2026-10-11T10:01:00.000Z',
            updatedAt: '2026-10-11T10:02:00.000Z',
          },
        ]),
      ),
    ).toThrow(/not present/i);
  });
});
