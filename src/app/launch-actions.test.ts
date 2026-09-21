/**
 * What the outside world may ask this app to do.
 *
 * The activity is exported, so any application on the device can send it an
 * intent. These tests are the security boundary: an outside caller may select
 * one of a short list of destinations by name, and may never describe a
 * destination of its own.
 */

import { describe, expect, it } from 'vitest';

import {
  LAUNCH_ACTIONS,
  LAUNCH_SCHEME,
  actionFromLaunchUrl,
  isLaunchAction,
  launchUrlFor,
  routeForLaunchAction,
} from './launch-actions';
import { href, parseHash } from './router';

describe('the destinations offered to the outside', () => {
  it('offers sermon fast capture, as an ordinary new sermon entry', () => {
    expect(routeForLaunchAction('sermon-fast-capture')).toEqual({
      name: 'newEntry',
      kind: 'sermon',
    });
  });

  it('lands on a route this app actually has', () => {
    // The floor: a table of destinations nobody can reach proves nothing.
    const names = Object.keys(LAUNCH_ACTIONS);
    expect(names.length).toBeGreaterThanOrEqual(1);

    for (const name of names) {
      const route = routeForLaunchAction(name);
      expect(route, name).toBeTruthy();
      // Round-trips through the real router, so a destination cannot be listed
      // here in a shape the router would not parse back.
      expect(parseHash(href(route!))).toEqual(route);
    }
  });

  it('states the kind rather than leaning on the editor default', () => {
    // The default is sermon today. A shortcut relying on that would quietly
    // point somewhere else the day it changed, and nothing would fail.
    expect(routeForLaunchAction('sermon-fast-capture')).toHaveProperty('kind', 'sermon');
  });

  it('hands out a copy, so a caller cannot edit the table', () => {
    const route = routeForLaunchAction('sermon-fast-capture') as { kind?: string };
    route.kind = 'prayer';
    expect(routeForLaunchAction('sermon-fast-capture')).toHaveProperty('kind', 'sermon');
  });
});

describe('anything not on the list fails safely', () => {
  it('refuses an unknown action', () => {
    for (const unknown of ['', 'home', 'settings', 'delete-everything', 'sermon', 'SERMON-FAST-CAPTURE']) {
      expect(routeForLaunchAction(unknown), unknown).toBeNull();
      expect(isLaunchAction(unknown), unknown).toBe(false);
    }
  });

  it('refuses anything that is not a string', () => {
    for (const rubbish of [null, undefined, 42, {}, [], { name: 'settings' }]) {
      expect(routeForLaunchAction(rubbish)).toBeNull();
    }
  });

  it('cannot be talked into a route by prototype pollution', () => {
    // `in` would say yes to these; hasOwn does not.
    for (const inherited of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(routeForLaunchAction(inherited), inherited).toBeNull();
    }
  });
});

describe('the launch URL a shortcut carries', () => {
  it('reads the action out of a well-formed URL', () => {
    expect(actionFromLaunchUrl(`${LAUNCH_SCHEME}://action/sermon-fast-capture`)).toBe(
      'sermon-fast-capture',
    );
    expect(actionFromLaunchUrl(launchUrlFor('sermon-fast-capture'))).toBe('sermon-fast-capture');
  });

  it('round-trips every action it offers', () => {
    const names = Object.keys(LAUNCH_ACTIONS) as Array<keyof typeof LAUNCH_ACTIONS>;
    expect(names.length).toBeGreaterThanOrEqual(1);
    for (const name of names) {
      expect(actionFromLaunchUrl(launchUrlFor(name)), name).toBe(name);
    }
  });

  it('refuses another application’s scheme', () => {
    for (const url of [
      'https://evil.example/action/sermon-fast-capture',
      'http://localhost/action/sermon-fast-capture',
      'file:///action/sermon-fast-capture',
      'javascript:alert(1)',
      'intent://action/sermon-fast-capture#Intent;end',
    ]) {
      expect(actionFromLaunchUrl(url), url).toBeNull();
    }
  });

  it('refuses a foreign scheme even when everything after it looks right', () => {
    // These are the cases that isolate the scheme check. The list above all
    // carry a host other than `action`, so the host check alone rejects them —
    // and a mutation that deleted the scheme check left every one of them
    // passing. A page served over https must not be able to reach this by
    // spelling the rest of the URL correctly.
    for (const scheme of ['http', 'https', 'file', 'ftp', 'ws', 'content', 'intent']) {
      const url = `${scheme}://action/sermon-fast-capture`;
      expect(actionFromLaunchUrl(url), url).toBeNull();
    }
    // And the one that must work, so this is not a test that rejects
    // everything.
    expect(actionFromLaunchUrl(`${LAUNCH_SCHEME}://action/sermon-fast-capture`)).toBe(
      'sermon-fast-capture',
    );
  });

  it('refuses a URL that is shaped wrong, however plausible', () => {
    for (const url of [
      `${LAUNCH_SCHEME}://action/`,
      `${LAUNCH_SCHEME}://action`,
      `${LAUNCH_SCHEME}://action/sermon-fast-capture/extra`,
      `${LAUNCH_SCHEME}://elsewhere/sermon-fast-capture`,
      `${LAUNCH_SCHEME}://action/sermon-fast-capture?then=settings`,
      `${LAUNCH_SCHEME}://action/sermon-fast-capture#/data`,
      `${LAUNCH_SCHEME}://user:pass@action/sermon-fast-capture`,
      `${LAUNCH_SCHEME}:///action/sermon-fast-capture`,
      'not a url at all',
      '',
    ]) {
      expect(actionFromLaunchUrl(url), url).toBeNull();
    }
  });

  it('cannot be used to navigate anywhere it likes', () => {
    // The property that matters: a launch URL selects from a list; it never
    // describes a destination. No spelling of a route reaches the app.
    for (const url of [
      `${LAUNCH_SCHEME}://action/%2Fdata`,
      `${LAUNCH_SCHEME}://action/..%2F..%2Fsettings`,
      `${LAUNCH_SCHEME}://action/%23%2Fentry%2Fnew`,
      `${LAUNCH_SCHEME}://action/entry/new`,
    ]) {
      expect(actionFromLaunchUrl(url), url).toBeNull();
    }
  });

  it('refuses a URL long enough to be an attack rather than a shortcut', () => {
    expect(actionFromLaunchUrl(`${LAUNCH_SCHEME}://action/${'a'.repeat(4000)}`)).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    for (const rubbish of [null, undefined, 42, {}, []]) {
      expect(actionFromLaunchUrl(rubbish)).toBeNull();
    }
  });
});

/**
 * The bug that reached an emulator, and the check that would have caught it.
 *
 * `new URL` splits a non-special scheme differently depending on the runtime:
 * the Android WebView gives it an opaque path (host '', pathname
 * '//action/name'), Node and jsdom populate host instead. A parser that read
 * `host` therefore worked in every test and rejected the real shortcut on a
 * device — where a rejected action is indistinguishable from a normal launch,
 * so nothing looked wrong.
 */
describe('the parse does not depend on how this runtime splits a URL', () => {
  it('answers the same whatever new URL would have said', () => {
    const url = `${LAUNCH_SCHEME}://action/sermon-fast-capture`;

    // Whichever shape THIS runtime produces, record it — so a future runtime
    // change shows up here as information rather than as a silent difference.
    const parsed = new URL(url);
    const shape = parsed.host === 'action' ? 'authority' : 'opaque-path';
    expect(['authority', 'opaque-path']).toContain(shape);

    // And the answer is the same either way, because the parse does not read
    // either field.
    expect(actionFromLaunchUrl(url)).toBe('sermon-fast-capture');
  });

  it('accepts the exact string the Android shortcut carries', () => {
    // Byte for byte what res/xml/shortcuts.xml puts in the intent. The
    // cross-check in launch-actions.android.test.ts reads it from the XML;
    // this pins it here too, so the contract is legible without the XML.
    expect(actionFromLaunchUrl('mylifewithchrist://action/sermon-fast-capture')).toBe(
      'sermon-fast-capture',
    );
  });

  it('still refuses the shapes that are not a bare authority and one segment', () => {
    for (const url of [
      'mylifewithchrist:/action/sermon-fast-capture',
      'mylifewithchrist:///action/sermon-fast-capture',
      'mylifewithchrist://action//sermon-fast-capture',
      'mylifewithchrist://ACTION/sermon-fast-capture',
    ]) {
      expect(actionFromLaunchUrl(url), url).toBeNull();
    }
    // The scheme itself is case-insensitive, as schemes are.
    expect(actionFromLaunchUrl('MyLifeWithChrist://action/sermon-fast-capture')).toBe(
      'sermon-fast-capture',
    );
  });
});
