/**
 * The binding between an intent and a destination.
 *
 * `launch-actions.test.ts` owns which URLs are acceptable. This owns the wiring
 * either side of that decision: that the web is untouched, that a valid
 * shortcut navigates, that an invalid one leaves the app where a normal launch
 * would, and that a bridge that misbehaves cannot stop the app starting.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { launchUrlFor, routeForLaunchAction } from '../app/launch-actions';
import { href, type Route } from '../app/router';

const listeners: Array<(event: { url?: string }) => void> = [];
const remove = vi.fn();
let launchUrl: { url: string } | undefined;
let getLaunchUrlThrows = false;

vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: async () => {
      if (getLaunchUrlThrows) throw new Error('bridge unavailable');
      return launchUrl;
    },
    addListener: async (_name: string, handler: (event: { url?: string }) => void) => {
      listeners.push(handler);
      return { remove };
    },
  },
}));

const platform = vi.hoisted(() => ({ value: 'android' as 'android' | 'ios' | null }));
vi.mock('./runtime', () => ({ nativePlatform: () => platform.value }));

const { bindLaunchActions } = await import('./native-launch');

function host() {
  const went: Route[] = [];
  return { went, go: (route: Route) => void went.push(route) };
}

afterEach(() => {
  listeners.length = 0;
  launchUrl = undefined;
  getLaunchUrlThrows = false;
  platform.value = 'android';
  vi.clearAllMocks();
});

describe('on the web', () => {
  it('binds nothing at all', async () => {
    platform.value = null;
    launchUrl = { url: launchUrlFor('sermon-fast-capture') };
    const h = host();

    const detach = await bindLaunchActions(h);

    // No intent exists in a browser; reading one would be inventing a platform.
    expect(h.went).toEqual([]);
    expect(listeners).toHaveLength(0);
    detach();
  });
});

describe('a cold start from the shortcut', () => {
  it('goes straight to the sermon editor', async () => {
    launchUrl = { url: launchUrlFor('sermon-fast-capture') };
    const h = host();

    await bindLaunchActions(h);

    expect(h.went).toEqual([{ name: 'newEntry', kind: 'sermon' }]);
  });

  it('starts normally when there is no launch URL', async () => {
    launchUrl = undefined;
    const h = host();
    await bindLaunchActions(h);
    expect(h.went).toEqual([]);
  });

  it('starts normally when the URL names something it should not', async () => {
    // The security property, at the binding: an intent cannot describe a
    // destination, only select one — and a bad selection is a normal launch.
    for (const url of [
      'mylifewithchrist://action/open-settings',
      'mylifewithchrist://action/%23%2Fdata',
      'https://evil.example/action/sermon-fast-capture',
      'mylifewithchrist://elsewhere/sermon-fast-capture',
      'nonsense',
    ]) {
      launchUrl = { url };
      const h = host();
      await bindLaunchActions(h);
      expect(h.went, url).toEqual([]);
    }
  });

  it('still starts when the bridge itself fails', async () => {
    // A shortcut that cannot be read is a normal launch. It is never a crash
    // on the one screen a person opened to write something down.
    getLaunchUrlThrows = true;
    const h = host();
    await expect(bindLaunchActions(h)).resolves.toBeTypeOf('function');
    expect(h.went).toEqual([]);
    // And the warm path is still attached afterwards.
    expect(listeners).toHaveLength(1);
  });
});

describe('the shortcut tapped while the app is already running', () => {
  it('navigates on appUrlOpen', async () => {
    const h = host();
    await bindLaunchActions(h);
    expect(listeners).toHaveLength(1);

    listeners[0]({ url: launchUrlFor('sermon-fast-capture') });
    expect(h.went).toEqual([{ name: 'newEntry', kind: 'sermon' }]);
  });

  it('ignores an event naming something unknown', async () => {
    const h = host();
    await bindLaunchActions(h);

    listeners[0]({ url: 'mylifewithchrist://action/wipe-journal' });
    listeners[0]({});
    expect(h.went).toEqual([]);
  });

  it('asks for the same place twice when a doorway is used twice', () => {
    /*
     * Two taps — a shortcut then a widget, or one widget tapped twice in a
     * hurry — must ask for the same destination rather than something new.
     *
     * That is what keeps writing safe under the second tap. The route carries
     * no draft id and no nonce, so the second invocation resolves to the hash
     * the editor is already on, and `go` replaces an address with itself. A
     * route that differed per invocation would remount the editor and take the
     * page out from under whoever was typing into it.
     */
    const first = routeForLaunchAction('sermon-fast-capture');
    const second = routeForLaunchAction('sermon-fast-capture');
    expect(first).toEqual(second);
    expect(href(first!), 'the same action resolves to two addresses').toBe(href(second!));
  });

  it('does not let a widget tap leak into the next ordinary launch', async () => {
    /*
     * The binding reads the launch URL once, when it is attached. Tapping the
     * app icon afterwards starts the app with no URL at all, and the reader
     * must land where the icon says — home — rather than back in an editor
     * because of something they tapped an hour ago.
     */
    launchUrl = { url: launchUrlFor('sermon-fast-capture') };
    const fromWidget = host();
    await bindLaunchActions(fromWidget);
    expect(fromWidget.went).toEqual([{ name: 'newEntry', kind: 'sermon' }]);

    // The next launch is an ordinary one: no URL.
    launchUrl = undefined;
    const fromIcon = host();
    await bindLaunchActions(fromIcon);
    expect(fromIcon.went, 'the widget action was replayed on a normal launch').toEqual([]);
  });

  it('detaches cleanly', async () => {
    const detach = await bindLaunchActions(host());
    detach();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
