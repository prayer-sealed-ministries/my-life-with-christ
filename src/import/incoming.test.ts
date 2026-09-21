/**
 * What the operating system is allowed to hand this app.
 *
 * Everything about a shared document is chosen by the sender: the display name,
 * the media type, and the bytes, and none of the three has to agree with the
 * others. These hold the gate that stands between them and the importer.
 *
 * The property that matters most is the one about sameness: a share and a pick
 * of the same file must reach the same parser and produce the same outcome,
 * because there is only one importer and this lane must not grow a second.
 */

import { describe, expect, it } from 'vitest';

import { SHARED_MIME_TYPES, acceptIncomingDocument, type IncomingDocument } from './incoming';
import { ImportError } from './limits';
import { MAX_SERMON_NOTES_BYTES, readSermonNotes, sermonNotesFormat } from './sermon-notes';

const utf8 = (text: string) => new TextEncoder().encode(text);

const incoming = (over: Partial<IncomingDocument> = {}): IncomingDocument => ({
  name: 'handout.txt',
  mimeType: 'text/plain',
  bytes: utf8('Point one: abiding is not striving.'),
  ...over,
});

/** A minimal but genuine PDF header, enough for the signature check. */
const pdfBytes = (body = '') => utf8(`%PDF-1.4\n${body}`);

describe('what arrives, and which parser it reaches', () => {
  it('sends each supported kind to the parser its extension names', () => {
    const cases: Array<[string, string, string]> = [
      ['handout.txt', 'text/plain', 'txt'],
      ['handout.md', 'text/markdown', 'markdown'],
      ['handout.markdown', 'text/markdown', 'markdown'],
      ['handout.json', 'application/json', 'sermon-notes-json'],
    ];
    // The floor: a loop over an empty list proves nothing.
    expect(cases.length).toBe(4);

    for (const [name, mimeType, format] of cases) {
      const accepted = acceptIncomingDocument(incoming({ name, mimeType }));
      expect(accepted.format, name).toBe(format);
      // And the filename handed on still resolves the same way, so the shared
      // path and the picked path cannot diverge on parser choice.
      expect(sermonNotesFormat(accepted.filename), name).toBe(format);
    }

    const pdf = acceptIncomingDocument(
      incoming({ name: 'handout.pdf', mimeType: 'application/pdf', bytes: pdfBytes() }),
    );
    expect(pdf.format).toBe('pdf');
  });

  it('accepts exactly the media types the importer can actually read', () => {
    // Registering for more would put this app in the share sheet for files it
    // cannot open — a promise broken the moment somebody takes it up.
    expect([...SHARED_MIME_TYPES].sort()).toEqual([
      'application/json',
      'application/pdf',
      'text/markdown',
      'text/plain',
    ]);
    // DOCX belongs to the document importer, which is a different feature.
    expect(SHARED_MIME_TYPES as readonly string[]).not.toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('uses the media type only when the name cannot answer', () => {
    // A mail attachment saved as "sermon", or a provider that names by title.
    const accepted = acceptIncomingDocument(incoming({ name: 'sermon', mimeType: 'text/plain' }));
    expect(accepted.format).toBe('txt');
    expect(accepted.filename).toBe('sermon.txt');

    // But a name that DOES answer is not overridden by a careless media type:
    // senders routinely send text/plain for everything.
    const md = acceptIncomingDocument(incoming({ name: 'outline.md', mimeType: 'text/plain' }));
    expect(md.format).toBe('markdown');
  });

  it('strips a path and refuses a hostile name rather than trusting it', () => {
    const accepted = acceptIncomingDocument(
      incoming({ name: '../../../etc/passwd.txt', mimeType: 'text/plain' }),
    );
    expect(accepted.filename).toBe('passwd.txt');
    expect(accepted.filename).not.toContain('/');
    expect(accepted.filename).not.toContain('..');
  });
});

describe('the bytes settle any disagreement', () => {
  it('refuses a PDF wearing a text name', () => {
    const attempt = () =>
      acceptIncomingDocument(incoming({ name: 'handout.txt', mimeType: 'text/plain', bytes: pdfBytes() }));
    expect(attempt).toThrow(ImportError);
    expect(attempt).toThrow(/is a PDF/);
  });

  it('refuses a text file wearing a PDF name', () => {
    const attempt = () =>
      acceptIncomingDocument(
        incoming({ name: 'handout.pdf', mimeType: 'application/pdf', bytes: utf8('not a pdf at all') }),
      );
    expect(attempt).toThrow(/named as a PDF but its contents are not/);
  });
});

describe('what is refused before anything is parsed', () => {
  it('refuses an empty file', () => {
    expect(() => acceptIncomingDocument(incoming({ bytes: new Uint8Array(0) }))).toThrow(/empty/);
  });

  it('refuses a file past the limit, by length alone', () => {
    const attempt = () =>
      acceptIncomingDocument(incoming({ bytes: new Uint8Array(MAX_SERMON_NOTES_BYTES + 1) }));
    expect(attempt).toThrow(ImportError);
    expect(attempt).toThrow(/larger than the/);
  });

  it('refuses a format this build does not read, including DOCX', () => {
    for (const [name, mimeType] of [
      ['sermon.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['photo.jpg', 'image/jpeg'],
      ['archive.zip', 'application/zip'],
      ['notes.rtf', 'application/rtf'],
      ['anonymous', 'application/octet-stream'],
    ]) {
      expect(() => acceptIncomingDocument(incoming({ name, mimeType })), name).toThrow(ImportError);
    }
  });

  it('refuses a name and type that between them say nothing', () => {
    expect(() => acceptIncomingDocument(incoming({ name: '', mimeType: '' }))).toThrow(ImportError);
  });

  it('reads a media type that carries parameters', () => {
    const accepted = acceptIncomingDocument(
      incoming({ name: 'sermon', mimeType: 'text/plain; charset=utf-8' }),
    );
    expect(accepted.format).toBe('txt');
  });
});

/**
 * The property this lane exists to protect: one importer, two doorways.
 */
describe('a shared file and a picked file are the same file', () => {
  it('produces an identical proposal from identical bytes', async () => {
    const bytes = utf8('# Abiding\n\nPoint one: the vine.\n');

    // The picked path: bytes and a name, straight into the importer.
    const picked = await readSermonNotes(bytes, 'handout.md');

    // The shared path: through the gate first, then the same importer.
    const accepted = acceptIncomingDocument({ name: 'handout.md', mimeType: 'text/markdown', bytes });
    const shared = await readSermonNotes(accepted.bytes, accepted.filename);

    expect(shared.material.body).toBe(picked.material.body);
    expect(shared.material.format).toBe(picked.material.format);
    expect(shared.material.filename).toBe(picked.material.filename);
    expect(shared.characters).toBe(picked.characters);
    expect(shared.suggested).toEqual(picked.suggested);
  });

  it('fails the same way on the same bad bytes', async () => {
    // A NUL byte: binary wearing a text name. The gate lets it through — it is
    // not a PDF and the name is plausible — and the shared importer refuses it,
    // which is exactly the point. One rejection, one wording, one place.
    const bytes = new Uint8Array([0x68, 0x69, 0x00, 0x74, 0x68, 0x65, 0x72, 0x65]);

    const pickedError = await readSermonNotes(bytes, 'handout.txt').catch((e: unknown) => e);
    const accepted = acceptIncomingDocument({ name: 'handout.txt', mimeType: 'text/plain', bytes });
    const sharedError = await readSermonNotes(accepted.bytes, accepted.filename).catch((e: unknown) => e);

    expect(pickedError).toBeInstanceOf(ImportError);
    expect(sharedError).toBeInstanceOf(ImportError);
    expect((sharedError as Error).message).toBe((pickedError as Error).message);
  });

  it('never decides authorship — a share is provided material', async () => {
    const bytes = utf8('Point three: the pelican in the wilderness.');
    const accepted = acceptIncomingDocument({
      // A name and a sender that both suggest the reader wrote it. Neither may
      // be allowed to say so.
      name: 'my-own-reflection-by-me.txt',
      mimeType: 'text/plain',
      bytes,
    });
    const proposal = await readSermonNotes(accepted.bytes, accepted.filename);

    // What comes out is SourceMaterial and nothing else. The reader's own
    // fields do not exist on a proposal at all, which is the strongest form
    // this guarantee can take.
    expect(proposal.material.body).toContain('pelican');
    expect(Object.keys(proposal)).not.toContain('notes');
    expect(Object.keys(proposal)).not.toContain('reflection');
    expect(Object.keys(proposal)).not.toContain('prayer');
    expect(proposal.suggested.title).toBeUndefined();
  });
});
