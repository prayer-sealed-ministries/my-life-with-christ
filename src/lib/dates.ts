/**
 * Entry dates, read as calendar days rather than instants.
 *
 * Two rules, and both exist because getting them wrong loses or alters what
 * someone wrote:
 *
 * 1. `new Date('2026-03-15')` parses as UTC midnight, which renders as the 14th
 *    anywhere west of Greenwich. The parts are read and a local date built, so
 *    an entry stays on the day it actually happened.
 * 2. A date the calendar does not have is not quietly repaired. `new Date(2026,
 *    1, 31)` rolls over to 3 March, so an imported "2026-02-31" would be shown
 *    as a different day than the one on the record. That is the one thing this
 *    project never does — the source reading is kept and shown verbatim.
 *
 * Shared rather than re-derived per view: a note must show the same day
 * everywhere it appears.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The local calendar day an ISO date names, or null if it names none.
 *
 * Null covers both a string that is not an ISO date at all and one that is
 * shaped like a date but is not a day — "2026-02-31", "2026-13-01".
 */
export function localDate(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  // Reject what the Date constructor rolled over rather than presenting it as a
  // day the writer did not write.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long' });

/**
 * A day, written out for a reader.
 *
 * A value that is not a calendar day is returned exactly as stored, so an
 * imported journal never loses information to a formatter. Only a genuinely
 * empty date gets stand-in wording.
 */
export function formatDay(iso: string): string {
  const date = localDate(iso);
  if (date) return dayFormat.format(date);
  return iso.trim() || 'No date recorded';
}

/** The month name for grouping headings, on the same terms as formatDay. */
export function formatMonth(iso: string): string {
  const date = localDate(iso);
  if (date) return monthFormat.format(date);
  return iso.trim() || 'No date recorded';
}
