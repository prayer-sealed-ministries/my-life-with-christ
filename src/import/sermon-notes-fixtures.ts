/**
 * Church sermon notes, invented here rather than checked in.
 *
 * Every one of these is written by this repository and owned by it. No real
 * church's handout is committed: the material would be somebody else's to
 * licence, and a fixture is a poor reason to take on that question.
 *
 * Built in code for the same reason as the document fixtures beside them — the
 * exact bytes a test relies on are visible in the test, and a hostile fixture
 * can be described rather than shipped. Nothing here is imported by the
 * application, so none of it reaches a build; `verify-bundle` proves that
 * against the artefact rather than trusting it.
 */

import { pdf } from './fixtures';
import { SERMON_NOTES_FORMAT } from './sermon-notes';

const encoder = new TextEncoder();

export const bytes = (text: string): Uint8Array => encoder.encode(text);

/** Latin-1, the encoding a PDF's structural bytes are written in. */
export function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** A plain-text handout. */
export const TXT_NOTES = [
  'SETTING GODLY PRIORITIES',
  'City Gate Church, 20 September 2026',
  '',
  'Matthew 6:19-34',
  '',
  '1. Where your treasure is, your heart follows.',
  '2. No one can serve two masters.',
  '3. Seek first the kingdom.',
  '',
  'Question for the week: what am I storing up?',
].join('\n');

/** The same handout as Markdown, with formatting a church would actually use. */
export const MD_NOTES = [
  '# Setting Godly Priorities',
  '',
  '**City Gate Church** — Pastor John Smith',
  '',
  '> Matthew 6:19-34',
  '',
  '1. Where your treasure is, your heart follows.',
  '2. No one can serve two masters.',
  '3. Seek first the kingdom.',
].join('\n');

/**
 * Markdown carrying markup that must never become markup.
 *
 * Not a hypothetical: a church's export tool could easily paste HTML into a
 * body field, and a handout is a file the reader did not write.
 */
export const MD_WITH_HTML = [
  '# Notes',
  '',
  '<script>window.__pwned = true;</script>',
  '',
  '<img src=x onerror="window.__pwned = true">',
  '',
  'A real line, after the noise.',
].join('\n');

/** A complete, valid structured file. */
export const JSON_NOTES = JSON.stringify(
  {
    format: SERMON_NOTES_FORMAT,
    version: 1,
    title: 'Setting Godly Priorities',
    church: 'City Gate Church',
    speaker: 'Pastor John Smith',
    date: '2026-09-20',
    scripture: ['Matthew 6:19-34'],
    bodyMarkdown: '# Setting Godly Priorities\n\n1. Where your treasure is.\n2. Two masters.\n',
  },
  null,
  2,
);

/** Only what the format requires, and nothing else. */
export const JSON_MINIMAL = JSON.stringify({
  format: SERMON_NOTES_FORMAT,
  version: 1,
  bodyMarkdown: 'Just the notes.',
});

/** A version from a future this build cannot read. */
export const JSON_FUTURE_VERSION = JSON.stringify({
  format: SERMON_NOTES_FORMAT,
  version: 2,
  bodyMarkdown: 'Written by something newer.',
});

/** Everything but the one field that is required. */
export const JSON_NO_BODY = JSON.stringify({
  format: SERMON_NOTES_FORMAT,
  version: 1,
  title: 'A sermon with no sermon in it',
  church: 'City Gate Church',
});

/** Right shape, wrong file. */
export const JSON_WRONG_FORMAT = JSON.stringify({
  format: 'somebody-elses-sermon-format',
  version: 1,
  bodyMarkdown: 'Not ours to read.',
});

/** Not JSON at all. */
export const JSON_MALFORMED = '{ "format": "my-life-with-christ-sermon-notes", version: }';

/**
 * A structured file carrying every shape the parser must refuse to be moved by:
 * a prototype-shaped key, fields of the wrong type, a date that is not one, and
 * names this build has never heard of.
 */
export const JSON_HOSTILE = [
  '{',
  `  "format": ${JSON.stringify(SERMON_NOTES_FORMAT)},`,
  '  "version": 1,',
  '  "bodyMarkdown": "The only real field here.",',
  '  "__proto__": { "polluted": true },',
  '  "constructor": { "prototype": { "polluted": true } },',
  '  "church": 12345,',
  '  "speaker": { "name": "not a string" },',
  '  "date": "2026-02-31",',
  '  "scripture": ["Matthew 6:19-34", 7, null, { "ref": "no" }],',
  '  "kind": "prayer",',
  '  "notes": "this must never become the reader\'s notes",',
  '  "reflection": "nor this",',
  '  "somethingFromTheFuture": { "deeply": { "nested": true } }',
  '}',
].join('\n');

/** A PDF with genuinely selectable text, two pages, in a known order. */
export const TEXT_PDF_NOTES = pdf([
  [
    'BT /F1 14 Tf 60 740 Td (Setting Godly Priorities) Tj ET',
    'BT /F1 11 Tf 60 710 Td (City Gate Church - Matthew 6:19-34) Tj ET',
    'BT /F1 11 Tf 60 690 Td (One: where your treasure is.) Tj ET',
  ],
  [
    'BT /F1 11 Tf 60 740 Td (Two: no one can serve two masters.) Tj ET',
    'BT /F1 11 Tf 60 720 Td (Three: seek first the kingdom.) Tj ET',
  ],
]);

/** A page with no text operators at all — what a scan looks like to a parser. */
export const SCANNED_PDF_NOTES = pdf([[]]);

/** Not a PDF, whatever the name says. */
export const BROKEN_PDF = 'this is not a PDF at all, it is a sentence';
