import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import BrowseView from './BrowseView';
import { canonBooks, hasOutlines } from '../app/data';

const OT_COUNT = canonBooks.filter((book) => book.testament === 'OT').length;

/** The canon row for a book, so counts are read from the profile in the build. */
function bookById(id: string) {
  const book = canonBooks.find((candidate) => candidate.id === id);
  if (!book) throw new Error(`no canon book ${id}`);
  return book;
}

/** The polite announcement region, wherever it sits in the tree. */
function announcement(): string {
  const region = document.querySelector('[aria-live="polite"]');
  return region?.textContent ?? '';
}

function typeFilter(value: string) {
  fireEvent.change(screen.getByLabelText('Find a book'), { target: { value } });
}

// Vitest is not running with globals, so Testing Library's automatic cleanup
// never registers itself. Without this, every render piles up in one document.
afterEach(cleanup);

describe('BrowseView', () => {
  it('lists all 66 books in canonical order, each linking to its book route', () => {
    render(<BrowseView />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(canonBooks.length);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      canonBooks.map((book) => `#/book/${book.id}`),
    );

    // Canonical, not alphabetical: Genesis first, Malachi last in the OT.
    expect(links[0]).toHaveAttribute('href', '#/book/genesis');
    expect(links[OT_COUNT - 1]).toHaveAttribute('href', '#/book/malachi');
    expect(links[OT_COUNT]).toHaveAttribute('href', '#/book/matthew');
    expect(links[links.length - 1]).toHaveAttribute('href', '#/book/revelation');
  });

  it('starts at h1 and uses h2 for the two testaments, skipping no level', () => {
    render(<BrowseView />);

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('The Bible');

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Old Testament',
      'New Testament',
    ]);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('shows each book’s chapter count, and its outline entry count when there is one', () => {
    render(<BrowseView />);

    const genesis = screen.getByRole('link', { name: /Genesis/ });
    const obadiah = screen.getByRole('link', { name: /Obadiah/ });

    // Chapter counts come from the KJV versification and hold under every profile.
    expect(genesis).toHaveTextContent(/50 chapters/);
    // Obadiah is one chapter: the singular has to be right.
    expect(obadiah).toHaveTextContent(/1 chapter(?!s)/);

    if (hasOutlines) {
      // The division count is the profile's, not a constant: the purchased
      // outlines divide Genesis 78 ways and the BSB sections 135. What has to
      // hold is that the row states the count the data actually carries, and
      // pluralises it correctly.
      const genesisEntries = bookById('genesis').entryCount;
      expect(genesisEntries).toBeGreaterThan(1);
      expect(genesis).toHaveTextContent(
        new RegExp(`50 chapters, ${genesisEntries} outline entries`),
      );

      // The singular needs a book with exactly one division. Obadiah is that
      // book under `full`; the BSB sections give every book at least two, so
      // the singular is asserted where it exists and the plural form of the
      // same row is asserted where it does not. The chapter count above
      // exercises the singular under every profile either way.
      const singular = canonBooks.find((book) => book.entryCount === 1);
      if (singular) {
        const row = screen.getByRole('link', { name: new RegExp(`^${singular.name}\\b`) });
        expect(row).toHaveTextContent(/, 1 outline entry(?!\w)/);
      } else {
        const obadiahEntries = bookById('obadiah').entryCount;
        expect(obadiahEntries).toBeGreaterThan(1);
        expect(obadiah).toHaveTextContent(
          new RegExp(`1 chapter, ${obadiahEntries} outline entries`),
        );
      }
    } else {
      // `refs-only` ships no outline layer, so there is nothing to count.
      expect(genesis).not.toHaveTextContent(/outline entr/);
      expect(obadiah).not.toHaveTextContent(/outline entr/);
    }
  });

  it('narrows the list as you type and announces the result count politely', () => {
    render(<BrowseView />);

    typeFilter('john');

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/book/john',
      '#/book/1-john',
      '#/book/2-john',
      '#/book/3-john',
    ]);
    expect(screen.queryByRole('link', { name: /Genesis/ })).toBeNull();

    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(announcement()).toMatch(/4 books match/);

    // The Old Testament section disappears when nothing in it matches.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'New Testament (4 books)',
    ]);
  });

  it('matches the id spelling too, and gets the singular announcement right', () => {
    render(<BrowseView />);

    typeFilter('1sam');

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /1 Samuel/ })).toHaveAttribute('href', '#/book/1-samuel');
    expect(announcement()).toMatch(/1 book matches/);
  });

  it('keeps a keyboard user’s place when the filter is cleared', () => {
    render(<BrowseView />);

    typeFilter('john');

    const clear = screen.getByRole('button', { name: 'Clear' });
    clear.focus();
    fireEvent.click(clear);

    // Clearing unmounts the button that was just pressed. Focus must land back
    // on the field, not on <body>, which would lose the user's place entirely.
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Find a book'));
  });

  it('does not claim matches for punctuation that filters nothing', () => {
    render(<BrowseView />);

    // "!!!" normalizes away to nothing, so every book is still on screen. The
    // announcement has to describe what is shown, not what was typed.
    typeFilter('!!!');

    expect(screen.getAllByRole('link')).toHaveLength(canonBooks.length);
    expect(announcement()).toMatch(/Showing all 66 books/);
  });

  it('says so when nothing matches, and clears back to the full list', () => {
    render(<BrowseView />);

    typeFilter('zzzz');

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText(/No book matches/)).toBeInTheDocument();
    expect(announcement()).toMatch(/0 books match/);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getAllByRole('link')).toHaveLength(canonBooks.length);
    expect(announcement()).toMatch(/Showing all 66 books/);
  });
});
