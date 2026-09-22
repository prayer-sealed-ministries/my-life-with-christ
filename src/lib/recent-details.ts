/**
 * The details somebody has already saved, offered back to them.
 *
 * Every Sunday asks for the same three things — where you were, who preached,
 * what series it is — and typing "City Gate Church" for the fortieth time is
 * the kind of friction that stops a person writing at all.
 *
 * What this is NOT is the important half. It does not guess, infer, predict,
 * or learn. It reads values the reader typed and deliberately SAVED, and
 * offers them as something to tap. Nothing here reaches a network, a location,
 * a contact list, or an account, and nothing here fills a field in on its own:
 * the caller renders these as buttons, and a field stays empty until somebody
 * presses one.
 *
 * Derived, never stored. There is no suggestions table and nothing new in the
 * archive — the journal is the record, and these are read back out of it. That
 * is also what makes the awkward cases correct for free: a deleted entry stops
 * suggesting its speaker because it is no longer there to be read, and an
 * unfinished recovery draft never suggests anything because drafts live in
 * their own collection and this never opens it.
 */

import type { Entry } from '../types';

/** The three fields this offers, named exactly as the entry stores them. */
export type DetailField = 'place' | 'speaker' | 'sermonSeries';

export const DETAIL_FIELDS: readonly DetailField[] = ['place', 'speaker', 'sermonSeries'];

/**
 * How many to show per field.
 *
 * Small on purpose. The point is to save a person typing the thing they use
 * every week, not to present their whole history — twenty chips is a worse
 * interface than an empty box, and the text field is always there for
 * everything else.
 */
export const SUGGESTION_LIMIT = 4;

export type RecentDetails = Record<DetailField, string[]>;

export const NO_DETAILS: RecentDetails = { place: [], speaker: [], sermonSeries: [] };

/**
 * What two spellings have to share to count as the same value.
 *
 * Deliberately timid. Outer whitespace and letter case only — enough to stop
 * "Pastor John" and "pastor john" both appearing, and nothing more. "St
 * John's" and "Saint John's" stay apart, because they may genuinely be two
 * churches and this has no business deciding they are not.
 */
const sameValue = (value: string): string => value.trim().toLowerCase();

/**
 * Distinct recent values for each field, newest first.
 *
 * `entries` must arrive in the order `listEntries()` returns them — newest
 * event first, ties broken by creation order. That ordering is not re-derived
 * here on purpose: "recent" should mean in this list exactly what it means in
 * the timeline, and two places deciding that separately is how they drift.
 *
 * The first spelling encountered wins, which — given that order — is the most
 * recently saved one. Somebody who has started writing "City Gate Church"
 * instead of "city gate church" sees their newer habit offered back.
 */
export function recentDetails(entries: readonly Entry[], limit = SUGGESTION_LIMIT): RecentDetails {
  const found: RecentDetails = { place: [], speaker: [], sermonSeries: [] };
  const seen: Record<DetailField, Set<string>> = {
    place: new Set(),
    speaker: new Set(),
    sermonSeries: new Set(),
  };

  for (const entry of entries) {
    // Nothing left to learn: every field has all it can show, and a journal of
    // five thousand Sundays should not be read to the end to discover that.
    if (DETAIL_FIELDS.every((field) => found[field].length >= limit)) break;

    for (const field of DETAIL_FIELDS) {
      if (found[field].length >= limit) continue;
      // Trimmed for display as well as for comparison: a save trims these
      // before storing them, so a stored value with an edge of whitespace came
      // from somewhere older or elsewhere, and putting it back into the field
      // verbatim would hand the reader a value their own Save would change.
      const value = (entry[field] ?? '').trim();
      if (!value) continue;
      const key = sameValue(value);
      if (seen[field].has(key)) continue;
      seen[field].add(key);
      found[field].push(value);
    }
  }

  return found;
}

/** Is there anything at all to offer? Keeps the caller from rendering an empty shelf. */
export const hasAnyDetail = (details: RecentDetails): boolean =>
  DETAIL_FIELDS.some((field) => details[field].length > 0);
