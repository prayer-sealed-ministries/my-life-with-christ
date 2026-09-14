/**
 * The reverse index: which topics touch a given passage.
 *
 * topics.json maps topics to scripture, one direction only. Without the reverse
 * lookup, someone reading Matthew 6 has no way of knowing it speaks to money,
 * anxiety and prayer — the topics exist but are invisible from the text, which
 * is where a reader actually is.
 *
 * Built once at module load from topics.json and KJV versification, both of
 * which ship under every data profile. It has no dependency on any division
 * layer whatsoever — not the purchased outlines, not the BSB sections. Under
 * `refs-only` this IS the discovery layer, and it must work there exactly as it
 * does with divisions present.
 *
 * Because it indexes by verse span rather than by division id, it points at
 * whichever scheme is loaded for free: `topicsForSpan` is what the passage and
 * book views call with a segment's range, and a segment is a segment whether it
 * came from an outline entry, a BSB section, or a whole chapter.
 */

import topicsFile from '../data/topics.json';
import versificationData from '../data/kjv/versification.json';
import type { ScriptureRef, Topic } from '../types';
import { buildIndex, referenceSpan, type Span, type VerseIndex } from './verse-index';

const versification: Record<string, number[]> = versificationData;
const topics = topicsFile.topics as Topic[];

/** One topic's claim on one passage. */
export interface TopicTouch {
  topic: Topic;
  ref: ScriptureRef;
}

/** Verse indexes, built once per book on first use. */
const indexes = new Map<string, VerseIndex>();

function indexFor(book: string): VerseIndex | null {
  const cached = indexes.get(book);
  if (cached) return cached;
  const counts = versification[book];
  if (!counts) return null;
  const index = buildIndex(counts);
  indexes.set(book, index);
  return index;
}

/** Every topic ref, resolved to an ordinal span, grouped by book. */
const byBook = new Map<string, Array<TopicTouch & { span: Span }>>();

for (const topic of topics) {
  for (const ref of topic.refs) {
    const index = indexFor(ref.book);
    if (!index) continue;
    const span = referenceSpan(index, ref);
    if (!span) continue;

    const list = byBook.get(ref.book);
    if (list) list.push({ topic, ref, span });
    else byBook.set(ref.book, [{ topic, ref, span }]);
  }
}

/**
 * Topics whose passages overlap the given range.
 *
 * Ordered by how much of the range each topic claims, so the topic a passage is
 * mostly about comes before one that merely clips its edge.
 */
export function topicsForSpan(
  book: string,
  chapterStart: number,
  verseStart: number,
  chapterEnd: number,
  verseEnd: number,
): TopicTouch[] {
  const index = indexFor(book);
  const entries = byBook.get(book);
  if (!index || !entries) return [];

  const target = referenceSpan(index, { chapterStart, verseStart, chapterEnd, verseEnd });
  if (!target) return [];

  const best = new Map<string, { touch: TopicTouch; overlap: number }>();

  for (const entry of entries) {
    const start = Math.max(entry.span.start, target.start);
    const end = Math.min(entry.span.end, target.end);
    if (start > end) continue;

    const overlap = end - start + 1;
    const existing = best.get(entry.topic.id);
    // One topic can cite several passages in the same chapter; keep the ref
    // that overlaps most, so the chip links somewhere representative.
    if (!existing || overlap > existing.overlap) {
      best.set(entry.topic.id, { touch: { topic: entry.topic, ref: entry.ref }, overlap });
    }
  }

  return [...best.values()]
    .sort((a, b) => b.overlap - a.overlap || a.touch.topic.name.localeCompare(b.touch.topic.name))
    .map((row) => row.touch);
}

/** Topics touching a whole chapter. */
export function topicsForChapter(book: string, chapter: number): TopicTouch[] {
  const counts = versification[book];
  if (!counts || chapter < 1 || chapter > counts.length) return [];
  return topicsForSpan(book, chapter, 1, chapter, counts[chapter - 1]);
}

export interface BookTopic {
  topic: Topic;
  /** How many of this topic's passages fall in this book. */
  passages: number;
  /** Where to send a reader who picks it up here. */
  firstRef: ScriptureRef;
}

/**
 * Every topic that touches any part of a book, with how much of it is here.
 *
 * The count is what makes this useful on a book page: "Money — 3 passages" says
 * something a bare chip does not.
 */
export function topicsForBook(book: string): BookTopic[] {
  const entries = byBook.get(book);
  if (!entries) return [];

  const counts = new Map<string, BookTopic>();
  for (const entry of entries) {
    const existing = counts.get(entry.topic.id);
    if (existing) existing.passages += 1;
    else counts.set(entry.topic.id, { topic: entry.topic, passages: 1, firstRef: entry.ref });
  }

  return [...counts.values()].sort(
    (a, b) => b.passages - a.passages || a.topic.name.localeCompare(b.topic.name),
  );
}

/** Books that any topic touches at all — for a coverage sanity check. */
export function booksWithTopics(): string[] {
  return [...byBook.keys()];
}

/** Total topic→passage links, used to assert the index is not empty. */
export function topicLinkCount(): number {
  let total = 0;
  for (const entries of byBook.values()) total += entries.length;
  return total;
}
