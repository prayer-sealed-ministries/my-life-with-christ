/**
 * How provided sermon notes are attributed, in one place.
 *
 * Every surface that shows somebody else's material says where it came from —
 * the editor, the exported Markdown, the book — and they must say it the same
 * way. Wording that drifted between them would leave one surface implying a
 * church the others do not name.
 *
 * Here rather than beside the parser so that rendering a journal does not pull
 * a PDF engine into its import graph: the archive renderer needs the sentence,
 * not the reader.
 */

import type { Entry, SourceMaterial } from '../types';

/**
 * The attribution line for provided material.
 *
 * Never invents a church. A file that did not state one gets the neutral
 * wording, because a name guessed from a filename would be this app putting
 * words in somebody's mouth on the record of a life.
 */
export function describeProvenance(material: SourceMaterial): string {
  return material.church ? `Provided by ${material.church}` : 'Imported sermon notes';
}

/**
 * The reader's own words in an entry, and somebody else's, kept apart.
 *
 * Both halves are searchable — someone who remembers a phrase from a handout
 * should be able to find the Sunday it belongs to. What must not happen is a
 * result list presenting the second as the first, so the split lives here and
 * every caller reads the same two definitions. Two implementations of "is this
 * the writer's voice" is exactly one more than this product can afford.
 */
export function ownText(entry: Entry): string {
  return [
    entry.title,
    entry.notes,
    entry.reflection,
    entry.prayer ?? '',
    entry.speaker ?? '',
    entry.place ?? '',
    entry.sermonSeries ?? '',
    entry.tags.join(' '),
  ]
    .join('\n')
    .toLowerCase();
}

/** Material provided with the entry, as searchable text. */
export function providedText(entry: Entry): string {
  return [entry.sourceMaterial?.body ?? '', entry.sourceMaterial?.church ?? '']
    .join('\n')
    .toLowerCase();
}

/**
 * Did this entry come back only because provided material matched?
 *
 * `needle` is expected lowercase, as every caller here already has it.
 */
export function matchedOnlyInProvided(entry: Entry, needle: string): boolean {
  if (!needle) return false;
  if (ownText(entry).includes(needle)) return false;
  return providedText(entry).includes(needle);
}
