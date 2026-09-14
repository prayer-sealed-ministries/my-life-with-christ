/**
 * How people actually type book names.
 *
 * Nobody searching for 1 Corinthians types "1 Corinthians". They type "1 cor",
 * or "1corinthians", or "First Corinthians". A search that only matches the
 * canonical spelling fails the person who knows the Bible best and abbreviates
 * out of habit.
 *
 * Ordinals are handled generatively rather than listed: every "1 X" book also
 * answers to "1st X", "first X" and "I X", which is a lot of table to maintain
 * by hand and a lot of places to miss one.
 */

import { BOOK_NAMES, CANON } from './canon';

/** Abbreviations that are not derivable from the name. */
const SHORT_FORMS: Record<string, string[]> = {
  genesis: ['gen', 'gn'],
  exodus: ['ex', 'exod'],
  leviticus: ['lev', 'lv'],
  numbers: ['num', 'nm', 'nb'],
  deuteronomy: ['deut', 'dt'],
  joshua: ['josh', 'jos'],
  judges: ['judg', 'jdg'],
  ruth: ['rt'],
  '1-samuel': ['1 sam', '1 sm'],
  '2-samuel': ['2 sam', '2 sm'],
  '1-kings': ['1 kgs', '1 kg'],
  '2-kings': ['2 kgs', '2 kg'],
  '1-chronicles': ['1 chron', '1 chr'],
  '2-chronicles': ['2 chron', '2 chr'],
  ezra: ['ezr'],
  nehemiah: ['neh'],
  esther: ['esth', 'est'],
  job: ['jb'],
  psalms: ['ps', 'psa', 'psalm', 'pss'],
  proverbs: ['prov', 'prv', 'pr'],
  ecclesiastes: ['eccl', 'ecc', 'qoheleth'],
  'song-of-solomon': ['song of songs', 'song', 'songs', 'canticles', 'sos', 'sng'],
  isaiah: ['isa', 'is'],
  jeremiah: ['jer', 'jr'],
  lamentations: ['lam'],
  ezekiel: ['ezek', 'eze', 'ezk'],
  daniel: ['dan', 'dn'],
  hosea: ['hos'],
  joel: ['jl'],
  amos: ['am'],
  obadiah: ['obad', 'ob'],
  jonah: ['jon'],
  micah: ['mic'],
  nahum: ['nah', 'na'],
  habakkuk: ['hab'],
  zephaniah: ['zeph', 'zep'],
  haggai: ['hag'],
  zechariah: ['zech', 'zec'],
  malachi: ['mal'],
  matthew: ['matt', 'mt'],
  mark: ['mk', 'mrk'],
  luke: ['lk'],
  john: ['jn', 'jhn'],
  acts: ['act', 'acts of the apostles'],
  romans: ['rom', 'rm'],
  '1-corinthians': ['1 cor', '1 co'],
  '2-corinthians': ['2 cor', '2 co'],
  galatians: ['gal', 'galations'],
  ephesians: ['eph'],
  philippians: ['phil', 'php'],
  colossians: ['col'],
  '1-thessalonians': ['1 thess', '1 thes', '1 th'],
  '2-thessalonians': ['2 thess', '2 thes', '2 th'],
  '1-timothy': ['1 tim', '1 ti'],
  '2-timothy': ['2 tim', '2 ti'],
  titus: ['tit'],
  philemon: ['philem', 'phm'],
  hebrews: ['heb'],
  james: ['jas', 'jm'],
  '1-peter': ['1 pet', '1 pt'],
  '2-peter': ['2 pet', '2 pt'],
  '1-john': ['1 jn', '1 jhn'],
  '2-john': ['2 jn', '2 jhn'],
  '3-john': ['3 jn', '3 jhn'],
  jude: ['jud', 'jd'],
  revelation: ['rev', 'rv', 'revelations', 'apocalypse'],
};

const ORDINALS: Record<string, string[]> = {
  '1': ['1st', 'first', 'i'],
  '2': ['2nd', 'second', 'ii'],
  '3': ['3rd', 'third', 'iii'],
};

/** Strip punctuation and collapse spacing, so "1 Cor." and "1cor" agree. */
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[.'’,]/g, '').replace(/\s+/g, ' ').trim();
}

/** Every accepted spelling, mapped to a book id. */
const LOOKUP = new Map<string, string>();

function add(spelling: string, bookId: string) {
  const key = normalize(spelling);
  if (!key) return;
  if (!LOOKUP.has(key)) LOOKUP.set(key, bookId);
  // Also without the space, so "1cor" and "songofsongs" resolve.
  const squashed = key.replace(/ /g, '');
  if (!LOOKUP.has(squashed)) LOOKUP.set(squashed, bookId);
}

for (const bookId of CANON) {
  const name = BOOK_NAMES[bookId];
  add(name, bookId);
  add(bookId.replace(/-/g, ' '), bookId);

  for (const alias of SHORT_FORMS[bookId] ?? []) add(alias, bookId);

  // Generate ordinal variants for every numbered spelling of this book.
  const numbered = [name, ...(SHORT_FORMS[bookId] ?? [])].filter((value) => /^[123]\s/.test(value));
  for (const spelling of numbered) {
    const digit = spelling[0];
    const rest = spelling.slice(2);
    for (const ordinal of ORDINALS[digit] ?? []) add(`${ordinal} ${rest}`, bookId);
  }
}

/** Resolve a typed book name to its id, or null. */
export function resolveBook(query: string): string | null {
  return LOOKUP.get(normalize(query)) ?? null;
}

/** Books whose name or any alias starts with the query. Ordered canonically. */
export function searchBooks(query: string, limit = 8): string[] {
  const needle = normalize(query);
  if (needle.length < 2) return [];

  // Prefix matches first, then anything containing the query. Searching "john"
  // must reach 1, 2 and 3 John as well as the gospel — those do not start with
  // it, but a reader typing "john" plainly means them too.
  const prefix = new Set<string>();
  const contains = new Set<string>();

  for (const [spelling, bookId] of LOOKUP) {
    if (spelling.startsWith(needle)) prefix.add(bookId);
    else if (spelling.includes(needle)) contains.add(bookId);
  }

  const canonical = (a: string, b: string) => CANON.indexOf(a) - CANON.indexOf(b);
  const ordered = [
    ...[...prefix].sort(canonical),
    ...[...contains].filter((id) => !prefix.has(id)).sort(canonical),
  ];

  return ordered.slice(0, limit);
}

/** Every alias for a book, for display and for tests. */
export function aliasesFor(bookId: string): string[] {
  return SHORT_FORMS[bookId] ?? [];
}

/** How many spellings the table knows. Used to assert it is not empty. */
export const SPELLING_COUNT = LOOKUP.size;
