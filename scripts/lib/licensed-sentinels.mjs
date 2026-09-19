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
 *
 * WHY THEY ARE ASSEMBLED RATHER THAN WRITTEN OUT
 *
 * The history rewrite that removed this material from the repository also
 * replaced these strings wherever they appeared in any historical blob. This
 * file has to survive that: written out as literals, its own sentinels would
 * have been scrubbed along with everything else and the guard would have gone
 * quietly blind. Joining fragments keeps the runtime value exact while leaving
 * no contiguous copy in the file for a text replacement to match.
 *
 * It also means the one file in the repository that must name this material
 * does not, in fact, contain it.
 */

const parts = [
  ['Creation', 'Story', 'Days', '1-6'],
  ['Adam', 'and', 'Eve', 'Before', 'the', 'Fall'],
  ['Blueprint', 'Outlines'],
];

export const LICENSED_SENTINELS = parts.map((words) => words.join(' '));
