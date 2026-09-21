/**
 * A reader's own history with a passage.
 *
 * "When has this passage appeared in my walk with Christ?" — answered from the
 * entries themselves and nothing else. There is no index here and no stored
 * derivation: retrieval is `entriesAnchoredTo`, already proven against the
 * overlap contract, and this module only decides how the answer is presented.
 *
 * That matters more than it sounds. A persisted passage index would be a second
 * copy of a relationship the anchors already record, and it would go stale the
 * first time an entry was edited, deleted, imported or restored. Deriving it
 * every time costs one pass over the journal and cannot disagree with the
 * journal.
 *
 * Ordering is oldest first, which is the opposite of search. Search answers
 * "where is that thing I half remember", where recency is a good guess. This
 * page tells a story across a life, and a story starts at the beginning.
 */

import { anchorOverlaps, entriesAnchoredTo } from './journal-search';
import type { Entry, ScriptureRef } from '../types';

/**
 * Which of the reader's own fields speaks for an entry on this page, in order.
 *
 * Reflection first, and deliberately: `notes` is what was taught and
 * `reflection` is what it meant to them (see the operating contract — the two
 * are never merged). A page about a person's history with a passage is asking
 * the second question, so the second field answers it. Notes are the fallback
 * for an entry that records a sermon without a reflection, and prayer for an
 * entry that is only a prayer.
 */
export const EXCERPT_ORDER = ['reflection', 'notes', 'prayer'] as const;

export type ExcerptSource = (typeof EXCERPT_ORDER)[number] | 'provided';

export interface Excerpt {
  source: ExcerptSource;
  /** Shown only when the words are not the reader's own. */
  label: string | null;
  /** Verbatim from the entry. Never summarised, never rewritten. */
  text: string;
}

/** Long enough to recognise the moment, short enough not to be the entry. */
export const EXCERPT_LIMIT = 180;

function trim(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_LIMIT) return text;
  // Cut at a word boundary where there is one nearby, so the excerpt does not
  // end mid-word for the sake of a character count.
  const cut = text.slice(0, EXCERPT_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_LIMIT - 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The line of the entry's own writing that makes the moment recognisable.
 *
 * Returns null rather than inventing anything when the entry has no prose at
 * all — a dated title and kind is a perfectly good record of a moment, and a
 * placeholder sentence would be this page writing on the reader's behalf.
 *
 * Provided material is last and always labelled. A church's handout is not the
 * reader's reflection, and this page is entirely about which is which.
 */
export function excerptFor(entry: Entry): Excerpt | null {
  for (const source of EXCERPT_ORDER) {
    const raw = source === 'prayer' ? (entry.prayer ?? '') : entry[source];
    if (raw && raw.trim()) return { source, label: null, text: trim(raw) };
  }

  const provided = entry.sourceMaterial?.body ?? '';
  if (provided.trim()) return { source: 'provided', label: 'Provided notes', text: trim(provided) };

  return null;
}

export interface HistoryYear {
  year: string;
  entries: Entry[];
}

/**
 * The passage's entries, oldest first, gathered into the years they fall in.
 *
 * Years with nothing in them are absent rather than empty: this is a record of
 * what happened, and a run of blank years would be the page inventing a
 * calendar the reader did not write.
 *
 * A date the calendar does not have keeps its own stored text as the heading,
 * for the same reason `formatDay` does — an imported journal never loses
 * information to a formatter.
 */
export function groupByYear(entries: Entry[]): HistoryYear[] {
  const years: HistoryYear[] = [];
  for (const entry of entries) {
    const year = /^(\d{4})-/.exec(entry.date)?.[1] ?? (entry.date.trim() || 'No date recorded');
    const last = years[years.length - 1];
    if (last && last.year === year) last.entries.push(entry);
    else years.push({ year, entries: [entry] });
  }
  return years;
}

export interface PassageHistory {
  ref: ScriptureRef;
  entries: Entry[];
  years: HistoryYear[];
  /** Descriptive, never a score. See the terminology note in the lane brief. */
  total: number;
}

/**
 * Everything saved that overlaps this passage, ready to render.
 *
 * `entriesAnchoredTo` is the whole of the retrieval, so the overlap semantics
 * here are exactly the ones already tested: a chapter query reaches a verse
 * anchored inside it, a verse query reaches a range containing it, ranges may
 * span chapters, and Mark 15 is never John 15.
 *
 * Drafts never reach this function because they are a separate collection and
 * are not entries. That is the design, not a filter that could be forgotten.
 */
export function passageHistory(entries: Entry[], ref: ScriptureRef): PassageHistory {
  const found = entriesAnchoredTo(entries, ref);
  return { ref, entries: found, years: groupByYear(found), total: found.length };
}

/**
 * The anchors that are the reason this entry is on this page.
 *
 * Overlap, not "same book": an entry anchored to John 3 and John 15 is here
 * because of the second, and showing the first beside it would be the page
 * claiming a connection the retrieval never made.
 */
export type ScriptureAnchor = Extract<Entry['anchors'][number], { kind: 'scripture' }>;

export function matchingAnchors(entry: Entry, ref: ScriptureRef): ScriptureAnchor[] {
  return entry.anchors.filter(
    (anchor): anchor is ScriptureAnchor => anchorOverlaps(anchor, ref),
  );
}
