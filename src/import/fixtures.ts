/**
 * Documents built in code rather than checked in as binaries.
 *
 * A .docx fixture on disk is an opaque blob nobody reviews; built here, the
 * exact bytes a test relies on are visible in the test. It also lets a hostile
 * fixture — a zip bomb, a truncated archive — be described rather than shipped.
 */

import { createHash } from 'node:crypto';

import { createZip } from '../export/zip';

const encoder = new TextEncoder();

/** Join byte runs into one buffer. */
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Wrap paragraphs in the minimum WordprocessingML that `parseDocx` reads. */
export function documentXml(
  paragraphs: Array<{ text: string; style?: string; list?: boolean }>,
): string {
  const body = paragraphs
    .map(({ text, style, list }) => {
      const properties =
        style || list
          ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ''}</w:pPr>`
          : '';
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/** The content types a real Word package declares for its main document. */
export const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

/** The root relationships a real Word package declares. */
export const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

/**
 * A .docx containing the given paragraphs, plus any extra members.
 *
 * A real Open Packaging Convention package, not merely a ZIP with a body in
 * it: the content types declare what the main part IS, and the root
 * relationship says where the package starts. Both are now required, because a
 * ZIP carrying only `word/document.xml` is something anybody can build and is
 * not evidence that Word produced anything.
 *
 * `extra` exists so a test can put a macro, an embedded object or an external
 * relationship into the package and assert what happens. `omit` and `replace`
 * exist so a test can build the adversarial packages — one with no content
 * types, one whose main part claims to be something else — that the inspector
 * has to refuse.
 */
export async function makeDocx(
  paragraphs: Array<{ text: string; style?: string; list?: boolean }>,
  extra: Array<{ path: string; content: string | Uint8Array }> = [],
  options: { omit?: string[]; replace?: Record<string, string> } = {},
): Promise<Uint8Array> {
  const omit = new Set(options.omit ?? []);
  const replace = options.replace ?? {};
  const base: Array<{ path: string; content: string | Uint8Array }> = [
    { path: '[Content_Types].xml', content: replace['[Content_Types].xml'] ?? CONTENT_TYPES_XML },
    { path: '_rels/.rels', content: replace['_rels/.rels'] ?? ROOT_RELS_XML },
    {
      path: 'word/document.xml',
      content: replace['word/document.xml'] ?? documentXml(paragraphs),
    },
  ];
  return createZip([...base.filter((member) => !omit.has(member.path)), ...extra]);
}

/**
 * An archive whose single member inflates to `size` bytes from almost nothing.
 *
 * Highly compressible input is the whole trick: a megabyte of one repeated
 * character deflates to a few hundred bytes, so the compressed size a naive
 * check would look at says nothing about what opening it costs.
 */
export async function makeZipBomb(size: number, path = 'word/document.xml'): Promise<Uint8Array> {
  return makeDeflatedZip([{ path, content: encoder.encode('A'.repeat(size)) }]);
}

// ---------------------------------------------------------------------------
// A minimal ZIP writer that can actually deflate
// ---------------------------------------------------------------------------

/**
 * Deflate some bytes, without going through Blob.
 *
 * `createZip` compresses via `new Blob([...]).stream()`, which jsdom does not
 * implement, so under test it silently stores everything instead. A zip-bomb
 * fixture that is merely *stored* proves nothing about the inflate ceiling, so
 * this path is built explicitly.
 */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as BufferSource);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new CompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** A ZIP whose members are genuinely deflated, so the inflate path is tested. */
export async function makeDeflatedZip(
  members: Array<{ path: string; content: Uint8Array }>,
): Promise<Uint8Array> {
  const { crc32 } = await import('../export/zip');
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const member of members) {
    const name = encoder.encode(member.path);
    const compressed = await deflateRaw(member.content);
    const crc = crc32(member.content);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true); // deflate
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, member.content.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, 8, true); // deflate
    dv.setUint32(16, crc, true);
    dv.setUint32(20, compressed.length, true);
    dv.setUint32(24, member.content.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);

    parts.push(local, compressed);
    central.push(dir);
    offset += local.length + compressed.length;
  }

  const directory = central.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, members.length, true);
  ev.setUint16(10, members.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, eocd];
  const size = all.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A minimal but real PDF, built from page content streams.
 *
 * Here rather than in the end-to-end fixtures because both suites need the
 * same document: a unit test that parsed a different PDF from the one the
 * browser sees would be testing a second, luckier file. Pass a page with no
 * text operators to get what a scan looks like to a parser.
 */
export function pdf(pages: string[][]): string {
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

/**
 * RC4, because a password-protected PDF cannot be faked.
 *
 * The first attempt at an encrypted fixture declared `/Encrypt` in the trailer
 * and left every stream in the clear. pdf.js opened it and handed back the
 * plaintext — correctly, since nothing in it was encrypted — and the refusal
 * test built on it passed for the wrong reason until it was looked at. A
 * document is password-protected when its bytes are, so the bytes are.
 */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/** The 32-byte padding string from the standard security handler. */
const PASSWORD_PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('md5').update(bytes).digest());

const latin1 = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);

const hexString = (bytes: Uint8Array): string =>
  `<${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}>`;

/** A password padded or truncated to the 32 bytes the handler works in. */
const padPassword = (password: string): Uint8Array =>
  concat([latin1(password), PASSWORD_PAD]).subarray(0, 32);

/** The password this fixture is locked with. A test needs it to prove the lock. */
export const ENCRYPTED_PDF_PASSWORD = 'zzsecret';

/**
 * A one-page PDF that genuinely requires a password to open.
 *
 * Revision 2 of the standard security handler — RC4 with a 40-bit key, which
 * is the oldest and simplest thing a real PDF writer still emits, and enough
 * to make the document unreadable without the password. The point is not the
 * strength of the cipher; it is that the refusal path is reached by a file
 * that is actually locked rather than by one that says it is.
 */
export function encryptedPdf(text = 'ZZSCAN-ENCRYPTED body'): Uint8Array {
  const permissions = -1;
  // A fixed /ID keeps the fixture byte-identical between runs, so a failure is
  // about the code and never about which bytes happened to be generated.
  const id = latin1('ZZSCANENCRYPTED0').subarray(0, 16);

  // Algorithm 3: /O, the owner entry, is the user password encrypted under the
  // owner password's key.
  const owner = rc4(md5(padPassword('zzowner')).subarray(0, 5), padPassword(ENCRYPTED_PDF_PASSWORD));

  // Algorithm 2: the file key, from the user password, /O, /P and the first /ID.
  const permissionBytes = new Uint8Array(4);
  new DataView(permissionBytes.buffer).setInt32(0, permissions, true);
  const fileKey = md5(
    concat([padPassword(ENCRYPTED_PDF_PASSWORD), owner, permissionBytes, id]),
  ).subarray(0, 5);

  // Algorithm 4: for revision 2, /U is simply the padding under the file key.
  const user = rc4(fileKey, PASSWORD_PAD);

  // Each object gets its own key, derived from the file key and its number.
  const objectKey = (number: number): Uint8Array =>
    md5(
      concat([fileKey, new Uint8Array([number & 0xff, (number >> 8) & 0xff, (number >> 16) & 0xff, 0, 0])]),
    ).subarray(0, 10);

  const content = latin1(`BT /F1 14 Tf 72 720 Td (${text}) Tj ET\n`);
  const encrypted = rc4(objectKey(4), content);

  const bodies: Array<Uint8Array> = [
    latin1('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    latin1('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    latin1(
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    ),
    concat([
      latin1(`4 0 obj\n<< /Length ${encrypted.length} >>\nstream\n`),
      encrypted,
      latin1('\nendstream\nendobj\n'),
    ]),
    latin1('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'),
    // The encryption dictionary itself is never encrypted, and must be
    // reachable: the earlier broken fixture pointed /Encrypt at an object
    // beyond /Size that no cross-reference listed, so pdf.js never found it.
    latin1(
      `6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O ${hexString(owner)} /U ${hexString(user)} /P ${permissions} >>\nendobj\n`,
    ),
  ];

  const header = latin1('%PDF-1.4\n');
  const offsets: number[] = [];
  let at = header.length;
  for (const body of bodies) {
    offsets.push(at);
    at += body.length;
  }

  const size = bodies.length + 1;
  let trailer = `xref\n0 ${size}\n0000000000 65535 f \n`;
  trailer += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  trailer +=
    `trailer\n<< /Size ${size} /Root 1 0 R /Encrypt 6 0 R ` +
    `/ID [${hexString(id)} ${hexString(id)}] >>\nstartxref\n${at}\n%%EOF\n`;

  return concat([header, ...bodies, latin1(trailer)]);
}
