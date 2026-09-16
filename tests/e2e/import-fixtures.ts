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
export function docx(): Buffer {
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

  return zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    [
      'word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ],
    // Neither of these may be opened, and the relationship must not be followed.
    ['word/vbaProject.bin', 'MACRO-BYTES-THAT-MUST-NOT-RUN'],
    [
      'word/_rels/document.xml.rels',
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://tracker.invalid/pixel.png" TargetMode="External"/></Relationships>',
    ],
  ]);
}

function pdf(pages: string[][]): string {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  pages.forEach((lines, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`,
    );
    const stream = lines.join('\n');
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return out;
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
  writeFileSync(join(dir, 'broken.docx'), 'this is not a zip archive');
  writeFileSync(join(dir, 'empty.txt'), '');
  return dir;
}
