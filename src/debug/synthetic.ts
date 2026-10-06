/**
 * Finding the throwaway content an acceptance run leaves behind.
 *
 * Automated and manual acceptance runs write entries and drafts with
 * deliberately unmistakable titles. When a run fails part way through — which
 * is most of them, while the automation is being built — that content stays in
 * the journal, and on a phone there is no way to clear it in bulk.
 *
 * This finds it, and it is deliberately narrow about how. The markers are
 * matched EXACTLY and case-sensitively, as substrings of the title and nothing
 * else: not the notes, not the reflection, not a fuzzy match, not a date range,
 * not "everything written today". The one thing this must never do is take a
 * real entry with it, and the only defence that holds is refusing to be clever
 * about what counts.
 *
 * It returns what it found rather than deleting anything. Deciding is somebody
 * else's job, and the caller is expected to show the list first.
 */

import type { Entry, EntryDraft } from '../types';

/**
 * The exact markers. Both are strings no one would write by accident:
 * `ZZSHARE` prefixes the share-acceptance fixtures, `zzios-sermon` was the
 * bring-up lane's probe entry.
 */
export const SYNTHETIC_MARKERS = ['ZZSHARE', 'zzios-sermon'] as const;

/** Case-sensitive on purpose — see the note above about not being clever. */
export function isSyntheticTitle(title: string): boolean {
  return SYNTHETIC_MARKERS.some((marker) => title.includes(marker));
}

/** One thing found, named as the reader will see it in the confirmation. */
export interface SyntheticItem {
  id: string;
  title: string;
}

export interface SyntheticFinds {
  entries: SyntheticItem[];
  drafts: SyntheticItem[];
}

export function findSynthetic(entries: Entry[], drafts: EntryDraft[]): SyntheticFinds {
  return {
    entries: entries
      .filter((entry) => isSyntheticTitle(entry.title))
      .map((entry) => ({ id: entry.id, title: entry.title })),
    drafts: drafts
      .filter((draft) => isSyntheticTitle(draft.form.title))
      .map((draft) => ({ id: draft.id, title: draft.form.title })),
  };
}

export function countOf(finds: SyntheticFinds): number {
  return finds.entries.length + finds.drafts.length;
}
