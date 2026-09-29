import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The rules App Lock is only worth having if nobody breaks.
 *
 * Every one of these is a thing that would be easy to add later, in a hurry,
 * for a good-sounding reason: a PIN cached "just for this session", a debug
 * unlock to save rebuilding, a verifier written beside the journal so the web
 * build could have the feature too. Each would be a one-line change and none
 * would fail any behavioural test, because the app would still lock and still
 * unlock. So they are checked here, against the source.
 *
 * The floors matter as much as the assertions: a glob that matched nothing
 * would report a clean pass over an empty search, which is the failure this
 * repository keeps finding in its own history.
 */

const sourceFiles = () =>
  execSync('git ls-files --cached --others --exclude-standard src android scripts', {
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\.(ts|tsx|mjs|js|java|xml|json)$/.test(line));

const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};


/**
 * The code, with the prose taken out.
 *
 * Written after the first version of this file failed itself: the checks below
 * look for words like "master PIN" and "localStorage", and the modules they
 * scan explain at length that they do NOT do those things. Scanning comments
 * meant the guard was reading the documentation rather than the code — the
 * same shape as the probe in CLAUDE.md that matched a filter chip instead of
 * an entry. What is asserted about behaviour must be read from behaviour.
 */
const codeOnly = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');

const APP_LOCK_FILES = [
  'src/app/lock-policy.ts',
  'src/app/app-lock.tsx',
  'src/app/app-lock-context.ts',
  'src/platform/app-lock.ts',
  'src/views/LockScreen.tsx',
  'src/views/AppLockSettings.tsx',
  'android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/AppLockStore.java',
  'android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/AppLockPlugin.java',
];

describe('what App Lock may not do', () => {
  it('has the files it claims to have', () => {
    // The floor. Every assertion below is "scan these and find nothing bad",
    // which passes gloriously if the list is wrong and nothing is scanned.
    for (const path of APP_LOCK_FILES) {
      expect(read(path).length, `${path} is missing or empty`).toBeGreaterThan(200);
    }
    expect(sourceFiles().length).toBeGreaterThan(100);
  });

  it('keeps the PIN out of every store the journal uses', () => {
    const offenders = [];
    for (const path of APP_LOCK_FILES) {
      const text = codeOnly(read(path));
      // A PIN reaching any of these is the whole thing undone: localStorage and
      // IndexedDB are readable by anything running in the webview, and SQLite
      // is the file the journal itself lives in.
      for (const sink of ['localStorage', 'sessionStorage', 'indexedDB', 'Dexie', 'executeSql']) {
        if (text.includes(sink)) offenders.push(`${path} reaches for ${sink}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never logs, serialises or puts a PIN in a URL', () => {
    const offenders = [];
    for (const path of APP_LOCK_FILES) {
      for (const [index, line] of codeOnly(read(path)).split('\n').entries()) {
        const where = `${path}:${index + 1}`;
        if (/console\.(log|warn|error|info|debug)/.test(line)) {
          offenders.push(`${where} logs`);
        }
        if (/JSON\.stringify\([^)]*\bpin\b/i.test(line)) offenders.push(`${where} serialises a pin`);
        if (/(searchParams|location\.hash|history\.(push|replace))[^\n]*\bpin\b/i.test(line)) {
          offenders.push(`${where} puts a pin in a URL`);
        }
        if (/navigator\.clipboard/.test(line)) offenders.push(`${where} uses the clipboard`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ships no master PIN, test PIN, or way past the lock', () => {
    const offenders = [];
    for (const path of APP_LOCK_FILES) {
      const text = codeOnly(read(path));
      for (const pattern of [
        /master\s*pin/i,
        /backdoor/i,
        /bypass\s*lock/i,
        /skip\s*lock/i,
        /DEBUG_UNLOCK/,
        /__unlock/,
      ]) {
        if (pattern.test(text)) offenders.push(`${path} matches ${pattern}`);
      }
      // A literal six-to-twelve digit run in App Lock code is either a test PIN
      // somebody left behind or a constant that should be named.
      for (const [index, line] of text.split('\n').entries()) {
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        const literal = /(?<![\w.])\d{6,12}(?![\w.])/.exec(line);
        // Durations are written with separators (60_000) and survive this.
        if (literal && !line.includes('_')) {
          offenders.push(`${path}:${index + 1} carries a bare ${literal[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the lock state out of Android backup, in both rule formats', () => {
    // A verifier restored onto another device could never be satisfied: the
    // Keystore key that computed it does not travel. Excluding it is what
    // makes "App Lock is off on the new phone" the outcome instead of "your
    // journal is locked and nothing opens it".
    const legacy = read('android/app/src/main/res/xml/backup_rules.xml');
    const modern = read('android/app/src/main/res/xml/data_extraction_rules.xml');
    const manifest = read('android/app/src/main/AndroidManifest.xml');

    expect(legacy).toMatch(/<exclude[^>]*domain="sharedpref"[^>]*path="app_lock\.xml"/);
    expect(modern).toMatch(/<cloud-backup>/);
    expect(modern).toMatch(/<device-transfer>/);
    expect(
      modern.match(/<exclude[^>]*domain="sharedpref"[^>]*path="app_lock\.xml"/g) ?? [],
      'both cloud-backup and device-transfer must exclude it',
    ).toHaveLength(2);

    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });

  it('asks for no new Android permission', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const permissions = [...manifest.matchAll(/uses-permission[^>]*android:name="([^"]+)"/g)].map(
      (match) => match[1],
    );
    // App Lock uses KeyguardManager and the Keystore, neither of which needs
    // one. If this ever changes, it should be a decision, not a diff.
    expect(permissions).not.toContain('android.permission.USE_BIOMETRIC');
    expect(permissions).not.toContain('android.permission.USE_FINGERPRINT');
  });

  it('leaves the journal alone when somebody guesses wrong', () => {
    const plugin = read(
      'android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/AppLockPlugin.java',
    );
    const store = read(
      'android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/AppLockStore.java',
    );
    // No wipe-on-failure, ever. The penalty is a delay; the journal is a
    // lifetime of writing and is never the thing that pays for a wrong guess.
    for (const text of [codeOnly(plugin), codeOnly(store)]) {
      expect(text).not.toMatch(/deleteDatabase|wipe|destroyJournal|clearEntries/i);
    }
  });

  it('claims access control, and never encryption', () => {
    // Copy is a security surface. "Fully encrypted" next to a PIN box tells
    // somebody their journal is safe from a person holding the unlocked phone,
    // or from anything that can read the app's files. Neither is true: App Lock
    // guards the way in through this app, and the SQLite database is exactly as
    // readable as it was before.
    const copy = [
      'src/views/LockScreen.tsx',
      'src/views/AppLockSettings.tsx',
    ]
      .map(read)
      .join('\n');

    expect(copy.length).toBeGreaterThan(500);
    for (const forbidden of [
      /military[- ]grade/i,
      /fully encrypted/i,
      // Affirmative claims only. The honest disclaimer this copy DOES make —
      // "does not encrypt the journal database" — contains the word, so a bare
      // /encrypt/ would forbid the very sentence that keeps this truthful.
      /\bis encrypted\b/i,
      /\bencrypts your\b/i,
      /end[- ]to[- ]end encrypted/i,
      /impossible to access/i,
      /perfect security/i,
      /completely (safe|secure|private)/i,
      /unbreakable/i,
      /bank[- ]level/i,
    ]) {
      expect(copy, `copy must not claim ${forbidden}`).not.toMatch(forbidden);
    }

    // And it must positively say the true thing, or the absence above is just
    // silence. A guard that only forbade words would be satisfied by copy that
    // said nothing at all.
    const settings = read('src/views/AppLockSettings.tsx');
    expect(settings).toMatch(/does not encrypt the/i);
    expect(settings).toMatch(/Require a PIN to open/i);
  });

  it('paints the locked screen with colours that actually exist', () => {
    // Found on a device, not in a test: the lock screen was written with
    // `bg-paper`, which is not a token in this design system. Tailwind emits
    // nothing for an unknown utility, so the surface was simply transparent —
    // and an "opaque" lock screen that is transparent is the one thing §9
    // cannot tolerate. Nothing failed; it just quietly had no background.
    const css = read('src/index.css');
    const defined = new Set(
      [...css.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]),
    );
    expect(defined.size).toBeGreaterThan(5);

    const offenders = [];
    for (const path of ['src/views/LockScreen.tsx', 'src/app/app-lock.tsx']) {
      const text = read(path);
      for (const [, token] of text.matchAll(/className="[^"]*\bbg-([a-z0-9-]+)/g)) {
        if (!defined.has(token)) offenders.push(`${path} paints with bg-${token}, which is not defined`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
