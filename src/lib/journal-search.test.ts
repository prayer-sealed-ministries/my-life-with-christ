/**
 * What "finding it" has to mean.
 *
 * Every case here is a person half-remembering something and expecting the
 * journal to meet them. The ranking assertions are the important ones: a
 * search that finds the right entry and buries it on line nine has not found
 * it.
 */

import { describe, expect, it } from 'vitest';

import { ENTRY_KINDS } from './entry-kinds';

import {
  FIELD_LABELS,
  type MatchField,
  allowedEdits,
  hasActiveFilters,
  anchorOverlaps,
  entriesAnchoredTo,
  normalizeText,
  searchJournal,
  spellingSuggestions,
  tokenize,
  withinEdits,
} from './journal-search';
import { parseReferenceQuery } from './search';
import type { Entry } from '../types';

let seq = 0;
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: `e${(seq += 1)}`,
  kind: 'sermon',
  title: '',
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
  ...overrides,
});

const ids = (hits: { entry: Entry }[]) => hits.map((h) => h.entry.id);

describe('normalisation', () => {
  it('folds case, punctuation and repeated whitespace', () => {
    expect(normalizeText('  Forgiveness,   AND   grace!  ')).toBe('forgiveness and grace');
  });

  it('treats a curly apostrophe as a straight one', () => {
    // One device types one, one types the other, and nobody remembers which.
    expect(normalizeText('God’s mercy')).toBe(normalizeText("God's mercy"));
  });

  it('folds accents so the same word meets itself', () => {
    expect(normalizeText('Jesús')).toBe('jesus');
  });

  it('keeps an apostrophe inside a word rather than splitting it', () => {
    expect(tokenize("don't worry")).toEqual(["don't", 'worry']);
  });

  it('has nothing to search for in punctuation alone', () => {
    expect(tokenize('!!! ???')).toEqual([]);
  });
});

describe('field coverage', () => {
  const corpus = [
    entry({ id: 'title', title: 'Grace at the door' }),
    entry({ id: 'notes', notes: 'He read the whole letter aloud.' }),
    entry({ id: 'reflection', reflection: 'I owe someone a letter like that.' }),
    entry({ id: 'prayer', prayer: 'For patience with my brother.' }),
    entry({ id: 'tags', tags: ['forgiveness', 'family'] }),
    entry({ id: 'speaker', speaker: 'Pastor Ruiz' }),
    entry({ id: 'place', place: 'First Baptist' }),
    entry({ id: 'series', sermonSeries: 'Philemon' }),
    entry({
      id: 'provided',
      sourceMaterial: { body: 'Peace in the middle of uncertainty.', importedAt: '2026-03-01T00:00:00.000Z', filename: 'x.md', format: 'markdown', parserVersion: 1 },
    }),
  ];

  it.each([
    ['title', 'Grace'],
    ['notes', 'aloud'],
    ['reflection', 'owe'],
    ['prayer', 'patience'],
    ['tags', 'forgiveness'],
    ['speaker', 'Ruiz'],
    ['place', 'Baptist'],
    ['series', 'Philemon'],
    ['provided', 'uncertainty'],
  ])('finds an entry by its %s', (id, query) => {
    expect(ids(searchJournal(query, corpus))).toContain(id);
  });
});

describe('provenance', () => {
  const own = entry({ id: 'own', notes: 'Peace was the whole point of the sermon.' });
  const handout = entry({
    id: 'handout',
    notes: 'Something else entirely.',
    sourceMaterial: { body: 'Peace in the middle of uncertainty.', importedAt: '2026-03-01T00:00:00.000Z', filename: 'x.md', format: 'markdown', parserVersion: 1 },
  });

  it('says which field answered, in the reader’s language', () => {
    const [hit] = searchJournal('aloud', [entry({ notes: 'He read it aloud.' })]);
    expect(hit.matches[0].field).toBe('notes');
  });

  it('marks a result that only somebody else’s material matched', () => {
    const [hit] = searchJournal('uncertainty', [handout]);
    expect(hit.providedOnly).toBe(true);
    expect(hit.matches.every((m) => m.field === 'provided')).toBe(true);
  });

  it('never calls the reader’s own writing provided', () => {
    const [hit] = searchJournal('peace', [own]);
    expect(hit.providedOnly).toBe(false);
  });

  it('puts the reader’s own words above a handout that used the same word', () => {
    // The whole point: an imported outline must not bury what they wrote.
    expect(ids(searchJournal('peace', [handout, own]))[0]).toBe('own');
  });
});

/**
 * The label names the field that actually matched — every field, one at a time.
 *
 * This block exists because of a reporting failure, not a product one, and the
 * distinction is the point. A hardware smoke test claimed an entry had been
 * found "with a Reflection label". The entry's reflection was the empty string;
 * it could not have matched anything. The probe was
 *
 *     body.innerText.match(/Notes|Reflection|Title/)
 *
 * over the WHOLE page, and the search view renders a row of entry-kind filter
 * chips above the results — one of which reads "Reflection". The regex found
 * that chip at character 321, forty-one characters before the result's real
 * "Notes" label at 452. The product had been right all along and the
 * measurement was reading the furniture.
 *
 * Re-measured on the device, scoped to the result row, it read
 * "Notes … | Title …" — correct, in weight order. So nothing was fixed here.
 * What was missing was a check that could have contradicted the claim in a
 * second, which is what these are: every field asserted under its own name,
 * including the one that started it.
 */
describe('every field answers under its own name', () => {
  // One row per field, each written so ONLY that field can match. A shared
  // term would prove nothing about which field was selected.
  const CASES: Array<{ field: MatchField; label: string; query: string; make: Partial<Entry> }> = [
    { field: 'title', label: 'Title', query: 'lantern', make: { title: 'The lantern' } },
    { field: 'notes', label: 'Notes', query: 'scaffold', make: { notes: 'He built the scaffold of the argument first.' } },
    { field: 'reflection', label: 'Reflection', query: 'unhurried', make: { reflection: 'I want to be unhurried about this.' } },
    { field: 'prayer', label: 'Prayer', query: 'steadfast', make: { prayer: 'Make me steadfast this week.' } },
    { field: 'tags', label: 'Tags', query: 'patience', make: { tags: ['patience'] } },
    { field: 'speaker', label: 'Speaker', query: 'okonkwo', make: { speaker: 'Ada Okonkwo' } },
    { field: 'place', label: 'Church', query: 'riverside', make: { place: 'Riverside Chapel' } },
    { field: 'series', label: 'Series', query: 'wilderness', make: { sermonSeries: 'Wilderness' } },
    { field: 'scripture', label: 'Scripture', query: 'habakkuk', make: { scriptureRefs: ['Habakkuk 3:17'] } },
    {
      field: 'provided',
      label: 'Provided notes',
      query: 'photocopier',
      make: {
        sourceMaterial: {
          body: 'Handout printed on the photocopier.',
          importedAt: '2026-03-01T00:00:00.000Z',
          filename: 'h.md',
          format: 'markdown',
          parserVersion: 1,
        },
      },
    },
  ];

  // The floor. Every assertion below is inside a loop, and a loop over an
  // empty list passes while examining nothing.
  it('covers every field the engine can match in', () => {
    expect(CASES.length).toBe(Object.keys(FIELD_LABELS).length);
    expect([...CASES].map((c) => c.field).sort()).toEqual(Object.keys(FIELD_LABELS).sort());
  });

  for (const { field, label, query, make } of CASES) {
    it(`reports a ${field} match as "${label}"`, () => {
      const [hit] = searchJournal(query, [entry(make)]);
      expect(hit, `"${query}" found nothing, so the label was never tested`).toBeTruthy();
      expect(hit.matches[0].field).toBe(field);
      expect(FIELD_LABELS[hit.matches[0].field]).toBe(label);
    });
  }

  it('never reports a field the entry left empty', () => {
    // The shape of the entry the smoke test was looking at: a title and notes
    // that both match, and an empty reflection. "Reflection" must be
    // unreachable, whatever else the page happens to say.
    const shaped = entry({
      id: 'beacon',
      title: 'Second beacon',
      notes: 'Second distinct proof entry.',
      reflection: '',
      prayer: '',
    });

    const [hit] = searchJournal('second distinct proof', [shaped]);
    const fields = hit.matches.map((m) => m.field);

    expect(fields).toContain('notes');
    expect(fields).not.toContain('reflection');
    expect(fields).not.toContain('prayer');
    // And the strongest reason wins: the phrase is in the notes, so that is
    // what the reader is shown first.
    expect(hit.matches[0].field).toBe('notes');
  });

  it('shows the snippet from the field it named, not from another one', () => {
    const both = entry({
      title: 'Cornerstone',
      notes: 'The cornerstone the builders rejected.',
      reflection: 'Cornerstone is a strange word to live under.',
    });

    const [hit] = searchJournal('cornerstone', [both]);
    for (const match of hit.matches) {
      const source = { title: both.title, notes: both.notes, reflection: both.reflection }[
        match.field as 'title' | 'notes' | 'reflection'
      ];
      expect(source, `no source text for ${match.field}`).toBeTruthy();
      expect(source).toContain(match.snippet.replace(/^…|…$/g, '').trim().slice(0, 20));
    }
  });

  it('names the highest-ranked field first when several match', () => {
    const everywhere = entry({
      title: 'Mercy',
      notes: 'Mercy was the whole sermon.',
      sourceMaterial: {
        body: 'Mercy, point three.',
        importedAt: '2026-03-01T00:00:00.000Z',
        filename: 'h.md',
        format: 'markdown',
        parserVersion: 1,
      },
    });

    const [hit] = searchJournal('mercy', [everywhere]);
    // Title (10) over notes (8) over a handout (1.5) — the displayed
    // provenance is the winner of the same ordering the score uses, not
    // whichever field happened to be looked at first.
    expect(hit.matches.map((m) => m.field)).toEqual(['title', 'notes', 'provided']);
    expect(hit.providedOnly).toBe(false);
  });
});

describe('ranking', () => {
  it('puts the remembered phrase above entries that merely share its words', () => {
    const scattered = entry({ id: 'scattered', notes: 'Worry came later. The surgery went well.' });
    const phrase = entry({ id: 'phrase', notes: 'I kept thinking: worry surgery, worry surgery.' });
    expect(ids(searchJournal('worry surgery', [scattered, phrase]))[0]).toBe('phrase');
  });

  it('prefers an entry covering both remembered words to one covering half', () => {
    const half = entry({ id: 'half', notes: 'Only anxiety here.' });
    const both = entry({ id: 'both', notes: 'Anxiety before the surgery.' });
    expect(ids(searchJournal('anxiety surgery', [half, both]))[0]).toBe('both');
  });

  it('outranks a fuzzy metadata match with an exact match in the writing', () => {
    const meta = entry({ id: 'meta', speaker: 'Forgivenes' });
    const written = entry({ id: 'written', notes: 'We talked about forgiveness for an hour.' });
    expect(ids(searchJournal('forgiveness', [meta, written]))[0]).toBe('written');
  });

  it('does not let a newer entry override a clearly better older one', () => {
    const old = entry({ id: 'old', date: '2020-01-01', notes: 'The vine and the branches, abiding.' });
    const recent = entry({ id: 'recent', date: '2026-09-01', place: 'Abiding Hope Church' });
    expect(ids(searchJournal('abiding vine', [recent, old]))[0]).toBe('old');
  });

  it('breaks a genuine tie by recency', () => {
    const older = entry({ id: 'older', date: '2024-01-01', notes: 'identical wording here' });
    const newer = entry({ id: 'newer', date: '2026-01-01', notes: 'identical wording here' });
    expect(ids(searchJournal('identical wording', [older, newer]))).toEqual(['newer', 'older']);
  });

  it('is deterministic — the same journal and query give the same order', () => {
    const corpus = [
      entry({ id: 'a', notes: 'grace upon grace' }),
      entry({ id: 'b', reflection: 'grace' }),
      entry({ id: 'c', tags: ['grace'] }),
    ];
    const once = ids(searchJournal('grace', corpus));
    expect(ids(searchJournal('grace', [...corpus].reverse()))).toEqual(once);
  });
});

describe('fuzzy tolerance', () => {
  it('allows no edits on a short word, one in the middle, two on a long one', () => {
    // The setting that decides whether a typo helps or turns search to noise.
    expect(allowedEdits('pray')).toBe(0);
    expect(allowedEdits('mercy')).toBe(1);
    expect(allowedEdits('resurrection')).toBe(2);
  });

  it.each([
    ['Phillipians', 'philippians'],
    ['ressurection', 'resurrection'],
  ])('forgives %s', (typo, actual) => {
    const found = entry({ id: 'found', notes: `A sermon about the ${actual}.` });
    expect(ids(searchJournal(typo, [found]))).toContain('found');
  });

  it('does not turn a short word into a match for a different one', () => {
    expect(ids(searchJournal('pray', [entry({ notes: 'we play football' })]))).toEqual([]);
  });

  it('abandons the comparison once the budget is gone', () => {
    expect(withinEdits('kitten', 'sitting', 2)).toBe(false);
    expect(withinEdits('kitten', 'sitten', 1)).toBe(true);
    expect(withinEdits('abc', 'abc', 0)).toBe(true);
  });

  it('ranks an exact match above a forgiven one', () => {
    const typo = entry({ id: 'typo', notes: 'the ressurection' });
    const exact = entry({ id: 'exact', notes: 'the resurrection' });
    expect(ids(searchJournal('resurrection', [typo, exact]))[0]).toBe('exact');
  });
});

describe('Scripture', () => {
  const anchored = entry({
    id: 'anchored',
    notes: 'The vine and the branches.',
    anchors: [{ kind: 'scripture', book: 'john', chapterStart: 15, verseStart: 1, chapterEnd: 15, verseEnd: 17 }],
  });

  it.each(['John 15', 'Jn 15', 'John 15:5', 'Jn 15:5'])(
    'finds an anchored entry from "%s" even though the prose never says it',
    (query) => {
      expect(ids(searchJournal(query, [anchored]))).toContain('anchored');
    },
  );

  it('does not match a chapter the anchor does not reach', () => {
    const ref = parseReferenceQuery('John 17')!;
    expect(anchorOverlaps(anchored.anchors[0], ref)).toBe(false);
  });

  it('matches at the exact boundaries of the anchored range', () => {
    const anchor = anchored.anchors[0];
    expect(anchorOverlaps(anchor, parseReferenceQuery('John 15:1')!)).toBe(true);
    expect(anchorOverlaps(anchor, parseReferenceQuery('John 15:17')!)).toBe(true);
    expect(anchorOverlaps(anchor, parseReferenceQuery('John 15:18')!)).toBe(false);
  });

  it('does not match the same chapter and verse in a different book', () => {
    // Chapter and verse numbers repeat across the canon, so an overlap check
    // that forgot the book would file every John 15 search under Mark 15 too.
    const mark = entry({
      id: 'mark',
      anchors: [{ kind: 'scripture', book: 'mark', chapterStart: 15, verseStart: 1, chapterEnd: 15, verseEnd: 17 }],
    });
    expect(anchorOverlaps(mark.anchors[0], parseReferenceQuery('John 15')!)).toBe(false);
    expect(ids(searchJournal('Jn 15', [mark]))).toEqual([]);
  });

  it('handles an anchor that spans chapters', () => {
    const across: Entry = entry({
      anchors: [{ kind: 'scripture', book: 'mark', chapterStart: 4, verseStart: 35, chapterEnd: 5, verseEnd: 2 }],
    });
    expect(anchorOverlaps(across.anchors[0], parseReferenceQuery('Mark 4:40')!)).toBe(true);
    expect(anchorOverlaps(across.anchors[0], parseReferenceQuery('Mark 5:1')!)).toBe(true);
    expect(anchorOverlaps(across.anchors[0], parseReferenceQuery('Mark 5:9')!)).toBe(false);
    expect(anchorOverlaps(across.anchors[0], parseReferenceQuery('Mark 3')!)).toBe(false);
  });

  it('answers the passage-history question directly, oldest first', () => {
    const later = entry({ id: 'later', date: '2026-01-01', anchors: anchored.anchors });
    const earlier = entry({ id: 'earlier', date: '2020-01-01', anchors: anchored.anchors });
    const ref = parseReferenceQuery('John 15')!;
    expect(entriesAnchoredTo([later, earlier], ref).map((e) => e.id)).toEqual(['earlier', 'later']);
  });
});

/**
 * Narrowing by entry type.
 *
 * Every case here goes through the engine, because that is where the narrowing
 * has to happen. Searching everything and then hiding the wrong rows in React
 * would give a result count that disagrees with the list under it, a limit that
 * silently trims the wrong set, and an empty state that cannot tell "nothing
 * matches" from "nothing of that kind matches".
 */
describe('narrowing by entry kind', () => {
  // One word in every kind, so only the filter can distinguish them. Built from
  // ENTRY_KINDS rather than typed out: a hand-written list here went stale the
  // moment the set changed, and a filter test that silently stops covering a
  // kind looks exactly like a filter test that covers them all.
  const corpus = ENTRY_KINDS.map((kind) =>
    entry({ id: `k-${kind}`, kind, notes: 'A word about mercy.' }),
  );

  it('searches every kind when nothing is selected', () => {
    expect(ids(searchJournal('mercy', corpus)).sort()).toEqual(
      corpus.map((each) => each.id).sort(),
    );
    // Absent and empty must mean the same thing. The view sends an empty array
    // when no box is ticked, and "no kinds selected" can never mean "no kinds".
    expect(ids(searchJournal('mercy', corpus, { kinds: [] }))).toHaveLength(
      ENTRY_KINDS.length,
    );
    // The floor: a corpus built from an empty list would satisfy every
    // assertion above it.
    expect(ENTRY_KINDS.length).toBe(5);
  });

  it('narrows to one kind', () => {
    expect(ids(searchJournal('mercy', corpus, { kinds: ['sermon'] }))).toEqual(['k-sermon']);
    expect(ids(searchJournal('mercy', corpus, { kinds: ['prayer'] }))).toEqual(['k-prayer']);
    expect(ids(searchJournal('mercy', corpus, { kinds: ['reflection'] }))).toEqual(['k-reflection']);
    expect(ids(searchJournal('mercy', corpus, { kinds: ['letter'] }))).toEqual(['k-letter']);
  });

  it('narrows to several kinds at once', () => {
    expect(ids(searchJournal('mercy', corpus, { kinds: ['prayer', 'reflection'] })).sort()).toEqual([
      'k-prayer',
      'k-reflection',
    ]);
  });

  it('selecting every kind is the same as selecting none', () => {
    const all = corpus.map((each) => each.kind);
    expect(ids(searchJournal('mercy', corpus, { kinds: all })).sort()).toEqual(
      ids(searchJournal('mercy', corpus)).sort(),
    );
  });

  it('does not change the order of what it leaves behind', () => {
    // Relevance is computed from the query, never from the filter. Removing
    // rows must not promote or demote the survivors relative to each other.
    const ranked = [
      entry({ id: 'weak', kind: 'sermon', place: 'Mercy Chapel' }),
      entry({ id: 'strong', kind: 'sermon', title: 'Mercy' }),
      entry({ id: 'middle', kind: 'prayer', notes: 'Mercy again.' }),
    ];
    const everything = ids(searchJournal('mercy', ranked));
    expect(everything).toEqual(['strong', 'middle', 'weak']);

    const sermonsOnly = ids(searchJournal('mercy', ranked, { kinds: ['sermon'] }));
    expect(sermonsOnly).toEqual(everything.filter((id) => id !== 'middle'));
  });

  it('scores a filtered entry exactly as it scores an unfiltered one', () => {
    const [unfiltered] = searchJournal('mercy', corpus);
    const [filtered] = searchJournal('mercy', corpus, { kinds: [unfiltered.entry.kind] });
    expect(filtered.score).toBe(unfiltered.score);
    expect(filtered.matches).toEqual(unfiltered.matches);
  });

  it('composes with a Scripture query rather than taking a second path', () => {
    const anchored = [
      entry({
        id: 'vine-sermon',
        kind: 'sermon',
        title: 'The vine',
        anchors: [{ kind: 'scripture', book: 'john', chapterStart: 15, verseStart: 1, chapterEnd: 15, verseEnd: 17 }],
      }),
      entry({
        id: 'vine-reflection',
        kind: 'reflection',
        title: 'Abiding',
        anchors: [{ kind: 'scripture', book: 'john', chapterStart: 15, verseStart: 4, chapterEnd: 15, verseEnd: 5 }],
      }),
    ];

    expect(ids(searchJournal('Jn 15', anchored)).sort()).toEqual(['vine-reflection', 'vine-sermon']);
    expect(ids(searchJournal('Jn 15', anchored, { kinds: ['reflection'] }))).toEqual(['vine-reflection']);
    expect(ids(searchJournal('Jn 15', anchored, { kinds: ['sermon'] }))).toEqual(['vine-sermon']);
  });

  it('keeps provenance intact — a kind is not a matched field', () => {
    // "Sermon" is what the entry IS; "Provided notes" is where the words came
    // from. Filtering by the first must not touch the second.
    const handout = entry({
      id: 'handout',
      kind: 'sermon',
      notes: 'My own thoughts were elsewhere.',
      sourceMaterial: {
        body: 'Point two: peace in the middle of uncertainty.',
        importedAt: '2026-03-01T00:00:00.000Z',
        filename: 'h.md',
        format: 'markdown',
        parserVersion: 1,
      },
    });

    const [hit] = searchJournal('uncertainty', [handout], { kinds: ['sermon'] });
    expect(hit.entry.kind).toBe('sermon');
    expect(hit.matches[0].field).toBe('provided');
    expect(FIELD_LABELS[hit.matches[0].field]).toBe('Provided notes');
    expect(hit.providedOnly).toBe(true);
  });

  it('still reaches the oldest entry in the journal when its kind is selected', () => {
    const history = [
      ...Array.from({ length: 300 }, (_, i) =>
        entry({ id: `f${i}`, kind: 'sermon', date: '2030-01-01', notes: 'ordinary notes' }),
      ),
      entry({ id: 'ancient', kind: 'letter', date: '2004-06-01', notes: 'The lighthouse letter.' }),
    ];
    expect(ids(searchJournal('lighthouse', history, { kinds: ['letter'] }))).toEqual(['ancient']);
  });

  it('knows when something is narrowing and when nothing is', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ kinds: [] })).toBe(false);
    expect(hasActiveFilters({ kinds: [], year: '' })).toBe(false);
    expect(hasActiveFilters({ kinds: ['prayer'] })).toBe(true);
    expect(hasActiveFilters({ year: '2024' })).toBe(true);
  });
});

describe('filters and limits', () => {
  const corpus = [
    entry({ id: 'sermon-2026', kind: 'sermon', date: '2026-05-01', notes: 'grace' }),
    entry({ id: 'prayer-2027', kind: 'prayer', date: '2027-05-01', notes: 'grace' }),
  ];

  it('narrows by kind', () => {
    expect(ids(searchJournal('grace', corpus, { kinds: ['prayer'] }))).toEqual(['prayer-2027']);
  });

  it('narrows by year', () => {
    expect(ids(searchJournal('grace', corpus, { year: '2026' }))).toEqual(['sermon-2026']);
  });

  it('caps what it hands back', () => {
    expect(searchJournal('grace', corpus, { limit: 1 })).toHaveLength(1);
  });
});

describe('snippets', () => {
  it('quotes the entry verbatim rather than inventing anything', () => {
    const long = entry({
      notes: 'A'.repeat(200) + ' I kept worrying about what would happen after. ' + 'B'.repeat(200),
    });
    const [hit] = searchJournal('worrying', [long]);
    expect(hit.matches[0].snippet).toContain('worrying');
    expect(long.notes).toContain(hit.matches[0].snippet.replace(/^…|…$/g, '').trim().slice(5, 30));
  });
});

describe('suggestions when nothing was found', () => {
  it('offers a word that really is in the journal', () => {
    const corpus = [entry({ notes: 'A sermon about the resurrection.' })];
    expect(spellingSuggestions('ressurection', corpus)).toContain('resurrection');
  });

  it('suggests nothing for a word that is simply absent', () => {
    expect(spellingSuggestions('zzzzqqqq', [entry({ notes: 'grace' })])).toEqual([]);
  });

  it('never suggests a word only a handout used', () => {
    // Suggesting somebody else's vocabulary as if it were theirs is the same
    // blurring of provenance the result labels exist to prevent.
    const corpus = [entry({
      sourceMaterial: { body: 'eschatological', importedAt: '2026-03-01T00:00:00.000Z', filename: 'x.md', format: 'markdown', parserVersion: 1 },
    })];
    expect(spellingSuggestions('eschatologcal', corpus)).toEqual([]);
  });
});
