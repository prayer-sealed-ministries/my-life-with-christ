#!/usr/bin/env node
/**
 * What the BUILT Android package actually declares.
 *
 * A source manifest is what this project asks for; an APK is what a phone
 * gets. Between them sit the manifest merger and every library's own
 * manifest, and this repository has already learned once that the two are not
 * the same document — the biometric and emoji2 permissions below appear in no
 * file anyone here wrote.
 *
 * So the widget's registration, its exported-ness, and the permission set are
 * asserted against the packaged bytes, with `aapt2` reading them. Not run in
 * CI, which builds no APK; run here, before a release and before any claim
 * that a widget is really in the shipped package.
 *
 * Usage: node scripts/verify-apk.mjs [path/to.apk]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_APK = 'android/app/build/outputs/apk/debug/app-debug.apk';

/**
 * Every permission the package is allowed to carry, and where each comes from.
 *
 * INTERNET is this project's own; the rest arrive through the manifest merger
 * from libraries Capacitor pulls in. Listing them by name rather than
 * tolerating "anything already there" is the point: a permission that appears
 * without a line added here is a change nobody decided on.
 */
const ALLOWED_PERMISSIONS = new Set([
  'android.permission.INTERNET',
  // androidx.biometric:1.1.0
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  // androidx.core:1.17.0, for runtime-registered receivers
  'com.myjourneywithchrist.lifewithchrist.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);

const FORBIDDEN_PERMISSIONS = [
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION',
  'READ_CONTACTS',
  'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE',
  'MANAGE_EXTERNAL_STORAGE',
  'RECEIVE_BOOT_COMPLETED',
  'SCHEDULE_EXACT_ALARM',
  'FOREGROUND_SERVICE',
];

function aapt2() {
  const sdk = process.env.ANDROID_HOME ?? join(process.env.HOME ?? '', 'Library/Android/sdk');
  const root = join(sdk, 'build-tools');
  if (!existsSync(root)) fail(`no build-tools under ${root}`);
  const newest = readdirSync(root).sort().reverse()[0];
  const path = join(root, newest, 'aapt2');
  if (!existsSync(path)) fail(`no aapt2 in ${newest}`);
  return path;
}

const results = [];
const problems = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  if (!ok) problems.push(`${name}: ${detail}`);
};

function fail(message) {
  console.error(`\nFAIL\n  ${message}\n`);
  process.exit(1);
}

const apk = resolve(process.argv[2] ?? DEFAULT_APK);
if (!existsSync(apk)) fail(`no APK at ${apk} — build it first`);

const tool = aapt2();
const permissionDump = execFileSync(tool, ['dump', 'permissions', apk], { encoding: 'utf8' });
const manifestDump = execFileSync(tool, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk], {
  encoding: 'utf8',
});

/*
 * Resources, separately, and this is not a detail.
 *
 * A compiled manifest holds resource IDs where the source held `@string/...`,
 * so looking for "mylifewithchrist" in the manifest dump finds nothing however
 * correct the package is — which is exactly what the first version of this
 * script reported, about a package that was fine.
 */
const resourceDump = execFileSync(tool, ['dump', 'resources', apk], { encoding: 'utf8' });

/** A packaged string resource's value, by name. */
function packagedString(name) {
  const match = new RegExp(`string/${name}\\s*\\n\\s*\\(\\) "([^"]*)"`).exec(resourceDump);
  return match?.[1] ?? null;
}


// ---------------------------------------------------------------------------
// The floor. Every assertion below is "the dump says X", and all of them pass
// against an empty string.
// ---------------------------------------------------------------------------
check(
  'PACKAGE_WAS_READ',
  manifestDump.length > 2000 && manifestDump.includes('com.myjourneywithchrist.lifewithchrist'),
  `read ${manifestDump.length} bytes of manifest — did aapt2 actually open it?`,
);

const permissions = [...permissionDump.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]);
check('PERMISSIONS_WERE_READ', permissions.length > 0, 'no permissions parsed at all');

const unexpected = permissions.filter((name) => !ALLOWED_PERMISSIONS.has(name));
check(
  'NO_UNEXPECTED_PERMISSION',
  unexpected.length === 0,
  `not on the list: ${unexpected.join(', ')}`,
);

const dangerous = permissions.filter((name) => FORBIDDEN_PERMISSIONS.some((bad) => name.endsWith(bad)));
check('NO_LOCATION_CONTACTS_STORAGE', dangerous.length === 0, dangerous.join(', '));

// ---------------------------------------------------------------------------
// The widget, in the package rather than in a source file.
// ---------------------------------------------------------------------------
const receiverBlock = manifestDump
  .split(/E: receiver/)
  .find((block) => block.includes('SermonNoteWidget'));

check('WIDGET_RECEIVER_PRESENT', Boolean(receiverBlock), 'no SermonNoteWidget receiver packaged');

if (receiverBlock) {
  check(
    'WIDGET_NOT_EXPORTED',
    /exported\(0x[0-9a-f]+\)=false/.test(receiverBlock),
    'the widget receiver is exported to every app on the device',
  );
  check(
    'WIDGET_IS_A_WIDGET',
    receiverBlock.includes('android.appwidget.provider'),
    'no appwidget.provider metadata — the launcher will not offer it',
  );
  const actions = [...receiverBlock.matchAll(/name\(0x[0-9a-f]+\)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((value) => value.startsWith('android.') && value.includes('.action.'));
  check(
    'WIDGET_HEARS_ONLY_UPDATES',
    actions.every((value) => value === 'android.appwidget.action.APPWIDGET_UPDATE'),
    `also listens for: ${actions.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// And the doorways that existed before it still do.
// ---------------------------------------------------------------------------
check(
  'SHORTCUT_STILL_DECLARED',
  manifestDump.includes('android.app.shortcuts'),
  'the launcher shortcut metadata is gone',
);
check(
  'RESOURCES_WERE_READ',
  resourceDump.length > 2000 && packagedString('app_name') !== null,
  `read ${resourceDump.length} bytes of resources but found no app_name`,
);

const scheme = packagedString('launch_action_scheme');
check('LAUNCH_SCHEME_STILL_DECLARED', scheme === 'mylifewithchrist', `scheme is ${scheme}`);

/*
 * The one that matters most: what a tap actually asks for, read out of the
 * shipped package rather than out of a source file. A widget naming an
 * unknown action opens on the home screen — indistinguishable from a
 * correctly rejected one, and silent.
 */
const widgetUrl = packagedString('widget_sermon_note_url');
check(
  'WIDGET_ASKS_FOR_THE_CANONICAL_ACTION',
  widgetUrl === 'mylifewithchrist://action/sermon-fast-capture',
  `the packaged widget asks for: ${widgetUrl}`,
);
check(
  'WIDGET_CARRIES_NO_ROUTE',
  typeof widgetUrl === 'string' && !/[#?]/.test(widgetUrl),
  `the widget URL carries a route or query: ${widgetUrl}`,
);

console.log(`\nVerifying ${apk}`);
console.log(`  ${(statSync(apk).size / 1024 / 1024).toFixed(1)}MB, ${permissions.length} permissions declared`);
console.log(`  aapt2: ${tool}\n`);
console.log(problems.length === 0 ? 'PASS' : 'FAIL');
for (const { name, ok, detail } of results) {
  console.log(`  ${ok ? ' ' : '!'} ${name.padEnd(30)} ${ok ? '' : detail}`);
}
console.log('');
if (problems.length > 0) process.exit(1);
console.log('The packaged application declares the widget and nothing new.\n');
