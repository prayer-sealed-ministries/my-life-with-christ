/**
 * The four formats, and the judgement each one needs.
 *
 * The recurring assertion across this file is restraint: a document that cannot
 * confidently be divided must arrive as ONE note rather than as a pile of
 * fragments, because a person will fix one wrong note and will abandon sixty.
 */

import { describe, expect, it } from 'vitest';

import { examinedAtLeast } from '../testing/floor';
import { parseDocument } from './candidates';
import { docxToText, parseDocx } from './docx';
import { makeDeflatedZip, makeDocx } from './fixtures';
import { MAX_CANDIDATES, MAX_FILE_BYTES } from './limits';
import { splitMarkdown, splitText } from './segment';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

describe('plain text', () => {
  it('offers a single note as one note', async () => {
    const parsed = await parseDocument(bytes('Sunday notes.\n\nHe spoke on grace.'), 'note.txt');
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].body).toContain('He spoke on grace.');
  });

  it('keeps paragraph breaks', async () => {
    const parsed = await parseDocument(bytes('First thought.\n\nSecond thought.'), 'a.txt');
    expect(parsed.candidates[0].body).toBe('First thought.\n\nSecond thought.');
  });

  it('splits on dated lines when there are several', () => {
    const doc = [
      '14 September 2024',
      'He preached on Romans 8.',
      '',
      '21 September 2024',
      'Communion Sunday.',
      '',
      '28 September 2024',
      'Visiting speaker.',
    ].join('\n');

    const sections = splitText(doc, 'fallback');
    expect(sections).toHaveLength(3);
    expect(sections[0].via).toBe('date-line');
    expect(sections[1].body).toContain('Communion Sunday.');
  });

  it('does NOT split on blank lines alone', () => {
    // Paragraphs are separated by blank lines too. Splitting on them turns an
    // essay into a pile of paragraphs, which is the failure mode this avoids.
    const essay = Array.from({ length: 8 }, (_, i) => `Paragraph ${i} of a single long note.`).join(
      '\n\n',
    );
    const sections = splitText(essay, 'fallback');
    expect(sections).toHaveLength(1);
    expect(sections[0].via).toBe('whole-document');
  });

  it('does not split on a single date', () => {
    const sections = splitText('14 September 2024\nOne note only.', 'fallback');
    expect(sections).toHaveLength(1);
  });

  it('detects a reference and a date inside the note', async () => {
    const parsed = await parseDocument(
      bytes('Sunday 14 September 2024\n\nHe preached John 3:16 at length.'),
      'note.txt',
    );
    expect(parsed.candidates[0].date).toBe('2024-09-14');
    expect(parsed.candidates[0].detectedRefs[0]?.label).toBe('John 3:16');
    expect(parsed.stats.references).toBe(1);
  });

  it('refuses an empty file, in words', async () => {
    await expect(parseDocument(bytes(''), 'empty.txt')).rejects.toThrow(/empty/i);
    await expect(parseDocument(bytes('   \n\n  '), 'blank.txt')).rejects.toThrow(/no text/i);
  });

  it('refuses an oversized file without reading it', async () => {
    const huge = new Uint8Array(MAX_FILE_BYTES + 1);
    await expect(parseDocument(huge, 'huge.txt')).rejects.toThrow(/larger than/i);
  });

  it('refuses a file type it does not handle', async () => {
    await expect(parseDocument(bytes('x'), 'notes.rtf')).rejects.toThrow(/not supported/i);
    await expect(parseDocument(bytes('x'), 'notes')).rejects.toThrow(/not supported/i);
  });

  it('caps how many notes it will offer', async () => {
    // Real consecutive dates, not "32 January": an impossible day is correctly
    // refused by the detector, so a naive fixture produces almost no boundaries
    // and the cap is never reached. The first version of this test did that and
    // passed for the wrong reason.
    const many = Array.from({ length: MAX_CANDIDATES + 40 }, (_, i) => {
      const day = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      return `${day}\nNote ${i}.`;
    }).join('\n\n');
    const parsed = await parseDocument(bytes(many), 'many.txt');
    expect(parsed.candidates.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(parsed.notices.join(' ')).toMatch(/only the first/i);
  });
});

describe('markdown', () => {
  it('splits on headings', () => {
    const sections = splitMarkdown('# One\n\nBody one.\n\n# Two\n\nBody two.', 'fallback');
    expect(sections.map((s) => s.title)).toEqual(['One', 'Two']);
    expect(sections[0].body).toBe('Body one.');
  });

  it('does not split on a single heading', () => {
    const sections = splitMarkdown('# Only\n\nBody.', 'fallback');
    expect(sections).toHaveLength(1);
  });

  it('ignores deeper headings, which are structure inside a note', () => {
    const doc = '# Sermon\n\n### Point one\n\nText.\n\n### Point two\n\nText.';
    const sections = splitMarkdown(doc, 'fallback');
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain('### Point one');
  });

  it('does not treat a heading inside a code fence as a heading', () => {
    const doc = '# Real\n\n```\n# not a heading\n# also not\n```\n\nBody.';
    expect(splitMarkdown(doc, 'fallback')).toHaveLength(1);
  });

  it('preserves lists and quotes in the body', async () => {
    const doc = '# One\n\n- a\n- b\n\n> quoted\n\n# Two\n\n1. first\n2. second';
    const parsed = await parseDocument(bytes(doc), 'notes.md');
    expect(parsed.candidates[0].body).toContain('- a');
    expect(parsed.candidates[0].body).toContain('> quoted');
    expect(parsed.candidates[1].body).toContain('1. first');
  });
});

describe('docx', () => {
  it('reads paragraphs in order', async () => {
    const file = await makeDocx([
      { text: 'First paragraph.' },
      { text: 'Second paragraph.' },
    ]);
    const text = docxToText(await parseDocx(file));
    expect(text).toBe('First paragraph.\nSecond paragraph.');
  });

  it('turns Word headings into Markdown headings', async () => {
    const file = await makeDocx([
      { text: 'Sunday Sermon', style: 'Heading1' },
      { text: 'He spoke on grace.' },
    ]);
    const text = docxToText(await parseDocx(file));
    expect(text).toContain('# Sunday Sermon');
  });

  it('turns Word list paragraphs into Markdown list items', async () => {
    const file = await makeDocx([
      { text: 'Point one', list: true },
      { text: 'Point two', list: true },
    ]);
    const text = docxToText(await parseDocx(file));
    expect(text).toContain('- Point one');
    expect(text).toContain('- Point two');
  });

  it('splits a Word document on its headings, like Markdown', async () => {
    const file = await makeDocx([
      { text: 'First sermon', style: 'Heading1' },
      { text: 'On Romans 8:28.' },
      { text: 'Second sermon', style: 'Heading1' },
      { text: 'On Psalm 23.' },
    ]);
    const parsed = await parseDocument(file, 'sermons.docx');
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0].title).toBe('First sermon');
    expect(parsed.candidates[1].detectedRefs[0]?.label).toBe('Psalms 23');
  });

  it('decodes XML entities back into characters', async () => {
    const file = await makeDocx([{ text: 'Grace & peace <to you>' }]);
    const text = docxToText(await parseDocx(file));
    expect(text).toBe('Grace & peace <to you>');
  });

  it('refuses a file that is not a Word document', async () => {
    await expect(parseDocument(bytes('this is not a zip'), 'fake.docx')).rejects.toThrow(
      // The refusal now comes from the type check rather than from the ZIP
      // reader: a file named .docx that is not a package is refused before
      // anything tries to open it as one.
      /named as a Word document, but its contents are not a supported .docx/i,
    );
  });

  it('refuses an archive with no document body', async () => {
    const file = await makeDeflatedZip([{ path: 'other.xml', content: bytes('<x/>') }]);
    await expect(parseDocument(file, 'empty.docx')).rejects.toThrow(
      /named as a Word document, but its contents are not a supported .docx/i,
    );
  });

  it('reads a genuinely deflated document, not only a stored one', async () => {
    // Every real .docx is deflated, so this is the path that matters.
    const body = 'Compressed body text. '.repeat(200);
    const file = await makeDeflatedZip([
      {
        path: 'word/document.xml',
        content: bytes(
          '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>' + body + '</w:t></w:r></w:p></w:body></w:document>',
        ),
      },
    ]);
    const paragraphs = await parseDocx(file);
    examinedAtLeast(paragraphs.length, 1, 'paragraphs read from a deflated document');
    expect(paragraphs[0].text).toContain('Compressed body text.');
  });
});

describe('what the parser hands back', () => {
  it('records provenance on every candidate it turns into an entry', async () => {
    const { candidateToEntry } = await import('./candidates');
    const parsed = await parseDocument(bytes('A note.'), 'Sunday Sermons 2019.txt');
    const entry = candidateToEntry(parsed.candidates[0], parsed, '2026-03-01T00:00:00.000Z', 0);

    expect(entry.source).toEqual({
      importedAt: '2026-03-01T00:00:00.000Z',
      filename: 'Sunday Sermons 2019.txt',
      format: 'txt',
      itemIndex: 1,
      parserVersion: 1,
    });
  });

  it('keeps every reference it found, not only the one it chose', async () => {
    const { candidateToEntry } = await import('./candidates');
    const parsed = await parseDocument(
      bytes('He read John 3:16, then Romans 8:28, then Psalm 23.'),
      'note.txt',
    );
    const candidate = parsed.candidates[0];
    examinedAtLeast(candidate.detectedRefs.length, 3, 'references detected in one note');

    const entry = candidateToEntry(candidate, parsed, '2026-03-01T00:00:00.000Z', 0);
    // One becomes the anchor; the rest are kept as text rather than discarded.
    expect(entry.anchors).toHaveLength(1);
    expect(entry.scriptureRefs).toEqual(['Romans 8:28', 'Psalms 23']);
    expect(candidate.reasons).toContain('multiple-refs');
  });

  it('leaves the date empty rather than inventing one', async () => {
    const parsed = await parseDocument(bytes('A note with no date in it at all.'), 'note.txt');
    expect(parsed.candidates[0].date).toBe('');
    expect(parsed.candidates[0].reasons).toContain('no-date');
  });

  it('fingerprints the file and each note, for duplicate detection', async () => {
    const a = await parseDocument(bytes('Identical content.'), 'a.txt');
    const b = await parseDocument(bytes('Identical content.'), 'b.txt');
    expect(a.fileFingerprint).toBe(b.fileFingerprint);
    expect(a.candidates[0].fingerprint).toBe(b.candidates[0].fingerprint);

    const c = await parseDocument(bytes('Different content.'), 'c.txt');
    expect(c.candidates[0].fingerprint).not.toBe(a.candidates[0].fingerprint);
  });
});
