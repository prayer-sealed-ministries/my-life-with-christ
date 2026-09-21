/**
 * Finding something you half remember writing.
 *
 * The old search was one lowercase `includes()` over a blob of every field,
 * with results ordered by date. That answers "does this exact string appear",
 * which is a database question. The question a person actually has is "where
 * did I write that thing about worry, around the time of the surgery" — two
 * remembered words, in the wrong order, possibly misspelled, possibly from a
 * passage rather than the prose.
 *
 * So this is a small, deterministic retrieval engine over the reader's own
 * journal. Deliberately NOT semantic: no embeddings, no service, no guessing at
 * what they meant. Everything here is explainable in a sentence, which matters
 * because a result has to be able to say why it appeared.
 *
 * It is pure and stateless. There is no persisted index to fall out of step
 * with the journal — the "index" is the entries themselves, read fresh. That is
 * the smallest architecture that cannot become wrong: nothing to invalidate on
 * edit, delete, import, restore or migration, and nothing that could ever be
 * mistaken for canonical data.
 */

import type { Entry, EntryAnchor, EntryKind, ScriptureRef } from '../types';
import { parseReferenceQuery, refLabel } from './search';

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * One spelling of "the same word", for matching only.
 *
 * Never applied to stored text — this shapes comparison, and the reader's own
 * words are kept exactly as typed everywhere else.
 *
 * NFKD then stripping combining marks folds accents, so `Jesús` and `Jesus`
 * meet. Curly apostrophes become straight ones because a phone types one and a
 * keyboard the other, and nobody should have to remember which they used.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    // Keep apostrophes inside words so "don't" stays one token; everything else
    // that is not a letter or digit becomes a gap.
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/'+/g, "'")
    .trim()
    .replace(/\s+/g, ' ');
}

/** Words, normalised. Empty for punctuation-only input. */
export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/**
 * A bare number is never a word worth matching on its own.
 *
 * "Jn 15" used to return every entry anchored in Mark 15, because the loose
 * token `15` met the text of that entry's own reference label. Chapter and
 * verse numbers repeat right across the canon, so a standalone number carries
 * almost no meaning by itself — what it belongs to is the reference beside it,
 * and that is matched properly by anchor overlap. A four-digit number is the
 * exception: people do remember years, and that is matched against the date.
 */
const isBareNumber = (token: string): boolean => /^\d+$/.test(token);
const asYear = (token: string): string | null =>
  /^\d{4}$/.test(token) && Number(token) >= 1900 && Number(token) <= 2199 ? token : null;

// ---------------------------------------------------------------------------
// Fields, weights and provenance
// ---------------------------------------------------------------------------

/**
 * Where a match was found, in the reader's language.
 *
 * `provided` is the one that must never be blurred: a church handout is not
 * the reader's writing, and a result surfaced only because of it has to say
 * so. See src/lib/provided-notes.ts.
 */
export type MatchField =
  | 'title'
  | 'notes'
  | 'reflection'
  | 'prayer'
  | 'tags'
  | 'speaker'
  | 'place'
  | 'series'
  | 'scripture'
  | 'provided';

export const FIELD_LABELS: Record<MatchField, string> = {
  title: 'Title',
  notes: 'Notes',
  reflection: 'Reflection',
  prayer: 'Prayer',
  tags: 'Tags',
  speaker: 'Speaker',
  place: 'Church',
  series: 'Series',
  scripture: 'Scripture',
  provided: 'Provided notes',
};

/** True for the fields that are the reader's own voice. */
export const isOwnVoice = (field: MatchField): boolean => field !== 'provided';

/**
 * What a match in each field is worth.
 *
 * The ordering is the product decision, not a tuning artefact: the words a
 * person wrote are what they are trying to find, and an imported handout must
 * never bury them. Metadata sits in between — a speaker's name is a real way
 * to remember a sermon, but weaker evidence than the sentence you wrote about
 * it.
 */
export const FIELD_WEIGHTS: Record<MatchField, number> = {
  title: 10,
  notes: 8,
  reflection: 8,
  prayer: 8,
  scripture: 6,
  tags: 5,
  speaker: 4,
  series: 4,
  place: 3,
  provided: 1.5,
};

/** Multipliers for how well a token matched. Exact beats guessed, always. */
export const TIER_WEIGHTS = { phrase: 6, exact: 3, prefix: 1.5, fuzzy: 0.5 } as const;
export type MatchTier = keyof typeof TIER_WEIGHTS;

// ---------------------------------------------------------------------------
// Fuzzy matching — conservative on purpose
// ---------------------------------------------------------------------------

/**
 * The most spelling help a word of this length may receive.
 *
 * Short words get none: at four letters an edit of one reaches too many
 * unrelated words, and "pray" would start matching "play". Long words get two,
 * because that is where real misspellings live — `Phillipians`,
 * `ressurection`. Explicit and tested rather than a tuned constant, because
 * this is the setting that decides whether a typo helps somebody or turns
 * every query into noise.
 */
export function allowedEdits(token: string): number {
  if (token.length <= 4) return 0;
  if (token.length <= 7) return 1;
  return 2;
}

/**
 * Edit distance, abandoned as soon as it exceeds what is allowed.
 *
 * Bounded rather than full Levenshtein: the answer is only ever compared
 * against a small limit, and stopping early is what keeps a fuzzy pass over a
 * long journal affordable.
 */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (max <= 0) return a === b;
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < best) best = value;
    }
    // Every remaining path can only grow, so a whole row over the limit ends it.
    if (best > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

// ---------------------------------------------------------------------------
// Scripture
// ---------------------------------------------------------------------------

/** Does an anchor overlap the queried passage at all? */
export function anchorOverlaps(anchor: EntryAnchor, ref: ScriptureRef): boolean {
  if (anchor.kind !== 'scripture') return false;
  if (anchor.book !== ref.book) return false;
  // Compare as flat (chapter, verse) positions so a range spanning chapters is
  // handled by the same arithmetic as one inside a chapter.
  const start = (c: number, v: number) => c * 1000 + v;
  const aFrom = start(anchor.chapterStart, anchor.verseStart);
  const aTo = start(anchor.chapterEnd, anchor.verseEnd);
  const qFrom = start(ref.chapterStart, ref.verseStart);
  const qTo = start(ref.chapterEnd, ref.verseEnd);
  return aFrom <= qTo && qFrom <= aTo;
}

/** Every saved entry anchored to a passage, oldest first. The passage-history shape. */
export function entriesAnchoredTo(entries: Entry[], ref: ScriptureRef): Entry[] {
  return entries
    .filter((entry) => entry.anchors.some((anchor) => anchorOverlaps(anchor, ref)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

interface FieldText {
  field: MatchField;
  /** The original text, for snippets. */
  raw: string;
  /** Normalised, for matching. */
  normalized: string;
  tokens: Set<string>;
}

function fieldsOf(entry: Entry): FieldText[] {
  const parts: Array<[MatchField, string]> = [
    ['title', entry.title],
    ['notes', entry.notes],
    ['reflection', entry.reflection],
    ['prayer', entry.prayer ?? ''],
    ['tags', entry.tags.join(' ')],
    ['speaker', entry.speaker ?? ''],
    ['place', entry.place ?? ''],
    ['series', entry.sermonSeries ?? ''],
    // Free-text references the reader typed, plus the labels of their anchors,
    // so "John 15" finds an entry that is anchored there and never says so in
    // prose.
    ['scripture', [entry.scriptureRefs.join(' '), ...entry.anchors.map(anchorLabel)].join(' ')],
    ['provided', [entry.sourceMaterial?.body ?? '', entry.sourceMaterial?.church ?? ''].join(' ')],
  ];

  return parts
    .filter(([, raw]) => raw.trim().length > 0)
    .map(([field, raw]) => {
      const normalized = normalizeText(raw);
      return { field, raw, normalized, tokens: new Set(normalized.split(' ').filter(Boolean)) };
    });
}

function anchorLabel(anchor: EntryAnchor): string {
  if (anchor.kind === 'scripture') return refLabel(anchor);
  if (anchor.kind === 'topic') return anchor.topicId.replace(/-/g, ' ');
  return anchor.book.replace(/-/g, ' ');
}

/** One reason a result appeared. */
export interface FieldMatch {
  field: MatchField;
  tier: MatchTier;
  /** Tokens this field accounted for. */
  tokens: string[];
  /** A short piece of the text around the match, taken verbatim. */
  snippet: string;
}

export interface SearchHit {
  entry: Entry;
  score: number;
  matches: FieldMatch[];
  /** True when nothing but somebody else's material matched. */
  providedOnly: boolean;
}

/**
 * What a search is narrowed BY, as one growable object.
 *
 * One object rather than a widening argument list, and rather than a boolean
 * per kind. Advanced search is expected to grow — a date range, a passage, a
 * speaker, a church, a series, a particular matched field — and each of those
 * should be a key here, answered in the loop below, without any caller
 * changing shape. Six independent booleans would have to be replaced wholesale
 * the first time a filter was not a kind.
 *
 * Kept separate from `limit` on purpose. These decide which entries are
 * ELIGIBLE; `limit` decides how many of the eligible ones are handed back.
 * Conflating them is how "narrow by kind" quietly starts meaning "show fewer".
 *
 * Every filter here narrows and nothing here scores. Relevance is computed
 * from the query against the entries that survive, so ticking a box can never
 * reorder the results it leaves behind — it only removes rows.
 */
export interface SearchFilters {
  /**
   * Narrow to these kinds. Absent or empty means every kind.
   *
   * `EntryKind[]`, not `string[]`: the canonical list lives in
   * src/lib/entry-kinds.ts and a kind that does not exist must not be
   * expressible here. A filter for a kind no entry can have is silently a
   * filter for nothing, which looks exactly like "you have written none of
   * those".
   */
  kinds?: EntryKind[];
  /** Four-digit year, as a facet. */
  year?: string;
}

export interface JournalSearchOptions extends SearchFilters {
  /** How many hits to return. The view never renders them all at once. */
  limit?: number;
}

/** True when anything is actually narrowing the search. */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return Boolean(filters.kinds?.length) || Boolean(filters.year);
}

const SNIPPET_RADIUS = 60;

/** A verbatim window around the match. Never rewritten, never summarised. */
function snippetAround(raw: string, normalizedNeedle: string): string {
  const normalized = normalizeText(raw);
  const at = normalized.indexOf(normalizedNeedle);
  if (at < 0) return raw.slice(0, SNIPPET_RADIUS * 2).trim();

  // Map back approximately: normalisation only collapses runs, so a ratio is
  // close enough to centre a window, and the window is generous.
  const ratio = raw.length / Math.max(normalized.length, 1);
  const centre = Math.round(at * ratio);
  const from = Math.max(0, centre - SNIPPET_RADIUS);
  const to = Math.min(raw.length, centre + normalizedNeedle.length * ratio + SNIPPET_RADIUS);
  const slice = raw.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${slice}${to < raw.length ? '…' : ''}`;
}

/**
 * Rank saved entries against a remembered phrase.
 *
 * Deterministic: the same journal and the same query give the same order,
 * every time, on both storage engines — the scoring never touches the database.
 */
export function searchJournal(
  query: string,
  entries: Entry[],
  options: JournalSearchOptions = {},
): SearchHit[] {
  const phrase = normalizeText(query);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // A typed reference widens the search to anchors, so "Jn 15" finds the
  // Sunday it belongs to. One parser, the one the rest of the app uses.
  const ref = parseReferenceQuery(query.trim());

  const hits: SearchHit[] = [];

  for (const entry of entries) {
    if (options.kinds?.length && !options.kinds.includes(entry.kind)) continue;
    if (options.year && !entry.date.startsWith(options.year)) continue;

    const fields = fieldsOf(entry);
    const matches: FieldMatch[] = [];
    let score = 0;

    for (const field of fields) {
      const weight = FIELD_WEIGHTS[field.field];

      // The whole remembered phrase, in order. The strongest evidence there is.
      if (queryTokens.length > 1 && !queryTokens.every(isBareNumber) && field.normalized.includes(phrase)) {
        score += weight * TIER_WEIGHTS.phrase;
        matches.push({
          field: field.field,
          tier: 'phrase',
          tokens: [...queryTokens],
          snippet: snippetAround(field.raw, phrase),
        });
        continue;
      }

      const exact: string[] = [];
      const prefix: string[] = [];
      const fuzzy: string[] = [];

      for (const token of queryTokens) {
        if (isBareNumber(token)) continue;
        if (field.tokens.has(token)) { exact.push(token); continue; }
        let matchedPrefix = false;
        for (const candidate of field.tokens) {
          if (candidate.startsWith(token) && token.length >= 3) { matchedPrefix = true; break; }
        }
        if (matchedPrefix) { prefix.push(token); continue; }

        const budget = allowedEdits(token);
        if (budget > 0) {
          for (const candidate of field.tokens) {
            if (withinEdits(token, candidate, budget)) { fuzzy.push(token); break; }
          }
        }
      }

      const found = [...exact, ...prefix, ...fuzzy];
      if (found.length === 0) continue;

      score +=
        weight *
        (exact.length * TIER_WEIGHTS.exact +
          prefix.length * TIER_WEIGHTS.prefix +
          fuzzy.length * TIER_WEIGHTS.fuzzy);

      const tier: MatchTier = exact.length ? 'exact' : prefix.length ? 'prefix' : 'fuzzy';
      matches.push({
        field: field.field,
        tier,
        tokens: found,
        snippet: snippetAround(field.raw, found[0]),
      });
    }

    // A remembered year is a real way to find something.
    for (const token of queryTokens) {
      const year = asYear(token);
      if (year && entry.date.startsWith(year)) {
        score += FIELD_WEIGHTS.tags * TIER_WEIGHTS.exact;
        if (!matches.some((m) => m.field === 'scripture' && m.tokens.includes(token))) {
          matches.push({ field: 'tags', tier: 'exact', tokens: [token], snippet: entry.date });
        }
      }
    }

    // An anchored passage counts even when the prose never names it.
    if (ref && entry.anchors.some((anchor) => anchorOverlaps(anchor, ref))) {
      const already = matches.find((m) => m.field === 'scripture');
      if (!already) {
        matches.push({
          field: 'scripture',
          tier: 'exact',
          tokens: queryTokens,
          snippet: refLabel(ref),
        });
      }
      score += FIELD_WEIGHTS.scripture * TIER_WEIGHTS.exact * queryTokens.length;
    }

    if (matches.length === 0) continue;

    matches.sort(
      (a, b) =>
        FIELD_WEIGHTS[b.field] * TIER_WEIGHTS[b.tier] - FIELD_WEIGHTS[a.field] * TIER_WEIGHTS[a.tier],
    );

    hits.push({
      entry,
      score,
      matches,
      providedOnly: matches.every((m) => m.field === 'provided'),
    });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      // Recency breaks ties only; it never overrides relevance.
      b.entry.date.localeCompare(a.entry.date) ||
      b.entry.createdAt.localeCompare(a.entry.createdAt) ||
      a.entry.id.localeCompare(b.entry.id),
  );

  return options.limit ? hits.slice(0, options.limit) : hits;
}

/**
 * Words close to a query token that do appear in the journal.
 *
 * For the empty state: offering "Search for Philippians instead?" is honest,
 * where "you meant" would be a claim this cannot support.
 */
export function spellingSuggestions(query: string, entries: Entry[], limit = 3): string[] {
  const tokens = tokenize(query).filter((t) => allowedEdits(t) > 0);
  if (tokens.length === 0) return [];

  const vocabulary = new Set<string>();
  for (const entry of entries) {
    for (const field of fieldsOf(entry)) {
      if (field.field === 'provided') continue;
      for (const word of field.tokens) if (word.length > 3) vocabulary.add(word);
    }
  }

  const found: string[] = [];
  for (const token of tokens) {
    if (vocabulary.has(token)) continue;
    for (const word of vocabulary) {
      if (withinEdits(token, word, allowedEdits(token)) && !found.includes(word)) {
        found.push(word);
        break;
      }
    }
  }
  return found.slice(0, limit);
}
