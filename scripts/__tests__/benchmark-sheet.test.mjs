import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The handwriting benchmark kit exists, is printable, and is fictional.
 *
 * It is a physical instrument that leaves the repository — somebody prints it,
 * writes on it and photographs it — so two things have to hold. It must
 * actually be a US Letter PDF with content on it, because an empty or
 * A4-shaped sheet is discovered at the printer rather than here. And its
 * content must stay invented, because a benchmark page is passed around and a
 * page of somebody's real journal is not a test fixture.
 */
const root = resolve(process.cwd());
const SOURCE = join(root, 'docs/ocr/handwriting-benchmark-sheet.md');
const SHEET = join(root, 'docs/ocr/handwriting-benchmark-sheet.pdf');

describe('the handwriting benchmark kit', () => {
  const markdown = readFileSync(SOURCE, 'utf8');
  const pdf = readFileSync(SHEET);

  it('is a US Letter PDF with pages in it', () => {
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // 612x792 points is US Letter. A4 would be 595x842, and would reflow the
    // ruled lines on any printer in the United States.
    const boxes = pdf.toString('latin1').match(/\/MediaBox \[0 0 612 792\]/g) ?? [];
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    // The floor: a valid PDF of nothing is about 1kB.
    expect(statSync(SHEET).size).toBeGreaterThan(40_000);
  });

  it('asks for all four hands, and says the sheet is fictional', () => {
    const sections = markdown.match(/^## Section \d+ — .+$/gm) ?? [];
    expect(sections).toHaveLength(4);
    expect(sections.join(' ')).toMatch(/Neat printing/);
    expect(sections.join(' ')).toMatch(/Normal handwriting/);
    expect(sections.join(' ')).toMatch(/Cursive/);
    expect(sections.join(' ')).toMatch(/Natural note-taking/);
    expect(markdown).toMatch(/Nothing from a real journal/);
  });

  it('keeps the reference spelling as the ground truth', () => {
    // The sheet must not reward an engine for expanding `Jhn` to `John`.
    // Scoring that as correct would bless exactly the generative rewriting
    // this feature refuses to do.
    expect(markdown).toContain('Jhn 3:16');
    expect(markdown).toMatch(/Do not normalise the reference/);
  });

  it('does not claim handwriting works', () => {
    // The product's wording stays cautious until this kit has been filled in
    // by several hands. The kit is what would justify changing it; it is not
    // itself evidence of anything.
    expect(markdown).toMatch(/unproven/i);
    expect(markdown).not.toMatch(/handwriting is supported|works with any handwriting/i);
  });
});
