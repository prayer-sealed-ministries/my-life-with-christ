/**
 * The divisions, and the one place they become available.
 *
 * Every consumer of section data asks this module for it. Nothing else in the
 * application imports `virtual:journey-outlines`, and nothing else calls
 * `import()` for it — one boundary, so that "where does the Scripture data
 * enter the module graph?" has exactly one answer, and so that the answer can
 * be held, delayed or failed on purpose by a test.
 *
 * WHY IT IS DEFERRED AT ALL
 *
 * Under `public` the payload is about 760 kB of BSB section headings. It was
 * two thirds of the startup chunk, and it sat on the path between tapping the
 * home-screen widget and typing the first sentence of a sermon note — where it
 * is needed by nothing. Fast Capture promises speed, so speed is a feature, and
 * a feature is allowed to have an architecture.
 *
 * WHAT DEFERRED DOES NOT MEAN
 *
 * It does not mean fetched. The chunk is bundled into the app and served from
 * it; there is no request, no origin, and no network permission — see rule 6 in
 * CLAUDE.md. An installed app with the radio off browses Scripture exactly as
 * it does online. The only thing that changed is WHEN the bytes are parsed.
 *
 * IT IS STILL SHIPPED DATA
 *
 * A lazily-loaded chunk is published the moment the build is. The data gate
 * walks the whole of `dist/`, so it reads this chunk with the same eyes as the
 * startup one, and `scripts/__tests__/data-profile.test.mjs` proves the walk
 * covers it.
 */

import { useEffect, useState } from 'react';

import { chapterSegments, hasOutlines, hasOutlineTitles, versification } from './data';
import { BOOK_NAMES } from '../lib/canon';
import { buildSegments } from '../lib/passages';
import type { OutlineBook, OutlineEntry, PassageSegment } from '../types';

/**
 * The divisions, plus everything that can only be answered once they are here.
 *
 * Handed out as one object rather than as loose exports so that a consumer
 * cannot hold half of it: a view that has `segmentsForBook` provably also has
 * the data it reads, because they arrived together.
 */
export type Sections = {
  outlineBooks: OutlineBook[];
  outlineBooksById: Map<string, OutlineBook>;
  outlineEntriesById: Map<string, OutlineEntry>;
  /** How many outline entries a book has. Zero under `refs-only`. */
  entryCountFor(bookId: string): number;
  segmentsForBook(bookId: string): PassageSegment[];
  segmentContaining(bookId: string, chapter: number, verse?: number): PassageSegment | undefined;
  findSegment(bookId: string, segmentId: string): PassageSegment | undefined;
  segmentTitle(segment: PassageSegment): string;
  segmentNote(segment: PassageSegment): string | null;
};

function build(outlines: OutlineBook[]): Sections {
  const outlineBooks = outlines;
  const outlineBooksById = new Map(outlineBooks.map((book) => [book.id, book]));
  const outlineEntriesById = new Map(
    outlineBooks.flatMap((book) => book.entries.map((entry) => [entry.id, entry] as const)),
  );

  /**
   * Segments for a book, computed once and cached.
   *
   * Every verse belongs to exactly one segment, so there is never a passage the
   * reader can reach but not write against. What the segments ARE depends on
   * the data profile: outline entries plus the gaps between them under
   * `public`, whole chapters under `refs-only`.
   */
  const segmentCache = new Map<string, PassageSegment[]>();

  function segmentsForBook(bookId: string): PassageSegment[] {
    const cached = segmentCache.get(bookId);
    if (cached) return cached;

    const counts = versification[bookId];
    if (!counts) return [];

    const book = outlineBooksById.get(bookId);
    const segments =
      hasOutlines && book
        ? buildSegments(
            { id: bookId, name: BOOK_NAMES[bookId] ?? bookId, entries: book.entries },
            counts,
          )
        : chapterSegments(bookId, counts);

    segmentCache.set(bookId, segments);
    return segments;
  }

  /**
   * Find the segment containing a chapter/verse position.
   *
   * Used when a link arrives carrying a segment id this build does not have —
   * a journal written under `public` and read under `refs-only`, say. The
   * passage is still reachable; only the division it was filed under has gone.
   */
  function segmentContaining(bookId: string, chapter: number, verse = 1) {
    return segmentsForBook(bookId).find(
      (segment) =>
        (chapter > segment.chapterStart ||
          (chapter === segment.chapterStart && verse >= segment.verseStart)) &&
        (chapter < segment.chapterEnd ||
          (chapter === segment.chapterEnd && verse <= segment.verseEnd)),
    );
  }

  function findSegment(bookId: string, segmentId: string) {
    return segmentsForBook(bookId).find((segment) => segment.id === segmentId);
  }

  /** The title to show for a segment, whatever the data profile. */
  function segmentTitle(segment: PassageSegment): string {
    if (segment.kind === 'uncovered') return segment.ref;
    if (!hasOutlineTitles) return segment.ref;
    return segment.entry.displayTitle || segment.entry.title || segment.ref;
  }

  /**
   * How to describe a segment that carries no outline entry.
   *
   * The wording differs by profile, and getting it wrong is confusing: under
   * `refs-only` there is no outline layer at all, so "no outline entry for this
   * passage" would imply something is missing that was never meant to be there.
   */
  function segmentNote(segment: PassageSegment): string | null {
    if (segment.kind === 'outline') return null;
    return hasOutlines
      ? 'No outline entry — read it and add your own note'
      : 'Read it and add your own note';
  }

  return {
    outlineBooks,
    outlineBooksById,
    outlineEntriesById,
    entryCountFor: (bookId) => outlineBooksById.get(bookId)?.entries.length ?? 0,
    segmentsForBook,
    segmentContaining,
    findSegment,
    segmentTitle,
    segmentNote,
  };
}

/**
 * How the payload is fetched from the bundle.
 *
 * A variable rather than a bare `import()` at the call site, because a test
 * needs to hold it, delay it or fail it — and must do so WITHOUT substituting
 * different data. Overriding this replaces the timing, never the contents: the
 * default still resolves the same generated module the application ships, and
 * `sections-parity.test.ts` asserts that is what a held loader eventually
 * yields. The PDF lane's lesson, applied here before it could cost anything.
 */
type Loader = () => Promise<{ outlines: OutlineBook[] }>;

const bundled: Loader = () => import('virtual:journey-outlines');

let loader: Loader = bundled;
let inFlight: Promise<Sections> | null = null;
let ready: Sections | null = null;

/**
 * Which attempt we are on, and who is waiting on it.
 *
 * Module-level rather than per-component because the retry is pressed in one
 * place — the boundary — and has to reach every hook that gave up.
 */
let attempt = 0;
const listeners = new Set<() => void>();

/**
 * Ask for the divisions.
 *
 * The same promise every time, because `use()` needs a stable one and because
 * a second caller during the first load must not start a second parse. Once it
 * has resolved the module system holds the chunk, so a later call is a cache
 * hit in the loader rather than anything this file has to remember for it.
 */
export function loadSections(): Promise<Sections> {
  if (!inFlight) {
    inFlight = loader().then((module) => {
      ready = build(module.outlines);
      return ready;
    });
  }
  return inFlight;
}

/**
 * The divisions if they are already here, and null otherwise.
 *
 * For the places that can show something useful without them and something
 * better with them — never for guessing at content. A caller that cannot
 * render honestly without the data waits for it instead.
 */
export function sectionsIfLoaded(): Sections | null {
  return ready;
}

/**
 * The divisions for a surface that cannot do its job without them.
 *
 * Returns null while they are on the way, so the caller shows a waiting state;
 * THROWS if the load failed, so `SectionsBoundary` can say so once and offer a
 * retry. Two different answers to two different questions — "not yet" and "not
 * coming" — which is the distinction a single nullable value would lose.
 *
 * Deliberately not `use()` and Suspense, which is where this started. Two
 * things were measured and neither is a matter of taste:
 *
 *   - A suspended child holds the commit for its whole tree. Passage History
 *     stopped settling its URL and stopped reading the journal, because one
 *     link in the corner of the page was waiting. Those effects have nothing
 *     to do with Scripture.
 *   - A suspending `use()` never recovers under this project's test host. A
 *     ten-line probe — a module-level promise, a Suspense boundary, a ten
 *     millisecond delay — stays on the fallback for ever. A mechanism whose
 *     failure cannot be written down as a test is not one this repository
 *     ships; that is the whole of CLAUDE.md's argument about instruments.
 */
export function useSections(): Sections | null {
  const state = useSectionsState(true);
  if (state.failed) throw new SectionsUnavailableError();
  return state.sections;
}

/** Thrown into `SectionsBoundary`, which is the only thing that catches it. */
export class SectionsUnavailableError extends Error {
  constructor() {
    super('The Scripture division data could not be loaded');
    this.name = 'SectionsUnavailableError';
  }
}

type SectionsState = { sections: Sections | null; failed: boolean };

/**
 * The shared machinery under both hooks.
 *
 * One effect, one subscription, one retry story. Kept private because a
 * caller should be choosing between "I need these" and "I can manage without
 * them", not assembling the answer out of parts.
 */
function useSectionsState(enabled: boolean): SectionsState {
  const [state, setState] = useState<SectionsState>(() => ({
    sections: ready,
    failed: false,
  }));
  // Which attempt this component is on. State, not a read of the module
  // variable: a module variable changing re-renders nothing, and the retry is
  // pressed somewhere else entirely.
  const [round, setRound] = useState(attempt);

  useEffect(() => {
    const listener = () => setRound(attempt);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!enabled || state.sections) return;
    let live = true;
    loadSections().then(
      (sections) => {
        if (live) setState({ sections, failed: false });
      },
      () => {
        if (live) setState({ sections: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, state.sections, round]);

  return state;
}

/**
 * The divisions when they are here, without suspending while they are not.
 *
 * For a surface that has something true to show either way and must not stop
 * showing it: the search view keeps its input focused and its journal results
 * on screen while the divisions arrive, which suspending in place would not —
 * the whole view would be replaced by a fallback mid-keystroke and the caret
 * would go with it.
 *
 * `enabled` is when to START asking, so that merely opening a surface does not
 * commit it to the payload. Returns null until the load resolves, and a caller
 * that cannot be honest with null must wait for the data rather than guess.
 */
export function useSectionsOptional(enabled: boolean): Sections | null {
  // A rejection is not this hook's to report: it leaves the value null, which
  // every caller here already handles, and a surface that cannot proceed
  // without the data uses `useSections` instead.
  return useSectionsState(enabled).sections;
}

/**
 * Try again after a failure.
 *
 * Clearing the promise is the whole of it: the next `loadSections()` asks the
 * module system again, which is what a retry means when the bytes are local.
 */
export function retrySections(): void {
  if (ready) return;
  inFlight = null;
  // Every mounted hook is watching this, so clearing the promise alone would
  // not restart anything: the effects have already run and their dependencies
  // have not changed. Bumping the attempt is what asks again.
  attempt += 1;
  for (const listener of listeners) listener();
}

/**
 * The test seam.
 *
 * Swaps HOW the payload arrives, never WHAT arrives. Passing no loader
 * restores the bundled one.
 */
export function __setSectionsLoader(next?: Loader): void {
  loader = next ?? bundled;
  inFlight = null;
  ready = null;
  attempt += 1;
  for (const listener of listeners) listener();
}
