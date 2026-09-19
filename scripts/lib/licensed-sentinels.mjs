/**
 * The minimum distinctive wording that would identify licensed third-party
 * material if it ever came back.
 *
 * One list, read by the repository guard and by the build verifier, so the two
 * cannot drift into disagreeing about what they are looking for.
 *
 * Kept deliberately short. A guard that embedded a substantial excerpt of the
 * licensed work in order to detect the licensed work would be republishing it
 * to detect it; these are the fewest words that cannot plausibly be written by
 * accident. See DATA-LICENSE.md.
 */
export const LICENSED_SENTINELS = [
  '[licensed content removed]',
  '[licensed content removed]',
  '[licensed content removed]',
];
