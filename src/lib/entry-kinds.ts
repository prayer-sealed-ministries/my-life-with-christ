/**
 * The kinds an entry can be, in one place.
 *
 * The type has always lived in `src/types`, and the *list* had started to live
 * in three: the importer's validator, the editor's dropdown, and — once the
 * router learned to carry a requested kind — a fourth would have been the
 * route parser. Four copies of five strings is four chances for a kind to exist
 * in the model and be unreachable from a link, or to be accepted from a URL and
 * rejected on import.
 *
 * So the tuple is here and the others read it. The two assertions below are
 * what make that safe in both directions: `satisfies` stops a value being
 * listed that the type does not allow, and `AllKindsListed` fails to compile if
 * the type gains a kind this list does not carry. Adding a sixth kind is then
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

/**
 * Kinds this app used to offer, and the kind that now carries their meaning.
 *
 * `service` — "a whole service or gathering" — was removed on 2026-09-30. See the
 * note on `EntryKind` in src/types for why. What matters here is that journals
 * written while it existed still say `service`, in a local database and in every
 * archive exported since the app was first installed.
 *
 * It maps to `sermon` rather than to the generic unknown-kind fallback, which is
 * `reflection`. That is not a coin toss: a service entry carries a speaker, a
 * place, and notes on what was taught, and a reflection is thinking on paper.
 * Defaulting it would file somebody's Easter morning under the wrong heading in
 * their own book.
 */
export const RETIRED_ENTRY_KINDS: Readonly<Record<string, EntryKind>> = {
  service: 'sermon',
};

/**
 * The kind to use for a value that may not have been written by this build.
 *
 * `null` means genuinely unrecognised — not a kind, and not a kind this app ever
 * had — so each caller can apply its own fallback and say what it did. The two
 * callers that need this are the archive importer and the editor, because those
 * are the two places a kind arrives from outside the running build: a file
 * somebody restores, and a row saved by an older version.
 */
export function resolveEntryKind(value: unknown): EntryKind | null {
  if (isEntryKind(value)) return value;
  if (typeof value === 'string' && Object.hasOwn(RETIRED_ENTRY_KINDS, value)) {
    return RETIRED_ENTRY_KINDS[value];
  }
  return null;
}
