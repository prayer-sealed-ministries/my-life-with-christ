import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MARKER, NATIVE_PROFILE } from '../native-assets.mjs';
import { COPIED_ASSETS } from '../native-sync.mjs';

/**
 * Policy tests over the native shells.
 *
 * The web build is gated by workflow-policy.test.mjs, because the realistic
 * accident there is an edit to pages.yml. The native builds have their own
 * version of the same problem, and it is worse in one respect: an App Store or
 * Play build is not revocable the way a Pages deploy is. Once a binary carrying
 * licensed third-party data is on a stranger's phone, no amount of
 * unpublishing takes it back.
 *
 * So these assertions hold the four things that cannot be allowed to drift:
 *
 *   - identity   (app id and name, which the stores bind permanently)
 *   - isolation  (no server.url; the app runs from bundled assets or not at all)
 *   - the gate   (only DATA_PROFILE=public may be packaged, and the sync step
 *                 cannot be talked out of proving it)
 *   - the seam   (native storage fails closed, and no view learns where it is)
 *
 * Durable decisions, recorded so a later edit has to argue with a test.
 */

const root = resolve(process.cwd());
const read = (path) => readFileSync(join(root, path), 'utf8');

/**
 * Two budgets, and the child's must be the smaller one.
 *
 * The copied-assets tests shell out to the real verifier over ~100 files and
 * thousands of probes — about 4.4s, against vitest's 5s default, which is how
 * one of them failed once in three full-suite profile sweeps.
 *
 * Raising the test budget alone would not be enough. `execFileSync` is
 * synchronous: a verifier that hangs blocks the worker thread, and vitest
 * cannot interrupt a blocked worker to enforce its own timeout. So the child
 * gets its own, comfortably inside the enclosing one, and a hang fails loudly
 * instead of stalling the suite.
 */
const VERIFIER_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;

/**
 * Run the real verifier and return its output, or throw with enough to diagnose.
 *
 * Every abnormal ending is a failure: a non-zero exit, a timeout, a signal. The
 * child's own output is carried into the message, because "the verifier failed"
 * with nothing else is an hour of someone's evening.
 *
 * One deliberate trade-off, measured rather than assumed: the kill signal is
 * SIGKILL, so termination is guaranteed even for a child that ignores SIGTERM —
 * and a SIGKILLed child flushes nothing, so timeout and signal failures name the
 * cause (`ETIMEDOUT`, `SIGKILL`) but carry no stream tail. Non-zero exits carry
 * both streams in full. For a hang, the fact of the hang is the diagnosis.
 */
function runVerifier(copied) {
  try {
    return execFileSync(
      'node',
      ['scripts/verify-bundle.mjs', '--profile', NATIVE_PROFILE, '--dist', copied],
      {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: VERIFIER_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
    );
  } catch (error) {
    const how = [
      error.status != null ? `exit status ${error.status}` : null,
      error.signal ? `killed by ${error.signal}` : null,
      error.code ? `code ${error.code}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    const tail = (stream) => String(stream ?? '').trim().split('\n').slice(-15).join('\n');
    throw new Error(
      `the verifier did not pass (${how || 'no status reported'})\n` +
        `--- stdout ---\n${tail(error.stdout)}\n--- stderr ---\n${tail(error.stderr)}`,
    );
  }
}

const APP_ID = 'com.myjourneywithchrist.lifewithchrist';
const APP_NAME = 'My Life With Christ';

const capacitorConfig = read('capacitor.config.ts');

describe('the files under test were actually read', () => {
  // Every assertion below is "this string is present" or "this string is
  // absent". The absence ones pass perfectly against an empty file, and the
  // presence ones against a file that happens to mention the right words. These
  // floors are what stop a rename or a deletion from reading as compliance.
  it('read a real Capacitor config', () => {
    expect(capacitorConfig.length).toBeGreaterThan(200);
    expect(capacitorConfig).toContain('CapacitorConfig');
    expect(capacitorConfig).toContain('webDir');
  });

  it('read real native projects', () => {
    expect(existsSync(join(root, 'ios/App/App/Info.plist')), 'no iOS project').toBe(true);
    expect(existsSync(join(root, 'android/app/build.gradle')), 'no Android project').toBe(true);
  });
});

describe('identity is exact, because the stores bind it permanently', () => {
  it('uses the agreed app id everywhere it is declared', () => {
    const declarations = {
      'capacitor.config.ts': capacitorConfig,
      'ios project': read('ios/App/App.xcodeproj/project.pbxproj'),
      'android build.gradle': read('android/app/build.gradle'),
    };

    // A floor: three files must each name the id, so deleting one is a failure
    // rather than a silent reduction in what is checked.
    expect(Object.keys(declarations)).toHaveLength(3);
    for (const [where, text] of Object.entries(declarations)) {
      expect(text, `${where} does not declare ${APP_ID}`).toContain(APP_ID);
    }

    // And nothing may declare a different one. Capacitor's own default is the
    // likeliest wrong value to appear.
    for (const [where, text] of Object.entries(declarations)) {
      expect(text, `${where} still carries a template id`).not.toContain('com.example');
      expect(text, `${where} carries the wrong reverse domain`).not.toMatch(
        /com\.(?!myjourneywithchrist\.lifewithchrist)[a-z]+\.lifewithchrist/,
      );
    }
  });

  it('uses the agreed app name everywhere it is displayed', () => {
    expect(capacitorConfig).toContain(`appName: '${APP_NAME}'`);
    expect(read('ios/App/App/Info.plist')).toContain(APP_NAME);
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(
      `<string name="app_name">${APP_NAME}</string>`,
    );
  });
});

describe('the app runs from bundled assets or not at all', () => {
  it('declares no server block in the Capacitor config', () => {
    // `server.url` points the webview at a website instead of the bundle. It is
    // the normal way to do live-reload development, and the normal way to ship
    // an app that silently stops working offline — or that loads whatever is at
    // that address later. It must never be committed.
    expect(capacitorConfig).not.toMatch(/\bserver\s*:/);
    expect(capacitorConfig).not.toMatch(/\burl\s*:/);
    expect(capacitorConfig).not.toMatch(/cleartext/);
  });

  it('points no committed native config at any remote origin', () => {
    const suspects = [
      'capacitor.config.ts',
      'ios/App/App/Info.plist',
      'android/app/src/main/AndroidManifest.xml',
      'android/app/src/main/res/xml/network_security_config.xml',
    ].filter((path) => existsSync(join(root, path)));

    expect(suspects.length, 'no native config files found to check').toBeGreaterThanOrEqual(3);

    // `https://localhost` is Capacitor's own loopback for the bundled assets and
    // is not a remote origin; everything else named here would be.
    const forbidden = [
      'systemslibrarian.github.io',
      'mylifewithchrist.com/app',
      // The product home was named myjourneywithchrist.com before it was
      // settled as mylifewithchrist.com. Both stay on this list: a retired
      // address is still a remote origin if anything ever points at it.
      'myjourneywithchrist.com/app',
      '192.168.',
      '10.0.2.2',
      'ngrok',
      'http://localhost',
      'https://localhost:',
    ];

    for (const path of suspects) {
      const text = read(path);
      for (const needle of forbidden) {
        expect(text, `${path} points at ${needle}`).not.toContain(needle);
      }
    }
  });
});

describe('only the public profile can be packaged', () => {
  const assets = read('scripts/native-assets.mjs');
  const sync = read('scripts/native-sync.mjs');

  it('builds native assets with DATA_PROFILE=public', () => {
    expect(NATIVE_PROFILE).toBe('public');
    expect(assets).toContain('DATA_PROFILE: NATIVE_PROFILE');
    // The build must be the profile build, not a plain one that inherits
    // whatever DATA_PROFILE happens to be set — which defaults to `full`.
    expect(assets).toMatch(/run\('npm',\s*\['run',\s*'build'\],\s*\{\s*DATA_PROFILE/);
  });

  it('verifies the build before writing the marker that permits a sync', () => {
    const verifyAt = assets.indexOf('verify-bundle.mjs');
    const markerAt = assets.indexOf(`writeFileSync(join(dist, MARKER)`);
    expect(verifyAt).toBeGreaterThan(-1);
    expect(markerAt).toBeGreaterThan(-1);
    // Order is the whole mechanism: a marker written before verification would
    // certify a build nobody checked.
    expect(verifyAt, 'the marker is written before verification').toBeLessThan(markerAt);
  });

  it('refuses to sync without a marker, the right profile, and matching bytes', () => {
    // It imports the marker name rather than repeating the literal, which is
    // what keeps the two scripts from drifting apart.
    expect(sync).toMatch(/import \{[^}]*MARKER[^}]*\} from '\.\/native-assets\.mjs'/);
    expect(MARKER).toBe('native-assets.json');
    expect(sync).toMatch(/marker\.profile !== NATIVE_PROFILE/);
    expect(sync).toMatch(/actual\.files !== marker\.files/);
    expect(sync).toMatch(/actual\.bytes !== marker\.bytes/);

    // Three distinct refusals, each exiting non-zero.
    expect(sync.match(/fail\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sync).toContain('process.exit(1)');
  });

  it('re-verifies the copied assets where they now live', () => {
    const syncAt = sync.indexOf(`'cap', 'sync'`);
    const reverifyAt = sync.lastIndexOf('verify-bundle.mjs');
    expect(syncAt).toBeGreaterThan(-1);
    expect(reverifyAt).toBeGreaterThan(syncAt);
    expect(Object.keys(COPIED_ASSETS).sort()).toEqual(['android', 'ios']);
  });

  it('offers no npm script that copies assets without the wrapper', () => {
    const { scripts } = JSON.parse(read('package.json'));
    const native = Object.entries(scripts).filter(([name]) => name.startsWith('native:'));
    expect(native.length, 'no native scripts found').toBeGreaterThanOrEqual(4);

    for (const [name, body] of native) {
      if (name === 'native:sync' || name === 'native:assets') continue;
      // `cap open` is fine. A bare `cap sync` or `cap copy` is the bypass.
      expect(body, `${name} calls the Capacitor CLI directly`).not.toMatch(
        /cap\s+(sync|copy)/,
      );
      expect(body, `${name} does not route through the wrapper`).toContain('native:sync');
    }
  });
});

describe('the packaged artefacts carry what was verified', () => {
  // These run against the copied assets, which are build output and gitignored.
  // When they are absent the test says so loudly rather than passing quietly —
  // a check that examines nothing is the failure this repository is built
  // around avoiding.
  it('bounds the verifier child inside the enclosing test budget', () => {
    // Not the proof that the guard works — that is done by making a child
    // actually exceed it. This only guards the ordering: a child budget raised
    // above the test budget would put the hang back, because vitest cannot
    // interrupt a synchronous execFileSync.
    expect(VERIFIER_TIMEOUT_MS).toBeLessThan(TEST_TIMEOUT_MS);
  });

  for (const [platform, relative] of Object.entries(COPIED_ASSETS)) {
    it(`${platform}: copied assets pass the data gate`, () => {
      const copied = join(root, relative);
      if (!existsSync(copied)) {
        // Not a pass. Vitest reports this as a failure with a usable message.
        expect.fail(
          `${relative} does not exist, so nothing was verified.\n` +
            `Run: npm run native:assets && npm run native:sync`,
        );
      }

      const count = (function walk(at) {
        return readdirSync(at).reduce((n, name) => {
          const path = join(at, name);
          return n + (statSync(path).isDirectory() ? walk(path) : 1);
        }, 0);
      })(copied);
      expect(count, `${relative} is suspiciously empty`).toBeGreaterThan(20);

      const marker = JSON.parse(readFileSync(join(copied, MARKER), 'utf8'));
      expect(marker.profile).toBe(NATIVE_PROFILE);

      // The real verifier over the real bytes, not a re-implementation of it.
      const output = runVerifier(copied);

      // A floor on the child: exit 0 alone would also be satisfied by a verifier
      // that did nothing. It has to say it passed.
      expect(output).toContain('This build is publishable');
    }, TEST_TIMEOUT_MS);
  }
});

describe('native storage fails closed', () => {
  it('has no sqlite provider registered, so a native build cannot open a journal', async () => {
    const { selectStorageProvider, StorageUnavailableError } = await import(
      '../../src/platform/storage.ts'
    );

    // Phase 1 has no SQLite implementation. This asserts the absence is handled
    // by refusing, not by quietly substituting the webview's IndexedDB.
    expect(() => selectStorageProvider('sqlite', {})).toThrow(StorageUnavailableError);

    let caught;
    try {
      selectStorageProvider('sqlite', {});
    } catch (error) {
      caught = error;
    }
    expect(caught.message).toContain('Nothing has been written');

    // And the substitution specifically must not happen: offering indexeddb
    // when sqlite was asked for is the exact shortcut being forbidden.
    const dexieish = () => ({ kind: 'indexeddb' });
    expect(() => selectStorageProvider('sqlite', { indexeddb: dexieish })).toThrow(
      StorageUnavailableError,
    );
  });

  it('wires the native edition to sqlite, not to whatever is available', () => {
    const runtime = read('src/platform/runtime.ts');
    expect(runtime).toMatch(/isNative\(\)\s*\?\s*'sqlite'\s*:\s*'indexeddb'/);

    // The app must ask the runtime rather than hardcoding a kind.
    const storage = read('src/app/storage.tsx');
    expect(storage).toContain('requiredStorageKind()');
    expect(storage).not.toMatch(/selectStorageProvider\(\s*'indexeddb'/);
  });
});

/**
 * Files outside `src/platform/` that may touch a platform binding.
 *
 * Enumerated rather than pattern-matched, and asserted to be exactly this list:
 * a new file that reaches for Capacitor has to be added here deliberately,
 * where someone will ask why. Both entries are platform *implementations*, not
 * product code — they no more branch on the platform in a view than
 * `db.ts` does by importing Dexie.
 */
const PLATFORM_BINDINGS = [
  // The native storage provider. It imports the SQLite bridge for the same
  // reason db.ts imports Dexie: it is the implementation of a port.
  join('src', 'storage', 'sqlite.ts'),
  // The on-device contract harness, whose whole job is to refuse to run unless
  // it really is on a native platform talking to the real plugin.
  join('src', 'storage', 'native-conformance.ts'),
];

/**
 * A reference to the Capacitor bridge, static or dynamic.
 *
 * Both spellings count. `sqlite.ts` reaches the plugin through
 * `await import('@capacitor-community/sqlite')` precisely so the web bundle
 * never loads it, and a scan that only looked for `from '@capacitor'` would
 * have reported it clean while it was importing the bridge on every line.
 */
const USES_CAPACITOR = /(?:from\s+'@capacitor|import\('@capacitor)/;

describe('no view learns which platform it is on', () => {
  const sourceFiles = (function walk(at) {
    return readdirSync(join(root, at)).flatMap((name) => {
      const relative = join(at, name);
      return statSync(join(root, relative)).isDirectory()
        ? walk(relative)
        : /\.tsx?$/.test(name)
          ? [relative]
          : [];
    });
  })('src');

  it('imports Capacitor only inside the platform layer', () => {
    expect(sourceFiles.length, 'found no source files to scan').toBeGreaterThan(40);

    const offenders = sourceFiles.filter(
      (path) =>
        !path.startsWith(join('src', 'platform')) &&
        !PLATFORM_BINDINGS.includes(path) &&
        USES_CAPACITOR.test(read(path)),
    );
    expect(offenders, 'Capacitor imported outside the platform layer').toEqual([]);

    // The allowlist is exact, so it cannot quietly grow.
    const bindings = sourceFiles.filter(
      (path) => PLATFORM_BINDINGS.includes(path) && USES_CAPACITOR.test(read(path)),
    );
    expect(bindings.sort(), 'the platform-binding allowlist no longer matches reality').toEqual(
      [...PLATFORM_BINDINGS].sort(),
    );

    // A floor on the scan itself: the platform layer really does import it, so
    // a broken regex would show up here rather than as a clean sweep.
    const inside = sourceFiles.filter(
      (path) => path.startsWith(join('src', 'platform')) && USES_CAPACITOR.test(read(path)),
    );
    expect(inside.length, 'the scan matched no Capacitor imports at all').toBeGreaterThanOrEqual(2);
  });

  it('does not sniff the platform in views', () => {
    const views = sourceFiles.filter(
      (path) =>
        !path.startsWith(join('src', 'platform')) &&
        !PLATFORM_BINDINGS.includes(path) &&
        !path.includes('.test.'),
    );
    expect(views.length).toBeGreaterThan(20);

    for (const path of views) {
      const text = read(path);
      expect(text, `${path} sniffs the user agent`).not.toMatch(/navigator\.(userAgent|platform)/);
      expect(text, `${path} branches on the platform`).not.toMatch(
        /\b(isIOS|isAndroid|getPlatform)\b/,
      );
    }
  });

  it('exports no generic platform predicate for the application to reach for', () => {
    const runtime = read('src/platform/runtime.ts');

    // The exported answers must each name the decision they exist to make.
    // A bare `isNative()` is the convenient shape that spreads: it reads as
    // harmless at every individual call site, and the sum of those call sites
    // is journal behaviour forking three ways.
    expect(runtime).toMatch(/^const isNative/m);
    expect(runtime, 'a generic isNative is exported again').not.toMatch(
      /^export\s+(const|function)\s+isNative/m,
    );

    // The floor: the predicate must still exist and still be used internally,
    // or this assertion would be satisfied by deleting the concept entirely and
    // would stop meaning anything.
    expect(runtime).toMatch(/isNative\(\)/);

    // `ports.ts` is the file views actually import. It must offer nothing.
    const ports = read('src/platform/ports.ts');
    expect(ports.length).toBeGreaterThan(500);
    expect(ports).not.toMatch(/^export\s+(const|function|type)\s+(isNative|isIOS|isAndroid)/m);
  });

  it('keeps the platform question to a single consumer outside the layer', () => {
    // `runtime.ts` answers "where am I". Exactly one place outside the platform
    // layer has a legitimate reason to ask: the storage wiring, which must pick
    // a kind. Anything else importing it is the beginning of scattered checks.
    // Tests are excluded: mocking the module is how the fail-closed behaviour is
    // proven, and counting a mock as a consumer would punish the test for
    // existing.
    const consumers = sourceFiles.filter(
      (path) =>
        !path.startsWith(join('src', 'platform')) &&
        !path.includes('.test.') &&
        /platform\/runtime'/.test(read(path)),
    );
    expect(consumers).toEqual([join('src', 'app', 'storage.tsx')]);
  });
});

describe('no signing material or machine-specific state is committable', () => {
  it('ignores every shape of credential a native build produces', () => {
    // Not hypothetical hygiene. An upload keystore cannot simply be rotated
    // once a Play listing exists, and a committed one is a credential leak that
    // survives in history after deletion. The cheapest moment to stop it is
    // before any signing setup happens at all, which is now.
    const candidates = [
      'release.keystore',
      'upload.jks',
      'key.properties',
      'android/key.properties',
      'keystore.properties',
      'android/local.properties',
      'google-services.json',
      'ios/App/App/GoogleService-Info.plist',
      'ios/App/App/profile.mobileprovision',
      'ios/certs/dist.p12',
      'ios/App/App.xcodeproj/xcuserdata/someone.xcuserdatad/x',
    ];

    const notIgnored = candidates.filter((path) => {
      try {
        execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'pipe' });
        return false;
      } catch {
        return true;
      }
    });

    expect(candidates.length).toBeGreaterThanOrEqual(10);
    expect(notIgnored, 'these could be committed').toEqual([]);
  });

  it('has no real signing identity committed in the iOS project', () => {
    const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbxproj.length).toBeGreaterThan(1000);

    // Capacitor's template leaves the generic "iPhone Developer" string, which
    // names nobody. A DEVELOPMENT_TEAM or a provisioning profile would be a
    // specific account, and belongs in local Xcode settings, not in the repo.
    expect(pbxproj).not.toMatch(/DEVELOPMENT_TEAM\s*=\s*[A-Z0-9]{10}/);
    expect(pbxproj).not.toMatch(/PROVISIONING_PROFILE_SPECIFIER\s*=\s*"?\w/);
  });
});

describe('native journal persistence is SQLite, and only SQLite', () => {
  const sqlite = read('src/storage/sqlite.ts');
  const platformStorage = read('src/platform/storage.ts');

  it('registers SQLite for the native edition', () => {
    expect(sqlite.length).toBeGreaterThan(2000);
    expect(platformStorage).toMatch(/sqlite:\s*\(\)\s*=>\s*new SqliteStorageProvider\(\)/);
    // And the mapping still comes from the edition, not from availability.
    expect(read('src/platform/runtime.ts')).toMatch(/isNative\(\)\s*\?\s*'sqlite'\s*:\s*'indexeddb'/);
  });

  it('keeps Dexie out of the SQLite provider entirely', () => {
    // Not a style point: if the native provider imported the Dexie module, the
    // fallback would be one line away from anyone debugging a failure at 2am.
    // Import statements, not prose: sqlite.ts explains itself by referring to
    // Dexie, and a check that banned the word would force the comments out.
    expect(sqlite).not.toMatch(/^import .*from '\.\/db'/m);
    expect(sqlite).not.toMatch(/^import .*\bdexie\b/mi);
    expect(sqlite).not.toMatch(/\bnew DexieStorageProvider\b/);
    expect(sqlite).not.toMatch(/\bindexedDB\./);
  });

  it('shares one description of persistence semantics rather than two', () => {
    // Both providers must derive ordering, defaulting and the query predicate
    // from the same module. Two correct-looking implementations that disagree
    // about a tie-break would put two sermons from one Sunday in a different
    // order on a phone than on a laptop.
    const semantics = read('src/storage/semantics.ts');
    // The shared module must depend on neither engine — again by import, since
    // it names both in its explanation of why it exists.
    expect(semantics).not.toMatch(/^import .*(dexie|@capacitor)/mi);

    for (const [file, text] of [
      ['db.ts', read('src/storage/db.ts')],
      ['sqlite.ts', sqlite],
    ]) {
      expect(text, `${file} does not use the shared semantics`).toMatch(/from '\.\/semantics'/);
      for (const shared of ['chronologically', 'matches', 'entryToCreate', 'applyPatch']) {
        expect(text, `${file} does not share ${shared}`).toContain(shared);
      }
    }

    // One contract, run by both runners.
    expect(read('src/storage/conformance.ts')).toContain('CONTRACT_CASES');
    expect(read('src/storage/native-conformance.ts')).toContain('CONTRACT_CASES');
  });

  it('imports the native bridge lazily, so the web runtime never loads it', () => {
    // A static import would put the plugin in the web bundle for no one's
    // benefit. The factory constructs the provider eagerly; only `open()`
    // reaches for the bridge, and the web edition never opens it.
    expect(sqlite).toMatch(/await import\('@capacitor-community\/sqlite'\)/);
    expect(sqlite).not.toMatch(/^import .*@capacitor-community\/sqlite/m);
  });

  it('opens the database without encryption, and claims nothing more', () => {
    // Turning on SQLCipher would mean owning a key, which means Keychain and
    // Keystore, which is a product decision Phase 2 did not make. The app must
    // not describe the journal as encrypted while it is not.
    expect(sqlite).toMatch(/mode: 'no-encryption'/);
    expect(sqlite).toMatch(/encrypted: false/);
  });

  it('has a schema version and an ordered migration ledger', () => {
    expect(sqlite).toMatch(/SCHEMA_VERSION = \d+/);
    expect(sqlite).toMatch(/const MIGRATIONS: Migration\[\]/);
    // The version is recorded inside the same transaction as the step, which is
    // what stops a failed migration from claiming it succeeded.
    const stepAt = sqlite.indexOf('for (const statement of migration.statements)');
    const versionAt = sqlite.indexOf('INSERT INTO schema_meta');
    const commitAt = sqlite.indexOf('commitTransaction');
    expect(stepAt).toBeGreaterThan(-1);
    expect(versionAt).toBeGreaterThan(stepAt);
    expect(commitAt).toBeGreaterThan(-1);
    expect(sqlite).toMatch(/SchemaTooNewError/);
  });

  it('commits writes rather than queuing them for a lifecycle callback', () => {
    // The product cannot depend on being told it is about to die. Phase 1
    // measured that `pagehide` and `beforeunload` never fire on either
    // platform, so anything held in memory until "app closing" would be lost.
    expect(sqlite).toMatch(/inTransaction/);
    for (const lifecycle of ['appStateChange', 'pagehide', 'beforeunload', 'visibilitychange']) {
      expect(sqlite, `sqlite.ts reacts to ${lifecycle}`).not.toContain(lifecycle);
    }
  });
});

describe('the native test harness cannot reach a store build or a real journal', () => {
  const harness = read('src/storage/native-conformance.ts');

  it('is only imported behind a build-time flag', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/import\.meta\.env\.VITE_NATIVE_CONFORMANCE/);
    expect(main).toMatch(/import\('\.\/storage\/native-conformance'\)/);
    // Behind a condition, so a production build eliminates it rather than
    // shipping a chunk that can open databases.
    expect(main).toMatch(/if \(import\.meta\.env\.VITE_NATIVE_CONFORMANCE\)/);
  });

  it('refuses to touch anything but its own throwaway stores', () => {
    expect(harness).toMatch(/const TEST_PREFIX = 'contract-test-'/);
    expect(harness).toMatch(/storeId === DATABASE_NAME/);
    expect(harness).toMatch(/throw new Error\(/);
    // It must also clean up after itself.
    expect(harness).toMatch(/deleteStore\(\)/);
  });

  it('has floors that a hollow run would trip', () => {
    // A harness that ran zero cases, ran on the web, or quietly ran Dexie must
    // report failure rather than a clean pass.
    expect(harness).toMatch(/expectedCases/);
    expect(harness).toMatch(/ranCases !== CONTRACT_CASE_COUNT/);
    expect(harness).toMatch(/result\.engine !== 'sqlite'/);
    expect(harness).toMatch(/not running on a native platform/);
    expect(harness).toMatch(/reopenProved/);
  });

  it('identifies the engine by a property the minifier cannot mangle', () => {
    // It used to read `constructor.name`, which a production build reports as
    // something like "er" — a floor that could not identify anything, and so
    // could never have caught a Dexie substitution.
    expect(read('src/storage/sqlite.ts')).toMatch(/readonly engine = 'sqlite'/);
    expect(read('src/storage/db.ts')).toMatch(/readonly engine = 'indexeddb'/);
    expect(harness).not.toMatch(/providerClass !== 'SqliteStorageProvider'/);
  });

  it('is absent from the packaged native assets', () => {
    // The real check: the bytes that ship. A flag that was supposed to exclude
    // it, but did not, would look identical in the source.
    for (const [platform, relative] of Object.entries(COPIED_ASSETS)) {
      const copied = join(root, relative);
      if (!existsSync(copied)) {
        expect.fail(`${relative} does not exist; run: npm run native:assets && npm run native:sync`);
      }

      const offenders = [];
      let filesRead = 0;
      const walk = (at) => {
        for (const name of readdirSync(at)) {
          const path = join(at, name);
          if (statSync(path).isDirectory()) {
            walk(path);
          } else if (/\.(js|html|css)$/.test(name)) {
            filesRead += 1;
            if (readFileSync(path, 'utf8').includes('NATIVE_CONTRACT_RESULT')) offenders.push(name);
          }
        }
      };
      walk(copied);

      // A floor, because "found nothing" is also what reading nothing looks like.
      expect(filesRead, `${platform}: read no code files at all`).toBeGreaterThan(5);
      expect(offenders, `${platform}: the test harness is in the packaged assets`).toEqual([]);
    }
  }, TEST_TIMEOUT_MS);
});
