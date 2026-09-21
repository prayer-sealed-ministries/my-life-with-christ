/**
 * Launching straight into a destination, from outside the app.
 *
 * An Android launcher shortcut — and later a widget, or an iOS quick action —
 * starts the application with a URL naming what the person asked for. This
 * turns that URL into a route, and nothing else.
 *
 * Same shape as `native-back.ts` and for the same reason: the decision lives in
 * a pure module (`src/app/launch-actions.ts`) that needs no emulator to prove,
 * and this file is only the binding that reads the platform and performs. No
 * view learns that shortcuts exist.
 *
 * The binding is deliberately thin about *what* it will accept. It never
 * receives a route from outside — only an action name, which is looked up in a
 * short allow-list. The activity is exported, so anything on the device can
 * send this app an intent; an intent that could carry a route would let any
 * other application drop the reader into any screen it liked.
 */

import { App } from '@capacitor/app';

import { actionFromLaunchUrl, routeForLaunchAction } from '../app/launch-actions';
import { href, type Route } from '../app/router';
import { nativePlatform } from './runtime';

export interface LaunchBindingHost {
  /**
   * Go to a destination, replacing the current history entry.
   *
   * Replace rather than push: the shortcut IS the way in, so back from the
   * editor should leave the app the way back from any first screen does,
   * rather than revealing a home screen the reader never asked for.
   */
  go: (route: Route) => void;
}

/** Sets the hash before React mounts, so the first render is the destination. */
export function locationHost(): LaunchBindingHost {
  return {
    go: (route) => window.location.replace(href(route)),
  };
}

/**
 * Attach the listener and honour the launch URL. Returns a detach function.
 *
 * A no-op on the web, where there is no intent to read, so callers do not need
 * to know where they are. Never throws: a shortcut that cannot be read is a
 * normal launch, which is exactly what tapping the app icon would have done.
 */
export async function bindLaunchActions(host: LaunchBindingHost): Promise<() => void> {
  if (nativePlatform() === null) return () => {};

  // Cold start: the intent this process was created for.
  try {
    const launch = await App.getLaunchUrl();
    const route = routeForLaunchAction(actionFromLaunchUrl(launch?.url));
    if (route) host.go(route);
  } catch {
    // Nothing to do but start normally.
  }

  // Warm start: the app was already running and the shortcut was tapped again.
  const handle = await App.addListener('appUrlOpen', (event) => {
    const route = routeForLaunchAction(actionFromLaunchUrl(event?.url));
    if (route) host.go(route);
  });

  return () => {
    void handle.remove();
  };
}
