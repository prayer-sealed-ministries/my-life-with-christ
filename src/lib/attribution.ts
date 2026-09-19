/**
 * Source attribution, shown on the site and written into every export.
 *
 * ATTRIBUTION is not required by either source: the KJV carries no such
 * condition, and the BSB was dedicated to the public domain in 2023 with an
 * explicit note that attribution is appreciated but not required. It is given
 * by decision. A book meant to be handed to a grandchild should say where its
 * words came from, and "nobody made us" is a poor reason for a record to be
 * silent.
 *
 * Attribution is not the same question as permission, and this file answers
 * only the first. The KJV is public domain in the United States and is NOT in
 * the United Kingdom, where perpetual Crown letters patent apply — a real
 * constraint on a UK-facing deployment that crediting the text does not
 * satisfy. See src/data/kjv/SOURCE.md.
 *
 * The two Scripture sources are separate and are never merged: the verse text
 * is the KJV, and the BSB supplies section headings and the spans they divide
 * the text into, never verse text.
 */

/**
 * Where a build's passage divisions came from.
 *
 * Only these two. A third member named a scheme this repository no longer
 * carries, which made the BSB attribution look like one option among several
 * rather than the only source of divisions there is.
 */
export type DivisionSource = 'sections' | 'none';

export interface Attribution {
  what: string;
  text: string;
  /** Only when the source is actually present in this build. */
  appliesTo: 'always' | DivisionSource;
}

export const ATTRIBUTIONS: Attribution[] = [
  {
    // The verse text, and only the verse text. Present in every build.
    what: 'Scripture text',
    text:
      'Scripture quotations are from the King James Version, which is in the public ' +
      'domain in the United States. In the United Kingdom the KJV remains under ' +
      'perpetual Crown letters patent.',
    appliesTo: 'always',
  },
  {
    // Headings and spans only — the BSB supplies no verse text to this app.
    what: 'Passage divisions and titles',
    text:
      'The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with ' +
      'Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation ' +
      'Committee. This text of God’s Word has been dedicated to the public domain. ' +
      'Section headings are used here with gratitude; attribution is not required.',
    appliesTo: 'sections',
  },
  {
    what: 'Book introductions and topics',
    text:
      'Book introductions and the topic collections were written for this project, ' +
      'drawing on plain historical fact and public-domain reference works.',
    appliesTo: 'always',
  },
];

/** The attributions that apply to a build, given where its divisions came from. */
export function attributionsFor(divisionSource: DivisionSource): Attribution[] {
  return ATTRIBUTIONS.filter(
    (item) => item.appliesTo === 'always' || item.appliesTo === divisionSource,
  );
}

/** Plain text, for the export archive's README. */
export function attributionText(divisionSource: DivisionSource): string {
  return attributionsFor(divisionSource)
    .map((item) => `${item.what}\n${item.text}`)
    .join('\n\n');
}
