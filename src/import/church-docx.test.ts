/**
 * A Word document handed out at church.
 *
 * The thing being pinned is not that DOCX can be read — the general importer
 * has read one for a long time. It is WHERE the words land. Import church
 * notes is the door for material somebody else supplied, so what comes through
 * it is Provided notes, and the reader's own fields are not touched.
 *
 * File type never decides authorship. The route does. A `.docx` taken through
 * the general importer is still the reader's own writing, and the same file
 * taken through this one is still somebody else's.
 *
 * Every document here is fictional.
 */
import { describe, expect, it } from 'vitest';

import { readSermonNotes } from './sermon-notes';
import { makeDocx } from './fixtures';

const HANDOUT = [
  { text: 'FICTIONAL-DOC Harbour Chapel', style: 'Heading1' },
  { text: 'Three points: wait, watch, walk.' },
  { text: 'The second reading was Jhn 3:16.' },
];

describe('church notes from a Word document', () => {
  it('reads the words, and records what it was read out of', async () => {
    const docx = await makeDocx(HANDOUT);
    const proposal = await readSermonNotes(docx, 'church-notes.docx');

    expect(proposal.material.body).toContain('Three points: wait, watch, walk.');
    // Named for what it is. Calling it `txt` because extraction produced text
    // would be a lie on the record about where somebody's words came from.
    expect(proposal.material.format).toBe('docx');
    expect(proposal.material.filename).toBe('church-notes.docx');
    expect(proposal.material.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never puts somebody else’s words in the reader’s own fields', async () => {
    const docx = await makeDocx(HANDOUT);
    const proposal = await readSermonNotes(docx, 'church-notes.docx');

    // The proposal carries provided material and a few suggestions about the
    // entry. It has no route to Notes, Reflection or Prayer, and the shape is
    // the guarantee rather than a rule somebody has to remember.
    const suggested = JSON.stringify(proposal.suggested);
    expect(suggested).not.toContain('Three points');
    expect(suggested).not.toContain('FICTIONAL-DOC');
    expect(Object.keys(proposal)).not.toContain('notes');
    expect(Object.keys(proposal)).not.toContain('reflection');
    expect(Object.keys(proposal)).not.toContain('prayer');
  });

  it('reads nothing about who provided it out of the prose', async () => {
    const docx = await makeDocx([
      { text: 'Pastor Alder Finch', style: 'Heading1' },
      { text: 'Harbour Chapel — 14 March 2027' },
      { text: 'FICTIONAL-DOC body text' },
    ]);
    const proposal = await readSermonNotes(docx, 'harbour-chapel-2027-03-14.docx');

    // A heading that looks like a name is not a statement that it is one, and
    // a filename is not evidence either. The structured sermon-notes format
    // exists for saying these things outright.
    expect(proposal.material.speaker).toBeUndefined();
    expect(proposal.material.church).toBeUndefined();
    expect(proposal.material.date).toBeUndefined();
    expect(proposal.material.scripture).toBeUndefined();
    // `suggested` carries nothing at all here, which is the stronger claim
    // than any one field being absent.
    expect(Object.keys(proposal.suggested)).toHaveLength(0);
  });

  it('refuses a macro-enabled document before reading a word of it', async () => {
    const macro = await makeDocx(HANDOUT, [
      { path: 'word/vbaProject.bin', content: 'FICTIONAL-DOC not a real macro' },
    ]);
    await expect(readSermonNotes(macro, 'church-notes.docx')).rejects.toThrow(
      /doesn’t import safely/i,
    );
  });

  it('refuses something that is not a Word document at all', async () => {
    const notWord = new TextEncoder().encode('FICTIONAL-DOC plain text in disguise');
    await expect(readSermonNotes(notWord, 'church-notes.docx')).rejects.toThrow(
      /named as a Word document/i,
    );
  });

  it('refuses an empty document rather than proposing nothing', async () => {
    const empty = await makeDocx([{ text: '' }]);
    await expect(readSermonNotes(empty, 'church-notes.docx')).rejects.toThrow();
  });
});
