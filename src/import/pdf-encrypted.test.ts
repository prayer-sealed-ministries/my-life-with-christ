/**
 * A password-protected PDF is refused, and nothing is spent trying.
 *
 * The refusal itself was written early and shipped with no test over it at
 * all: `ENCRYPTED_PDF` and the `PasswordException` branch that raises it had
 * no coverage of any kind, which is how the first attempt at a fixture here
 * went unnoticed. That fixture declared `/Encrypt` in its trailer, pointed it
 * at an object beyond `/Size` that no cross-reference listed, and left every
 * stream in the clear. pdf.js never found an encryption dictionary, opened the
 * document and handed back the plaintext — correctly. The product was right;
 * the measurement was reading an unencrypted file.
 *
 * So the first test here is about the FIXTURE, not the product: it proves the
 * bytes are genuinely locked by refusing to open without the password and
 * yielding the exact plaintext with it. Only then does the refusal below mean
 * anything. This is the floor, in the form this particular check needs it.
 */

import { describe, expect, it } from 'vitest';

import { ENCRYPTED_PDF } from './pdf';
import { ENCRYPTED_PDF_PASSWORD, encryptedPdf } from './fixtures';
import { MAX_SCANNED_PDF_OCR_PAGES } from './limits';
import { readSermonNotes } from './sermon-notes';
import type { PreparedPage } from '../platform/ports';

const BODY = 'ZZSCAN-ENCRYPTED body';

/*
 * Built fresh for every read, not shared between them.
 *
 * pdfjs takes ownership of the buffer it is handed and DETACHES it, so a
 * second read of the same array finds zero bytes and reports "That file is
 * empty" about a document that is nothing of the kind. The view guards the
 * same hazard with a ref; a test that reused one fixture would simply be
 * asserting the wrong refusal, which is what it did on the first run here.
 */
const locked = () => encryptedPdf(BODY);

/** Read one, and return the sentence it refused with. */
const refusal = (bytes: Uint8Array, scanner?: Parameters<typeof readSermonNotes>[3]) =>
  readSermonNotes(bytes, 'ZZBAD-encrypted.pdf', 'application/pdf', scanner).then(
    () => '',
    (error: Error) => error.message,
  );

/*
 * The sentence a DAMAGED PDF gets, which also contains the words
 * "password-protected" — because a file that will not open might be either,
 * and the reader is told so.
 *
 * It is written out here because the first version of this test asserted
 * `/password-protected/i`, which both sentences satisfy. Deleting the
 * encrypted branch from the parser left all four tests green. The messages
 * must therefore be compared exactly, and the two must be known to differ.
 */
const DAMAGED = 'That PDF could not be opened. It may be damaged or password-protected.';

/** A scanner that fails the test if the refusal ever reaches recognition. */
function forbiddenScanner() {
  const calls: PreparedPage[] = [];
  return {
    calls,
    scanner: {
      supported: true,
      capture: async () => ({ reason: 'unsupported' }) as never,
      choose: async () => ({ reason: 'unsupported' }) as never,
      recognise: async () => ({ reason: 'unsupported' }) as never,
      discard: async () => undefined,
      async recognisePrepared(image: PreparedPage) {
        calls.push(image);
        return { reason: 'no-text' } as const;
      },
    },
  };
}

describe('the fixture is actually encrypted', () => {
  it('will not open without the password, and reads correctly with it', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const open = (password?: string) =>
      pdfjs.getDocument({
        data: locked(),
        password,
        useWorkerFetch: false,
        disableFontFace: true,
        useSystemFonts: false,
      });

    // Asked for by name, which is how pdf.js reports a locked document.
    await expect(open().promise).rejects.toMatchObject({ name: 'PasswordException' });

    const task = open(ENCRYPTED_PDF_PASSWORD);
    const opened = await task.promise;
    const page = await opened.getPage(1);
    const text = (await page.getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join('');
    await task.destroy();

    // The plaintext comes back exactly, which is the proof the streams were
    // encrypted rather than merely declared to be: RC4 against cleartext would
    // return noise, and a missing encryption dictionary would return this
    // string without a password having been needed at all.
    expect(text).toBe(BODY);
  }, 20_000);
});

describe('importing a password-protected handout', () => {
  it('refuses it, and says which situation it is', async () => {
    // The floor for the two assertions below: if these ever became the same
    // sentence, "it said password-protected" would stop being evidence that
    // the locked case was recognised at all.
    expect(ENCRYPTED_PDF).not.toBe(DAMAGED);

    expect(await refusal(locked())).toBe(ENCRYPTED_PDF);
  }, 20_000);

  it('does not mistake a locked document for a damaged one', async () => {
    expect(await refusal(locked())).not.toBe(DAMAGED);
  }, 20_000);

  it('spends no recognition on it', async () => {
    // Refusing after rasterising every page would still be a refusal, and
    // would have cost a locked document's worth of canvases and OCR first.
    const ocr = forbiddenScanner();

    expect(await refusal(locked(), ocr.scanner)).toBe(ENCRYPTED_PDF);

    expect(ocr.calls).toEqual([]);
    // A guard against this assertion going quiet if the ceiling is ever read
    // as "none allowed", which would make an empty list meaningless.
    expect(MAX_SCANNED_PDF_OCR_PAGES).toBeGreaterThan(0);
  }, 20_000);

  it('tells the reader nothing about the document’s contents', async () => {
    const message = await refusal(locked());

    expect(message).not.toContain(BODY);
    expect(message).not.toMatch(/zzsecret|Helvetica|stream|obj/i);
  }, 20_000);
});
