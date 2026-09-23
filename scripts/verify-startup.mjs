/**
 * What the app loads before it can be used.
 *
 * The data gate asks whether a build may be published. This asks a different
 * question about the same bytes: is the Scripture section payload still OFF
 * the path between launching the app and writing a sentence?
 *
 * It is a separate verifier because it is a separate kind of claim, and
 * because the way this repository loses a property is not by someone deciding
 * to lose it — it is by a `import x from 'virtual:journey-outlines'` appearing
 * in a module the entry already reaches, which nothing else here would notice.
 * Bundle sizes in a build log are not a check; nobody reads them, and they say
 * nothing about WHY a number moved.
 *
 * Shape, not filenames. Section 17 of the brief is right that a hard-coded
 * chunk name is brittle — Vite hashes them and may rename them — so the
 * payload chunk is found by what it EXPORTS, which is a property of the module
 * and survives every renaming.
 *
 * Every assertion is named, and the floors come first: a run that examined
 * nothing must fail as loudly as one that found something, which is the
 * lesson an empty dist/ taught this repository when it passed the data gate
 * and printed "publishable".
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * How big the startup chunk is allowed to get, per profile.
 *
 * A ceiling rather than an exact number: the point is to notice a megabyte of
 * data coming back, not to fail every time a component is added. Both sit
 * comfortably above today's build and far below a build carrying the sections
 * — which was 1,158,369 bytes and is the number these exist to keep out.
 */
export const STARTUP_CEILING = {
  public: 700_000,
  'refs-only': 700_000,
};

/** Below this, the payload chunk under `public` is not carrying the sections. */
const PUBLIC_PAYLOAD_FLOOR = 400_000;

/**
 * Is this reference to a chunk a static import or a dynamic one?
 *
 * Reads the code immediately before the quoted specifier. Vite writes a static
 * dependency as `from"./x.js"` or as a bare `import"./x.js"`, and a deferred
 * one as `import("./x.js")` — usually wrapped in its preload helper, which
 * still contains the parenthesis. Looking at the few characters in front of
 * the name is exact enough to tell them apart and does not require parsing a
 * minified module.
 *
 * Exported because a regex nobody can test is a decoration.
 */
export function referenceKind(source, index) {
  // Enough to reach back past `__vitePreload(()=>import("./` and past a long
  // named-import clause, and no further: this is a local decision.
  const before = source.slice(Math.max(0, index - 80), index);

  // The specifier is quoted and usually prefixed with "./", so every pattern
  // has to allow for what sits between the keyword and the name itself. The
  // first version did not, and read every real static import as `unknown` —
  // which still FAILED the build, because unknown is not waived, but said the
  // wrong thing about why. Found by the test, before it could mislead anyone.
  // Backticks included, because that is what Vite actually writes for a
  // dynamic specifier: `import(\`./chunk.js\`)`. Read off the built bundle,
  // not guessed — the quoted-only version failed on the first real build.
  if (/\bimport\s*\(\s*["'`][^"'`]*$/.test(before)) return 'dynamic';
  if (/\bfrom\s*["'`][^"'`]*$/.test(before)) return 'static';
  if (/\bimport\s*["'`][^"'`]*$/.test(before)) return 'static';

  // A bare occurrence inside a preload map or a string table is a reference to
  // the file, not an import of it — the helper takes it as data and calls
  // import() on it. Anything genuinely unrecognised is reported as such rather
  // than assumed harmless, and the caller treats it as a failure.
  return /__vitePreload\s*\(/.test(before) ? 'dynamic' : 'unknown';
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

function parseArgs(argv) {
  const args = { profile: process.env.DATA_PROFILE ?? 'public', dist: 'dist' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile') args.profile = argv[i + 1];
    if (argv[i] === '--dist') args.dist = argv[i + 1];
  }
  return args;
}

async function main() {
  const { profile, dist } = parseArgs(process.argv.slice(2));
  const distDir = resolve(ROOT, dist);
  const failures = [];

  const files = await collectFiles(distDir);
  const scripts = files.filter((file) => /\.(js|mjs)$/.test(file));

  console.log(`Verifying startup shape for DATA_PROFILE=${profile} against ${dist}/`);
  console.log(`  ${files.length} files, ${scripts.length} scripts\n`);

  // ---- 1. Floors. Nothing below means anything without these. ----
  const indexHtml = files.find((file) => /(^|\/)index\.html$/.test(relative(distDir, file)));
  if (!indexHtml) failures.push({ assertion: 'STARTUP_WAS_READ', detail: `no index.html in ${dist}/` });
  if (scripts.length < 5) {
    failures.push({
      assertion: 'STARTUP_WAS_READ',
      detail: `${scripts.length} scripts in ${dist}/ — is this a real build?`,
    });
  }

  const html = indexHtml ? await readFile(indexHtml, 'utf8') : '';
  // The module the browser is told to run. Everything it statically imports is
  // startup, by definition.
  const entryName = html.match(/<script[^>]+type="module"[^>]+src="[^"]*?\/?([^"/]+\.js)"/)?.[1];
  const entryFile = entryName
    ? scripts.find((file) => file.endsWith(`/${entryName}`))
    : undefined;
  if (!entryFile) {
    failures.push({
      assertion: 'STARTUP_WAS_READ',
      detail: 'could not find the entry module index.html points at',
    });
  }

  const sources = new Map();
  for (const file of scripts) sources.set(file, await readFile(file, 'utf8'));

  // ---- 2. Exactly one chunk is the divisions. ----
  // Found by its export, not its name: `export{e as outlines}` is what the
  // generated module IS, and it survives every hash and every rename.
  const payloads = scripts.filter((file) => /\bas outlines\b/.test(sources.get(file)));
  if (payloads.length !== 1) {
    failures.push({
      assertion: 'SECTIONS_NOT_DUPLICATED',
      detail:
        payloads.length === 0
          ? 'no chunk exports `outlines` — the section module is gone or was inlined into another chunk'
          : `${payloads.length} chunks export \`outlines\`: ${payloads
              .map((file) => relative(distDir, file))
              .join(', ')}`,
    });
  }

  const payload = payloads[0];
  const payloadName = payload ? payload.split('/').pop() : null;
  const payloadBytes = payload ? sources.get(payload).length : 0;

  if (payload && profile === 'public' && payloadBytes < PUBLIC_PAYLOAD_FLOOR) {
    failures.push({
      assertion: 'SECTIONS_PRESENT',
      detail: `the divisions chunk is ${payloadBytes} bytes, expected at least ${PUBLIC_PAYLOAD_FLOOR} under public. Deferring the data is not the same as dropping it.`,
    });
  }

  /*
   * ---- The profile line, read off the shipped chunk. ----
   *
   * A lazily-loaded chunk is published the moment the build is, so the
   * question "does this build carry the other profile's arrangement?" has to
   * be asked of THESE bytes and not of the plugin that wrote them. Both
   * directions, because a check that only forbade would be satisfied by a
   * build that shipped nothing at all — which is how an empty dist/ once
   * passed the data gate.
   *
   * `displayTitle` is the field every outline ENTRY has, and it cannot be
   * absent from a real division set nor present in a profile that ships none.
   * Matched unquoted as well as quoted: the payload is minified, and its
   * object keys lose their quotes. The first version looked for `"entries":[`
   * and found nothing in either profile — it passed a refs-only build that had
   * been deliberately packed with the public data, which is the exact mistake
   * this assertion exists to catch. A check that cannot fail is decoration.
   */
  if (payload) {
    const carriesDivisions = /["']?displayTitle["']?\s*:/.test(sources.get(payload));
    if (profile === 'refs-only' && carriesDivisions) {
      failures.push({
        assertion: 'PROFILE_ISOLATED',
        detail:
          'the refs-only divisions chunk carries outline entries. refs-only ships NO division data — not a copy with the titles stripped, because the arrangement is the substance. See DATA-LICENSE.md.',
      });
    }
    if (profile === 'public' && !carriesDivisions) {
      failures.push({
        assertion: 'PROFILE_ISOLATED',
        detail: 'the public divisions chunk carries no outline entries at all',
      });
    }
  }

  // ---- 3. Nothing statically imports it. ----
  if (payload && payloadName) {
    for (const [file, source] of sources) {
      if (file === payload) continue;
      let at = source.indexOf(payloadName);
      while (at !== -1) {
        const kind = referenceKind(source, at);
        if (kind !== 'dynamic') {
          failures.push({
            assertion: 'SECTIONS_OFF_STARTUP',
            detail: `${relative(distDir, file)} refers to ${payloadName} as a ${kind} import — it must be reached only by import()`,
          });
        }
        at = source.indexOf(payloadName, at + 1);
      }
    }

    // Vite preloads what the entry statically depends on. A modulepreload for
    // the divisions would mean the browser fetches them before first paint,
    // which is the cost this whole lane removes — even though nothing would
    // have "imported" them.
    if (html.includes(payloadName)) {
      failures.push({
        assertion: 'SECTIONS_OFF_STARTUP',
        detail: `index.html references ${payloadName}; the divisions must not be preloaded`,
      });
    }
  }

  // ---- 4. The startup chunk stays small. ----
  if (entryFile) {
    const bytes = sources.get(entryFile).length;
    const ceiling = STARTUP_CEILING[profile] ?? STARTUP_CEILING.public;
    console.log(`  startup chunk ${relative(distDir, entryFile)} — ${bytes} bytes (ceiling ${ceiling})`);
    if (payload) console.log(`  divisions chunk ${relative(distDir, payload)} — ${payloadBytes} bytes`);
    if (bytes > ceiling) {
      failures.push({
        assertion: 'STARTUP_UNDER_BUDGET',
        detail: `the startup chunk is ${bytes} bytes, over the ${ceiling} ceiling for ${profile}`,
      });
    }
  }

  console.log('');
  if (failures.length > 0) {
    const byAssertion = new Map();
    for (const failure of failures) {
      if (!byAssertion.has(failure.assertion)) byAssertion.set(failure.assertion, []);
      byAssertion.get(failure.assertion).push(failure.detail);
    }
    for (const [assertion, details] of byAssertion) {
      console.error(`  ${assertion} FAILED`);
      for (const detail of details) console.error(`    - ${detail}`);
    }
    console.error('\nThe startup path is not what this build claims.');
    process.exit(1);
  }

  console.log('  STARTUP_WAS_READ        entry module found and read');
  console.log('  SECTIONS_NOT_DUPLICATED exactly one chunk carries the divisions');
  console.log('  SECTIONS_PRESENT        that chunk carries what this profile ships');
  console.log('  PROFILE_ISOLATED        and carries nothing the other profile ships');
  console.log('  SECTIONS_OFF_STARTUP    reached only by import(), and never preloaded');
  console.log('  STARTUP_UNDER_BUDGET    the startup chunk is within its ceiling');
  console.log('\nFast Capture does not wait for Scripture data.');
}

// Importable for its own unit tests without running the verifier.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
