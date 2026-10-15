/**
 * The active-content check is reached, not merely written.
 *
 * A security control that nothing calls is the failure this repository has
 * shipped before. This drives the real import path with a document that only
 * that check refuses — pdf.js opens it perfectly — so the assertion is about
 * the wiring rather than about the function.
 */
import { describe, expect, it } from 'vitest';

import { parseDocument } from './candidates';
import { readSermonNotes } from './sermon-notes';
import { pdf } from './fixtures';

const latin1 = (text: string) => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** An ordinary handout that also asks to run a script. */
const scripted = () =>
  latin1(
    pdf([['BT /F1 12 Tf (FICTIONAL-DOC handout) Tj ET']]).replace(
      'trailer',
      '9 0 obj\n<< /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj\ntrailer',
    ),
  );

describe('a scripted PDF is refused by both doorways', () => {
  it('the parser is content with it, which is why the check has to exist', async () => {
    const { parsePdf } = await import('./pdf');
    const extraction = await parsePdf(scripted().slice());
    expect(extraction.pages.length).toBeGreaterThan(0);
  });

  it('the general importer refuses it', async () => {
    await expect(parseDocument(scripted(), 'handout.pdf')).rejects.toThrow(
      /interactive features this app doesn’t open/i,
    );
  });

  it('the church-notes importer refuses it too', async () => {
    await expect(readSermonNotes(scripted(), 'handout.pdf')).rejects.toThrow(
      /interactive features this app doesn’t open/i,
    );
  });
});
