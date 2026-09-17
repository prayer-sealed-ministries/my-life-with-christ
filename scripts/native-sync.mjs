#!/usr/bin/env node
/**
 * Copy verified web assets into the native projects, and refuse otherwise.
 *
 * This wraps `cap sync` rather than aliasing it. The Capacitor CLI copies
 * whatever is in `dist/` without knowing which data profile produced it, so
 * calling it directly is the one step that could put purchased Blueprint
 * material inside an iOS or Android application.
 *
 * Three refusals, in order of how likely the mistake is:
 *
 *   1. No marker — `dist/` was built by something other than `native:assets`,
 *      most likely a plain `npm run build`, which defaults to `full`.
 *   2. Marker says a profile other than `public`.
 *   3. Marker does not match what is on disk — a rebuild happened after the
 *      verification, so the bytes about to be copied are not the bytes that
 *      were proved.
 *
 * The third is the subtle one and the reason the marker records a fingerprint
 * rather than just a profile name. "It was verified at some point" is not the
 * claim that matters; "these exact files were verified" is.
 *
 * After copying, the assets are verified AGAIN where they now live, because
 * `dist/` and `ios/App/App/public` are different directories and only the
 * second one ships.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MARKER, NATIVE_PROFILE } from './native-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Where Capacitor puts the copied assets on each platform. */
export const COPIED_ASSETS = {
  ios: join('ios', 'App', 'App', 'public'),
  android: join('android', 'app', 'src', 'main', 'assets', 'public'),
};

const fail = (message) => {
  console.error(`\nRefusing to sync native assets.\n\n${message}\n`);
  process.exit(1);
};

/** Must exclude the marker exactly as native-assets.mjs does, or it never matches. */
function fingerprint(directory, exclude) {
  let files = 0;
  let bytes = 0;
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      if (at === directory && name === exclude) continue;
      const path = join(at, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else {
        files += 1;
        bytes += info.size;
      }
    }
  };
  walk(directory);
  return { files, bytes };
}

function requireVerifiedAssets() {
  const markerPath = join(dist, MARKER);

  if (!existsSync(markerPath)) {
    fail(
      `dist/ carries no verification marker.\n\n` +
        `It was probably built by \`npm run build\`, which defaults to the \`full\`\n` +
        `profile and contains the purchased [licensed content removed].\n\n` +
        `Run: npm run native:assets`,
    );
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch {
    fail('The verification marker is unreadable. Run: npm run native:assets');
  }

  if (marker.profile !== NATIVE_PROFILE) {
    fail(
      `dist/ was built with DATA_PROFILE=${marker.profile}, not ${NATIVE_PROFILE}.\n\n` +
        `Only \`${NATIVE_PROFILE}\` may be packaged. See DATA-LICENSE.md.`,
    );
  }

  const actual = fingerprint(dist, MARKER);
  if (actual.files !== marker.files || actual.bytes !== marker.bytes) {
    fail(
      `dist/ has changed since it was verified.\n\n` +
        `  verified: ${marker.files} files, ${marker.bytes} bytes\n` +
        `  on disk:  ${actual.files} files, ${actual.bytes} bytes\n\n` +
        `Something rebuilt dist/ after verification, so the bytes about to be\n` +
        `copied are not the bytes that were proved. Run: npm run native:assets`,
    );
  }

  return marker;
}

function main() {
  const marker = requireVerifiedAssets();
  console.log(`\ndist/ verified as \`${marker.profile}\` at ${marker.verifiedAt}. Syncing.\n`);

  execFileSync('npx', ['cap', 'sync'], { cwd: root, stdio: 'inherit' });

  // Verify where the assets now live. dist/ and the native trees are different
  // directories, and only the second kind ships.
  for (const [platform, relative] of Object.entries(COPIED_ASSETS)) {
    const copied = join(root, relative);
    if (!existsSync(copied)) {
      console.log(`  ${platform}: not generated, skipping`);
      continue;
    }
    console.log(`\nVerifying copied ${platform} assets at ${relative}\n`);
    execFileSync(
      'node',
      ['scripts/verify-bundle.mjs', '--profile', NATIVE_PROFILE, '--dist', copied],
      { cwd: root, stdio: 'inherit' },
    );
  }

  console.log('\nNative assets synced and verified on every generated platform.\n');
}

if (process.argv[1] && process.argv[1].endsWith('native-sync.mjs')) main();
