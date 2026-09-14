#!/usr/bin/env node
/**
 * Prove that a `refs-only` build contains none of the purchased outline content.
 *
 * The DATA_PROFILE flag is not evidence. This reads the actual built artefact
 * and searches it for the protected strings — outline titles and the author's
 * intro prose — taken from the real dataset. If any survived, the build is not
 * publishable and this exits non-zero.
 *
 * Usage:
 *   DATA_PROFILE=refs-only npm run build
 *   node scripts/verify-bundle.mjs --profile refs-only --dist dist
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Strings short enough to collide by accident are useless as evidence. */
const MIN_PROBE_LENGTH = 24;
/** How many probes to draw from each category. */
const PROBE_COUNT = 60;

function parseArgs(argv) {
  const args = { profile: process.env.DATA_PROFILE ?? 'refs-only', dist: 'dist' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile') args.profile = argv[i + 1];
    if (argv[i] === '--dist') args.dist = argv[i + 1];
  }
  return args;
}

async function collectFiles(dir) {
  const found = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) found.push(...(await collectFiles(path)));
    else found.push(path);
  }
  return found;
}

/**
 * Build the probe set: real strings that must not appear under `refs-only`.
 *
 * Titles are sampled across the whole dataset rather than from the top, so a
 * partial strip cannot pass by accident.
 */
function buildProbes(books) {
  const titles = [];
  const intros = [];

  for (const book of books) {
    if (book.intro && book.intro.length >= MIN_PROBE_LENGTH) {
      // A distinctive interior sentence, not the opening words.
      const sentences = book.intro.split(/(?<=\.)\s+/).filter((s) => s.length >= MIN_PROBE_LENGTH);
      if (sentences.length > 0) intros.push(sentences[Math.floor(sentences.length / 2)].trim());
    }
    for (const entry of book.entries) {
      for (const value of [entry.title, entry.displayTitle]) {
        if (value && value.length >= MIN_PROBE_LENGTH) titles.push(value);
      }
    }
  }

  const spread = (list, count) => {
    if (list.length <= count) return [...new Set(list)];
    const step = list.length / count;
    return [...new Set(Array.from({ length: count }, (_, i) => list[Math.floor(i * step)]))];
  };

  return {
    titles: spread(titles, PROBE_COUNT),
    intros: spread(intros, Math.min(PROBE_COUNT, intros.length)),
  };
}

async function main() {
  const { profile, dist } = parseArgs(process.argv.slice(2));
  const distDir = resolve(ROOT, dist);

  if (!existsSync(distDir)) {
    console.error(`No build found at ${distDir}. Run the build first.`);
    process.exitCode = 1;
    return;
  }

  const books = JSON.parse(await readFile(join(ROOT, 'src/data/outlines.json'), 'utf8'));
  const probes = buildProbes(books);

  const files = await collectFiles(distDir);
  const searchable = files.filter((file) => /\.(js|mjs|cjs|css|html|json|txt|map)$/i.test(file));

  console.log(`Verifying DATA_PROFILE=${profile}`);
  console.log(`  ${searchable.length} text files in ${dist}/`);
  console.log(`  ${probes.titles.length} title probes, ${probes.intros.length} intro probes`);

  /** @type {Array<{probe: string, kind: string, file: string}>} */
  const hits = [];
  for (const file of searchable) {
    const content = await readFile(file, 'utf8');
    for (const probe of probes.titles) {
      if (content.includes(probe)) hits.push({ probe, kind: 'outline title', file });
    }
    for (const probe of probes.intros) {
      if (content.includes(probe)) hits.push({ probe, kind: 'intro prose', file });
    }
  }

  if (profile === 'refs-only') {
    if (hits.length > 0) {
      console.error(`\nFAIL: ${hits.length} protected string(s) found in a refs-only build.\n`);
      for (const hit of hits.slice(0, 20)) {
        console.error(`  ${hit.kind}: ${JSON.stringify(hit.probe.slice(0, 70))}`);
        console.error(`    in ${hit.file.replace(`${ROOT}/`, '')}`);
      }
      if (hits.length > 20) console.error(`  ... and ${hits.length - 20} more`);
      console.error('\nThis build is NOT publishable. See DATA-LICENSE.md.');
      process.exitCode = 1;
      return;
    }
    console.log('\nPASS: no outline titles or intro prose in the build.');
    return;
  }

  // Under `full` the content is supposed to be there. Assert that too, so a
  // silently-empty dataset cannot masquerade as a clean refs-only build.
  if (hits.length === 0) {
    console.error('\nFAIL: a full build contains none of the outline content. Is the data missing?');
    process.exitCode = 1;
    return;
  }
  console.log(`\nPASS: full build contains the outline content (${hits.length} probe hits).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
