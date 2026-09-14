/**
 * Source attribution, shown on the site and written into every export.
 *
 * None of this is legally required. The KJV is public domain in the US, and the
 * BSB was dedicated to the public domain in 2023 with an explicit note that
 * attribution is appreciated but not required. It is given anyway, by decision:
 * a book meant to be handed to a grandchild should say where its words came
 * from, and "nobody made us" is a poor reason for a record to be silent.
 */

export interface Attribution {
  what: string;
  text: string;
  /** Only when the source is actually present in this build. */
  appliesTo: 'always' | 'sections';
}

export const ATTRIBUTIONS: Attribution[] = [
  {
    what: 'Scripture text',
    text:
      'Scripture quotations are from the King James Version, which is in the public ' +
      'domain in the United States. In the United Kingdom the KJV remains under ' +
      'perpetual Crown letters patent.',
    appliesTo: 'always',
  },
  {
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
export function attributionsFor(divisionSource: 'outlines' | 'sections' | 'none'): Attribution[] {
  return ATTRIBUTIONS.filter(
    (item) => item.appliesTo === 'always' || item.appliesTo === divisionSource,
  );
}

/** Plain text, for the export archive's README. */
export function attributionText(divisionSource: 'outlines' | 'sections' | 'none'): string {
  return attributionsFor(divisionSource)
    .map((item) => `${item.what}\n${item.text}`)
    .join('\n\n');
}
