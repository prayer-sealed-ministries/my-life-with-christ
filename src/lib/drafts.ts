/**
 * What counts as work worth keeping, and when a queued write may still land.
 *
 * Both questions are pure, and both are here rather than inside the editor
 * because they are the parts that have to be exactly right. One decides whether
 * a person has begun writing; the other decides whether a write that was
 * queued before the last one finished is still allowed to touch the store.
 */

import type { DraftForm, EntryDraft } from '../types';

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
