import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import BookView from './BookView';
import {
  findSegment,
  hasOutlines,
  hasOutlineTitles,
  segmentTitle,
  segmentsForBook,
} from '../app/data';
import { StorageContextProvider } from '../app/storage';
import { segmentRef } from '../lib/passages';
import { DexieStorageProvider } from '../storage/db';
import type { AnchorLookup, EntryQuery } from '../storage/StorageProvider';
import type { Entry } from '../types';

// Vitest is not running with globals, so Testing Library's automatic cleanup
// never registers itself.
afterEach(cleanup);

/**
 * The real Dexie provider, counting reads.
 *
 * The view's contract is that a book costs a fixed number of storage reads, not
 * one per segment — Genesis has 84 of them under the full profile. Counting on
 * the genuine provider proves that against real IndexedDB behaviour rather than
 * against a stub.
 */
class CountingProvider extends DexieStorageProvider {
  listEntriesCalls = 0;
  anchorCalls = 0;

  override async listEntries(query: EntryQuery = {}): Promise<Entry[]> {
    this.listEntriesCalls += 1;
    return super.listEntries(query);
  }

  override async findEntriesForAnchor(anchor: AnchorLookup): Promise<Entry[]> {
    this.anchorCalls += 1;
    return super.findEntriesForAnchor(anchor);
  }
}

/** Storage that will not open: private browsing, or blocked site data. */
class UnopenableProvider extends DexieStorageProvider {
  override async open(): Promise<void> {
    throw new Error('site data is blocked');
  }
}

let dbCount = 0;
/** A fresh database per test, so nothing leaks between them. */
function newProvider(): CountingProvider {
  dbCount += 1;
  return new CountingProvider(`journey-bookview-${dbCount}`);
}

function renderBook(bookId: string, provider = newProvider()) {
  render(
    <StorageContextProvider provider={provider}>
      <BookView bookId={bookId} />
    </StorageContextProvider>,
  );
  return provider;
}

const GENESIS_SEGMENTS = segmentsForBook('genesis');

describe('BookView', () => {
  it('names the book and links every segment to its passage', async () => {
    renderBook('genesis');
    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    const links = screen.getAllByRole('link');

    expect(links).toHaveLength(GENESIS_SEGMENTS.length);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      GENESIS_SEGMENTS.map((segment) => `#/passage/genesis/${segment.id}`),
    );
    // Real anchors, not clickable divs.
    for (const link of links) expect(link.tagName).toBe('A');
  });

  it('starts at h1, uses h2 beneath it, and has exactly one h1', async () => {
    renderBook('genesis');
    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      `Passages (${GENESIS_SEGMENTS.length} passages)`,
    ]);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('shows the book intro only when the data profile carries it', async () => {
    renderBook('genesis');
    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    // Under `refs-only` the author's prose is not in the build at all, and the
    // view must render nothing rather than an empty box.
    if (hasOutlineTitles) {
      expect(screen.getByText(/Genesis is not only the first Bible book/)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/Genesis is not only the first Bible book/)).toBeNull();
    }
  });

  it('titles every segment with segmentTitle, and never prints the reference twice', async () => {
    renderBook('genesis');
    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    const links = screen.getAllByRole('link');
    GENESIS_SEGMENTS.forEach((segment, index) => {
      const title = segmentTitle(segment);
      expect(links[index]).toHaveTextContent(title);
      if (title === segment.ref) {
        // Title and reference are the same string; it must appear once.
        expect(links[index].textContent?.match(/Genesis \d/g)).toHaveLength(1);
      } else {
        expect(links[index]).toHaveTextContent(segment.ref);
        // The row is read aloud as one string. Without punctuation the title
        // runs into the reference: "[licensed content removed]Genesis 1".
        expect(links[index].textContent).toContain(`, ${segment.ref}`);
      }
    });
  });

  it.skipIf(!hasOutlines)(
    'makes an uncovered passage as clickable as an outline one, and says what it is',
    async () => {
      renderBook('genesis');
      await screen.findByRole('heading', { level: 1, name: 'Genesis' });

      // Genesis 35:1-15 is the case the product promise is written about: the
      // outlines do not cover it, and the reader must still be able to write.
      const gap = findSegment('genesis', 'genesis-35-1-15');
      expect(gap?.kind).toBe('uncovered');

      const link = screen.getByRole('link', { name: /Genesis 35:1-15/ });
      expect(link).toHaveAttribute('href', '#/passage/genesis/genesis-35-1-15');
      expect(link.tagName).toBe('A');
      expect(link).toHaveTextContent('No outline entry — read it and add your own note');
      // Separated when spoken, rather than running on from the reference.
      expect(link.textContent).toContain(', No outline entry');

      // Same element, same affordance as its outline-backed neighbour.
      const covered = screen.getByRole('link', { name: new RegExp(segmentTitle(GENESIS_SEGMENTS[0])) });
      expect(link.tagName).toBe(covered.tagName);
      expect(link.className.includes('min-h-11')).toBe(true);
      expect(covered.className.includes('min-h-11')).toBe(true);
    },
  );

  it.skipIf(hasOutlines)('browses whole chapters when no outline layer ships', async () => {
    renderBook('genesis');
    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(50);
    expect(links[0]).toHaveTextContent('Genesis 1');
    expect(links[0]).toHaveAttribute('href', '#/passage/genesis/genesis-1');
    // Said once for the list rather than repeated on all fifty rows.
    expect(screen.getByText(/Open any chapter to read it and add your own note/)).toBeInTheDocument();
  });

  it.skipIf(!hasOutlines)(
    'marks series and classic stories with tags, where the profile has them',
    async () => {
      renderBook('john');
      await screen.findByRole('heading', { level: 1, name: 'John' });

      const segment = findSegment('john', 'john-2-1-12');
      const link = screen.getByRole('link', { name: new RegExp(segmentTitle(segment!)) });

      expect(link).toHaveAttribute('href', '#/passage/john/john-2-1-12');
      expect(link).toHaveTextContent('Classic story');
      // Chips run together when spoken unless each carries its own separator.
      expect(link.textContent).toContain(', Classic story');
      if (hasOutlineTitles) expect(link).toHaveTextContent('Series: Miracle');
      else expect(link).not.toHaveTextContent('Series:');
    },
  );

  it('counts the journal entries on each passage from a single read', async () => {
    const provider = newProvider();
    await provider.open();

    const target = GENESIS_SEGMENTS[3];
    await provider.createEntry({
      title: 'Sunday morning',
      anchors: [{ kind: 'scripture', ...segmentRef(target, 'genesis') }],
    });
    await provider.createEntry({
      title: 'A second look',
      anchors: [{ kind: 'scripture', ...segmentRef(target, 'genesis') }],
    });
    provider.listEntriesCalls = 0;
    provider.anchorCalls = 0;

    renderBook('genesis', provider);
    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    const link = document.querySelector(`a[href="#/passage/genesis/${target.id}"]`);
    await waitFor(() => expect(link).toHaveTextContent('2 journal entries'));

    // The neighbour is untouched: the match is the exact range, not an overlap.
    const neighbour = document.querySelector(
      `a[href="#/passage/genesis/${GENESIS_SEGMENTS[4].id}"]`,
    );
    expect(neighbour).not.toBeNull();
    expect(neighbour).not.toHaveTextContent('journal entr');

    // Dozens of segments, and the whole book answered without a per-segment query.
    expect(provider.anchorCalls).toBe(0);
    expect(provider.listEntriesCalls).toBeLessThan(3);
  });

  it('counts an entry once even when it anchors to the same passage twice', async () => {
    const provider = newProvider();
    await provider.open();

    const target = GENESIS_SEGMENTS[3];
    const ref = segmentRef(target, 'genesis');
    await provider.createEntry({
      title: 'Anchored twice',
      anchors: [
        { kind: 'scripture', ...ref },
        // The same range again, this time also carrying an outline id.
        { kind: 'scripture', ...ref, outlineEntryId: target.id },
      ],
    });

    renderBook('genesis', provider);
    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    const link = document.querySelector(`a[href="#/passage/genesis/${target.id}"]`);
    await waitFor(() => expect(link).toHaveTextContent('1 journal entry'));
  });

  it('summarises the journal for the book once storage has been read', async () => {
    const provider = newProvider();
    await provider.open();
    await provider.createEntry({
      title: 'Sunday morning',
      anchors: [{ kind: 'scripture', ...segmentRef(GENESIS_SEGMENTS[0], 'genesis') }],
    });

    renderBook('genesis', provider);

    // Announced, not silent: the summary is a live status, not a hidden change.
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('1 journal entry in Genesis.'));
  });

  it('says the journal could not be read rather than showing it as empty', async () => {
    render(
      <StorageContextProvider provider={new UnopenableProvider('journey-bookview-broken')}>
        <BookView bookId="genesis" />
      </StorageContextProvider>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Genesis' });

    // An unreadable journal is not an empty one, and the difference matters:
    // "no entries yet" would invite the reader to conclude their notes are gone.
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent(/could not be opened/));
    expect(status).not.toHaveTextContent('No journal entries in Genesis yet.');

    // The book is still fully browsable; only the counts are in doubt.
    expect(screen.getAllByRole('link')).toHaveLength(GENESIS_SEGMENTS.length);
  });

  it('says plainly when a book id is unknown, and offers the way back', async () => {
    renderBook('narnia');

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Book not found');
    expect(screen.getByText(/There is no book called/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to the list of books/ })).toHaveAttribute(
      'href',
      '#/browse',
    );
  });
});
