/**
 * What this app tells Android it can open, against what it can actually read.
 *
 * The manifest is XML and the importer is TypeScript, so nothing but a test
 * spans the two. The failure it prevents is quiet and public: register for a
 * media type the importer cannot parse and the app appears in the share sheet
 * for it, which is a promise broken at the moment somebody takes it up.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SHARED_MIME_TYPES } from '../import/incoming';

const NS = 'http://schemas.android.com/apk/res/android';
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const manifest = new DOMParser().parseFromString(
  read('android/app/src/main/AndroidManifest.xml'),
  'application/xml',
);

const attr = (node: Element | null | undefined, name: string): string | null =>
  node?.getAttributeNS(NS, name) ?? null;

const activity = [...manifest.querySelectorAll('activity')].find((node) =>
  (attr(node, 'name') ?? '').endsWith('MainActivity'),
);

/** Filters carrying one of these actions, which are the document doorways. */
const documentFilters = () =>
  [...(activity?.querySelectorAll('intent-filter') ?? [])].filter((filter) => {
    const actions = [...filter.querySelectorAll('action')].map((a) => attr(a, 'name'));
    const hasDocumentAction =
      actions.includes('android.intent.action.SEND') ||
      actions.includes('android.intent.action.VIEW');
    const types = [...filter.querySelectorAll('data')].some((d) => attr(d, 'mimeType'));
    return hasDocumentAction && types;
  });

describe('the manifest was actually read', () => {
  it('parsed an activity with intent filters', () => {
    // The floor. Every assertion below is over a list, and an empty list
    // satisfies all of them while proving nothing.
    expect(activity, 'no MainActivity in the manifest').toBeTruthy();
    expect(documentFilters().length, 'no document intent filters found').toBeGreaterThanOrEqual(2);
  });
});

describe('it offers to open exactly what it can read', () => {
  const declared = () => {
    const types = new Set<string>();
    for (const filter of documentFilters()) {
      for (const data of filter.querySelectorAll('data')) {
        const type = attr(data, 'mimeType');
        if (type) types.add(type);
      }
    }
    return [...types].sort();
  };

  it('declares the importer’s media types, and no others', () => {
    expect(declared()).toEqual([...SHARED_MIME_TYPES].sort());
  });

  it('never registers as a receiver for everything on the device', () => {
    // `*/*` in a SEND filter puts this app in the share sheet for photographs,
    // videos, spreadsheets and archives it cannot open.
    expect(declared()).not.toContain('*/*');
    for (const type of declared()) {
      expect(type, `${type} is a wildcard`).not.toMatch(/\*/);
    }
  });

  it('does not claim DOCX, which the sermon importer does not read', () => {
    expect(declared()).not.toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('accepts a shared document only from a content provider', () => {
    // The VIEW filter is scheme-pinned so a web page cannot hand the app a
    // document by link. SEND has no scheme by nature — it carries an extra.
    for (const filter of documentFilters()) {
      const actions = [...filter.querySelectorAll('action')].map((a) => attr(a, 'name'));
      if (!actions.includes('android.intent.action.VIEW')) continue;
      const schemes = [...filter.querySelectorAll('data')]
        .map((d) => attr(d, 'scheme'))
        .filter((s): s is string => s !== null);
      expect(new Set(schemes)).toEqual(new Set(['content']));
    }
  });
});

describe('no new permission was taken for any of this', () => {
  it('declares no permission of its own at all', () => {
    /*
     * This reads the SOURCE manifest, which is what this project declares —
     * and it now declares nothing.
     *
     * INTERNET used to be here, inherited from the Capacitor template, and was
     * removed once the packaged app was proved not to need it: on an API 35
     * emulator without it the app launched, the WebView served the assets, the
     * lazily imported Scripture chunk fetched, and Fast Capture worked, with no
     * net::ERR of any kind.
     *
     * The packaged APK still carries three permissions, and none of them is
     * ours: the manifest merger pulls USE_BIOMETRIC and USE_FINGERPRINT from
     * androidx.biometric (a transitive dependency of the SQLite plugin) and
     * DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION from androidx.core. Verified
     * against the built APK with `aapt2 dump permissions` and traced through
     * the merger report.
     *
     * Nothing was added for sharing, and nothing here touches storage — which
     * is the claim that matters, because a share grants read access to one
     * document for the life of the activity and needs no permission at all.
     */
    const permissions = [...manifest.querySelectorAll('uses-permission')].map((node) =>
      attr(node, 'name'),
    );
    // A share grants read access to one document for the life of the activity.
    // Reading the device's storage to accept a handout would be taking far
    // more than the task requires.
    expect(permissions).toEqual([]);
    for (const denied of [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.MANAGE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
    ]) {
      expect(permissions).not.toContain(denied);
    }
  });
});

describe('the launcher shortcut is not mistaken for a document', () => {
  it('keeps the app’s own scheme out of the document filters', () => {
    // `mylifewithchrist://action/...` is also an ACTION_VIEW. The Java side
    // ignores that scheme when remembering a shared document, or a shortcut
    // tap would arrive at the importer as a failed import.
    const java = read(
      'android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/SharedDocument.java',
    );
    expect(java).toMatch(/mylifewithchrist/);
    expect(java).toMatch(/scheme/i);
  });
});
