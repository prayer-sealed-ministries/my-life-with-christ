/**
 * Build docs/ocr/handwriting-benchmark-sheet.pdf.
 *
 * The sheet is a physical instrument: somebody prints it, writes on it by hand,
 * photographs it and scores what the app produced. So the geometry matters more
 * than the typography — ruled space has to be tall enough to write in with a
 * normal pen, and the printed reference text has to sit far enough from the
 * writing that a photograph of one does not catch the other and flatter the
 * result.
 *
 * Content comes from docs/ocr/handwriting-benchmark-sheet.md, which is the file
 * to edit. The ground truth lives there, in fenced blocks, and this script
 * reads those blocks rather than restating them — two copies of a ground truth
 * is one copy of a ground truth and one bug waiting to happen.
 *
 * Rendered through the Chromium that Playwright already installs for the e2e
 * suite, because print geometry is exactly what a browser is good at and no
 * additional dependency is worth it for one sheet.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const SOURCE = join(root, 'docs/ocr/handwriting-benchmark-sheet.md');
const OUTPUT = join(root, 'docs/ocr/handwriting-benchmark-sheet.pdf');

/** Pull each section's heading, instruction and ground truth out of the source. */
function readSections(markdown) {
  const sections = [];
  const pattern = /^## (Section \d+ — .+)$\n([\s\S]*?)```\n([\s\S]*?)```/gm;
  for (const match of markdown.matchAll(pattern)) {
    const [, heading, between, truth] = match;
    const instruction = between
      .split('\n')
      .filter((line) => line.startsWith('>'))
      .map((line) => line.replace(/^>\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    sections.push({ heading, instruction, lines: truth.trimEnd().split('\n') });
  }
  return sections;
}

const markdown = readFileSync(SOURCE, 'utf8');
const sections = readSections(markdown);

// A floor, for the same reason everything else in this repository has one: an
// empty sheet is a valid PDF, and a regex that stopped matching would produce
// one silently.
if (sections.length !== 4) {
  throw new Error(`expected 4 sections in the source, parsed ${sections.length}`);
}
if (!sections[3].heading.includes('Natural note-taking')) {
  throw new Error('the fourth section is not the free-writing one; check the source order');
}
for (const section of sections) {
  if (section.instruction.length < 40) {
    throw new Error(`${section.heading} has no usable instruction`);
  }
}

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Escape, then honour the little markdown the instructions use.
 *
 * Without this the asterisks print literally, and the sheet told its reader to
 * put something "**in the box at the bottom**" — which is the sort of thing
 * that gets noticed by whoever has already printed forty copies.
 */
const inline = (text) =>
  escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>');

/** Ruled lines to write on. 11mm apart, which is ordinary wide-ruled paper. */
const ruled = (count) =>
  Array.from({ length: count }, () => '<div class="rule"></div>').join('');

const sectionHtml = (section, index) => {
  const free = index === 3;
  return `
    <section class="${free ? 'free' : ''}">
      <h2>${escape(section.heading)}</h2>
      <p class="instruction">${inline(section.instruction)}</p>
      ${
        free
          ? ''
          : `<div class="reference">${section.lines
              .map((line) => `<div>${escape(line)}</div>`)
              .join('')}</div>`
      }
      <div class="write">${ruled(free ? 6 : section.lines.length + 1)}</div>
      ${
        free
          ? `<p class="instruction">Now print what you wrote, so there is something to score against:</p>
             <div class="write truth">${ruled(6)}</div>`
          : ''
      }
    </section>`;
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Handwriting benchmark sheet</title>
<style>
  @page { size: Letter; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    color: #111;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .lede { margin: 0 0 4mm; font-size: 9.5pt; }
  .caution {
    border: 0.4mm solid #111;
    padding: 3mm 4mm;
    margin: 0 0 5mm;
    font-size: 9pt;
  }
  .caution strong { display: block; margin-bottom: 1mm; }
  section { break-inside: avoid; margin-bottom: 7mm; }
  h2 { font-size: 11.5pt; margin: 0 0 1.5mm; }
  .instruction { margin: 0 0 2.5mm; font-size: 9pt; font-style: italic; }
  .reference {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
    padding: 2.5mm 3mm;
    background: #f2f2f2;
    margin-bottom: 4mm;
  }
  /* The gap below matters: it keeps the printed reference out of a photograph
     framed on the writing, which would otherwise hand the recogniser the
     answer in clean type. */
  .write { margin-bottom: 1mm; }
  .rule { height: 11mm; border-bottom: 0.25mm solid #999; }
  .truth .rule { border-bottom-style: dashed; }
  footer { font-size: 8pt; color: #333; margin-top: 4mm; }
</style>
</head>
<body>
  <h1>Handwriting benchmark sheet — My Life With Christ</h1>
  <p class="lede">
    Scan Notes reads printed pages well. Whether it reads <em>handwriting</em>
    is unproven. Copy each block below in the style asked for, photograph it
    with Scan notes, and keep the transcription <strong>before</strong> you
    correct it — the uncorrected text is the measurement.
  </p>
  <div class="caution">
    <strong>Everything on this sheet is fictional, and must stay that way.</strong>
    No real names, no real churches, and nothing from an actual journal. A
    benchmark page gets photographed, attached to a report and passed around;
    somebody's prayers are not a test fixture.
  </div>
  ${sections.map(sectionHtml).join('')}
  <footer>
    Scored as character error rate against the printed reference, with
    <code>Jhn 3:16</code> counted as the ground truth — an engine that returns
    <code>John 3:16</code> has substituted, and is scored wrong even though it
    guessed right. Generated from docs/ocr/handwriting-benchmark-sheet.md.
  </footer>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
const pdf = await page.pdf({ format: 'Letter', printBackground: true });
await browser.close();

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, pdf);

// Prove something was written, rather than trusting that a call returned.
const written = readFileSync(OUTPUT);
if (!written.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
  throw new Error('output is not a PDF');
}
if (written.byteLength < 8000) {
  throw new Error(`output is suspiciously small: ${written.byteLength} bytes`);
}
console.log(
  `handwriting-benchmark-sheet.pdf — ${sections.length} sections, ${Math.round(written.byteLength / 1024)} kB`,
);
