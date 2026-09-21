/**
 * Stamp every build with a content digest, so the e2e harness can prove which
 * bytes a server is handing out.
 *
 * Written in `closeBundle` rather than `generateBundle`: the digest must cover
 * everything the server will serve, and `public/` is copied into the output
 * directory outside the module graph. Hashing the rollup bundle alone would
 * miss exactly the files Vite copies verbatim.
 *
 * See scripts/lib/build-identity.mjs for why this is not the same marker as
 * `native-assets.json`, and why it is a digest rather than a commit SHA.
 */

import { resolve } from 'node:path';

import { writeBuildMarker } from './lib/build-identity.mjs';
import { resolveProfile } from './vite-plugin-data-profile.mjs';

/** @param {{profile?: string}} options */
export default function buildIdPlugin(options = {}) {
  // One resolver, shared with the data-profile plugin. Two answers to "which
  // profile is this" is how a marker starts describing a different build from
  // the one it sits in.
  const profile = resolveProfile(options.profile);
  let outDir = 'dist';
  let base = '/';

  return {
    name: 'journey:build-id',
    apply: 'build',

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },

    async closeBundle() {
      const marker = await writeBuildMarker(outDir, { profile, base });
      this.info?.(
        `build id ${marker.digest.slice(0, 12)} — ${marker.files} files, profile ${marker.profile}`,
      );
    },
  };
}
