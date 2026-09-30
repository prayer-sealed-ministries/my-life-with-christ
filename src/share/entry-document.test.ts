/**
 * What leaves the app when one entry is shared.
 *
 * The important assertions here are the ABSENCES. A share that carries a
 * little too much is not a bug somebody notices and reports — it is a message
 * already sent to somebody who should not have received it, and there is no
 * undo for that. So the selection is tested from both sides, and the internals
 * of the record are tested to be nowhere in the output at all.
 */

import { describe, expect, it } from 'vitest';

import {
  PRIVATE_BY_DEFAULT,
  buildSharedEntryDocument,
  renderSharedEntryMarkdown,
  renderSharedEntryText,
  sharedEntryFilename,
  type ShareScope,
} from './entry-document';
import type { Entry } from '../types';

/** Markers unique enough that finding one anywhere is proof it leaked. */
const NOTES = 'NOTESMARKER-vine-and-branches';
const REFLECTION = 'REFLECTIONMARKER-what-this-meant-to-me';
const PRAYER = 'PRAYERMARKER-said-quietly';
const PROVIDED = 'PROVIDEDMARKER-the-church-handout';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'IDMARKER-1277ea0b-9202-4279-a078-bfb6ff4284ad',
    kind: 'sermon',
    title: 'Abiding in Christ',
    date: '2026-09-23',
    place: 'First Baptist Church',
    speaker: 'Pastor James',
    sermonSeries: 'The Vine',
    anchors: [],
    scriptureRefs: ['John 15:1-17'],
    notes: NOTES,
    reflection: REFLECTION,
    prayer: PRAYER,
    links: [],
    tags: ['TAGMARKER-private'],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-09-23T10:00:00.000Z',
    updatedAt: '2026-09-23T11:00:00.000Z',
    sourceMaterial: {
      format: 'pdf',
      filename: 'FILENAMEMARKER-handout.pdf',
      importedAt: '2026-09-23T09:00:00.000Z',
      sha256: 'SHAMARKER-abcdef',
      body: PROVIDED,
      parserVersion: 1,
    },
    ...overrides,
  };
}

const all: ShareScope = {
  includeScripture: true,
  includeDetails: true,
  includeNotes: true,
  includeReflection: true,
  includePrayer: true,
  includeProvidedNotes: true,
  includeLinks: true,
};

const text = (e: Entry, s: ShareScope) => renderSharedEntryText(buildSharedEntryDocument(e, s));

describe('the defaults', () => {
  it('keeps reflection and prayer out until they are chosen', () => {
    // Rule 5 of this repository, and not a preference: a person sending the
    // outline of a sermon must not send their own response to it because they
    // did not notice a switch.
    expect(PRIVATE_BY_DEFAULT.includeReflection).toBe(false);
    expect(PRIVATE_BY_DEFAULT.includePrayer).toBe(false);
  });

  it('keeps somebody else’s handout out until it is chosen', () => {
    expect(PRIVATE_BY_DEFAULT.includeProvidedNotes).toBe(false);
  });

  it('carries the notes, the passage and the circumstances', () => {
    expect(PRIVATE_BY_DEFAULT.includeNotes).toBe(true);
    expect(PRIVATE_BY_DEFAULT.includeScripture).toBe(true);
    expect(PRIVATE_BY_DEFAULT.includeDetails).toBe(true);
  });

  it('shares an ordinary sermon note and nothing private', () => {
    const shared = text(entry(), PRIVATE_BY_DEFAULT);

    expect(shared).toContain('Abiding in Christ');
    expect(shared).toContain('John 15:1-17');
    expect(shared).toContain(NOTES);
    expect(shared).not.toContain(REFLECTION);
    expect(shared).not.toContain(PRAYER);
    expect(shared).not.toContain(PROVIDED);
  });
});

describe('selection', () => {
  it('includes each section only when it is chosen', () => {
    for (const [key, marker] of [
      ['includeReflection', REFLECTION],
      ['includePrayer', PRAYER],
      ['includeProvidedNotes', PROVIDED],
    ] as const) {
      const off = text(entry(), { ...all, [key]: false });
      expect(off, `${key} off`).not.toContain(marker);

      const on = text(entry(), { ...PRIVATE_BY_DEFAULT, [key]: true });
      expect(on, `${key} on`).toContain(marker);
    }
  });

  it('drops the circumstances when they are not chosen', () => {
    const without = text(entry(), { ...all, includeDetails: false });
    expect(without).not.toContain('Pastor James');
    expect(without).not.toContain('First Baptist Church');
    expect(without).not.toContain('The Vine');
  });

  it('drops the passage when it is not chosen', () => {
    expect(text(entry(), { ...all, includeScripture: false })).not.toContain('John 15');
  });

  it('never invents a section the entry does not have', () => {
    const bare = entry({ reflection: '', prayer: '   ', sourceMaterial: undefined });
    const shared = text(bare, all);
    expect(shared).not.toContain('My reflection');
    expect(shared).not.toContain('Prayer');
    expect(shared).not.toContain('Provided notes');
  });

  it('does not change the entry it was given', () => {
    const original = entry();
    const before = JSON.stringify(original);
    buildSharedEntryDocument(original, all);
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe('whose words are whose', () => {
  it('labels the church’s material and never calls it the reader’s', () => {
    const shared = text(entry(), all);

    expect(shared).toContain('Provided notes');
    const providedAt = shared.indexOf(PROVIDED);
    const headingAt = shared.indexOf('Provided notes');
    expect(headingAt).toBeGreaterThan(-1);
    expect(headingAt).toBeLessThan(providedAt);

    // And the reader's own writing is still under its own heading, before it.
    expect(shared.indexOf('My notes')).toBeLessThan(headingAt);
  });

  it('marks the provided section in the model, so no renderer can lose the label', () => {
    const document = buildSharedEntryDocument(entry(), all);
    const provided = document.sections.filter((section) => section.provided);
    expect(provided).toHaveLength(1);
    expect(provided[0].heading).toBe('Provided notes');
    // Everything else is the reader's.
    expect(document.sections.filter((s) => !s.provided).map((s) => s.heading)).toEqual([
      'My notes',
      'My reflection',
      'Prayer',
    ]);
  });

  it('keeps the four kinds of writing in separate sections', () => {
    const document = buildSharedEntryDocument(entry(), all);
    const bodies = document.sections.map((section) => section.body);
    // No section contains two people's words.
    expect(bodies).toEqual([NOTES, REFLECTION, PRAYER, PROVIDED]);
  });
});

describe('what never leaves, whatever is selected', () => {
  /**
   * The strongest test in the file.
   *
   * Everything above checks that a chosen section appears. This checks that
   * the record around it does not — the id, the timestamps, the digest, the
   * stored filename, the visibility flag. A share is a page from a notebook,
   * not a row from a database.
   */
  it('carries no identifier, timestamp, digest or internal field', () => {
    for (const render of [renderSharedEntryText, renderSharedEntryMarkdown]) {
      const shared = render(buildSharedEntryDocument(entry(), all));

      for (const forbidden of [
        'IDMARKER',
        'SHAMARKER',
        'FILENAMEMARKER',
        'TAGMARKER',
        '2026-09-23T10:00:00.000Z',
        '2026-09-23T11:00:00.000Z',
        'private',
        'parserVersion',
        'forDescendants',
        'sourceMaterial',
        '_unmigrated',
      ]) {
        expect(shared, `${forbidden} in ${render.name}`).not.toContain(forbidden);
      }
    }
  });

  it('cannot reach a second entry', () => {
    // Structural, not filtered: the function takes one entry and reads named
    // fields off it. There is no collection here to leak from.
    const document = buildSharedEntryDocument(entry({ title: 'Only this one' }), all);
    expect(document.title).toBe('Only this one');
    expect(Object.keys(document).sort()).toEqual([
      'date',
      'details',
      'kind',
      'links',
      'scripture',
      'sections',
      'title',
    ]);
  });

  it('shows the day in words rather than a timestamp', () => {
    expect(buildSharedEntryDocument(entry(), all).date).not.toMatch(/T\d\d:\d\d/);
  });
});

describe('links', () => {
  it('carries them only when chosen, and only as the reader wrote them', () => {
    const withLink = entry({
      links: [{ url: 'https://example.org/sermon', label: 'The recording' }],
    });

    expect(text(withLink, all)).toContain('https://example.org/sermon');
    expect(text(withLink, { ...all, includeLinks: false })).not.toContain('example.org');
  });

  it('falls back to the address when there is no label', () => {
    const withLink = entry({ links: [{ url: 'https://example.org/a' }] });
    expect(text(withLink, all)).toContain('https://example.org/a');
  });
});

describe('the two renderings', () => {
  it('gives plain text no markdown punctuation to paste into a message', () => {
    const shared = text(entry(), PRIVATE_BY_DEFAULT);
    expect(shared).not.toMatch(/^#/m);
    expect(shared).not.toMatch(/^\*\*/m);
    expect(shared).toContain('My notes');
  });

  it('gives markdown real headings', () => {
    const shared = renderSharedEntryMarkdown(buildSharedEntryDocument(entry(), PRIVATE_BY_DEFAULT));
    expect(shared).toContain('# Abiding in Christ');
    expect(shared).toContain('## My notes');
  });

  it('is deterministic', () => {
    const once = text(entry(), all);
    const twice = text(entry(), all);
    expect(once).toBe(twice);
  });
});

describe('the filename', () => {
  it('is made from the title and carries no identifier', () => {
    const document = buildSharedEntryDocument(entry(), PRIVATE_BY_DEFAULT);
    expect(sharedEntryFilename(document, 'pdf')).toBe('abiding-in-christ.pdf');
  });

  it('still names an untitled entry something a person can find', () => {
    const document = buildSharedEntryDocument(entry({ title: '' }), PRIVATE_BY_DEFAULT);
    expect(sharedEntryFilename(document, 'txt')).toBe('untitled-entry.txt');
  });

  it('refuses a title that would escape a directory', () => {
    const document = buildSharedEntryDocument(entry({ title: '../../etc/passwd' }), PRIVATE_BY_DEFAULT);
    const name = sharedEntryFilename(document, 'pdf');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });
});

describe('a reference is a reference, whichever way it was attached', () => {
  /*
   * The app has two ways to attach Scripture and a reader cannot tell them
   * apart: type it, or choose it in the picker. Only the first was ever
   * shared. Ticking "Scripture references" on an entry whose references came
   * from the picker sent none of them, and the switch read "Nothing written
   * here" over an entry that plainly had three.
   *
   * The toggle governs the meaning, not the mechanism.
   */
  const at = (book: string, cs: number, vs: number, ce: number, ve: number) =>
    ({ kind: 'scripture', book, chapterStart: cs, verseStart: vs, chapterEnd: ce, verseEnd: ve }) as const;

  const picked = entry({
    scriptureRefs: [],
    anchors: [
      at('john', 3, 16, 3, 16),
      at('john', 3, 16, 3, 18),
      at('romans', 8, 31, 8, 39),
    ],
  });

  it('shares an exact verse chosen in the picker', () => {
    const document = buildSharedEntryDocument(picked, PRIVATE_BY_DEFAULT);
    // "John 3:16", not "John 3:16-16" and not a start/end object.
    expect(document.scripture).toContain('John 3:16');
  });

  it('shares a range chosen in the picker', () => {
    const document = buildSharedEntryDocument(picked, PRIVATE_BY_DEFAULT);
    expect(document.scripture).toContain('John 3:16-18');
    expect(document.scripture).toContain('Romans 8:31-39');
  });

  it('shares a passage, and never its outline id', () => {
    // A passage anchor carries an outlineEntryId on top of its range. The
    // range is what a reader means; the id is an implementation detail and
    // must not leave the device.
    const document = buildSharedEntryDocument(
      entry({
        scriptureRefs: [],
        anchors: [{ ...at('john', 3, 1, 3, 21), outlineEntryId: 'OUTLINEMARKER-john-3-1-21' }],
      }),
      PRIVATE_BY_DEFAULT,
    );

    expect(document.scripture).toEqual(['John 3:1-21']);
    expect(JSON.stringify(document)).not.toContain('OUTLINEMARKER');
  });

  it('still shares what somebody typed, and keeps both', () => {
    const document = buildSharedEntryDocument(
      entry({ scriptureRefs: ['John 15:1-17'], anchors: [at('john', 3, 16, 3, 16)] }),
      PRIVATE_BY_DEFAULT,
    );

    // Typed first, then picked — the order the entry holds them in.
    expect(document.scripture).toEqual(['John 15:1-17', 'John 3:16']);
  });

  it('says the same reference once', () => {
    const document = buildSharedEntryDocument(
      entry({
        scriptureRefs: ['John 3:16'],
        anchors: [at('john', 3, 16, 3, 16), at('john', 3, 16, 3, 16)],
      }),
      PRIVATE_BY_DEFAULT,
    );

    expect(document.scripture).toEqual(['John 3:16']);
  });

  it('keeps genuinely different overlapping references apart', () => {
    // A verse inside a range is not the same reference as the range. Only
    // identical ones collapse.
    const document = buildSharedEntryDocument(
      entry({ scriptureRefs: [], anchors: [at('john', 3, 16, 3, 16), at('john', 3, 1, 3, 21)] }),
      PRIVATE_BY_DEFAULT,
    );

    expect(document.scripture).toEqual(['John 3:16', 'John 3:1-21']);
  });

  it('names a whole book as one, and leaves topics out of it', () => {
    /*
     * A topic is not a Scripture reference. Sending one under a switch
     * labelled "Scripture references" would share something the label does not
     * describe, which is exactly the surprise this surface exists to prevent.
     */
    const document = buildSharedEntryDocument(
      entry({
        scriptureRefs: [],
        anchors: [
          { kind: 'book', book: 'john' },
          { kind: 'topic', topicId: 'TOPICMARKER-grief' },
        ],
      }),
      PRIVATE_BY_DEFAULT,
    );

    expect(document.scripture).toEqual(['John (whole book)']);
    expect(JSON.stringify(document)).not.toContain('TOPICMARKER');
  });

  it('sends no reference at all when the switch is off', () => {
    const document = buildSharedEntryDocument(picked, {
      ...PRIVATE_BY_DEFAULT,
      includeScripture: false,
    });

    expect(document.scripture).toEqual([]);
    // And not smuggled into any other part of the document either.
    const rendered = `${JSON.stringify(document)}\n${renderSharedEntryText(document)}\n${renderSharedEntryMarkdown(document)}`;
    expect(rendered).not.toContain('John 3:16');
    expect(rendered).not.toContain('Romans 8:31');
  });

  it('shares the reference and never the verse text', () => {
    // References only. Expanding John 3:16 into the KJV would be sharing
    // Scripture the reader never chose to send.
    const document = buildSharedEntryDocument(picked, PRIVATE_BY_DEFAULT);
    const rendered = `${renderSharedEntryText(document)}\n${renderSharedEntryMarkdown(document)}`;

    expect(rendered).toContain('John 3:16');
    expect(rendered).not.toMatch(/For God so loved/i);
    expect(rendered).not.toMatch(/everlasting life/i);
  });

  it('reads the same in the text and the Markdown', () => {
    const document = buildSharedEntryDocument(picked, PRIVATE_BY_DEFAULT);
    for (const reference of ['John 3:16', 'John 3:16-18', 'Romans 8:31-39']) {
      expect(renderSharedEntryText(document), `text is missing ${reference}`).toContain(reference);
      expect(renderSharedEntryMarkdown(document), `markdown is missing ${reference}`).toContain(
        reference,
      );
    }
  });
});
