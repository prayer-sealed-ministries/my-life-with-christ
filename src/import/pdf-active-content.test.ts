/**
 * What a PDF asks the reader to do.
 *
 * The two tests that matter most are the ones a substring search gets wrong:
 * a handout whose visible text mentions JavaScript must import, and a document
 * that hides `/JS` inside a compressed stream must not. A scanner that gets
 * the first wrong is annoying; one that gets the second wrong reports clean
 * and is worse than nothing.
 *
 * Every document here is fictional and built in code.
 */
import { describe, expect, it } from 'vitest';

import { findActiveContent, pdfNamesIn } from './pdf-active-content';
import { pdf } from './fixtures';

const encoder = new TextEncoder();
const latin1 = (text: string) => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** Deflate to zlib, the way a PDF's FlateDecode payload is written. */
async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as BufferSource);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream('deflate')).getReader();
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

/** An ordinary handout, with an object appended to it. */
const withObject = (object: string) => latin1(pdf([['BT /F1 12 Tf (FICTIONAL-DOC) Tj ET']]).replace('trailer', `${object}\ntrailer`));

describe('the lexer reads names, not text', () => {
  it('finds a name and decodes its hex escapes', () => {
    expect(pdfNamesIn('<< /Type /Action /S /JavaScript >>').has('JavaScript')).toBe(true);
    // `/J#53` is `/JS`. A search for the plain spelling misses this one.
    expect(pdfNamesIn('<< /S /J#53 >>').has('JS')).toBe(true);
  });

  it('does not read one name as the beginning of another', () => {
    // `/JSON` contains `/JS` and is not it.
    const names = pdfNamesIn('<< /JSON 1 /JSName 2 >>');
    expect(names.has('JSON')).toBe(true);
    expect(names.has('JS')).toBe(false);
  });

  it('ignores anything inside a string, a hex string or a comment', () => {
    expect(pdfNamesIn('(this handout is about /JavaScript classes)').size).toBe(0);
    expect(pdfNamesIn('(escaped \\) paren /Launch still inside)').size).toBe(0);
    expect(pdfNamesIn('<48656c6c6f /Launch>').size).toBe(0);
    expect(pdfNamesIn('% a comment mentioning /Launch\n/Real 1').has('Launch')).toBe(false);
    expect(pdfNamesIn('% a comment mentioning /Launch\n/Real 1').has('Real')).toBe(true);
  });
});

describe('a document that wants to run something', () => {
  it('passes an ordinary handout', async () => {
    const finding = await findActiveContent(latin1(pdf([['BT /F1 12 Tf (FICTIONAL-DOC handout) Tj ET']])));
    expect(finding.found).toEqual([]);
  });

  it('refuses a script action, however it is spelled', async () => {
    const plain = await findActiveContent(
      withObject('9 0 obj\n<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj'),
    );
    expect(plain.found).toContain('JavaScript');

    const escaped = await findActiveContent(withObject('9 0 obj\n<< /S /J#53 >>\nendobj'));
    expect(escaped.found).toContain('JS');
  });

  it('refuses launching a program, an attachment, and a film', async () => {
    for (const [object, name] of [
      ['<< /Type /Action /S /Launch /F (fictional.exe) >>', 'Launch'],
      ['<< /Type /Filespec /EF << /F 10 0 R >> /Subtype /EmbeddedFile >>', 'EmbeddedFile'],
      ['<< /Subtype /Movie >>', 'Movie'],
      ['<< /Subtype /RichMedia >>', 'RichMedia'],
    ]) {
      const finding = await findActiveContent(withObject(`9 0 obj\n${object}\nendobj`));
      expect(finding.found, object).toContain(name);
    }
  });

  it('leaves an ordinary hyperlink alone', async () => {
    /*
      Church handouts are full of web addresses. A link is not an action:
      nothing in this app will follow one, and refusing documents that contain
      them would refuse most real handouts.
    */
    const linked = await findActiveContent(
      withObject('9 0 obj\n<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://fictional.invalid/) >> >>\nendobj'),
    );
    expect(linked.found).toEqual([]);
  });

  it('leaves a document that merely opens at a page alone', async () => {
    const opens = await findActiveContent(withObject('9 0 obj\n<< /OpenAction [3 0 R /Fit] >>\nendobj'));
    expect(opens.found).toEqual([]);
  });

  it('is not fooled by a handout that talks about JavaScript', async () => {
    // The false positive that would make this unusable: the words are page
    // content, inside a string, and they are not structure.
    const teaching = latin1(
      pdf([['BT /F1 12 Tf (FICTIONAL-DOC a class on JavaScript and /Launch codes) Tj ET']]),
    );
    const finding = await findActiveContent(teaching);
    expect(finding.found).toEqual([]);
  });
});

describe('compressed streams are not a blind spot', () => {
  it('finds a script action hidden inside a FlateDecode stream', async () => {
    /*
      THE test. Most of a modern PDF lives inside compressed streams, so a
      scanner that never inflates one sees deflate output and reports clean —
      which is exactly the false green this whole module exists to avoid.
    */
    const hidden = encoder.encode('<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >>');
    const compressed = await zlib(hidden);

    let object = '9 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /Length ' + compressed.length + ' >>\nstream\n';
    let body = '';
    for (let i = 0; i < compressed.length; i += 1) body += String.fromCharCode(compressed[i]);
    object += body + '\nendstream\nendobj';

    const document = withObject(object);

    // The proof that the search is real: the plain name is NOT in the bytes.
    let raw = '';
    for (let i = 0; i < document.length; i += 1) raw += String.fromCharCode(document[i]);
    expect(raw).not.toContain('/JavaScript');

    const finding = await findActiveContent(document);
    // A floor: a run that inflated nothing would report clean for the wrong
    // reason, so assert it actually opened the stream.
    expect(finding.streamsInflated).toBeGreaterThan(0);
    expect(finding.found).toContain('JavaScript');
  });
});
