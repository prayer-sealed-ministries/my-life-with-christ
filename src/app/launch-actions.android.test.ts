import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LAUNCH_SCHEME,
  actionFromLaunchUrl,
  routeForLaunchAction,
} from './launch-actions';

/**
 * The launcher shortcut and the application must agree.
 *
 * The shortcut lives in Android XML and the destination it names lives in
 * TypeScript, so nothing but a test spans the two. A shortcut pointing at an
 * action the app does not know is a long-press that opens the home screen, and
 * it would fail silently on a phone rather than in CI.
 *
 * This also pins the security boundary in the other direction: the manifest
 * accepts exactly one scheme, and what that scheme can carry is an action name
 * rather than a route.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const SHORTCUTS = 'android/app/src/main/res/xml/shortcuts.xml';
const STRINGS = 'android/app/src/main/res/values/strings.xml';

const manifest = parse(read(MANIFEST));
const shortcuts = parse(read(SHORTCUTS));
const strings = parse(read(STRINGS));

/** Resolve `@string/foo` against strings.xml, or return the literal. */
function androidString(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('@string/')) return value ?? null;
  const name = value.slice('@string/'.length);
  const node = [...strings.querySelectorAll('string')].find((n) => n.getAttribute('name') === name);
  return node?.textContent ?? null;
}

const NS = 'http://schemas.android.com/apk/res/android';
const attr = (node: Element | null | undefined, name: string): string | null =>
  node?.getAttributeNS(NS, name) ?? null;

describe('the XML was actually read', () => {
  // Every assertion below is "this element says X", and a failed parse yields
  // no elements at all — which would satisfy nothing and report nothing.
  it('parsed a manifest, a shortcut set and the strings', () => {
    expect(manifest.querySelector('manifest')).toBeTruthy();
    expect(manifest.querySelectorAll('activity').length).toBeGreaterThanOrEqual(1);
    expect(shortcuts.querySelectorAll('shortcut').length).toBeGreaterThanOrEqual(1);
    expect(strings.querySelectorAll('string').length).toBeGreaterThanOrEqual(4);
  });
});

describe('the sermon shortcut points somewhere this app understands', () => {
  const shortcut = [...shortcuts.querySelectorAll('shortcut')].find(
    (node) => attr(node, 'shortcutId') === 'sermon-fast-capture',
  );

  it('exists, and is enabled', () => {
    expect(shortcut, 'no sermon-fast-capture shortcut').toBeTruthy();
    expect(attr(shortcut!, 'enabled')).toBe('true');
  });

  it('is labelled in words a person would look for', () => {
    expect(androidString(attr(shortcut!, 'shortcutShortLabel'))).toBe('Sermon note');
    expect(androidString(attr(shortcut!, 'shortcutLongLabel'))).toBe('Start a sermon note');
    // A shortcut with no icon is a blank row in the launcher.
    expect(attr(shortcut!, 'icon')).toMatch(/^@drawable\//);
  });

  it('carries a URL the application accepts, resolving to the sermon editor', () => {
    const intent = shortcut!.querySelector('intent');
    const data = attr(intent, 'data');

    // The crossing point: Android XML on one side, the TypeScript allow-list
    // on the other, and the real parser deciding.
    const action = actionFromLaunchUrl(data);
    expect(action, `shortcut data ${data} is not an action this app offers`).toBe(
      'sermon-fast-capture',
    );
    expect(routeForLaunchAction(action)).toEqual({ name: 'newEntry', kind: 'sermon' });
  });

  it('targets this application explicitly, not whatever answers the scheme', () => {
    const intent = shortcut!.querySelector('intent');
    expect(attr(intent, 'targetPackage')).toBe('com.myjourneywithchrist.lifewithchrist');
    expect(attr(intent, 'targetClass')).toMatch(/MainActivity$/);
  });
});

describe('what an outside intent may reach', () => {
  const activity = [...manifest.querySelectorAll('activity')].find((node) =>
    (attr(node, 'name') ?? '').endsWith('MainActivity'),
  );

  it('registers the shortcut set on the launcher activity', () => {
    const meta = [...activity!.querySelectorAll('meta-data')].find(
      (node) => attr(node, 'name') === 'android.app.shortcuts',
    );
    expect(meta, 'shortcuts are declared nowhere, so the long-press menu is empty').toBeTruthy();
    expect(attr(meta, 'resource')).toBe('@xml/shortcuts');
  });

  it('accepts exactly one scheme, and it is the one the app owns', () => {
    const schemes = [...activity!.querySelectorAll('intent-filter data')].map((node) =>
      androidString(attr(node, 'scheme')),
    );
    expect(schemes).toEqual([LAUNCH_SCHEME]);

    const hosts = [...activity!.querySelectorAll('intent-filter data')].map((node) =>
      attr(node, 'host'),
    );
    expect(hosts).toEqual(['action']);
  });

  it('never accepts http or https, which any site could send', () => {
    const schemes = [...manifest.querySelectorAll('data')].map((node) =>
      androidString(attr(node, 'scheme')),
    );
    expect(schemes).not.toContain('http');
    expect(schemes).not.toContain('https');
  });

  it('adds no permission for any of this', () => {
    const permissions = [...manifest.querySelectorAll('uses-permission')].map((node) =>
      attr(node, 'name'),
    );
    // INTERNET is what Capacitor needs to serve the local webview. Nothing was
    // added for shortcuts, and nothing here reaches a network.
    expect(permissions).toEqual(['android.permission.INTERNET']);
  });

  it('keeps singleTask, so a second tap reaches the running app', () => {
    // Without it the shortcut would start a second copy of the editor while an
    // unfinished draft sat in the first.
    expect(attr(activity!, 'launchMode')).toBe('singleTask');
  });
});
