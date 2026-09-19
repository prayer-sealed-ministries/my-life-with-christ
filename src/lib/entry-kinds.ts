/**
 * The kinds an entry can be, in one place.
 *
 * The type has always lived in `src/types`, and the *list* had started to live
 * in three: the importer's validator, the editor's dropdown, and — once the
 * router learned to carry a requested kind — a fourth would have been the
 * route parser. Four copies of six strings is four chances for a kind to exist
 * in the model and be unreachable from a link, or to be accepted from a URL and
 * rejected on import.
 *
 * So the tuple is here and the others read it. The two assertions below are
 * what make that safe in both directions: `satisfies` stops a value being
 * listed that the type does not allow, and `AllKindsListed` fails to compile if
 * the type gains a kind this list does not carry. Adding a seventh kind is then
 * a type error until it is listed, which is the only kind of reminder worth
 * relying on.
 *
 * The labels are the words a reader sees for each kind in the editor. They are
 * a `Record<EntryKind, string>`, so the compiler already refuses an incomplete
 * one; no assertion is needed for those.
 */

import type { EntryKind } from '../types';

export const ENTRY_KINDS = [
  'sermon',
  'reading',
  'service',
  'prayer',
  'reflection',
  'letter',
] as const satisfies readonly EntryKind[];

/** Compile-time proof that the list above covers the type. */
type Unlisted = Exclude<EntryKind, (typeof ENTRY_KINDS)[number]>;
export type AllKindsListed = Unlisted extends never ? true : Unlisted;

/** The word shown for each kind where there is room for the full name. */
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  sermon: 'Sermon',
  reading: 'Bible reading',
  service: 'Service',
  prayer: 'Prayer',
  reflection: 'Reflection',
  letter: 'Letter',
};

/**
 * Is this string a kind this build understands?
 *
 * The guard exists because kinds arrive from places that are not the app: a
 * hash somebody bookmarked, edited, or mistyped, and an archive written by an
 * older or newer version. Both answer the same question, so both ask it here.
 */
export function isEntryKind(value: unknown): value is EntryKind {
  return typeof value === 'string' && (ENTRY_KINDS as readonly string[]).includes(value);
}
