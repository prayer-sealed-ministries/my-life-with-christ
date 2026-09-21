/**
 * A shared handout is the same provided material as a picked one.
 *
 * There is no archive concept for "arrived through Share", and this is the test
 * that keeps it that way. The canonical record must be byte-identical whichever
 * doorway the file came through, and must never carry an Android content URI —
 * a value that is meaningless outside the process that was granted it and
 * would be nonsense to somebody reading the archive in 2060.
 */

import { describe, expect, it } from 'vitest';

import { acceptIncomingDocument } from '../import/incoming';
import { readSermonNotes } from '../import/sermon-notes';
import type { Entry } from '../types';

const utf8 = (text: string) => new TextEncoder().encode(text);
const BODY = '# Abiding\n\nPoint three: the pelican in the wilderness.\n';

const entryWith = (material: Entry['sourceMaterial']): Entry => ({
  id: 'e1',
  kind: 'sermon',
  title: 'Sunday',
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  sourceMaterial: material,
});

describe('the canonical record does not know how the file arrived', () => {
  it('produces identical material from a picked and a shared file', async () => {
    const bytes = utf8(BODY);

    const picked = await readSermonNotes(bytes, 'handout.md');
    const accepted = acceptIncomingDocument({
      name: 'handout.md',
      mimeType: 'text/markdown',
      bytes,
    });
    const shared = await readSermonNotes(accepted.bytes, accepted.filename);

    // importedAt is a clock reading and legitimately differs; everything that
    // describes the document itself must not.
    const { importedAt: _p, ...pickedMaterial } = picked.material;
    const { importedAt: _s, ...sharedMaterial } = shared.material;
    expect(sharedMaterial).toEqual(pickedMaterial);

    // And what lands in an entry is the same shape, with no extra field.
    expect(Object.keys(shared.material).sort()).toEqual(Object.keys(picked.material).sort());
  });

  it('carries no trace of a content URI anywhere in the entry', async () => {
    const accepted = acceptIncomingDocument({
      // A display name a content provider might plausibly hand over.
      name: 'content://com.android.providers.downloads/document/42',
      mimeType: 'text/markdown',
      bytes: utf8(BODY),
    });
    const proposal = await readSermonNotes(accepted.bytes, accepted.filename);
    const entry = entryWith(proposal.material);

    const serialised = JSON.stringify(entry);
    for (const scheme of ['content://', 'file://', 'android.resource://']) {
      expect(serialised, `${scheme} reached the canonical record`).not.toContain(scheme);
    }
    // The path is reduced to a bare name, as every imported filename is.
    expect(entry.sourceMaterial?.filename).toBe('42.md');
  });

  it('adds no field to SourceMaterial for the sharing path', async () => {
    const proposal = await readSermonNotes(utf8(BODY), 'handout.md');
    // Pinned deliberately: a new key here is a new thing every archive ever
    // written would have to explain.
    expect(Object.keys(proposal.material).sort()).toEqual(
      ['body', 'filename', 'format', 'importedAt', 'parserVersion', 'sha256'].sort(),
    );
  });
});
