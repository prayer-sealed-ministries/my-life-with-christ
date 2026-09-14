/**
 * USFM three-letter book codes to this project's book ids.
 *
 * USFM is the standard interchange format for scripture, and its book codes are
 * fixed by the specification — they are not the file names, and not derivable
 * from them, so the mapping is written out.
 */

export const USFM_TO_BOOK_ID = {
  GEN: 'genesis', EXO: 'exodus', LEV: 'leviticus', NUM: 'numbers', DEU: 'deuteronomy',
  JOS: 'joshua', JDG: 'judges', RUT: 'ruth', '1SA': '1-samuel', '2SA': '2-samuel',
  '1KI': '1-kings', '2KI': '2-kings', '1CH': '1-chronicles', '2CH': '2-chronicles',
  EZR: 'ezra', NEH: 'nehemiah', EST: 'esther', JOB: 'job', PSA: 'psalms',
  PRO: 'proverbs', ECC: 'ecclesiastes', SNG: 'song-of-solomon', ISA: 'isaiah',
  JER: 'jeremiah', LAM: 'lamentations', EZK: 'ezekiel', DAN: 'daniel', HOS: 'hosea',
  JOL: 'joel', AMO: 'amos', OBA: 'obadiah', JON: 'jonah', MIC: 'micah', NAM: 'nahum',
  HAB: 'habakkuk', ZEP: 'zephaniah', HAG: 'haggai', ZEC: 'zechariah', MAL: 'malachi',
  MAT: 'matthew', MRK: 'mark', LUK: 'luke', JHN: 'john', ACT: 'acts', ROM: 'romans',
  '1CO': '1-corinthians', '2CO': '2-corinthians', GAL: 'galatians', EPH: 'ephesians',
  PHP: 'philippians', COL: 'colossians', '1TH': '1-thessalonians',
  '2TH': '2-thessalonians', '1TI': '1-timothy', '2TI': '2-timothy', TIT: 'titus',
  PHM: 'philemon', HEB: 'hebrews', JAS: 'james', '1PE': '1-peter', '2PE': '2-peter',
  '1JN': '1-john', '2JN': '2-john', '3JN': '3-john', JUD: 'jude', REV: 'revelation',
};
