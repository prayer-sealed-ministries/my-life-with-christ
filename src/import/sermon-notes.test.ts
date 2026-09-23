/**
 * Reading church sermon notes: the boundary where untrusted files arrive.
 *
 * Two things are being checked here and they are not the same. The first is
 * that valid files read correctly. The second, and the reason most of these
 * cases exist, is that an invalid one produces an error and *nothing else* —
 * no half-read material, no invented church, no field smuggled through, and
 * above all nothing that ends up in the reader's own writing.
 */

import { describe, expect, it } from 'vitest';

import { ImportError } from './limits';
import {
  MAX_SERMON_NOTES_BYTES,
  MAX_SERMON_NOTES_CHARS,
  SERMON_NOTES_FORMAT,
  decodeText,
  parseSermonNotesJson,
  readSermonNotes,
  sermonNotesFormat,
} from './sermon-notes';
import {
  BROKEN_PDF,
  JSON_FUTURE_VERSION,
  JSON_HOSTILE,
  JSON_MALFORMED,
  JSON_MINIMAL,
  JSON_NOTES,
  JSON_NO_BODY,
  JSON_WRONG_FORMAT,
  MD_NOTES,
  MD_WITH_HTML,
  SCANNED_PDF_NOTES,
  TEXT_PDF_NOTES,
  TXT_NOTES,
  bytes,
  latin1,
} from './sermon-notes-fixtures';

/** Assert a read fails with wording meant for a person, and says nothing else. */
async function refuses(data: Uint8Array, name: string, matcher: RegExp): Promise<string> {
  let thrown: unknown;
  try {
    await readSermonNotes(data, name);
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown, `${name} was accepted when it should have been refused`).toBeInstanceOf(
    ImportError,
  );
  const message = (thrown as ImportError).message;
  expect(message, `the message for ${name} does not read for a person`).toMatch(matcher);
  return message;
}

describe('which parser a file asks for', () => {
  it('reads the extension, and refuses everything else', () => {
    expect(sermonNotesFormat('notes.txt')).toBe('txt');
    expect(sermonNotesFormat('NOTES.TXT')).toBe('txt');
    expect(sermonNotesFormat('notes.md')).toBe('markdown');
    expect(sermonNotesFormat('notes.markdown')).toBe('markdown');
    expect(sermonNotesFormat('notes.json')).toBe('sermon-notes-json');
    expect(sermonNotesFormat('notes.pdf')).toBe('pdf');
    expect(sermonNotesFormat('notes.docx')).toBeNull();
    expect(sermonNotesFormat('notes')).toBeNull();
    expect(sermonNotesFormat('notes.pdf.exe')).toBeNull();
  });
});

describe('plain text', () => {
  it('imports exactly what was in the file', async () => {
    const proposal = await readSermonNotes(bytes(TXT_NOTES), 'handout.txt');
    expect(proposal.material.format).toBe('txt');
    expect(proposal.material.body).toBe(TXT_NOTES.trim());
    expect(proposal.material.filename).toBe('handout.txt');
    expect(proposal.characters).toBe(TXT_NOTES.trim().length);
  });

  it('records a digest of the bytes it read', async () => {
    const proposal = await readSermonNotes(bytes(TXT_NOTES), 'handout.txt');
    expect(proposal.material.sha256).toMatch(/^[0-9a-f]{64}$/);

    const again = await readSermonNotes(bytes(TXT_NOTES), 'a-copy.txt');
    expect(again.material.sha256, 'the same handout did not hash the same').toBe(
      proposal.material.sha256,
    );
  });

  it('invents no church, no speaker and no date', async () => {
    // The file plainly names a church and a date in its prose. Reading either
    // one out of it would put words on the permanent record of a life.
    const proposal = await readSermonNotes(bytes(TXT_NOTES), 'handout.txt');
    expect(proposal.material.church).toBeUndefined();
    expect(proposal.material.speaker).toBeUndefined();
    expect(proposal.material.date).toBeUndefined();
    expect(proposal.suggested).toEqual({});
  });

  it('strips any path from the name before it is recorded', async () => {
    // Provenance travels into every export and is read by strangers years
    // later. Whatever a picker hands over, only the bare name is kept — both
    // separators, so a drag-and-drop from either kind of machine is covered.
    for (const given of [
      'church/2026/handout.txt',
      'downloads\\church\\handout.txt',
      '../../handout.txt',
    ]) {
      const proposal = await readSermonNotes(bytes(TXT_NOTES), given);
      expect(proposal.material.filename, given).toBe('handout.txt');
    }
  });

  it('refuses a file that is not text', async () => {
    await refuses(new Uint8Array([0xff, 0xfe, 0x00, 0x41]), 'notes.txt', /not readable text/i);
  });

  it('refuses a file with nothing in it', async () => {
    await refuses(new Uint8Array(0), 'notes.txt', /empty/i);
    await refuses(bytes('   \n\n  '), 'notes.txt', /no notes in it/i);
  });

  it('refuses a name it does not read', async () => {
    await refuses(bytes(TXT_NOTES), 'handout.docx', /\.txt, \.md, \.json or text-based \.pdf/);
  });
});

describe('decoding', () => {
  it('refuses invalid UTF-8 rather than scattering replacement characters', () => {
    expect(() => decodeText(new Uint8Array([0xc3, 0x28]))).toThrow(ImportError);
  });

  it('refuses a NUL byte, which is valid UTF-8 and never a handout', () => {
    expect(() => decodeText(new Uint8Array([65, 0, 66]))).toThrow(/binary/i);
  });

  it('gives Windows and Unix line endings the same body', () => {
    expect(decodeText(bytes('one\r\ntwo\rthree\nfour'))).toBe('one\ntwo\nthree\nfour');
  });
});

describe('markdown', () => {
  it('keeps the source exactly as written', async () => {
    const proposal = await readSermonNotes(bytes(MD_NOTES), 'notes.md');
    expect(proposal.material.format).toBe('markdown');
    expect(proposal.material.body).toBe(MD_NOTES.trim());
  });

  it('stores embedded HTML as characters, not as markup', async () => {
    // The parser's job is to not transform it. That it cannot EXECUTE is the
    // renderer's job, proven in the wiring test against a real DOM — this is
    // the half that would otherwise silently start sanitising, or not.
    const proposal = await readSermonNotes(bytes(MD_WITH_HTML), 'notes.md');
    expect(proposal.material.body).toContain('<script>');
    expect(proposal.material.body).toContain('A real line, after the noise.');
  });
});

describe('the structured format', () => {
  it('reads a complete file', async () => {
    const proposal = await readSermonNotes(bytes(JSON_NOTES), 'sermon-notes.json');
    const { material, suggested } = proposal;

    expect(material.format).toBe('sermon-notes-json');
    expect(material.church).toBe('City Gate Church');
    expect(material.speaker).toBe('Pastor John Smith');
    expect(material.date).toBe('2026-09-20');
    expect(material.scripture).toEqual(['Matthew 6:19-34']);
    expect(material.body).toContain('Setting Godly Priorities');

    expect(suggested.title).toBe('Setting Godly Priorities');
    expect(suggested.date).toBe('2026-09-20');
    expect(suggested.speaker).toBe('Pastor John Smith');
    expect(suggested.scripture).toEqual(['Matthew 6:19-34']);
  });

  it('reads a file carrying only what is required', async () => {
    const proposal = await readSermonNotes(bytes(JSON_MINIMAL), 'minimal.json');
    expect(proposal.material.body).toBe('Just the notes.');
    expect(proposal.material.church).toBeUndefined();
    expect(proposal.suggested).toEqual({});
  });

  it('refuses a version it does not understand, and says which', async () => {
    const message = await refuses(bytes(JSON_FUTURE_VERSION), 'future.json', /version 2/);
    expect(message, 'the message does not say what would help').toMatch(/newer version of the app/i);
  });

  it('refuses a file with no notes in it', async () => {
    await refuses(bytes(JSON_NO_BODY), 'empty.json', /no notes in it/i);
  });

  it('refuses a file that is not this format', async () => {
    await refuses(bytes(JSON_WRONG_FORMAT), 'other.json', /not a sermon-notes file/i);
  });

  it('refuses JSON that does not parse', async () => {
    await refuses(bytes(JSON_MALFORMED), 'broken.json', /not valid JSON/i);
  });

  it('refuses a JSON document that is not an object', async () => {
    for (const text of ['[]', '"a string"', 'null', '42']) {
      await refuses(bytes(text), 'odd.json', /not a sermon-notes file/i);
    }
  });

  it('refuses a file that does not say which version it is', async () => {
    const text = JSON.stringify({ format: SERMON_NOTES_FORMAT, bodyMarkdown: 'x' });
    await refuses(bytes(text), 'unversioned.json', /which version/i);

    const fractional = JSON.stringify({
      format: SERMON_NOTES_FORMAT,
      version: 1.5,
      bodyMarkdown: 'x',
    });
    await refuses(bytes(fractional), 'fractional.json', /which version/i);
  });

  it('cannot be moved by anything it was not asked for', async () => {
    const proposal = await readSermonNotes(bytes(JSON_HOSTILE), 'hostile.json');
    const material = proposal.material as unknown as Record<string, unknown>;

    // The one real field survives, and only it.
    expect(material.body).toBe('The only real field here.');

    // Fields of the wrong type are absent rather than coerced.
    expect(material.church).toBeUndefined();
    expect(material.speaker).toBeUndefined();

    // 31 February is not a date, and is not guessed at either.
    expect(material.date).toBeUndefined();

    // A list keeps the strings and drops the rest.
    expect(material.scripture).toEqual(['Matthew 6:19-34']);

    // Names the format does not have cannot appear on the material at all,
    // and the journal's own field names least of all: `notes` here is a
    // stranger's text, and `notes` on an entry is the reader's own writing.
    for (const key of ['kind', 'notes', 'reflection', 'somethingFromTheFuture', 'polluted']) {
      expect(material[key], `"${key}" reached the stored material`).toBeUndefined();
    }

    // Nothing was written onto Object.prototype by parsing that file.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('ignores unknown fields rather than refusing the file', () => {
    const { material } = parseSermonNotesJson(
      JSON.stringify({
        format: SERMON_NOTES_FORMAT,
        version: 1,
        bodyMarkdown: 'Body.',
        somethingNew: 'from a later version of the format',
      }),
    );
    expect(material.body).toBe('Body.');
  });
});

describe('PDF', () => {
  it('extracts text in page order', async () => {
    const proposal = await readSermonNotes(latin1(TEXT_PDF_NOTES), 'handout.pdf');
    expect(proposal.material.format).toBe('pdf');
    expect(proposal.pages).toBe(2);

    const body = proposal.material.body;
    expect(body).toContain('Setting Godly Priorities');
    expect(body).toContain('seek first the kingdom.');

    // Order, asserted as order rather than as presence.
    expect(body.indexOf('where your treasure is')).toBeLessThan(
      body.indexOf('no one can serve two masters'),
    );
    expect(body.indexOf('no one can serve two masters')).toBeLessThan(
      body.indexOf('seek first the kingdom'),
    );
  }, 20_000);

  it('reads nothing about who provided it', async () => {
    // The fixture's first page literally says "City Gate Church". Inferring a
    // church from prose is exactly the guess this phase refuses to make.
    const proposal = await readSermonNotes(latin1(TEXT_PDF_NOTES), 'handout.pdf');
    expect(proposal.material.church).toBeUndefined();
    expect(proposal.material.speaker).toBeUndefined();
    expect(proposal.material.date).toBeUndefined();
  }, 20_000);

  it('refuses a scanned PDF, and says both what it is and what we cannot do', async () => {
    const message = await refuses(
      latin1(SCANNED_PDF_NOTES),
      'scan.pdf',
      /scanned pages rather than selectable text/i,
    );
    // Two facts, in the order a reader needs them. Saying only the second
    // leaves somebody holding a photocopy to work out why a PDF full of words
    // is "not readable".
    expect(message).toMatch(/text recognition is not available yet/i);
    // "not available yet", not "not supported": it was measured and deferred
    // on package size, not decided against.
    expect(message).not.toMatch(/not supported/i);
  }, 20_000);

  it('refuses a file that is not a PDF', async () => {
    await refuses(bytes(BROKEN_PDF), 'broken.pdf', /could not|damaged|not a/i);
  }, 20_000);
});

describe('the limits', () => {
  it('refuses a file past the size limit, and names the size', async () => {
    const oversized = new Uint8Array(MAX_SERMON_NOTES_BYTES + 1).fill(0x41);
    await refuses(oversized, 'huge.txt', /larger than the 8MB limit/i);
  });

  it('lets a file exactly at the size limit past that limit', async () => {
    // The boundary from the allowed side, stated as what it actually is.
    //
    // A text file cannot be accepted outright at 8MB, and that is not a
    // contradiction: bytes and characters are near enough the same thing for
    // text, so the 200,000-character rule bites long before the 8MB one. The
    // byte limit exists for PDFs, where a few hundred kilobytes of fonts and
    // images carry a page of words. What this asserts is the only thing the
    // byte limit claims — that the size check does not fire AT its own stated
    // value. Writing it as "is accepted" would have been a test of a different
    // limit wearing this one's name.
    const atLimit = new Uint8Array(MAX_SERMON_NOTES_BYTES).fill(0x41);
    let message = '';
    try {
      await readSermonNotes(atLimit, 'big.txt');
    } catch (cause) {
      message = (cause as ImportError).message;
    }
    expect(message, 'the size limit fired at its own stated value').not.toMatch(/larger than the/i);
  }, 20_000);

  it('refuses text past the character limit rather than cutting it', async () => {
    const tooMuch = 'a'.repeat(MAX_SERMON_NOTES_CHARS + 1);
    await refuses(bytes(tooMuch), 'long.txt', /longer than a sermon handout/i);
  });

  it('accepts text exactly at the character limit', async () => {
    const atLimit = 'a'.repeat(MAX_SERMON_NOTES_CHARS);
    const proposal = await readSermonNotes(bytes(atLimit), 'long.txt');
    expect(proposal.material.body.length).toBe(MAX_SERMON_NOTES_CHARS);
  });
});
