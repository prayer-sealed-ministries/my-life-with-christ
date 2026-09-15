/**
 * Mirror what GitHub Pages is actually serving, so the data gate can be run
 * against the deployed artefact rather than a local build of the same commit.
 *
 * Chunk names are discovered by crawling: start at index.html, pull every
 * assets/*.js|css string out of each file fetched, and repeat until nothing
 * new appears. Vite code-splits per book, so the entry bundle alone is a
 * small fraction of the site.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE = process.argv[2];
const OUT = process.argv[3];

const queue = ['index.html', 'robots.txt'];
const seen = new Set(queue);
let fetched = 0;

while (queue.length) {
  const path = queue.shift();
  const res = await fetch(new URL(path, BASE));
  if (!res.ok) {
    if (path === 'robots.txt') continue;
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  const target = join(OUT, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
  fetched += 1;

  // Book chunks are referenced as `./genesis-HASH.js` from inside another
  // chunk, not as `assets/...`, so both spellings have to be recognised or
  // the crawl stops at 16 of ~85 files and the gate reads almost nothing.
  const text = body.toString('utf8');
  const refs = [
    ...[...text.matchAll(/assets\/[A-Za-z0-9_.@-]+\.(?:js|css)/g)].map((m) => m[0]),
    ...[...text.matchAll(/\.\/([A-Za-z0-9_.@-]+\.(?:js|css))/g)].map((m) => `assets/${m[1]}`),
  ];
  for (const ref of refs.map((value) => ({ 0: value }))) {
    if (!seen.has(ref[0])) {
      seen.add(ref[0]);
      queue.push(ref[0]);
    }
  }
}

console.log(`mirrored ${fetched} files from ${BASE}`);
