/**
 * The destinations something outside the app is allowed to ask for.
 *
 * A launcher shortcut, and later a home-screen widget or an iOS quick action,
 * needs to say "start a sermon note now" without knowing how this app spells
 * its routes. Two ways to let it: hand over a route string, or hand over the
 * name of an action and look the route up here.
 *
 * This is the second, deliberately. An intent that carried a route would mean
 * any application on the device could open this one at any screen it liked —
 * mid-edit, mid-import, inside a destructive confirmation — by guessing a hash.
 * The activity is exported, so that is not hypothetical. An action name can
 * only ever select one of the destinations listed below, and the list is short
 * enough to read.
 *
 * Pure, and free of anything platform-shaped, for the same reason `back.ts` is:
 * the decision is exact, it is the part worth testing, and it must not need an
 * emulator to prove.
 */

import type { Route } from './router';

/**
 * Every destination reachable from outside, by name.
 *
 * Adding one is a deliberate edit here and nowhere else. The value is a plain
 * route, so a reviewer can see precisely where an outside caller can land.
 */
export const LAUNCH_ACTIONS = {
  /**
   * Sermon note, now.
   *
   * The ordinary new-entry route with the kind stated rather than left to the
   * default. Stating it is the point: `blankForm` already defaults to sermon,
   * but a shortcut that relied on that default would silently start pointing
   * somewhere else the day the default changed, and nothing would fail.
   */
  'sermon-fast-capture': { name: 'newEntry', kind: 'sermon' },
} as const satisfies Record<string, Route>;

export type LaunchAction = keyof typeof LAUNCH_ACTIONS;

/** The scheme the shortcut uses. Owned by this app; it reaches nothing else. */
export const LAUNCH_SCHEME = 'mylifewithchrist';

/** Is this a destination this build offers to the outside world? */
export function isLaunchAction(value: unknown): value is LaunchAction {
  return typeof value === 'string' && Object.hasOwn(LAUNCH_ACTIONS, value);
}

/**
 * The route an action names, or null.
 *
 * Null means "carry on with a normal launch". It never means "guess": an
 * unknown action, a missing one, or anything that is not a string at all
 * lands the reader on the ordinary home screen, which is what tapping the app
 * icon would have done.
 */
export function routeForLaunchAction(action: unknown): Route | null {
  if (!isLaunchAction(action)) return null;
  // Copied, so a caller that mutates what it is given cannot edit the table.
  return { ...LAUNCH_ACTIONS[action] };
}

/**
 * The action named by a launch URL, or null.
 *
 * Accepts exactly `mylifewithchrist://action/<name>` and nothing else.
 *
 * Matched against the raw string rather than through `new URL`, and that is
 * not a style preference — it is a bug that shipped into an emulator and was
 * invisible to every test.
 *
 * `new URL` disagrees with itself across runtimes for a NON-SPECIAL scheme.
 * The WHATWG rule gives such a URL an opaque path, so the real Android WebView
 * (Chrome 124) reports:
 *
 *     host ''            pathname '//action/sermon-fast-capture'
 *
 * while Node and jsdom — where the tests run — report:
 *
 *     host 'action'      pathname '/sermon-fast-capture'
 *
 * The first version of this checked `host === 'action'`. Every test passed and
 * the shortcut silently did nothing on a device: the app opened on the home
 * screen, which is exactly what a rejected action is supposed to look like, so
 * there was no error to notice.
 *
 * A regex over the literal string answers the same question identically
 * everywhere. It is also strict in the ways that matter: no query, no
 * fragment, no credentials, no second path segment, and no percent-encoding,
 * because an action name is plain text and anything encoded is an attempt to
 * smuggle something through.
 */
const LAUNCH_URL = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/action\/([A-Za-z0-9-]{1,64})$/;

export function actionFromLaunchUrl(url: unknown): LaunchAction | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return null;

  const match = LAUNCH_URL.exec(url);
  if (!match) return null;

  // Schemes are case-insensitive; the rest of the URL is not.
  if (match[1].toLowerCase() !== LAUNCH_SCHEME) return null;

  return isLaunchAction(match[2]) ? match[2] : null;
}

/** The URL a shortcut, widget or quick action should carry for an action. */
export function launchUrlFor(action: LaunchAction): string {
  return `${LAUNCH_SCHEME}://action/${action}`;
}
