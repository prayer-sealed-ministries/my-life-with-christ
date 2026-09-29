/**
 * An archive is verified before it is believed.
 *
 * The defect this suite exists for was measured on a real device, not guessed
 * at: an archive altered inside a still-valid ZIP, its MANIFEST.txt left
 * untouched, imported silently into an empty journal — the state every
 * migrating device is in — and the writing it replaced was gone. The manifest
 * had recorded the right checksum the whole time. Nothing read it.
 *
 * So the rule these tests hold is not merely "bad archives are rejected". It
 * is that verification happens BEFORE the bytes are treated as content: before
 * parsing, before the preview, before any conflict count, and before storage.
 * A refusal that arrived after the journal had been touched would satisfy a
 * careless reading of the requirement and none of the point.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { buildArchive } from './archive';
import { ArchiveIntegrityError, applyImport, parseImport, previewImport } from './importer';
import { createZip, readZip, sha256 } from './zip';
import { DexieStorageProvider } from '../storage/db';
import { examinedAtLeast } from '../testing/floor';
import type { DraftForm, Entry, EntryDraft } from '../types';

let counter = 0;
let db: DexieStorageProvider;

beforeEach(async () => {
  counter += 1;
  db = new DexieStorageProvider(`journey-integrity-${counter}`);
  await db.open();
});

const form = (overrides: Partial<DraftForm> = {}): DraftForm => ({
  kind: 'sermon',
  title: '',
  date: '2026-03-01',
  place: '',
  speaker: '',
  sermonSeries: '',
  notes: '',
  reflection: '',
  prayer: '',
  tagsText: '',
  links: [],
  anchors: [],
  forDescendants: false,
  scriptureRefs: [],
  sourceMaterial: null,
  ...overrides,
});

const draft = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  id: 'd1',
  form: form({ notes: 'MARKER-DRAFT-a sentence nobody finished' }),
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:04:00.000Z',
  ...overrides,
});

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  kind: 'sermon',
  title: 'MARKER-ENTRY-title',
  date: '2026-02-01',
  anchors: [],
  scriptureRefs: [],
  notes: 'MARKER-ENTRY-notes',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
  ...overrides,
});

const ENTRIES = [entry(), entry({ id: 'e2', title: 'MARKER-ENTRY-second' })];
const DRAFTS = [draft(), draft({ id: 'd2' })];

const soundArchive = async () =>
  (
    await buildArchive({
      entries: ENTRIES,
      drafts: DRAFTS,
      outlineBooks: [],
      topics: [],
      profile: 'public',
      now: new Date('2026-03-02T12:00:00.000Z'),
    })
  ).bytes;

/** Re-zip an archive after `mutate` has had a go at its files, in order. */
async function rebuild(
  bytes: Uint8Array,
  mutate: (files: { path: string; content: Uint8Array }[]) => void,
): Promise<Uint8Array> {
  const files = (await readZip(bytes)).map((file) => ({ path: file.path, content: file.bytes }));
  mutate(files);
  return createZip(files);
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const fileIn = (files: { path: string; content: Uint8Array }[], path: string) => {
  const found = files.find((file) => file.path === path);
  if (!found) throw new Error(`fixture is missing ${path}`);
  return found;
};

/** What the journal holds, as a comparable snapshot. */
async function snapshot() {
  const [entries, drafts] = await Promise.all([db.listEntries(), db.listDrafts()]);
  return JSON.stringify({ entries, drafts });
}

describe('a sound archive', () => {
  it('is accepted, and restores entries and drafts', async () => {
    const parsed = await parseImport(await soundArchive());
    expect(parsed.entries).toHaveLength(ENTRIES.length);
    expect(parsed.drafts).toHaveLength(DRAFTS.length);

    await applyImport(parsed, db, 'merge');

    expect(await db.listEntries()).toHaveLength(ENTRIES.length);
    const restored = await db.listDrafts();
    expect(restored).toHaveLength(DRAFTS.length);
    // Unfinished writing comes back unfinished, not as extra entries.
    expect(restored.map((one) => one.id).sort()).toEqual(['d1', 'd2']);
  });

  it('restores twice without duplicating anything', async () => {
    await applyImport(await parseImport(await soundArchive()), db, 'merge');
    const once = await snapshot();

    await applyImport(await parseImport(await soundArchive()), db, 'merge');

    expect(await snapshot()).toBe(once);
    expect(await db.listEntries()).toHaveLength(ENTRIES.length);
    expect(await db.listDrafts()).toHaveLength(DRAFTS.length);
  });

  it('still accepts a bare journey.json, which never had a manifest', async () => {
    // Not an older archive — a different input, and the one the UI offers
    // beside the .zip. Requiring a manifest of it would be requiring something
    // that has never existed.
    const files = await readZip(await soundArchive());
    const canonical = files.find((file) => file.path === 'data/journey.json')!;

    const parsed = await parseImport(textOf(canonical.bytes));

    expect(parsed.source).toBe('json');
    expect(parsed.entries).toHaveLength(ENTRIES.length);
  });
});

describe('a damaged archive is refused', () => {
  /** Every case below must reject, and the reasons must be distinguishable. */
  const cases: { name: string; damage: (bytes: Uint8Array) => Promise<Uint8Array> }[] = [
    {
      name: 'the canonical record was altered, manifest untouched',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const file = fileIn(files, 'data/journey.json');
          file.content = bytesOf(textOf(file.content).replace('MARKER-ENTRY-notes', 'SOMETHING-ELSE'));
        }),
    },
    {
      name: 'a draft was altered, manifest untouched',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const file = fileIn(files, 'data/journey.json');
          const text = textOf(file.content);
          expect(text).toContain('MARKER-DRAFT-');
          file.content = bytesOf(text.replace('MARKER-DRAFT-a sentence nobody finished', 'REWRITTEN'));
        }),
    },
    {
      name: 'a hash is wrong but the size is right',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          // Same length, and README.txt is read by nothing else, so only the
          // hash comparison can see this.
          const file = fileIn(files, 'README.txt');
          const text = textOf(file.content);
          const at = text.indexOf('journal');
          expect(at).toBeGreaterThan(-1);
          const replaced = `${text.slice(0, at)}JOURNAL${text.slice(at + 7)}`;
          expect(bytesOf(replaced).length).toBe(file.content.length);
          file.content = bytesOf(replaced);
        }),
    },
    {
      name: 'a file grew',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const file = fileIn(files, 'data/entries.csv');
          file.content = bytesOf(`${textOf(file.content)}\nextra,row\n`);
        }),
    },
    {
      name: 'a listed file is missing',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          files.splice(
            files.findIndex((file) => file.path === 'data/entries.csv'),
            1,
          );
        }),
    },
    {
      name: 'a required file is missing',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          files.splice(
            files.findIndex((file) => file.path === 'data/schema.json'),
            1,
          );
        }),
    },
    {
      name: 'a file was added that the manifest never named',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          files.push({ path: 'notes/planted.md', content: bytesOf('# not from the export\n') });
        }),
    },
    {
      name: 'the manifest lists a path twice',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const manifest = fileIn(files, 'MANIFEST.txt');
          const lines = textOf(manifest.content).split('\n');
          const hashLine = lines.find((line) => line.includes('  data/schema.json'))!;
          manifest.content = bytesOf([...lines, hashLine].join('\n'));
        }),
    },
    {
      name: 'the archive carries the same path twice',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const original = fileIn(files, 'data/journey.json');
          // A second member with the same name, whose content the manifest has
          // never vouched for. Which one a reader takes is luck.
          files.push({ path: 'data/journey.json', content: bytesOf('{"format":"journey-export"}') });
          expect(original.content.length).toBeGreaterThan(0);
        }),
    },
    {
      name: 'the manifest hashes almost nothing',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const manifest = fileIn(files, 'MANIFEST.txt');
          const lines = textOf(manifest.content).split('\n');
          const hashes = lines.filter((line) => /^[0-9a-f]{64}\s/.test(line));
          const prose = lines.filter((line) => !/^[0-9a-f]{64}\s/.test(line));
          manifest.content = bytesOf([...prose, hashes[0]].join('\n'));
        }),
    },
    {
      name: 'the manifest is gone',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          files.splice(
            files.findIndex((file) => file.path === 'MANIFEST.txt'),
            1,
          );
        }),
    },
    {
      name: 'the zip is truncated',
      damage: async (bytes) => bytes.slice(0, Math.floor(bytes.length / 2)),
    },
    {
      name: 'the zip is malformed',
      damage: async (bytes) => {
        // Keep the ZIP magic so it is still offered to the archive reader, and
        // ruin the rest.
        const broken = bytes.slice();
        broken.fill(0, 4, broken.length - 8);
        return broken;
      },
    },
  ];

  // A floor: if this list were ever emptied or filtered to nothing, the suite
  // below would pass having proved nothing at all.
  examinedAtLeast(cases.length, 13, 'damage cases');

  for (const { name, damage } of cases) {
    it(`rejects when ${name}`, async () => {
      const damaged = await damage(await soundArchive());

      await expect(parseImport(damaged)).rejects.toThrow();
    });

    it(`leaves an EMPTY journal untouched when ${name}`, async () => {
      const damaged = await damage(await soundArchive());
      const before = await snapshot();

      await expect(parseImport(damaged)).rejects.toThrow();

      // The exact Lane-16 regression: before verification existed, this case
      // imported silently into an empty journal.
      expect(await snapshot()).toBe(before);
      expect(await db.listEntries()).toHaveLength(0);
      expect(await db.listDrafts()).toHaveLength(0);
    });

    it(`leaves a POPULATED journal untouched when ${name}`, async () => {
      await applyImport(await parseImport(await soundArchive()), db, 'merge');
      const before = await snapshot();
      expect(await db.listEntries()).toHaveLength(ENTRIES.length);

      const damaged = await damage(await soundArchive());
      await expect(parseImport(damaged)).rejects.toThrow();

      expect(await snapshot()).toBe(before);
    });
  }
});

describe('the whole restore path, as the view drives it', () => {
  /**
   * parse then apply, the way DataView does it.
   *
   * The `leaves ... untouched` cases above stop at parseImport, so they cannot
   * tell WHERE validation happens — only that it happened. This one runs the
   * full path, which is what distinguishes "refused before anything was
   * written" from "written, then refused".
   */
  const restore = async (bytes: Uint8Array) => applyImport(await parseImport(bytes), db, 'merge');

  it('writes nothing at all when the archive is damaged', async () => {
    const damaged = await rebuild(await soundArchive(), (files) => {
      const file = fileIn(files, 'data/journey.json');
      file.content = bytesOf(textOf(file.content).replace('MARKER-ENTRY-notes', 'SOMETHING-ELSE'));
    });

    await expect(restore(damaged)).rejects.toThrow();

    expect(await db.listEntries()).toHaveLength(0);
    expect(await db.listDrafts()).toHaveLength(0);
  });

  it('writes nothing over a populated journal when the archive is damaged', async () => {
    await restore(await soundArchive());
    const before = await snapshot();

    const damaged = await rebuild(await soundArchive(), (files) => {
      const file = fileIn(files, 'data/journey.json');
      file.content = bytesOf(
        textOf(file.content).replace('MARKER-DRAFT-a sentence nobody finished', 'REWRITTEN'),
      );
    });

    await expect(restore(damaged)).rejects.toThrow();

    expect(await snapshot()).toBe(before);
  });
});

describe('what the refusal says', () => {
  it('names verification, not blame, and keeps the detail out of the message', async () => {
    const damaged = await rebuild(await soundArchive(), (files) => {
      const file = fileIn(files, 'data/journey.json');
      file.content = bytesOf(textOf(file.content).replace('MARKER-ENTRY-notes', 'SOMETHING-ELSE'));
    });

    const error = await parseImport(damaged).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ArchiveIntegrityError);
    const thrown = error as ArchiveIntegrityError;
    expect(thrown.message).toBe('This backup could not be verified and was not restored.');

    // Corruption produces this too, so the wording may not accuse anyone.
    for (const word of ['hacked', 'malicious', 'compromised', 'tampered', 'attack']) {
      expect(thrown.message.toLowerCase()).not.toContain(word);
    }
    // No hashes in what a reader sees; they belong in the detail.
    expect(thrown.message).not.toMatch(/[0-9a-f]{16}/);
    expect(thrown.problems.length).toBeGreaterThan(0);
  });
});

describe('verification happens before anything reads the content', () => {
  it('refuses before a preview can be computed from damaged bytes', async () => {
    const damaged = await rebuild(await soundArchive(), (files) => {
      const file = fileIn(files, 'data/journey.json');
      file.content = bytesOf(textOf(file.content).replace('MARKER-ENTRY-notes', 'SOMETHING-ELSE'));
    });

    // previewImport can only run on a ParsedImport, and parseImport is where
    // verification lives — so there is no arrangement of the public API that
    // yields a preview of an unverified archive. Proved by there being nothing
    // to hand it.
    await expect(parseImport(damaged)).rejects.toBeInstanceOf(ArchiveIntegrityError);

    const sound = await parseImport(await soundArchive());
    const preview = previewImport(sound, await db.listEntries(), 'merge');
    expect(preview.newEntries).toBe(ENTRIES.length);
  });

  it('hashes what the manifest recorded, using the same function that wrote it', async () => {
    // Writer and verifier must not drift. If these were two implementations,
    // this is where the disagreement would show.
    const files = await readZip(await soundArchive());
    const manifest = files.find((file) => file.path === 'MANIFEST.txt')!;
    const schema = files.find((file) => file.path === 'data/schema.json')!;

    const recorded = textOf(manifest.bytes)
      .split('\n')
      .find((line) => line.endsWith('  data/schema.json'))!
      .slice(0, 64);

    expect(await sha256(schema.bytes)).toBe(recorded);
  });
});
