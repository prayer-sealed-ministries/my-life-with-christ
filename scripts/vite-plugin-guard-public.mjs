/**
 * Refuse to build if the purchased source material could reach the artefact.
 *
 * Vite copies `public/` into `dist/` wholesale, without passing it through the
 * module graph — so nothing in the data-profile gate would ever see it. A PDF
 * or a report dropped in there, by hand or by a careless script, would be
 * published verbatim.
 *
 * This fails the build at start rather than letting the verifier catch it after
 * the fact, because a build that cannot possibly be safe should not run at all.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const FORBIDDEN = [
  { test: (path) => /\.pdf$/i.test(path), why: 'a source PDF' },
  { test: (path) => /ingest-report\.md$/i.test(path), why: 'the ingest report (quotes raw source lines)' },
  { test: (path) => /coverage-report\.md$/i.test(path), why: 'the coverage report (quotes outline titles)' },
  { test: (path) => /outlines\.json$/i.test(path), why: 'the parsed compilation' },
  { test: (path) => /(^|[/\\])source[/\\]/i.test(path), why: 'a path under a source/ directory' },
];

function walk(dir, base = dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walk(path, base));
    else found.push(relative(base, path));
  }
  return found;
}

export default function guardPublicDir(options = {}) {
  const root = options.root ?? process.cwd();
  const publicDir = options.publicDir ?? resolve(root, 'public');

  return {
    name: 'journey:guard-public',
    enforce: 'pre',

    buildStart() {
      if (!existsSync(publicDir)) return;

      const violations = [];
      for (const path of walk(publicDir)) {
        for (const rule of FORBIDDEN) {
          if (rule.test(path)) violations.push(`public/${path} — ${rule.why}`);
        }
      }

      if (violations.length > 0) {
        throw new Error(
          `Refusing to build: public/ is copied into the build verbatim and contains material that must not be published.\n` +
            violations.map((line) => `  ${line}`).join('\n') +
            `\n\nSee DATA-LICENSE.md.`,
        );
      }
    },
  };
}
