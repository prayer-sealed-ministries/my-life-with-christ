#!/usr/bin/env node
/**
 * Score OCR output against ground truth: CER, WER, and the specifics this
 * product actually cares about.
 *
 * Accuracy numbers are easy to flatter. Three deliberate choices here:
 *
 *   1. Printed and handwritten are never averaged together. They are different
 *      problems with different answers, and one number hides that.
 *   2. Raw CER/WER are computed on the text as recognised. A separate
 *      normalised pass (case folded, punctuation and whitespace collapsed) is
 *      reported ALONGSIDE, never instead — because for a journal that preserves
 *      people's words, punctuation and capitalisation are part of the words.
 *   3. Scripture references are scored on their own, because a reference that
 *      loses a digit is worse than a sentence that loses an article.
 *
 * Usage:
 *   node tools/ocr-lab/score.mjs <results-dir> [--kind printed]
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/** Levenshtein distance over an array of tokens (characters or words). */
function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** Collapse runs of whitespace; keep everything else exactly as written. */
const tidy = (s) => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/[ \t]*\n[ \t]*/g, '\n').trim();

/**
 * The normalised view. Reported next to the raw figure, never in place of it:
 * this is "could a person reconstruct the meaning", not "is the transcription
 * faithful".
 */
const normalise = (s) =>
  tidy(s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/[^\p{L}\p{N}\s'":.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const words = (s) => s.split(/\s+/).filter(Boolean);

/** Scripture references, as a reader would write them. */
const SCRIPTURE = /\b((?:[123]\s*)?[A-Z][a-z]+)\s+(\d{1,3}):(\d{1,3})(?:\s*[-‐-―]\s*(\d{1,3}))?/g;
function references(text) {
  return [...text.matchAll(SCRIPTURE)].map((m) => m[0].replace(/\s+/g, ' ').trim());
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const percentile = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(2)}%`);

async function main() {
  const dir = resolve(process.argv[2] ?? 'tools/ocr-lab/results');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'summary.json');
  if (files.length === 0) {
    console.error(`No result JSON in ${dir}. Run the benchmark first.`);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const file of files) {
    const result = JSON.parse(await readFile(join(dir, file), 'utf8'));
    const truth = await readFile(result.truthPath, 'utf8');

    const rawTruth = tidy(truth);
    const rawOcr = tidy(result.text ?? '');
    const cer = editDistance([...rawTruth], [...rawOcr]) / Math.max(1, [...rawTruth].length);
    const wer = editDistance(words(rawTruth), words(rawOcr)) / Math.max(1, words(rawTruth).length);

    const nTruth = normalise(truth);
    const nOcr = normalise(result.text ?? '');
    const ncer = editDistance([...nTruth], [...nOcr]) / Math.max(1, [...nTruth].length);
    const nwer = editDistance(words(nTruth), words(nOcr)) / Math.max(1, words(nTruth).length);

    const refTruth = references(rawTruth);
    const refOcr = references(rawOcr);
    const refExact = refTruth.filter((r) => refOcr.includes(r)).length;

    rows.push({
      id: result.id,
      kind: result.kind ?? 'printed',
      engine: result.engine,
      revision: result.revision,
      level: result.level,
      correction: result.languageCorrection,
      truthChars: [...rawTruth].length,
      ocrChars: [...rawOcr].length,
      cer, wer, ncer, nwer,
      elapsedMs: result.elapsedMs,
      width: result.imageWidth,
      height: result.imageHeight,
      lineCount: result.lineCount,
      refsExpected: refTruth.length,
      refsExact: refExact,
      refsMissing: refTruth.filter((r) => !refOcr.includes(r)),
    });
  }

  // Group by the configuration being compared.
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.engine} rev${row.revision} ${row.level} correction=${row.correction ? 'on' : 'off'} [${row.kind}]`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const summary = [];
  for (const [key, group] of [...groups.entries()].sort()) {
    const cers = group.map((r) => r.cer);
    const wers = group.map((r) => r.wer);
    const stat = {
      configuration: key,
      samples: group.length,
      medianCER: median(cers),
      medianWER: median(wers),
      worstCER: Math.max(...cers),
      worstWER: Math.max(...wers),
      p90CER: percentile(cers, 90),
      medianNormalisedCER: median(group.map((r) => r.ncer)),
      medianLatencyMs: median(group.map((r) => r.elapsedMs)),
      worstLatencyMs: Math.max(...group.map((r) => r.elapsedMs)),
      scriptureExact: group.reduce((n, r) => n + r.refsExact, 0),
      scriptureExpected: group.reduce((n, r) => n + r.refsExpected, 0),
      worstSample: group.reduce((a, b) => (a.cer > b.cer ? a : b)).id,
    };
    summary.push(stat);

    console.log(`\n### ${key}`);
    console.log(`  samples            ${stat.samples}`);
    console.log(`  median CER         ${pct(stat.medianCER)}      median WER  ${pct(stat.medianWER)}`);
    console.log(`  worst  CER         ${pct(stat.worstCER)}  (${stat.worstSample})   worst WER  ${pct(stat.worstWER)}`);
    console.log(`  p90    CER         ${pct(stat.p90CER)}`);
    console.log(`  normalised CER     ${pct(stat.medianNormalisedCER)}   (case/punctuation folded — context only)`);
    console.log(`  latency            median ${stat.medianLatencyMs.toFixed(0)}ms, worst ${stat.worstLatencyMs.toFixed(0)}ms`);
    console.log(`  Scripture refs     ${stat.scriptureExact}/${stat.scriptureExpected} exact`);
  }

  console.log('\n### per sample (raw CER, worst first)\n');
  console.log('  sample              cfg                      CER      WER      refs   ms');
  for (const row of [...rows].sort((a, b) => b.cer - a.cer)) {
    const cfg = `rev${row.revision}/${row.level}/${row.correction ? 'corr' : 'raw '}`;
    console.log(
      `  ${row.id.padEnd(20)}${cfg.padEnd(25)}${pct(row.cer).padStart(7)}  ${pct(row.wer).padStart(7)}  ` +
      `${String(row.refsExact)}/${row.refsExpected}`.padStart(6) + `  ${row.elapsedMs.toFixed(0).padStart(5)}`,
    );
  }

  const missing = rows.flatMap((r) => r.refsMissing.map((m) => `${r.id}: ${m}`));
  if (missing.length > 0) {
    console.log('\n### Scripture references not recovered exactly\n');
    for (const m of [...new Set(missing)]) console.log(`  ${m}`);
  }

  console.log(`\n${rows.length} results scored from ${dir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
