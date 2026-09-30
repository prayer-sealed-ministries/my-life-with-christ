/**
 * One entry, prepared to leave the app.
 *
 * Pure. It takes a single `Entry` and a selection, and returns a document
 * model. It reads no storage, knows no platform, and cannot reach a second
 * entry — the privacy boundary is the function signature, not a filter applied
 * afterwards.
 *
 * WHOSE WORDS ARE WHOSE
 *
 * The journal keeps four kinds of writing apart and this must not put them back
 * together: what was taught (`notes`), what it meant to the reader
 * (`reflection`), what they prayed (`prayer`), and what somebody else handed
 * them (`sourceMaterial`). Each leaves under its own heading or does not leave
 * at all. A shared page with one unlabelled body would be this feature
 * quietly reassigning authorship of a person's private reflection to a church
 * handout, or the reverse.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 *
 * No id, no timestamps, no visibility, no schema version, no digest, no file
 * path, no tags of internal origin, and nothing about the journal as a whole.
 * A shared entry is a page from somebody's notebook, not a database record.
 */

import { refToString } from '../lib/bible';
import { BOOK_NAMES } from '../lib/canon';
import { formatDay } from '../lib/dates';
import { ENTRY_KIND_LABELS } from '../lib/entry-kinds';
import type { Entry } from '../types';

/**
 * Which parts of an entry a share carries.
 *
 * Every field is an explicit choice. There is no "everything" shortcut on
 * purpose: a person sharing a sermon note with a friend and a person sharing a
 * prayer are doing different things, and the second should never happen by
 * accident because the first was easy.
 */
export interface ShareScope {
  includeScripture: boolean;
  /** Place, speaker, series — the circumstances, not the writing. */
  includeDetails: boolean;
  includeNotes: boolean;
  includeReflection: boolean;
  includePrayer: boolean;
  includeProvidedNotes: boolean;
  includeLinks: boolean;
}

/**
 * The defaults, and why reflection is not among them.
 *
 * Rule 5 of this repository is explicit and is not a preference: "Reflections
 * and prayers require their own affirmative choice, per share — `ShareScope`
 * defaults them to `false`, and that default does not change."
 *
 * The names are the ones that rule uses. They were carried over from a
 * speculative `storage/ShareProvider.ts` — a seam for revocable links and
 * group sharing that was never implemented and has now been retired — because
 * the privacy rule it carried is the part that was worth keeping. The values
 * for notes, reflection, prayer and links are unchanged from what it held.
 *
 * A reflection is the most private thing in the journal after a prayer — it is
 * what a sermon meant to one person — and the common share is "here are the
 * notes from this morning". Defaulting it on would mean that somebody sending
 * a friend the outline of a sermon sends their own spiritual response to it
 * unless they notice and switch it off. Getting that wrong once is not
 * recoverable: the message has been sent.
 *
 * So both stay off, and the options surface shows plainly what is included.
 */
export const PRIVATE_BY_DEFAULT: ShareScope = {
  includeScripture: true,
  includeDetails: true,
  includeNotes: true,
  includeReflection: false,
  includePrayer: false,
  includeProvidedNotes: false,
  includeLinks: true,
};

/** One titled block of the shared page. */
export interface SharedSection {
  heading: string;
  body: string;
  /**
   * True when this is somebody else's material.
   *
   * Carried through to every rendering so the label cannot be lost between the
   * model and the page. A renderer that forgot it would present a church's
   * handout as the reader's own notes.
   */
  provided: boolean;
}

/** An entry, as it will appear wherever it is sent. */
export interface SharedEntryDocument {
  title: string;
  /** The day it happened, in words. Never a timestamp. */
  date: string;
  kind: string;
  scripture: string[];
  /** Circumstances, as label/value pairs. Empty when not selected or not set. */
  details: Array<[string, string]>;
  sections: SharedSection[];
  links: Array<{ url: string; label: string }>;
}

/** An entry with no title still needs to be called something. */
const UNTITLED = 'Untitled entry';

/**
 * Every Scripture reference this entry carries, as a person would write them.
 *
 * Two sources, because the app has two ways of attaching one and a reader
 * cannot tell them apart. `scriptureRefs` holds what somebody typed; `anchors`
 * holds what they chose in the picker — an exact verse, a range, or a passage.
 *
 * Before this, only the first was shared. Choosing "John 3:16" in the picker
 * and leaving "Scripture references" ticked sent no reference at all, and the
 * switch showed "Nothing written here" over an entry that plainly had one. The
 * toggle governs the meaning, not the mechanism that produced it.
 *
 * Topic anchors are deliberately absent. A topic is not a Scripture reference,
 * and sending one under a switch labelled "Scripture references" would share
 * something the label does not describe — which is the kind of surprise this
 * whole surface exists to prevent. A whole-book anchor IS one, and is named the
 * way `indexes/by-book.md` names the same thing.
 *
 * `refToString` is the formatter the editor's own chips use, so a reference
 * reads here exactly as it read when it was chosen. De-duplicated the way the
 * archive's About line is, and in the order the entry holds them: what was
 * typed first, then what was picked.
 */
export function scriptureReferences(entry: Entry): string[] {
  const labels = [
    ...entry.scriptureRefs.map(trimmed),
    ...entry.anchors.flatMap((anchor) => {
      if (anchor.kind === 'scripture') {
        return [refToString(anchor, BOOK_NAMES[anchor.book] ?? anchor.book)];
      }
      if (anchor.kind === 'book') {
        return [`${BOOK_NAMES[anchor.book] ?? anchor.book} (whole book)`];
      }
      return [];
    }),
  ].filter(Boolean);

  return [...new Set(labels)];
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Build the document for exactly one entry.
 *
 * `selection` only ever removes. There is nothing it can switch on that the
 * entry does not already contain, and nothing here reads anything but the
 * entry it was handed.
 */
export function buildSharedEntryDocument(
  entry: Entry,
  selection: ShareScope,
): SharedEntryDocument {
  const sections: SharedSection[] = [];

  const notes = trimmed(entry.notes);
  if (selection.includeNotes && notes) {
    sections.push({ heading: 'My notes', body: notes, provided: false });
  }

  const reflection = trimmed(entry.reflection);
  if (selection.includeReflection && reflection) {
    sections.push({ heading: 'My reflection', body: reflection, provided: false });
  }

  const prayer = trimmed(entry.prayer);
  if (selection.includePrayer && prayer) {
    sections.push({ heading: 'Prayer', body: prayer, provided: false });
  }

  // Last, and labelled. Somebody else's words come after the reader's own and
  // never under a heading that could be mistaken for theirs.
  const provided = trimmed(entry.sourceMaterial?.body);
  if (selection.includeProvidedNotes && provided) {
    sections.push({ heading: 'Provided notes', body: provided, provided: true });
  }

  const details: Array<[string, string]> = [];
  if (selection.includeDetails) {
    const place = trimmed(entry.place);
    const speaker = trimmed(entry.speaker);
    const series = trimmed(entry.sermonSeries);
    if (speaker) details.push(['Speaker', speaker]);
    if (place) details.push(['Place', place]);
    if (series) details.push(['Series', series]);
  }

  return {
    title: trimmed(entry.title) || UNTITLED,
    date: formatDay(entry.date),
    kind: ENTRY_KIND_LABELS[entry.kind] ?? entry.kind,
    scripture: selection.includeScripture ? scriptureReferences(entry) : [],
    details,
    sections,
    links: selection.includeLinks
      ? entry.links
          .filter((link) => trimmed(link.url))
          .map((link) => ({ url: trimmed(link.url), label: trimmed(link.label) || trimmed(link.url) }))
      : [],
  };
}

/**
 * The document as plain text.
 *
 * For a message, an email body, or a clipboard. Deliberately without Markdown
 * punctuation: somebody pasting this into a text message should not receive a
 * page of hashes and asterisks. Headings carry themselves by being on their own
 * line with a blank line before them, which is how a person writes a note
 * anyway.
 *
 * The body of each section is the reader's own Markdown, left exactly as they
 * typed it. Stripping their emphasis would be editing their writing.
 */
export function renderSharedEntryText(document: SharedEntryDocument): string {
  const lines: string[] = [document.title];

  lines.push(document.date);
  if (document.scripture.length > 0) lines.push(document.scripture.join('; '));
  for (const [label, value] of document.details) lines.push(`${label}: ${value}`);

  for (const section of document.sections) {
    lines.push('', section.heading, '', section.body);
  }

  if (document.links.length > 0) {
    lines.push('', 'Links', '');
    for (const link of document.links) {
      lines.push(link.label === link.url ? link.url : `${link.label} — ${link.url}`);
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

/**
 * The document as Markdown.
 *
 * Offered separately because the two audiences want different things: a text
 * message wants no syntax, a note-taking app wants headings it can fold. Same
 * content, same order, same labels — only the punctuation differs.
 */
export function renderSharedEntryMarkdown(document: SharedEntryDocument): string {
  const lines: string[] = [`# ${document.title}`, '', document.date];

  if (document.scripture.length > 0) lines.push(`*${document.scripture.join('; ')}*`);
  for (const [label, value] of document.details) lines.push(`**${label}:** ${value}`);

  for (const section of document.sections) {
    lines.push('', `## ${section.heading}`, '', section.body);
  }

  if (document.links.length > 0) {
    lines.push('', '## Links', '');
    for (const link of document.links) lines.push(`- [${link.label}](${link.url})`);
  }

  return `${lines.join('\n').trim()}\n`;
}

/** A filename for a shared entry. Never an id, never a path. */
export function sharedEntryFilename(document: SharedEntryDocument, extension: string): string {
  const stem =
    document.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'entry';
  return `${stem}.${extension}`;
}
