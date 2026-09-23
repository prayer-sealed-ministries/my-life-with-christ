/**
 * Which piece of writing an editor route names.
 *
 * React already needs this: App keys `EntryEditor` by it, so that moving to a
 * different entry remounts rather than reusing an instance that still holds
 * the last one's primed delete confirmation. This file gives that identity a
 * name so a second thing can ask the same question and get the same answer.
 *
 * The second thing is focus mode. Focus is not a property of the application —
 * it is how somebody is holding ONE editor for the next forty minutes — and
 * keeping it anywhere broader is how it leaked: entering focus mode on a
 * prayer, then tapping the home-screen widget, opened a brand new sermon with
 * the chrome already gone. Fast Capture's promise is the ordinary editor with
 * the cursor in the notes box; the reader can choose focus afterwards, and
 * choosing it once should not choose it again for unrelated writing later.
 */

import type { Route } from './router';

/**
 * The editor a route names, or null when it names none.
 *
 * Deliberately the same string App keys the component by. If these two ever
 * disagreed, focus would survive a remount or die without one, and which of
 * those happened would depend on a detail nobody was looking at.
 */
export function editorSessionKey(route: Route): string | null {
  switch (route.name) {
    case 'entry':
      return `entry:${route.id}`;
    case 'newEntry':
      return `new:${route.anchor ?? ''}:${route.kind ?? ''}:${route.draft ?? ''}`;
    default:
      return null;
  }
}

/**
 * Is the reader still in the editor they were in?
 *
 * Identical keys are obviously the same one. The interesting case is the
 * single transition that is NOT identical and is still the same writing: a new
 * entry acquiring an id. Saving navigates `#/entry/new` to `#/entry/<id>`,
 * App's key changes, and the editor remounts — which is precisely why focus
 * mode lives above the routed view at all. Ending it there would end it
 * mid-sermon, at the moment somebody pressed Save, which is exactly when they
 * are using it.
 *
 * Narrow on purpose, and worth being honest about its edge: any move from a
 * new-entry editor to a saved one is treated as that save. Nothing in the
 * editor offers a way to reach a DIFFERENT entry from a new one — the routes
 * out of it are the timeline, the entry just written, or an outside action,
 * and an outside action names a new capture rather than an existing entry — so
 * the only navigation this actually admits is the save it is for.
 */
export function isSameEditorSession(previous: string | null, current: string | null): boolean {
  if (previous === null || current === null) return false;
  if (previous === current) return true;
  return previous.startsWith('new:') && current.startsWith('entry:');
}
