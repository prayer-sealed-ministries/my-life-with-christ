#!/usr/bin/env node
/**
 * Ingest the Berean Standard Bible section headings into the "sections" layer.
 *
 * This is the division scheme the project OWNS. The BSB was dedicated to the
 * public domain on 2023-04-30, so its headings — titles and the verse spans
 * they imply — can be published without restriction. That is the whole point:
 * the purchased outlines cannot be, because in a compilation the selection and
 * arrangement is the protected element, and rewording the titles does not
 * change that.
 *
 * Kept deliberately separate from the outlines layer, in code and in naming, so
 * the two can never be confused for one another.
 *
 * Usage: npm run ingest:sections
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOOKS } from './lib/books.mjs';
import { USFM_TO_BOOK_ID } from './lib/usfm-books.mjs';
import { parseUsfmSections } from './lib/parse-usfm-sections.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'data/source/bsb_usfm');
const OUTPUT_JSON = join(ROOT, 'src/data/sections.json');
const OUTPUT_REPORT = join(ROOT, 'data/sections-ingest-report.md');
const VERSIFICATION = join(ROOT, 'src/data/kjv/versification.json');

/** Stable id for a section, in the same shape outline entry ids use. */
function sectionId(section) {
  const { book, chapterStart, verseStart, chapterEnd, verseEnd } = section;
  return chapterStart === chapterEnd
    ? `${book}-${chapterStart}-${verseStart}-${verseEnd}`
    : `${book}-${chapterStart}-${verseStart}-${chapterEnd}-${verseEnd}`;
}

function displayRef(section, bookName, verseCounts) {
  const { chapterStart, verseStart, chapterEnd, verseEnd } = section;
  if (chapterStart === chapterEnd) {
    if (verseStart === 1 && verseEnd === verseCounts[chapterStart - 1]) {
      return `${bookName} ${chapterStart}`;
    }
    if (verseStart === verseEnd) return `${bookName} ${chapterStart}:${verseStart}`;
    return `${bookName} ${chapterStart}:${verseStart}-${verseEnd}`;
  }
  return `${bookName} ${chapterStart}:${verseStart}-${chapterEnd}:${verseEnd}`;
}

async function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`Missing BSB USFM at ${SOURCE_DIR}. See src/data/sections/SOURCE.md.`);
    process.exitCode = 1;
    return;
  }

  const versification = JSON.parse(await readFile(VERSIFICATION, 'utf8'));
  const files = (await readdir(SOURCE_DIR)).filter((name) => name.endsWith('.usfm'));

  const books = [];
  const allIssues = [];
  let totalSubsections = 0;

  for (const book of BOOKS) {
    const code = Object.keys(USFM_TO_BOOK_ID).find((key) => USFM_TO_BOOK_ID[key] === book.id);
    const file = files.find((name) => basename(name, '.usfm') === code);

    if (!file) {
      allIssues.push({
        type: 'missing-book',
        book: book.name,
        detail: `no USFM file for ${code ?? book.id}`,
        raw: book.id,
      });
      continue;
    }

    const text = await readFile(join(SOURCE_DIR, file), 'utf8');
    const counts = versification[book.id];
    const { sections, subsectionCount, issues } = parseUsfmSections(text, book.id, counts);
    totalSubsections += subsectionCount;

    for (const issue of issues) allIssues.push({ ...issue, book: book.name });

    const seen = new Map();
    const entries = sections.map((section) => {
      const base = sectionId(section);
      let id = base;
      if (seen.has(id)) {
        let suffix = 2;
        while (seen.has(`${base}-${suffix}`)) suffix += 1;
        id = `${base}-${suffix}`;
        allIssues.push({
          type: 'duplicate-id',
          book: book.name,
          detail: `"${base}" already used by "${seen.get(base)}"; this section became "${id}"`,
          raw: section.title,
        });
      }
      seen.set(id, section.title);

      // Sanity-check the span against real versification.
      const startMax = counts[section.chapterStart - 1];
      const endMax = counts[section.chapterEnd - 1];
      if (!startMax || section.verseStart > startMax || !endMax || section.verseEnd > endMax) {
        allIssues.push({
          type: 'impossible-range',
          book: book.name,
          detail: `${section.chapterStart}:${section.verseStart}-${section.chapterEnd}:${section.verseEnd} is outside ${book.name}`,
          raw: section.title,
        });
      }

      return {
        id,
        ref: displayRef(section, book.name, counts),
        book: book.id,
        chapterStart: section.chapterStart,
        chapterEnd: section.chapterEnd,
        verseStart: section.verseStart,
        verseEnd: section.verseEnd,
        title: section.title,
        // Same field the outlines carry, so both layers render identically.
        // Nothing to expand here: BSB headings are already plain English.
        displayTitle: section.title,
        classicStory: false,
        series: null,
      };
    });

    books.push({
      id: book.id,
      name: book.name,
      testament: book.testament,
      order: book.order,
      intro: '',
      entries,
    });
  }

  books.sort((a, b) => a.order - b.order);

  await mkdir(dirname(OUTPUT_JSON), { recursive: true });
  await writeFile(OUTPUT_JSON, `${JSON.stringify(books, null, 2)}\n`, 'utf8');

  const total = books.reduce((sum, book) => sum + book.entries.length, 0);
  await writeFile(OUTPUT_REPORT, renderReport({ books, issues: allIssues, total, totalSubsections }), 'utf8');

  process.stderr.write(
    `Wrote ${books.length} books, ${total} sections -> src/data/sections.json\n` +
      `${allIssues.length} issues, ${totalSubsections} \\s2 subsections excluded -> data/sections-ingest-report.md\n`,
  );
}

function renderReport({ books, issues, total, totalSubsections }) {
  const lines = [];
  lines.push('# BSB section ingest report');
  lines.push('');
  lines.push('Generated by `npm run ingest:sections`. **Do not edit by hand.**');
  lines.push('');
  lines.push(
    'The Berean Standard Bible was dedicated to the public domain on 2023-04-30.',
    'Its section headings are therefore ours to publish. See',
    '`src/data/sections/SOURCE.md`.',
    '',
  );
  lines.push('## Totals');
  lines.push('');
  lines.push(`- **${books.length}** books`);
  lines.push(`- **${total}** sections`);
  lines.push(`- **${totalSubsections}** \`\\s2\` subsections excluded (they nest inside \`\\s1\`, so including both would make every subsection overlap its parent)`);
  lines.push(`- **${issues.length}** issues`);
  lines.push('');

  if (issues.length > 0) {
    const byType = new Map();
    for (const issue of issues) {
      if (!byType.has(issue.type)) byType.set(issue.type, []);
      byType.get(issue.type).push(issue);
    }
    lines.push('## Issues');
    lines.push('');
    for (const [type, rows] of byType) {
      lines.push(`### ${type} — ${rows.length}`);
      lines.push('');
      lines.push('| Book | Detail | Raw |');
      lines.push('| --- | --- | --- |');
      for (const row of rows.slice(0, 40)) {
        lines.push(`| ${row.book ?? '—'} | ${escape(row.detail)} | \`${escape(row.raw)}\` |`);
      }
      if (rows.length > 40) lines.push(`| … | ${rows.length - 40} more | |`);
      lines.push('');
    }
  } else {
    lines.push('No issues. Every heading resolved to a real verse span.');
    lines.push('');
  }

  lines.push('## Sections per book');
  lines.push('');
  lines.push('| # | Book | Testament | Sections |');
  lines.push('| ---: | --- | --- | ---: |');
  for (const book of books) {
    lines.push(`| ${book.order} | ${book.name} | ${book.testament} | ${book.entries.length} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
