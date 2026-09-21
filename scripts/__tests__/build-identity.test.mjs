import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BUILD_ID_FILENAME,
  MINIMUM_FILES,
  MISMATCH,
  computeBuildDigest,
  readBuildMarker,
  verifyServedBuild,
  writeBuildMarker,
} from '../lib/build-identity.mjs';

/**
 * Proof that the e2e freshness guard is real.
 *
 * The guard exists because a stale `vite preview` server was silently adopted
 * and the suite spent a whole session proving things about hours-old bytes. A
 * guard written in response to that has to answer the question this repository
 * asks of every check: can it fail?
 *
 * So both halves are proved here, against real HTTP servers rather than a
 * mocked fetch — the fetch, the URL construction and the JSON parse are part
 * of what could be wrong:
 *
 *   A. a server serving the intended build passes
 *   B. a server serving a DIFFERENT build is rejected, before any spec runs
 *
 * Nothing here depends on timing. Each server is awaited into the listening
 * state and given an ephemeral port, so there is no sleep, no retry and no
 * port to collide over.
 */

/** Enough files to clear the floor, shaped like a real build. */
async function makeBuild(directory, { marker = 'alpha' } = {}) {
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><html><head><script type="module" src="/assets/app-${marker}.js"></script></head><body><div id="root"></div></body></html>`,
  );
  await writeFile(join(directory, `assets/app-${marker}.js`), `export const build = ${JSON.stringify(marker)};`);
  await writeFile(join(directory, 'assets/style.css'), 'body{margin:0}');
  await writeFile(join(directory, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(directory, 'robots.txt'), 'User-agent: *\n');
  for (const book of ['genesis', 'matthew', 'john', 'romans']) {
    await writeFile(join(directory, `assets/${book}-${marker}.js`), `export default ${JSON.stringify(book)};`);
  }
  return directory;
}

/** A real static server over a directory, listening before this resolves. */
async function serve(directory) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
    try {
      const body = await readFile(join(directory, path || 'index.html'));
      response.writeHead(200, { 'content-type': path.endsWith('.json') ? 'application/json' : 'text/plain' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { baseURL: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => server.close(d)) };
}

describe('the build identity itself', () => {
  let scratch;
  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'build-identity-'));
  });

  it('is stable across two digests of the same bytes', async () => {
    const directory = await makeBuild(join(scratch, 'stable'));
    const first = await computeBuildDigest(directory);
    const second = await computeBuildDigest(directory);
    expect(first.digest).toBe(second.digest);
    // The floor: a digest over nothing is stable too, and means nothing.
    expect(first.files).toBeGreaterThanOrEqual(MINIMUM_FILES);
  });

  it('changes when one byte of one chunk changes', async () => {
    const directory = await makeBuild(join(scratch, 'onebyte'));
    const before = await computeBuildDigest(directory);
    await writeFile(join(directory, 'assets/style.css'), 'body{margin:1px}');
    const after = await computeBuildDigest(directory);
    expect(after.digest).not.toBe(before.digest);
  });

  it('excludes the markers written into the directory it describes', async () => {
    const directory = await makeBuild(join(scratch, 'markers'));
    const bare = await computeBuildDigest(directory);
    await writeBuildMarker(directory, { profile: 'public', base: '/' });
    await writeFile(join(directory, 'native-assets.json'), '{"profile":"public"}');
    const stamped = await computeBuildDigest(directory);
    // A marker that counted itself could never match itself; this repository
    // has already shipped that bug once, in native-assets.mjs.
    expect(stamped.digest).toBe(bare.digest);
  });

  it('carries nothing private — no paths, no branch, no author, no machine', async () => {
    const directory = await makeBuild(join(scratch, 'private'));
    await writeBuildMarker(directory, { profile: 'public', base: '/' });
    const raw = await readFile(join(directory, BUILD_ID_FILENAME), 'utf8');
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['base', 'bytes', 'digest', 'files', 'profile']);
    expect(raw).not.toContain(scratch);
    expect(raw).not.toMatch(/\/Users\/|\/home\/|@|refs\/heads/);
  });
});

describe('a server serving the intended build', () => {
  let scratch;
  let fresh;
  let running;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'build-fresh-'));
    fresh = await makeBuild(join(scratch, 'dist'));
    await writeBuildMarker(fresh, { profile: 'public', base: '/' });
    running = await serve(fresh);
  });

  afterAll(async () => {
    await running?.close();
    await rm(scratch, { recursive: true, force: true });
  });

  it('passes, and says what it verified', async () => {
    const served = await verifyServedBuild({ distDir: fresh, baseURL: running.baseURL });
    const expected = await readBuildMarker(fresh);
    expect(served.digest).toBe(expected.digest);
    expect(served.profile).toBe('public');
    expect(served.files).toBeGreaterThanOrEqual(MINIMUM_FILES);
  });

  it('passes when the run names the profile the server is serving', async () => {
    await expect(
      verifyServedBuild({ distDir: fresh, baseURL: running.baseURL, expectProfile: 'public' }),
    ).resolves.toBeTruthy();
  });
});

describe('a server serving a stale or mismatched build is rejected', () => {
  let scratch;
  let fresh;
  let stale;
  let staleServer;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'build-stale-'));
    // Two genuinely different builds, exactly as a rebuild produces: different
    // chunk hashes, a different index.html pointing at them.
    fresh = await makeBuild(join(scratch, 'dist'), { marker: 'new' });
    await writeBuildMarker(fresh, { profile: 'public', base: '/' });

    stale = await makeBuild(join(scratch, 'old-dist'), { marker: 'old' });
    await writeBuildMarker(stale, { profile: 'public', base: '/' });

    staleServer = await serve(stale);
  });

  afterAll(async () => {
    await staleServer?.close();
    await rm(scratch, { recursive: true, force: true });
  });

  // THE case. This is the failure that actually happened, reproduced exactly:
  // dist/ holds the build this run meant to test, and the thing answering on
  // the port is an older one.
  it('rejects a stale build with a message naming the cause', async () => {
    const failure = await verifyServedBuild({ distDir: fresh, baseURL: staleServer.baseURL }).catch((e) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain(MISMATCH);
    expect(failure.message).toContain('digest:');
    expect(failure.message).toMatch(/stale preview server/);
  });

  it('rejects a server built with the other data profile', async () => {
    const otherProfile = await makeBuild(join(scratch, 'refs-dist'), { marker: 'new' });
    await writeBuildMarker(otherProfile, { profile: 'refs-only', base: '/' });
    const server = await serve(otherProfile);
    try {
      // Same bytes, different profile stamp: the digests agree and only the
      // profile catches it. This is the `public`/`refs-only` mix-up.
      const failure = await verifyServedBuild({ distDir: fresh, baseURL: server.baseURL }).catch((e) => e);
      expect(failure.message).toContain(MISMATCH);
      expect(failure.message).toContain('built public, server is serving refs-only');
    } finally {
      await server.close();
    }
  });

  it('rejects a server whose profile is not the one this run asked for', async () => {
    const server = await serve(fresh);
    try {
      const failure = await verifyServedBuild({
        distDir: fresh,
        baseURL: server.baseURL,
        expectProfile: 'refs-only',
      }).catch((e) => e);
      expect(failure.message).toContain('this run asked for refs-only, server is serving public');
    } finally {
      await server.close();
    }
  });

  it('rejects something that is listening but is not this project at all', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'not-ours-'));
    const server = await serve(empty);
    try {
      const failure = await verifyServedBuild({ distDir: fresh, baseURL: server.baseURL }).catch((e) => e);
      expect(failure.message).toContain(MISMATCH);
      expect(failure.message).toMatch(/Could not read/);
    } finally {
      await server.close();
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('rejects a dist/ that changed after it was stamped', async () => {
    const drifted = await makeBuild(join(scratch, 'drifted'), { marker: 'new' });
    await writeBuildMarker(drifted, { profile: 'public', base: '/' });
    const server = await serve(drifted);
    try {
      // A rebuild that started after the server did: the server holds the old
      // bytes, the marker describes the new ones, and without this the digest
      // comparison would be between the marker and itself.
      await writeFile(join(drifted, 'assets/style.css'), 'body{margin:2px}');
      const failure = await verifyServedBuild({ distDir: drifted, baseURL: server.baseURL }).catch((e) => e);
      expect(failure.message).toContain(MISMATCH);
      expect(failure.message).toMatch(/has changed since it was built/);
    } finally {
      await server.close();
    }
  });

  it('refuses a build too small to be a build, rather than comparing nothing', async () => {
    const tiny = await mkdtemp(join(tmpdir(), 'tiny-'));
    await writeFile(join(tiny, 'index.html'), '<!doctype html>');
    await writeBuildMarker(tiny, { profile: 'public', base: '/' });
    const server = await serve(tiny);
    try {
      const failure = await verifyServedBuild({ distDir: tiny, baseURL: server.baseURL }).catch((e) => e);
      expect(failure.message).toContain('NULL MEASUREMENT');
    } finally {
      await server.close();
      await rm(tiny, { recursive: true, force: true });
    }
  });

  it('refuses a directory with no marker rather than assuming it is fine', async () => {
    const unstamped = await makeBuild(await mkdtemp(join(tmpdir(), 'unstamped-')));
    const server = await serve(unstamped);
    try {
      const failure = await verifyServedBuild({ distDir: unstamped, baseURL: server.baseURL }).catch((e) => e);
      expect(failure.message).toContain(BUILD_ID_FILENAME);
      expect(failure.message).toMatch(/vite\.config\.ts|npm run build/);
    } finally {
      await server.close();
      await rm(unstamped, { recursive: true, force: true });
    }
  });
});

/**
 * The guard is only a guard if it is wired in.
 *
 * `src/lib/attribution.ts` was written, exported, unit-tested, passing — and
 * called by nothing. Every test above would still pass with the plugin
 * unregistered and `reuseExistingServer` back to true.
 */
describe('the freshness guard is actually wired in', () => {
  const root = resolve(process.cwd());
  const playwrightConfig = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
  const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');

  it('registers the build-id plugin, so every build is stamped', () => {
    expect(viteConfig).toMatch(/vite-plugin-build-id\.mjs/);
    expect(viteConfig).toMatch(/plugins:\s*\[[^\]]*buildId\(\)/s);
  });

  it('never reuses a server it did not start, in any environment', () => {
    expect(playwrightConfig).toMatch(/reuseExistingServer:\s*false/);
    // The exact regression: true off CI was what adopted the stale server.
    expect(playwrightConfig).not.toMatch(/reuseExistingServer:\s*!?\s*(process\.env\.CI|true)/);
  });

  it('runs the identity check before any spec', () => {
    expect(playwrightConfig).toMatch(/globalSetup:\s*'\.\/tests\/e2e\/global-setup\.ts'/);
    const setup = readFileSync(join(root, 'tests/e2e/global-setup.ts'), 'utf8');
    expect(setup).toMatch(/verifyServedBuild/);
    expect(setup).toMatch(/DATA_PROFILE/);
  });

  it('never kills a process it did not start', () => {
    // Killing processes the harness did not start is not a freshness
    // mechanism; it is a way to end somebody else's afternoon. Comment lines
    // are stripped first — the sweep explains at length why it no longer does
    // this, and a guard that forbade the word would forbid the explanation.
    const executable = (source) =>
      source
        .split('\n')
        .filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line))
        .join('\n');

    const sweep = readFileSync(join(root, 'scripts/e2e-sweep.sh'), 'utf8');
    expect(executable(sweep)).not.toMatch(/pkill|killall/);
    expect(executable(playwrightConfig)).not.toMatch(/pkill|killall/);

    // The floor: stripping comments must not have stripped the whole file,
    // which would make both assertions above pass over an empty string.
    expect(executable(sweep).trim().length).toBeGreaterThan(400);
  });
});
