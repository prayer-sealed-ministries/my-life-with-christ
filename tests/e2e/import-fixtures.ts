/**
 * Documents built at test time rather than committed as binaries.
 *
 * A .docx or .pdf checked into the repo is an opaque blob nobody reviews. Built
 * here, every byte a test depends on is visible in the test — including the
 * parts that must be IGNORED, like the macro and the external relationship in
 * the Word document below.
 */

import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pdf } from '../../src/import/fixtures';

const encoder = new TextEncoder();

export const TXT = [
  '14 September 2024',
  'Pastor Whitfield preached on Romans 8:28.',
  '',
  '21 September 2024',
  'Communion Sunday. Read 1 Corinthians 11:23-26.',
  '',
  '28 September 2024',
  'Visiting speaker on Psalm 23. Booklets cost $5 * 3.',
].join('\n');

export const MD = [
  '# The Sermon on the Mount',
  '',
  'He opened with **the Beatitudes**, Matthew 5:1-12.',
  '',
  '> Blessed are the poor in spirit.',
  '',
  '- Poverty of spirit',
  '- Mourning',
  '',
  '# Jesus at the Well',
  '',
  'On John 4:1-26. Notes from 2024-10-05.',
].join('\n');

function zip(members: Array<[string, string]>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [path, content] of members) {
    const name = encoder.encode(path);
    const raw = Buffer.from(encoder.encode(content));
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    Buffer.from(name).copy(local, 30);

    const dir = Buffer.alloc(46 + name.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    Buffer.from(name).copy(dir, 46);

    parts.push(local, compressed);
    central.push(dir);
    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, directory, eocd]);
}

/** A Word document that also contains a macro and a remote relationship. */
/** The content types a real Word package declares for its main document. */
const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

/** The root relationships a real Word package declares. */
const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

/**
 * A relationship pointing at somebody else's server.
 *
 * Entirely legal in a real Word document, and it must never be followed: the
 * egress watcher in the spec is what proves it is not. Kept out of the root
 * relationships on purpose — a package whose STARTING POINT is external is a
 * different thing, and is refused.
 */
const DOCUMENT_RELS =
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
  'Target="https://tracker.invalid/pixel.png" TargetMode="External"/></Relationships>';

function documentBody(): string {
  const paragraphs = [
    { text: 'Sunday Sermons 2019', style: 'Heading1' },
    { text: 'Grace and peace to you.' },
    { text: 'First Sunday', style: 'Heading1' },
    { text: 'He preached Ephesians 2:8-9 on grace. 6 January 2019.' },
    { text: 'Point one', list: true },
    { text: 'Point two', list: true },
    { text: 'Second Sunday', style: 'Heading1' },
    { text: 'On 1 Corinthians 13. Love is patient.' },
  ];

  const body = paragraphs
    .map(({ text, style, list }) => {
      const properties =
        style || list
          ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ''}</w:pPr>`
          : '';
      return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    })
    .join('');

  return `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/**
 * An ordinary Word document, as Word actually writes one.
 *
 * A real Open Packaging Convention package: content types that declare the
 * main part, and a root relationship naming it. It used to be a bare ZIP with
 * a body in it, which the importer now refuses — correctly, because anybody
 * can build that and it is no evidence Word produced anything.
 *
 * It still carries an external image relationship, because the thing worth
 * proving is that a legitimate document containing one is read without that
 * relationship ever being followed.
 */
export function docx(): Buffer {
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['word/document.xml', documentBody()],
    ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ]);
}

/**
 * The same document, with a macro project in it.
 *
 * Refused outright rather than read-with-the-macro-ignored. Opening the text
 * of a macro-enabled document and silently leaving the macro behind means
 * carrying a file this app cannot account for; the person is told to save a
 * copy without macros, which is something they can act on.
 */
export function macroDocx(): Buffer {
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['word/document.xml', documentBody()],
    ['word/vbaProject.bin', 'MACRO-BYTES-THAT-MUST-NOT-RUN'],
  ]);
}

/** Two pages of genuinely selectable text. */
export const TEXT_PDF = pdf([
  [
    'BT /F1 14 Tf 60 740 Td (Sunday 6 October 2024) Tj ET',
    'BT /F1 11 Tf 60 710 Td (He preached on Romans 8:28 and Psalm 23.) Tj ET',
    'BT /F1 11 Tf 60 690 Td (Nothing is wasted, he said.) Tj ET',
  ],
  [
    'BT /F1 14 Tf 60 740 Td (Sunday 13 October 2024) Tj ET',
    'BT /F1 11 Tf 60 710 Td (Communion. Read 1 Corinthians 11:23-26.) Tj ET',
  ],
]);

/** A page with no text operators at all — what a scan looks like to a parser. */
export const SCANNED_PDF = pdf([[]]);

/** Write every fixture into a fresh temporary directory and return its path. */
export function writeFixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), 'journey-import-'));
  writeFileSync(join(dir, 'journal.txt'), TXT);
  writeFileSync(join(dir, 'sermons.md'), MD);
  writeFileSync(join(dir, 'Sunday Sermons 2019.docx'), docx());
  writeFileSync(join(dir, 'sermon notes.pdf'), TEXT_PDF, 'latin1');
  writeFileSync(join(dir, 'scanned.pdf'), SCANNED_PDF, 'latin1');
  writeFileSync(join(dir, 'macros.docx'), macroDocx());
  writeFileSync(join(dir, 'broken.docx'), 'this is not a zip archive');
  writeFileSync(join(dir, 'empty.txt'), '');
  return dir;
}
