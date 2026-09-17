/**
 * Everywhere the application can go, in one list.
 *
 * Kept apart from the menu component for the same reason `context.ts` is kept
 * apart from `provider.tsx`: a module that exports both a component and plain
 * data breaks Fast Refresh. It also means a test can read the destinations
 * without rendering anything.
 */

import type { Route } from './router';

export interface MenuDestination {
  route: Route;
  label: string;
}

/**
 * Everything the application can reach, in the order a person meets it.
 *
 * `My journey` is the running timeline. It is deliberately NOT called
 * "My Journey With Christ" — that is the lifelong book the export produces, and
 * conflating the two would make the nav promise a different thing than it opens.
 */
export const PRIMARY: MenuDestination[] = [
  { route: { name: 'home' }, label: 'Home' },
  { route: { name: 'browse' }, label: 'Bible' },
  { route: { name: 'topics' }, label: 'Topics' },
  { route: { name: 'timeline' }, label: 'My journey' },
  { route: { name: 'search', query: '' }, label: 'Search' },
];

export const SECONDARY: MenuDestination[] = [
  { route: { name: 'data' }, label: 'Data & Backup' },
  { route: { name: 'settings' }, label: 'Settings' },
  { route: { name: 'help' }, label: 'Help' },
  { route: { name: 'about' }, label: 'About' },
];

