/**
 * The share surface, driven the way a person drives it.
 *
 * `entry-document.test.ts` proves the renderer. This proves the renderer is
 * what the button actually sends — and, more importantly, that the three ways
 * a share can end badly all leave the journal exactly as it was: cancelling,
 * a dismissed chooser, and a failure.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformProvider } from '../platform/provider';
import type { Platform, ShareRequest } from '../platform/ports';
import { ShareEntry } from './ShareEntry';
import type { Entry } from '../types';

const NOTES = 'NOTESMARKER-the-vine';
const REFLECTION = 'REFLECTIONMARKER-what-it-meant';
const PRAYER = 'PRAYERMARKER-keep-me';
const PROVIDED = 'PROVIDEDMARKER-handout';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'IDMARKER-share-1',
    kind: 'sermon',
    title: 'Abiding in Christ',
    date: '2026-09-23',
    speaker: 'Pastor James',
    anchors: [],
    scriptureRefs: ['John 15:1-17'],
    notes: NOTES,
    reflection: REFLECTION,
    prayer: PRAYER,
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-09-23T10:00:00.000Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
    sourceMaterial: {
      format: 'pdf',
      filename: 'handout.pdf',
      importedAt: '2026-09-23T09:00:00.000Z',
      body: PROVIDED,
      parserVersion: 1,
    },
    ...overrides,
  };
}

/**
 * A share mock with a declared signature.
 *
 * `vi.fn(async () => …)` infers a zero-argument function, and then
 * `mock.calls[0][0]` is a type error even though the call really does carry a
 * request. Declaring it here keeps `tsc -b` and the runtime agreeing — a
 * vitest run alone would not have noticed, because vitest does not typecheck.
 */
const shareMock = (result: { shared: boolean } | (() => never) = { shared: true }) =>
  vi.fn<(request: ShareRequest) => Promise<{ shared: boolean }>>(async () => {
    if (typeof result === 'function') return result();
    return result;
  });

function show(
  e: Entry,
  share: (request: ShareRequest) => Promise<{ shared: boolean }>,
  onClose = () => {},
) {
  const platform = {
    files: { save: async () => ({ saved: false as const, reason: 'cancelled' as const }) },
    picker: { pick: async () => null },
    printer: { print: () => {}, canPrint: false },
    unsavedWork: { protect: () => () => {} },
    sharer: { canShare: true, share },
  } as unknown as Platform;

  return render(
    <PlatformProvider platform={platform}>
      <ShareEntry entry={e} onClose={onClose} />
    </PlatformProvider>,
  );
}

const check = (name: RegExp) => screen.getByRole('checkbox', { name });

afterEach(cleanup);

describe('what the button sends', () => {
  it('sends the notes and leaves reflection, prayer and the handout behind', async () => {
    const share = shareMock();
    show(entry(), share);

    fireEvent.click(screen.getByRole('button', { name: 'Share as text' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const sent = share.mock.calls[0][0];

    expect(sent.text).toContain(NOTES);
    expect(sent.text).not.toContain(REFLECTION);
    expect(sent.text).not.toContain(PRAYER);
    expect(sent.text).not.toContain(PROVIDED);
    // And nothing of the record around it.
    expect(sent.text).not.toContain('IDMARKER');
    expect(sent.text).not.toContain('2026-09-23T10:00');
  });

  it('sends a section once it is ticked', async () => {
    const share = shareMock();
    show(entry(), share);

    fireEvent.click(check(/My reflection/));
    fireEvent.click(screen.getByRole('button', { name: 'Share as text' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].text).toContain(REFLECTION);
  });

  it('labels the church’s material when it is ticked', async () => {
    const share = shareMock();
    show(entry(), share);

    fireEvent.click(check(/Provided notes/));
    fireEvent.click(screen.getByRole('button', { name: 'Share as text' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const text = share.mock.calls[0][0].text ?? '';
    expect(text).toContain('Provided notes');
    expect(text.indexOf('Provided notes')).toBeLessThan(text.indexOf(PROVIDED));
  });

  it('starts with reflection and prayer unticked', () => {
    show(entry(), shareMock());
    expect(check(/My reflection/)).not.toBeChecked();
    expect(check(/Prayer/)).not.toBeChecked();
    expect(check(/Provided notes/)).not.toBeChecked();
    expect(check(/My notes/)).toBeChecked();
  });

  it('shows the reader exactly what will be sent, before it is', () => {
    show(entry(), shareMock());

    // The preview is the text itself, not a description of it.
    const preview = screen.getByText(new RegExp(NOTES));
    expect(preview).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(PRAYER))).toBeNull();

    fireEvent.click(check(/Prayer/));
    expect(screen.getByText(new RegExp(PRAYER))).toBeInTheDocument();
  });

  it('will not offer a section the entry has nothing for', () => {
    show(entry({ prayer: '', reflection: '' }), shareMock());
    expect(check(/Prayer/)).toBeDisabled();
    expect(check(/My reflection/)).toBeDisabled();
    expect(check(/My notes/)).toBeEnabled();
  });
});

describe('nothing is changed by any ending', () => {
  it('cancelling closes and sends nothing', () => {
    const share = shareMock();
    const onClose = vi.fn();
    show(entry(), share, onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('a dismissed chooser is not an error and says nothing', async () => {
    const share = shareMock({ shared: false });
    const onClose = vi.fn();
    show(entry(), share, onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Share as text' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    // Somebody who changed their mind has done nothing wrong.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a failure says so plainly and promises the journal is untouched', async () => {
    const share = shareMock(() => {
      throw new Error('the sheet fell over');
    });
    show(entry(), share);

    fireEvent.click(screen.getByRole('button', { name: 'Share as text' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be shared/i);
    expect(alert).toHaveTextContent(/unchanged/i);
    // And never the library's own words.
    expect(alert).not.toHaveTextContent(/fell over/i);
  });

  it('does not modify the entry it was given', () => {
    const original = entry();
    const before = JSON.stringify(original);
    show(original, shareMock());

    fireEvent.click(check(/Prayer/));
    fireEvent.click(check(/Provided notes/));

    expect(JSON.stringify(original)).toBe(before);
  });
});

describe('the PDF route', () => {
  it('hands over a named PDF file rather than text', async () => {
    const share = shareMock();
    show(entry(), share);

    fireEvent.click(screen.getByRole('button', { name: /Share as PDF/ }));

    await waitFor(() => expect(share).toHaveBeenCalled(), { timeout: 20_000 });
    const sent = share.mock.calls[0][0];

    expect(sent.file?.mimeType).toBe('application/pdf');
    expect(sent.file?.filename).toBe('abiding-in-christ.pdf');
    expect(sent.file?.bytes.byteLength).toBeGreaterThan(500);
    // The filename carries the title, never the identifier.
    expect(sent.file?.filename).not.toContain('IDMARKER');
  }, 30_000);
});
