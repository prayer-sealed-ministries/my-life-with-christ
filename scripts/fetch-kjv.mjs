#!/usr/bin/env node
/**
 * One-shot vendoring of the KJV scripture text into src/data/kjv/.
 *
 * Run once; the output is committed. The app never fetches anything at runtime.
 * Each book becomes its own file so a chapter can be lazy-loaded without
 * pulling the whole Bible into the bundle.
 *
 * Also emits src/data/kjv/versification.json — verse counts per chapter — which
 * is small enough to load eagerly and is what the coverage report needs to know
 * which passages the outlines leave uncovered.
 *
 * Usage: node scripts/fetch-kjv.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOOKS } from './lib/books.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/data/kjv');
const BASE = 'https://raw.githubusercontent.com/aruljohn/Bible-kjv/master';

/** Source file names differ from our display names for a few books. */
const SOURCE_NAMES = {
  'song-of-solomon': 'SongofSolomon',
  '1-samuel': '1Samuel', '2-samuel': '2Samuel',
  '1-kings': '1Kings', '2-kings': '2Kings',
  '1-chronicles': '1Chronicles', '2-chronicles': '2Chronicles',
  '1-corinthians': '1Corinthians', '2-corinthians': '2Corinthians',
  '1-thessalonians': '1Thessalonians', '2-thessalonians': '2Thessalonians',
  '1-timothy': '1Timothy', '2-timothy': '2Timothy',
  '1-peter': '1Peter', '2-peter': '2Peter',
  '1-john': '1John', '2-john': '2John', '3-john': '3John',
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  /** @type {Record<string, number[]>} */
  const versification = {};
  let totalVerses = 0;

  for (const book of BOOKS) {
    const sourceName = SOURCE_NAMES[book.id] ?? book.name.replace(/\s+/g, '');
    const response = await fetch(`${BASE}/${sourceName}.json`);
    if (!response.ok) {
      throw new Error(`${book.name}: ${response.status} ${response.statusText} (tried ${sourceName}.json)`);
    }
    const payload = await response.json();

    // Reshape to exactly what the app reads: chapters as arrays of verse strings.
    // Verse numbers are positional, which halves the file size versus objects.
    const chapters = payload.chapters.map((chapter) => chapter.verses.map((verse) => verse.text.trim()));

    versification[book.id] = chapters.map((verses) => verses.length);
    totalVerses += chapters.reduce((sum, verses) => sum + verses.length, 0);

    await writeFile(
      join(OUT_DIR, `${book.id}.json`),
      JSON.stringify({ id: book.id, name: book.name, chapters }),
      'utf8',
    );
    process.stderr.write(`${book.name.padEnd(18)} ${chapters.length} chapters\n`);
  }

  await writeFile(join(OUT_DIR, 'versification.json'), `${JSON.stringify(versification, null, 0)}\n`, 'utf8');
  process.stderr.write(`\n66 books, ${totalVerses} verses -> src/data/kjv/\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
