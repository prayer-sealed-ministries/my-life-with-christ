#!/usr/bin/env node
/**
 * Build the web assets a native app ships, and prove them before anything
 * copies them.
 *
 * WHY THIS IS A SCRIPT AND NOT A LINE IN package.json
 *
 * `npx cap sync` copies whatever is sitting in `dist/`. It does not know or care
 * which DATA_PROFILE produced it. `dist/` holds whichever profile was built
 * last, and a build made without a stated profile is not necessarily the one
 * that should be shipped.
 * So the realistic accident is not someone deciding to ship purchased material;
 * it is someone running `npm run build` to check something, then running
 * `cap sync` an hour later, and quietly packaging the compilation into an app.
 *
 * This script closes that gap by making the build and the proof inseparable:
 *
 *   1. build with DATA_PROFILE=public
 *   2. verify the built files with the existing seven-assertion gate
 *   3. only then write the marker that `native:sync` requires
 *
 * The marker is the mechanism. `scripts/native-sync.mjs` refuses to copy
 * without a fresh one, so a stale or hand-made `dist/` cannot reach a native
 * project even if someone calls the Capacitor CLI directly through the wrapper.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** The only profile a store build may carry. See DATA-LICENSE.md. */
export const NATIVE_PROFILE = 'public';

/** Written by this script; required by native-sync.mjs. */
export const MARKER = 'native-assets.json';

const run = (command, args, env = {}) =>
  execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

/**
 * A cheap fingerprint of the build, so a later sync can tell it is the same one.
 *
 * The marker file is excluded, and that is not a detail: the marker is written
 * INTO the directory it describes, so counting it would mean the fingerprint
 * never matched itself. The first version did exactly that and the sync refused
 * its own freshly verified build.
 */
export function fingerprint(directory, exclude) {
  let files = 0;
  let bytes = 0;
  const hash = createHash('sha256');
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      if (at === directory && name === exclude) continue;
      const path = join(at, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else {
        files += 1;
        bytes += info.size;
        hash.update(path.slice(directory.length + 1));
        hash.update('\0');
        hash.update(readFileSync(path));
        hash.update('\0');
      }
    }
  };
  walk(directory);
  return { files, bytes, sha256: hash.digest('hex') };
}

function main() {
  console.log(`\nBuilding native web assets with DATA_PROFILE=${NATIVE_PROFILE}\n`);
  // Never inherit a developer's DEBUG_TOOLS=1 into something eligible for a
  // native marker. Vite checks for exactly "1", so an explicit zero is a
  // release boundary rather than an ambient-shell convention.
  run('npm', ['run', 'build'], { DATA_PROFILE: NATIVE_PROFILE, DEBUG_TOOLS: '0' });

  console.log('\nVerifying the built assets before anything may copy them\n');
  // The same verifier CI runs. If purchased material is present this throws and
  // no marker is written, so `native:sync` will refuse to run.
  run('node', ['scripts/verify-bundle.mjs', '--profile', NATIVE_PROFILE, '--dist', dist]);

  const stamp = {
    profile: NATIVE_PROFILE,
    // Recorded as well as enforced above: the marker describes the security-
    // relevant build branch whose exact bytes were verified.
    debugTools: false,
    verifiedAt: new Date().toISOString(),
    ...fingerprint(dist, MARKER),
  };

  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, MARKER), `${JSON.stringify(stamp, null, 2)}\n`);

  console.log(`\nVerified. ${stamp.files} files, ${Math.round(stamp.bytes / 1024)}kB.`);
  console.log('Native assets may now be synced.\n');
}

if (process.argv[1] && process.argv[1].endsWith('native-assets.mjs')) main();
