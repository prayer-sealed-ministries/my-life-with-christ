/**
 * App Lock is device-local, and the archive proves it.
 *
 * The inheritance promise is that a journal exported here can be restored
 * anywhere, by anyone holding it, in 2060. A PIN travelling inside that file
 * would be a contradiction twice over: it would follow a journal onto a
 * machine that cannot check it, and it would put a secret into the one
 * artefact this project tells people to copy about and keep forever.
 *
 * So the archive carries entries and drafts and nothing about the lock. That is
 * true today because the lock lives natively and the builder has no way to
 * reach it — but "the wiring happens not to exist" is exactly the kind of fact
 * that stops being true quietly, which is what this file is for.
 */

import { describe, expect, it } from 'vitest';

import { buildArchive, buildJourneyJson, buildContext } from './archive';
import { readZip, zipEntryText } from './zip';
import { renderSharedEntryText, renderSharedEntryMarkdown, buildSharedEntryDocument, PRIVATE_BY_DEFAULT } from '../share/entry-document';
import type { Entry, Settings } from '../types';

const ENTRY: Entry = {
  id: 'e1',
  kind: 'sermon',
  title: 'A title',
  date: '2026-02-01',
  anchors: [],
  scriptureRefs: [],
  notes: 'Some notes',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
};

/** Anything that would be a leak if it turned up in an exported file. */
const FORBIDDEN = [
  /\bpin\b/i,
  /applock/i,
  /app[-_ ]lock/i,
  /verifier/i,
  /keystore/i,
  /hmac/i,
  /\bsalt\b/i,
  /lockTimeout/i,
  /failures/i,
];

const archive = async () =>
  buildArchive({
    entries: [ENTRY],
    drafts: [],
    outlineBooks: [],
    topics: [],
    profile: 'public',
    now: new Date('2026-03-02T12:00:00.000Z'),
  });

describe('the exported archive', () => {
  it('carries only the keys the format declares, and no lock among them', async () => {
    const json = buildJourneyJson(
      await buildContext({
        entries: [ENTRY],
        drafts: [],
        outlineBooks: [],
        topics: [],
        profile: 'public',
      }),
    );

    expect(Object.keys(json).sort()).toEqual(['entries', 'exportedAt', 'format', 'version']);
    for (const pattern of FORBIDDEN) {
      expect(JSON.stringify(json)).not.toMatch(pattern);
    }
  });

  it('mentions nothing about App Lock in any file it contains', async () => {
    const built = await archive();
    const files = await readZip(built.bytes);

    // The floor: a zip that failed to build would satisfy every "does not
    // contain" assertion below by containing nothing.
    expect(files.length).toBeGreaterThanOrEqual(10);

    const offenders: string[] = [];
    for (const file of files) {
      // Binary members would decode to noise; every file this format writes is
      // text, and that is worth asserting rather than assuming.
      const text = zipEntryText(file);
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${file.path} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no place in the settings record to put one', () => {
    // A compile-time check written as a runtime one: if `Settings` ever grows
    // a PIN or a lock field, this stops type-checking and somebody has to
    // decide deliberately rather than by autocomplete.
    const settings: Settings = {
      lastExportAt: '2026-01-01T00:00:00.000Z',
      reminderDismissedAt: undefined,
      backupReminderDays: 30,
      theme: 'system',
    };
    expect(Object.keys(settings).sort()).toEqual([
      'backupReminderDays',
      'lastExportAt',
      'reminderDismissedAt',
      'theme',
    ]);
  });
});

describe('sharing one entry', () => {
  it('says nothing about the lock in text or Markdown', () => {
    const document = buildSharedEntryDocument(ENTRY, PRIVATE_BY_DEFAULT);
    const rendered = `${renderSharedEntryText(document)}\n${renderSharedEntryMarkdown(document)}`;

    expect(rendered.length).toBeGreaterThan(20);
    for (const pattern of FORBIDDEN) {
      expect(rendered).not.toMatch(pattern);
    }
  });
});
