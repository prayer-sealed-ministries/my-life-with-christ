/**
 * Proving that the server an e2e run talks to is serving the build that run
 * meant to test.
 *
 * This exists because of a real failure, and the failure was persuasive rather
 * than obvious. A `vite preview` server left running from an earlier session
 * was still listening on 4173. Playwright's `reuseExistingServer` was true off
 * CI, so it probed the URL, found something answering, and adopted it. The
 * suite then ran against a bundle built hours earlier: ordinary text search
 * worked, every Scripture-anchor query returned nothing, and the whole thing
 * read exactly like a product defect in the feature under development. It was
 * not. A "124 passed" run had proved something true about the wrong bytes.
 *
 * The lesson is the one this repository keeps relearning: a check that cannot
 * say WHAT it examined is not a check. "The build ran first" is not evidence
 * about what the listening socket is handing out, and neither is a 200 on the
 * health probe.
 *
 * So every build stamps a content digest into `dist/build-id.json`, and the
 * e2e harness refuses to run until the server hands back the same one.
 *
 * Why a digest and not a timestamp or a git SHA:
 *
 *   - A timestamp makes two identical builds differ, so it would raise alarms
 *     that mean nothing while proving nothing extra.
 *   - A commit SHA describes the source, not the artefact. A dirty tree, a
 *     half-finished rebuild and a stale `dist/` all carry the same SHA.
 *   - A digest over the built bytes answers the only question being asked:
 *     are these the files the run intended? It is also not private data —
 *     no paths outside the build, no branch names, no author, nothing about
 *     the machine. See the note on `native-assets.json` below.
 *
 * This is deliberately NOT the same marker as `native-assets.json`. That one
 * answers "did these bytes pass the data gate", is written only after the
 * verifier has run, and is the thing standing between an unverified build and
 * an app store. This one answers "is the server serving these bytes", is
 * written by every build including ones that were never gated, and is a test
 * harness concern. Collapsing them would weaken the first to serve the second.
 * They share nothing but the directory, and both are excluded from the digest
 * for the same reason: a marker written into the directory it describes cannot
 * be part of what it describes.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { MARKER as NATIVE_MARKER } from '../native-assets.mjs';

/** Written into `dist/` by the build. Read by the e2e harness, by nothing else. */
export const BUILD_ID_FILENAME = 'build-id.json';

/**
 * Files that live in `dist/` but are not part of what it serves.
 *
 * Both are markers describing the directory they sit in. Including either in
 * the digest would mean the digest could never match itself.
 */
export const NOT_PART_OF_THE_BUILD = [BUILD_ID_FILENAME, NATIVE_MARKER];

/**
 * A floor, in the sense this repository means it.
 *
 * Every comparison below is "these two digests are equal", and two empty
 * directories agree perfectly. An empty `dist/` has already passed a gate in
 * this repository once; it is not a hypothetical.
 */
export const MINIMUM_FILES = 8;

async function collectFiles(directory, out = []) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, item.name);
    if (item.isDirectory()) await collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * A content digest over everything the build actually serves.
 *
 * Path as well as content, so moving a chunk to a different name is a
 * different build — which it is, since `index.html` would then point somewhere
 * else.
 */
export async function computeBuildDigest(distDir) {
  const all = await collectFiles(distDir);
  const lines = [];
  let bytes = 0;

  for (const file of all) {
    const path = relative(distDir, file).split(sep).join('/');
    if (NOT_PART_OF_THE_BUILD.includes(path)) continue;
    const content = await readFile(file);
    bytes += content.byteLength;
    lines.push(`${path}:${createHash('sha256').update(content).digest('hex')}`);
  }

  lines.sort();
  return {
    digest: createHash('sha256').update(lines.join('\n')).digest('hex'),
    files: lines.length,
    bytes,
  };
}

/** Stamp a freshly built directory. Called by the Vite plugin, on every build. */
export async function writeBuildMarker(distDir, { profile, base }) {
  const { digest, files, bytes } = await computeBuildDigest(distDir);
  const marker = { profile, base, digest, files, bytes };
  await writeFile(join(distDir, BUILD_ID_FILENAME), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

export async function readBuildMarker(distDir) {
  const path = join(distDir, BUILD_ID_FILENAME);
  if (!existsSync(path)) {
    throw new Error(
      `No ${BUILD_ID_FILENAME} in ${distDir}. That directory was not produced by this ` +
        `project's build, or the build-id plugin is no longer registered in vite.config.ts. ` +
        `Run: npm run build`,
    );
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * The comparison itself, kept pure so it can be proved without a socket.
 *
 * Returns the list of problems rather than throwing, so a caller can report
 * all of them at once — "wrong profile AND wrong digest" is a more useful
 * sentence than either half.
 */
export function compareBuildIdentity({ expected, served, expectProfile }) {
  const problems = [];

  if (!served || typeof served.digest !== 'string') {
    problems.push('the server returned no build id at all');
    return problems;
  }
  if (served.digest !== expected.digest) {
    problems.push(
      `digest: expected ${expected.digest.slice(0, 16)}… (${expected.files} files), ` +
        `server is serving ${served.digest.slice(0, 16)}… (${served.files} files)`,
    );
  }
  if (served.profile !== expected.profile) {
    problems.push(`profile: built ${expected.profile}, server is serving ${served.profile}`);
  }
  if (expectProfile && served.profile !== expectProfile) {
    problems.push(`profile: this run asked for ${expectProfile}, server is serving ${served.profile}`);
  }

  return problems;
}

/** The message the harness fails with. Named so a test can assert on it. */
export const MISMATCH = 'E2E server build does not match expected revision';

/**
 * Fail closed unless the server at `baseURL` is serving the build in `distDir`.
 *
 * Order matters. The floors come first: a digest comparison between two things
 * that examined nothing passes, and that is the shape of every bug this file
 * is here to prevent.
 */
export async function verifyServedBuild({
  distDir,
  baseURL,
  expectProfile,
  fetchImpl = fetch,
}) {
  const expected = await readBuildMarker(distDir);

  if (expected.files < MINIMUM_FILES) {
    throw new Error(
      `NULL MEASUREMENT: ${distDir} claims ${expected.files} files, expected at least ` +
        `${MINIMUM_FILES}. Comparing a digest of nothing against a digest of nothing passes.`,
    );
  }

  // Has dist/ moved since it was stamped? A rebuild that began after the
  // server started would leave the server on the old bytes and the marker on
  // the new ones, and the check below would pass while being wrong about both.
  const onDisk = await computeBuildDigest(distDir);
  if (onDisk.digest !== expected.digest) {
    throw new Error(
      `${MISMATCH}\n\n` +
        `  ${distDir} has changed since it was built:\n` +
        `    stamped: ${expected.digest.slice(0, 16)}… (${expected.files} files)\n` +
        `    on disk: ${onDisk.digest.slice(0, 16)}… (${onDisk.files} files)\n\n` +
        `  Something rebuilt or edited the directory after the build. Run: npm run build`,
    );
  }

  const url = `${baseURL.replace(/\/$/, '')}${expected.base ?? '/'}${BUILD_ID_FILENAME}`;

  let served;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    served = await response.json();
  } catch (cause) {
    throw new Error(
      `${MISMATCH}\n\n` +
        `  Could not read ${url}: ${cause instanceof Error ? cause.message : cause}\n\n` +
        `  Something is listening on ${baseURL} that is not this project's build — most\n` +
        `  likely a preview or dev server left running from earlier work.`,
    );
  }

  const problems = compareBuildIdentity({ expected, served, expectProfile });
  if (problems.length > 0) {
    throw new Error(
      `${MISMATCH}\n\n` +
        problems.map((problem) => `  - ${problem}`).join('\n') +
        `\n\n  The server on ${baseURL} is not serving ${distDir}. A stale preview server\n` +
        `  answering on the port will produce results that look like product defects.\n` +
        `  Stop it, rebuild, and run again.`,
    );
  }

  return { ...served, url };
}
