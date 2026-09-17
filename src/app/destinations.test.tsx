/**
 * The application destinations: real routes, not panels hidden inside the shell.
 *
 * Settings, Help and About are ordinary routes for the same reasons every other
 * view is: the browser's back button works, Android's back gesture works, the
 * page has a title, and a person can be sent straight to one. A drawer that
 * swapped content in place would look identical on screen and fail all four.
 */

import { describe, expect, it } from 'vitest';

import { PRIMARY, SECONDARY } from './destinations';
import { href, parseHash } from './router';

describe('every menu destination is a real route', () => {
  it('parses back to the route it points at', () => {
    const all = [...PRIMARY, ...SECONDARY];
    // A floor: an empty list would satisfy the loop below perfectly.
    expect(all.length).toBeGreaterThanOrEqual(9);

    for (const destination of all) {
      const path = href(destination.route);
      expect(path, `${destination.label} has no path`).toMatch(/^#\//);

      const parsed = parseHash(path.replace(/^#/, ''));
      expect(parsed.name, `${destination.label} does not round-trip through the router`).toBe(
        destination.route.name,
      );
    }
  });

  it('gives the application pages their own addresses', () => {
    expect(href({ name: 'settings' })).toBe('#/settings');
    expect(href({ name: 'help' })).toBe('#/help');
    expect(href({ name: 'about' })).toBe('#/about');
    // Data & Backup is the existing journal page under a friendlier name; the
    // route id stays `data` because it is a machine name, and renaming machine
    // names to match a label is how stored things get orphaned.
    expect(href({ name: 'data' })).toBe('#/data');
  });

  it('can be reached directly, as a shared link or a restored tab would', () => {
    expect(parseHash('/settings')).toEqual({ name: 'settings' });
    expect(parseHash('/help')).toEqual({ name: 'help' });
    expect(parseHash('/about')).toEqual({ name: 'about' });
  });

  it('names Data & Backup for people, not for the database', () => {
    const labels = SECONDARY.map((destination) => destination.label);
    expect(labels).toEqual(['Data & Backup', 'Settings', 'Help', 'About']);
  });
});
