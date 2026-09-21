/**
 * What counts as work worth keeping, and when a queued write may still land.
 *
 * Both questions are pure, and both are here rather than inside the editor
 * because they are the parts that have to be exactly right. One decides whether
 * a person has begun writing; the other decides whether a write that was
 * queued before the last one finished is still allowed to touch the store.
 */

import type { DraftForm, DraftLinkRow, EntryAnchor, EntryDraft, SourceMaterial } from '../types';

/**
 * How long typing settles before the snapshot is written.
 *
 * A single named constant rather than a number scattered through the editor, so
 * the loss window has one place to be reasoned about and one place to be
 * changed. Long enough that a fast typist does not write on every keystroke,
 * short enough that the window of unsaved text stays a sentence rather than a
 * paragraph.
 *
 * This is the whole worst case: text typed inside the current window is the
 * only text a process death can take.
 */
export const DRAFT_DEBOUNCE_MS = 400;

/**
 * Has the reader actually begun?
 *
 * A blank editor must leave nothing behind — opening "new entry" and changing
 * your mind should not litter the store with an empty draft that then shows up
 * offering to be continued.
 *
 * `date` and `kind` are deliberately excluded: every blank editor has both, so
 * counting them would make every blank editor meaningful and the predicate
 * would answer yes to nothing at all having happened.
 *
 * Everything else a person can put into the form counts, including imported
 * source material — choosing and importing a handout is work, and losing it
 * means doing it again.
 */
export function hasDraftContent(form: DraftForm): boolean {
  if (form.title.trim()) return true;
  if (form.notes.trim()) return true;
  if (form.reflection.trim()) return true;
  if (form.prayer.trim()) return true;
  if (form.place.trim()) return true;
  if (form.speaker.trim()) return true;
  if (form.sermonSeries.trim()) return true;
  if (form.tagsText.trim()) return true;
  if (form.anchors.length > 0) return true;
  if (form.scriptureRefs.length > 0) return true;
  if (form.forDescendants) return true;
  if (form.sourceMaterial) return true;
  // A row with only its display text typed is still a row on their screen.
  return form.links.some((link) => link.url.trim() || link.label.trim() || link.capturedTitle.trim());
}

/** What a queued snapshot is allowed to do by the time it is serviced. */
export type DraftWriteOutcome = 'write' | 'superseded' | 'retired';

export interface DraftWriteState {
  /** The generation this queued write is carrying. */
  generation: number;
  /** The newest generation queued so far. */
  latest: number;
  /**
   * Set once the draft has been retired — saved, or discarded.
   *
   * A fence rather than a flag on the caller: after an explicit Save the draft
   * is gone, and a write still in flight from before the save must not put it
   * back. That is the sequence that would otherwise resurrect old text over a
   * finished entry.
   */
  retired: boolean;
}

/**
 * May this write proceed?
 *
 * The ordering rule is about generations, not about timing. Anything resting on
 * "the later timer will win" is a race; a write that knows it is carrying stale
 * content can simply decline, whatever order the timers happen to fire in.
 */
export function resolveDraftWrite({ generation, latest, retired }: DraftWriteState): DraftWriteOutcome {
  if (retired) return 'retired';
  if (generation < latest) return 'superseded';
  return 'write';
}

/**
 * Is this draft worth offering back to the reader?
 *
 * Guards the resume surfaces. A draft whose content has since been emptied is
 * not something to invite anyone back into.
 */
export const isResumable = (draft: EntryDraft): boolean => hasDraftContent(draft.form);

/** Newest first, for "continue where you left off". */
export const byRecency = (a: EntryDraft, b: EntryDraft): number =>
  b.updatedAt.localeCompare(a.updatedAt);

/**
 * Is there anything here that a recovery could give back?
 *
 * `hasDraftContent` above answers "has somebody begun", which is the right
 * question for a blank page and the wrong one for a saved entry. Opening an
 * entry that already holds a paragraph hydrates the editor with that paragraph,
 * and a predicate that only asks "is there content" answers yes to it — so
 * merely *reading* an entry minted a recovery draft, and the home page then
 * offered to "continue writing" something nobody had touched.
 *
 * A draft exists to hold what is NOT in the journal yet. When the editor holds
 * exactly what the journal already holds, there is nothing to recover: a
 * process death costs nothing, because reopening the entry shows the same words
 * from the canonical record.
 *
 * `canonical` is the saved entry expressed in editor form — precisely what
 * reopening this editor would show. `null` means there is no saved entry behind
 * this form, and then the blank-page question is the correct one after all.
 */
export function hasRecoverableChanges(form: DraftForm, canonical: DraftForm | null): boolean {
  if (!canonical) return hasDraftContent(form);
  return !draftFormsEqual(form, canonical);
}

/** Same in every field, compared as the editor holds them. */
type FieldEquality = { [K in keyof DraftForm]: (a: DraftForm[K], b: DraftForm[K]) => boolean };

const sameStrings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const sameLinks = (a: readonly DraftLinkRow[], b: readonly DraftLinkRow[]): boolean =>
  a.length === b.length &&
  a.every((link, index) => {
    const other = b[index];
    return (
      link.url === other.url &&
      link.label === other.label &&
      link.capturedTitle === other.capturedTitle &&
      link.capturedAt === other.capturedAt
    );
  });

const sameAnchors = (a: readonly EntryAnchor[], b: readonly EntryAnchor[]): boolean =>
  a.length === b.length &&
  a.every((anchor, index) => {
    const other = b[index];
    if (anchor.kind !== other.kind) return false;
    if (anchor.kind === 'topic') return anchor.topicId === (other as typeof anchor).topicId;
    if (anchor.kind === 'book') return anchor.book === (other as typeof anchor).book;
    const scripture = other as typeof anchor;
    return (
      anchor.book === scripture.book &&
      anchor.chapterStart === scripture.chapterStart &&
      anchor.verseStart === scripture.verseStart &&
      anchor.chapterEnd === scripture.chapterEnd &&
      anchor.verseEnd === scripture.verseEnd &&
      anchor.outlineEntryId === scripture.outlineEntryId &&
      anchor.note === scripture.note
    );
  });

/**
 * Provided material never makes an unchanged editor dirty.
 *
 * Compared field by field rather than by reference: a form restored from a
 * draft carries a structurally identical handout that is a different object,
 * and reference equality would call every restored editor changed forever.
 */
const sameSourceMaterial = (a: SourceMaterial | null, b: SourceMaterial | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.format === b.format &&
    a.filename === b.filename &&
    a.importedAt === b.importedAt &&
    a.sha256 === b.sha256 &&
    a.church === b.church &&
    a.speaker === b.speaker &&
    a.date === b.date &&
    a.body === b.body &&
    a.parserVersion === b.parserVersion &&
    sameStrings(a.scripture ?? [], b.scripture ?? [])
  );
};

/**
 * One comparator per field, and the type says so.
 *
 * Deliberately a map rather than a chain of `&&`: adding a field to `DraftForm`
 * without deciding how it compares fails to compile, instead of silently
 * becoming a field that no edit to it can ever produce a recovery draft for.
 * That failure would be invisible — the editor would work, the draft would just
 * quietly not hold one of the things somebody wrote.
 */
const SAME_FIELD: FieldEquality = {
  kind: Object.is,
  title: Object.is,
  date: Object.is,
  place: Object.is,
  speaker: Object.is,
  sermonSeries: Object.is,
  notes: Object.is,
  reflection: Object.is,
  prayer: Object.is,
  tagsText: Object.is,
  forDescendants: Object.is,
  scriptureRefs: sameStrings,
  links: sameLinks,
  anchors: sameAnchors,
  sourceMaterial: sameSourceMaterial,
};

const FORM_FIELDS = Object.keys(SAME_FIELD) as (keyof DraftForm)[];

/**
 * Do these two forms hold the same thing?
 *
 * Exact, and deliberately not normalised. Trimming here to make the comparison
 * tidier would decide that a paragraph somebody ended with a deliberate blank
 * line is the same as one they did not, and a recovery snapshot exists to give
 * back what was on the screen rather than a cleaned-up version of it.
 */
export function draftFormsEqual(a: DraftForm, b: DraftForm): boolean {
  if (a === b) return true;
  return FORM_FIELDS.every((key) => {
    const equal = SAME_FIELD[key] as (x: unknown, y: unknown) => boolean;
    return equal(a[key], b[key]);
  });
}
