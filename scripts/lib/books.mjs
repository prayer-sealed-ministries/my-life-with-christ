/**
 * Canonical 66-book Protestant canon: the authority for book ids, display
 * names, testament, and canonical order.
 *
 * `aliases` carries spellings that appear in the source PDFs but are not the
 * canonical name. Resolving an alias is never silent — the ingest reports every
 * line where one was applied so the spelling can be adjudicated by hand.
 */

/** @type {Array<{id: string, name: string, testament: 'OT'|'NT', order: number, aliases?: string[]}>} */
export const BOOKS = [
  { id: 'genesis', name: 'Genesis', testament: 'OT', order: 1 },
  { id: 'exodus', name: 'Exodus', testament: 'OT', order: 2 },
  { id: 'leviticus', name: 'Leviticus', testament: 'OT', order: 3 },
  { id: 'numbers', name: 'Numbers', testament: 'OT', order: 4 },
  { id: 'deuteronomy', name: 'Deuteronomy', testament: 'OT', order: 5 },
  { id: 'joshua', name: 'Joshua', testament: 'OT', order: 6 },
  { id: 'judges', name: 'Judges', testament: 'OT', order: 7 },
  { id: 'ruth', name: 'Ruth', testament: 'OT', order: 8 },
  { id: '1-samuel', name: '1 Samuel', testament: 'OT', order: 9 },
  { id: '2-samuel', name: '2 Samuel', testament: 'OT', order: 10 },
  { id: '1-kings', name: '1 Kings', testament: 'OT', order: 11 },
  { id: '2-kings', name: '2 Kings', testament: 'OT', order: 12 },
  { id: '1-chronicles', name: '1 Chronicles', testament: 'OT', order: 13 },
  { id: '2-chronicles', name: '2 Chronicles', testament: 'OT', order: 14 },
  { id: 'ezra', name: 'Ezra', testament: 'OT', order: 15 },
  { id: 'nehemiah', name: 'Nehemiah', testament: 'OT', order: 16 },
  { id: 'esther', name: 'Esther', testament: 'OT', order: 17 },
  { id: 'job', name: 'Job', testament: 'OT', order: 18 },
  { id: 'psalms', name: 'Psalms', testament: 'OT', order: 19, aliases: ['Psalm'] },
  { id: 'proverbs', name: 'Proverbs', testament: 'OT', order: 20 },
  { id: 'ecclesiastes', name: 'Ecclesiastes', testament: 'OT', order: 21 },
  {
    id: 'song-of-solomon',
    name: 'Song of Solomon',
    testament: 'OT',
    order: 22,
    aliases: ['Song of Songs', 'Songs'],
  },
  { id: 'isaiah', name: 'Isaiah', testament: 'OT', order: 23 },
  { id: 'jeremiah', name: 'Jeremiah', testament: 'OT', order: 24 },
  { id: 'lamentations', name: 'Lamentations', testament: 'OT', order: 25 },
  { id: 'ezekiel', name: 'Ezekiel', testament: 'OT', order: 26 },
  { id: 'daniel', name: 'Daniel', testament: 'OT', order: 27 },
  { id: 'hosea', name: 'Hosea', testament: 'OT', order: 28 },
  { id: 'joel', name: 'Joel', testament: 'OT', order: 29 },
  { id: 'amos', name: 'Amos', testament: 'OT', order: 30 },
  { id: 'obadiah', name: 'Obadiah', testament: 'OT', order: 31 },
  { id: 'jonah', name: 'Jonah', testament: 'OT', order: 32 },
  { id: 'micah', name: 'Micah', testament: 'OT', order: 33 },
  { id: 'nahum', name: 'Nahum', testament: 'OT', order: 34 },
  { id: 'habakkuk', name: 'Habakkuk', testament: 'OT', order: 35 },
  { id: 'zephaniah', name: 'Zephaniah', testament: 'OT', order: 36 },
  { id: 'haggai', name: 'Haggai', testament: 'OT', order: 37 },
  { id: 'zechariah', name: 'Zechariah', testament: 'OT', order: 38 },
  { id: 'malachi', name: 'Malachi', testament: 'OT', order: 39 },
  { id: 'matthew', name: 'Matthew', testament: 'NT', order: 40 },
  { id: 'mark', name: 'Mark', testament: 'NT', order: 41 },
  { id: 'luke', name: 'Luke', testament: 'NT', order: 42 },
  { id: 'john', name: 'John', testament: 'NT', order: 43 },
  { id: 'acts', name: 'Acts', testament: 'NT', order: 44 },
  { id: 'romans', name: 'Romans', testament: 'NT', order: 45 },
  { id: '1-corinthians', name: '1 Corinthians', testament: 'NT', order: 46 },
  { id: '2-corinthians', name: '2 Corinthians', testament: 'NT', order: 47 },
  { id: 'galatians', name: 'Galatians', testament: 'NT', order: 48, aliases: ['Galations'] },
  { id: 'ephesians', name: 'Ephesians', testament: 'NT', order: 49 },
  { id: 'philippians', name: 'Philippians', testament: 'NT', order: 50 },
  { id: 'colossians', name: 'Colossians', testament: 'NT', order: 51 },
  { id: '1-thessalonians', name: '1 Thessalonians', testament: 'NT', order: 52 },
  { id: '2-thessalonians', name: '2 Thessalonians', testament: 'NT', order: 53 },
  { id: '1-timothy', name: '1 Timothy', testament: 'NT', order: 54 },
  { id: '2-timothy', name: '2 Timothy', testament: 'NT', order: 55 },
  { id: 'titus', name: 'Titus', testament: 'NT', order: 56 },
  { id: 'philemon', name: 'Philemon', testament: 'NT', order: 57 },
  { id: 'hebrews', name: 'Hebrews', testament: 'NT', order: 58 },
  { id: 'james', name: 'James', testament: 'NT', order: 59 },
  { id: '1-peter', name: '1 Peter', testament: 'NT', order: 60 },
  { id: '2-peter', name: '2 Peter', testament: 'NT', order: 61 },
  { id: '1-john', name: '1 John', testament: 'NT', order: 62 },
  { id: '2-john', name: '2 John', testament: 'NT', order: 63 },
  { id: '3-john', name: '3 John', testament: 'NT', order: 64 },
  { id: 'jude', name: 'Jude', testament: 'NT', order: 65 },
  { id: 'revelation', name: 'Revelation', testament: 'NT', order: 66, aliases: ['Revelations'] },
];

/** Chapter counts, used to flag references that point outside a real book. */
export const CHAPTER_COUNTS = {
  genesis: 50, exodus: 40, leviticus: 27, numbers: 36, deuteronomy: 34,
  joshua: 24, judges: 21, ruth: 4, '1-samuel': 31, '2-samuel': 24,
  '1-kings': 22, '2-kings': 25, '1-chronicles': 29, '2-chronicles': 36,
  ezra: 10, nehemiah: 13, esther: 10, job: 42, psalms: 150, proverbs: 31,
  ecclesiastes: 12, 'song-of-solomon': 8, isaiah: 66, jeremiah: 52,
  lamentations: 5, ezekiel: 48, daniel: 12, hosea: 14, joel: 3, amos: 9,
  obadiah: 1, jonah: 4, micah: 7, nahum: 3, habakkuk: 3, zephaniah: 3,
  haggai: 2, zechariah: 14, malachi: 4, matthew: 28, mark: 16, luke: 24,
  john: 21, acts: 28, romans: 16, '1-corinthians': 16, '2-corinthians': 13,
  galatians: 6, ephesians: 6, philippians: 4, colossians: 4,
  '1-thessalonians': 5, '2-thessalonians': 3, '1-timothy': 6, '2-timothy': 4,
  titus: 3, philemon: 1, hebrews: 13, james: 5, '1-peter': 5, '2-peter': 3,
  '1-john': 5, '2-john': 1, '3-john': 1, jude: 1, revelation: 22,
};

/**
 * Longest-first lookup table of every accepted spelling. Longest-first matters:
 * "Song of Songs" must win over "Songs", and "1 John" over "John".
 */
const LOOKUP = (() => {
  /** @type {Array<{spelling: string, book: typeof BOOKS[number], canonical: boolean}>} */
  const rows = [];
  for (const book of BOOKS) {
    rows.push({ spelling: book.name, book, canonical: true });
    for (const alias of book.aliases ?? []) {
      rows.push({ spelling: alias, book, canonical: false });
    }
  }
  return rows.sort((a, b) => b.spelling.length - a.spelling.length);
})();

/**
 * Match a book name at the start of `text`.
 *
 * @returns {{book: typeof BOOKS[number], matched: string, rest: string, canonical: boolean} | null}
 */
export function matchBookPrefix(text) {
  const subject = text.trimStart();
  for (const row of LOOKUP) {
    if (!subject.toLowerCase().startsWith(row.spelling.toLowerCase())) continue;
    const next = subject.charAt(row.spelling.length);
    // Require a boundary so "John" does not match inside "Johnson".
    if (next && !/[\s0-9]/.test(next)) continue;
    return {
      book: row.book,
      matched: subject.slice(0, row.spelling.length),
      rest: subject.slice(row.spelling.length).trim(),
      canonical: row.canonical,
    };
  }
  return null;
}

/** Exact (whole-string) book-name match, used to detect book heading lines. */
export function matchBookExact(text) {
  const subject = text.trim();
  const row = LOOKUP.find((candidate) => candidate.spelling.toLowerCase() === subject.toLowerCase());
  return row ? { book: row.book, canonical: row.canonical } : null;
}

export const BOOKS_BY_ID = new Map(BOOKS.map((book) => [book.id, book]));
