/**
 * The home-screen widget, against the contract it is supposed to be a doorway to.
 *
 * The widget is Android XML and Java; the destination it names is decided in
 * TypeScript. Nothing but a test spans the two, and the failure it prevents is
 * silent in the worst way: a widget that names an action this app does not
 * recognise opens on the home screen, which is exactly what a correctly
 * REJECTED action looks like. There is no error to notice — the shortcut
 * already shipped that bug once for a different reason.
 *
 * So this asserts the two things that cannot be seen from either side alone:
 * that the widget and the launcher shortcut ask for the same thing, and that
 * the thing they ask for is one the allow-list actually offers.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { actionFromLaunchUrl, launchUrlFor, routeForLaunchAction } from '../app/launch-actions';

const NS = 'http://schemas.android.com/apk/res/android';
const read = (path: string) => readFileSync(resolve(process.cwd(), `android/app/src/main/${path}`), 'utf8');
const parse = (path: string) => new DOMParser().parseFromString(read(path), 'application/xml');

const attr = (node: Element | null | undefined, name: string): string | null =>
  node?.getAttributeNS(NS, name) ?? null;

const manifest = parse('AndroidManifest.xml');
const widgetInfo = parse('res/xml/sermon_note_widget_info.xml');
const shortcuts = parse('res/xml/shortcuts.xml');
const layout = parse('res/layout/widget_sermon_note.xml');
const providerSource = read('java/com/myjourneywithchrist/lifewithchrist/SermonNoteWidget.java');
const stringsSource = read('res/values/strings.xml');

/** A string resource's value, by name. */
function stringResource(name: string): string {
  const node = [...parse('res/values/strings.xml').querySelectorAll('string')].find(
    (candidate) => candidate.getAttribute('name') === name,
  );
  return node?.textContent?.trim() ?? '';
}

const receiver = [...manifest.querySelectorAll('receiver')].find((node) =>
  (attr(node, 'name') ?? '').endsWith('SermonNoteWidget'),
);

describe('the files were actually read', () => {
  // The floor. Every assertion below is of the shape "this XML says X", and
  // all of them pass just as well against an empty document.
  it('found a widget receiver, its declaration, and the shortcut it must match', () => {
    expect(receiver, 'no SermonNoteWidget receiver in the manifest').toBeTruthy();
    expect(widgetInfo.querySelector('appwidget-provider'), 'no appwidget-provider').toBeTruthy();
    expect(shortcuts.querySelector('shortcut'), 'no launcher shortcut').toBeTruthy();
    expect(layout.querySelector('LinearLayout'), 'no widget layout').toBeTruthy();
    expect(providerSource.length, 'the provider source is empty').toBeGreaterThan(200);
  });
});

describe('the widget asks for the one canonical action', () => {
  const widgetUrl = stringResource('widget_sermon_note_url');

  it('names an action the allow-list actually offers', () => {
    const action = actionFromLaunchUrl(widgetUrl);
    expect(action, `the widget names something unknown: ${widgetUrl}`).toBe('sermon-fast-capture');
    expect(routeForLaunchAction(action)).toEqual({ name: 'newEntry', kind: 'sermon' });
  });

  it('is exactly what the shared module says a caller should send', () => {
    expect(widgetUrl).toBe(launchUrlFor('sermon-fast-capture'));
  });

  it('asks for the same thing the launcher shortcut asks for', () => {
    /*
     * The parity the brief is about. Two doorways, one destination — so that a
     * change to what "start a sermon note" means cannot reach one of them and
     * miss the other.
     */
    const shortcutIntent = shortcuts.querySelector('intent');
    const shortcutUrl = attr(shortcutIntent, 'data');
    expect(shortcutUrl, 'the shortcut carries no data URL').toBeTruthy();
    expect(shortcutUrl, 'shortcut and widget have drifted apart').toBe(widgetUrl);
  });

  it('carries an action name and never a route', () => {
    // Anything with a hash, a query, or a second path segment is an attempt to
    // say WHERE rather than WHAT, and the parser refuses all of them.
    expect(widgetUrl).not.toMatch(/[#?]/);
    for (const smuggled of [
      'mylifewithchrist://action/sermon-fast-capture#/data',
      'mylifewithchrist://action/sermon-fast-capture?to=/data',
      'mylifewithchrist://action/sermon-fast-capture/extra',
      'mylifewithchrist://route//data',
      'https://example.org/action/sermon-fast-capture',
    ]) {
      expect(actionFromLaunchUrl(smuggled), `${smuggled} was accepted`).toBeNull();
    }
  });

  it('reads that URL from resources rather than building one in Java', () => {
    // A URL assembled in the provider could not be compared with the
    // shortcut's, and this test would be checking a string that nothing uses.
    expect(providerSource).toContain('R.string.widget_sermon_note_url');
    expect(providerSource, 'the action is spelled out in Java as well').not.toMatch(
      /"mylifewithchrist:/,
    );
  });
});

describe('what the widget is allowed to do', () => {
  it('is not offered to every application on the device', () => {
    expect(attr(receiver, 'exported'), 'the widget receiver is exported').toBe('false');
  });

  it('hears only the system’s update broadcast', () => {
    const actions = [...(receiver?.querySelectorAll('intent-filter action') ?? [])].map((node) =>
      attr(node, 'name'),
    );
    expect(actions).toEqual(['android.appwidget.action.APPWIDGET_UPDATE']);
  });

  it('sends an explicit, immutable intent', () => {
    // Explicit: nothing else on the device can answer it. Immutable: whoever
    // holds it cannot rewrite what it says.
    expect(providerSource, 'the tap intent is implicit').toContain('setClass(context, MainActivity.class)');
    expect(providerSource).toContain('FLAG_IMMUTABLE');
    expect(providerSource, 'a mutable PendingIntent').not.toContain('FLAG_MUTABLE');
  });

  it('wakes nothing on a timer', () => {
    /*
     * The widget shows one fixed word. A refresh period would spend a
     * person's battery redrawing something that cannot change, and would mean
     * the app being started in the background to do it.
     */
    const provider = widgetInfo.querySelector('appwidget-provider');
    expect(attr(provider, 'updatePeriodMillis')).toBe('0');
    for (const forbidden of ['WorkManager', 'AlarmManager', 'setRepeating', 'scheduleUpdate']) {
      expect(providerSource, `${forbidden} in a widget that has nothing to refresh`).not.toContain(
        forbidden,
      );
    }
  });

  it('never reads the journal', () => {
    for (const forbidden of ['SQLite', 'Database', 'getSharedPreferences', 'openFileInput']) {
      expect(providerSource, `${forbidden} in the widget`).not.toContain(forbidden);
    }
  });
});

describe('what the home screen shows a passer-by', () => {
  it('shows the app and the action, and no journal text', () => {
    /*
     * A home screen is visible to whoever is stood next to the reader. The
     * layout may only name things that are the same for everybody who installs
     * the app — never a title, a speaker, a church, or a line of writing.
     */
    const texts = [...layout.querySelectorAll('TextView')].map((node) => attr(node, 'text'));
    expect(texts).toEqual(['@string/app_name', '@string/widget_sermon_note_action']);
    expect(stringResource('widget_sermon_note_action')).toBe('Sermon note');
  });

  it('says what it is for out loud', () => {
    const root = layout.querySelector('LinearLayout');
    expect(attr(root, 'contentDescription')).toBe('@string/widget_sermon_note_action_label');
    const spoken = stringResource('widget_sermon_note_action_label');
    expect(spoken).toMatch(/sermon note/i);
    expect(spoken, 'the accessible name does not say which app').toMatch(/My Life With Christ/);
  });

  it('keeps its words in resources, so translating them is an ordinary job', () => {
    for (const name of [
      'widget_sermon_note_label',
      'widget_sermon_note_action',
      'widget_sermon_note_description',
      'widget_sermon_note_action_label',
    ]) {
      expect(stringsSource, `${name} is missing`).toContain(`name="${name}"`);
    }
    // Nothing user-visible hard-coded in the layout or the provider.
    expect(layout.documentElement.outerHTML).not.toMatch(/android:text="[^@]/);
  });
});
