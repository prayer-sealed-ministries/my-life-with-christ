import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { Entry } from '../types';
import TimelineView from './TimelineView';

let dbCounter = 0;

/** A real Dexie provider over fake-indexeddb, fresh per test. */
function freshProvider(): DexieStorageProvider {
  dbCounter += 1;
  return new DexieStorageProvider(`journey-timeline-test-${dbCounter}`);
}

function entry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    kind: 'sermon',
    title: 'Untitled',
    date: '2026-01-01',
    anchors: [],
    scriptureRefs: [],
    notes: '',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function renderWith(provider: DexieStorageProvider, children: ReactNode = <TimelineView />) {
  return render(
    <RouterProvider>
      <StorageContextProvider provider={provider}>{children}</StorageContextProvider>
    </RouterProvider>,
  );
}

/** Month name as the app would print it, so the assertion is not locale-bound. */
const monthName = (year: number, monthIndex: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(year, monthIndex, 1));

beforeEach(() => {
  window.location.hash = '#/timeline';
});

// Vitest does not run with `globals: true`, so Testing Library's automatic
// cleanup never registers. Without this, every render stacks up in one document.
afterEach(cleanup);

describe('TimelineView', () => {
  it('shows an empty state, and a way in, when nothing is written', async () => {
    const provider = freshProvider();
    await provider.open();

    renderWith(provider);

    expect(await screen.findByText('Nothing written yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New sermon note' })).toHaveAttribute(
      'href',
      '#/entry/new',
    );
  });

  it('groups entries by year then month, oldest first, each linking to its entry', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({ id: 'b', title: 'Second Sunday', date: '2026-03-15' }),
      entry({ id: 'a', title: 'A quiet reading', date: '2025-11-02', kind: 'reading' }),
      entry({ id: 'c', title: 'Same month again', date: '2026-03-29' }),
    ]);

    renderWith(provider);

    await screen.findByRole('link', { name: /Second Sunday/ });

    const years = screen.getAllByRole('heading', { level: 2 });
    expect(years.map((heading) => heading.textContent)).toEqual(['2025', '2026']);

    const months = screen.getAllByRole('heading', { level: 3 });
    expect(months.map((heading) => heading.textContent)).toEqual([
      monthName(2025, 10),
      monthName(2026, 2),
    ]);

    // Oldest first, and the two March entries share one month heading.
    const links = screen.getAllByRole('link', { name: /quiet reading|Sunday|Same month/ });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/entry/a',
      '#/entry/b',
      '#/entry/c',
    ]);
  });

  it('shows kind, date, speaker, place and a notes excerpt on each entry', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({
        id: 'a',
        title: 'The Beatitudes',
        date: '2026-03-15',
        speaker: 'Pastor James Whitfield',
        place: 'First Baptist, Tallahassee, FL',
        notes: 'He opened by saying the Beatitudes are not entry requirements.',
      }),
    ]);

    renderWith(provider);

    const link = await screen.findByRole('link', { name: /The Beatitudes/ });
    expect(within(link).getByText(/Sermon/)).toBeInTheDocument();
    expect(within(link).getByText(/Pastor James Whitfield/)).toBeInTheDocument();
    expect(within(link).getByText(/First Baptist, Tallahassee, FL/)).toBeInTheDocument();
    expect(within(link).getByText(/not entry requirements/)).toBeInTheDocument();
    // The day, in whatever the environment's locale renders it as.
    expect(link.textContent).toContain(monthName(2026, 2));
  });

  it('marks a descendants entry with words, not only a colour', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({ id: 'a', title: 'For the children', date: '2026-02-01', forDescendants: true }),
      entry({ id: 'b', title: 'Just for me', date: '2026-02-02' }),
    ]);

    renderWith(provider);

    const flagged = await screen.findByRole('link', { name: /For the children/ });
    expect(within(flagged).getByText('For my family')).toBeInTheDocument();

    const plain = screen.getByRole('link', { name: /Just for me/ });
    expect(within(plain).queryByText('For my family')).not.toBeInTheDocument();
  });

  it('surfaces the export reminder here, linking to the export', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'A first note', date: '2026-02-01' })]);

    renderWith(provider);

    // Scoped to the banner: the same wording also reaches the live region that
    // announces it, and an unscoped query would match both.
    const heading = await screen.findByText('Back up your journal');
    const banner = heading.closest('div');
    expect(banner).not.toBeNull();
    expect(within(banner as HTMLElement).getByText(/never exported/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export my journal' })).toHaveAttribute(
      'href',
      '#/data',
    );
  });

  it('stays quiet when the journal was exported recently', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'Recent', date: '2026-02-01' })]);
    await provider.updateSettings({ lastExportAt: daysAgo(3) });

    renderWith(provider);

    await screen.findByRole('link', { name: /Recent/ });
    expect(screen.queryByText('Back up your journal')).not.toBeInTheDocument();
  });

  it('dismisses the reminder with a real button, and remembers the dismissal', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'Unbacked', date: '2026-02-01' })]);

    renderWith(provider);

    const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismiss);

    await waitFor(() => expect(screen.queryByText('Back up your journal')).not.toBeInTheDocument());
    await waitFor(async () => {
      const settings = await provider.getSettings();
      expect(settings.reminderDismissedAt).toBeTruthy();
    });
  });

  /**
   * An undated run is not contiguous: a stored date of "" sorts before every
   * real date and "unknown" sorts after, so "Undated" opens twice. Keyed on the
   * bucket alone those two sections collide, and React's response to a key
   * collision is to duplicate or omit a child — an entry disappearing.
   */
  it('keeps undated entries visible even when they open a section twice', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args[0]);
    });

    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({ id: 'x', title: 'No date at all', date: '' }),
      entry({ id: 'y', title: 'Properly dated', date: '2026-01-01' }),
      entry({ id: 'z', title: 'Unreadable date', date: 'unknown' }),
    ]);

    renderWith(provider);

    await screen.findByRole('link', { name: /Unreadable date/ });

    expect(screen.getByRole('link', { name: /No date at all/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Properly dated/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Undated',
      '2026',
      'Undated',
    ]);

    const duplicateKey = errors.some((message) =>
      String(message).includes('two children with the same key'),
    );
    expect(duplicateKey).toBe(false);
    spy.mockRestore();
  });

  it('shows a date the calendar does not have verbatim, never rolled over', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      // An import could carry this. new Date(2026, 1, 31) rolls to 3 March, and
      // showing that would be correcting the record rather than reporting it.
      entry({ id: 'a', title: 'Impossible day', date: '2026-02-31' }),
    ]);

    renderWith(provider);

    const link = await screen.findByRole('link', { name: /Impossible day/ });
    expect(link).toHaveTextContent('2026-02-31');
    expect(link).not.toHaveTextContent(monthName(2026, 2));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Undated');
  });

  it('announces the backup reminder, not only the entry count', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'Unbacked', date: '2026-02-01' })]);

    renderWith(provider);

    await screen.findByText('Back up your journal');

    const live = Array.from(document.querySelectorAll('[aria-live="polite"]')).map(
      (node) => node.textContent ?? '',
    );
    expect(live.some((text) => /never exported/i.test(text))).toBe(true);
    expect(live.some((text) => text.includes('1 entry in your journal.'))).toBe(true);
  });

  it('draws focus on filled controls against the page, not in their own ink', async () => {
    const provider = freshProvider();
    await provider.open();

    renderWith(provider);

    // A filled control focused with `outline-current` paints its ring in its own
    // ink — which on this button is `accent-ink`, very nearly the page colour in
    // one theme or the other. That is no visible focus at all (WCAG 2.4.7).
    //
    // Asserted as "names a ring, and not the inherited one" rather than by
    // colour name: the colours moved to semantic tokens and the literal
    // `outline-slate-900` stopped existing, but the rule it was protecting did
    // not change at all.
    const action = await screen.findByRole('link', { name: 'New sermon note' });
    expect(action.className).toMatch(/focus-visible:outline-(?!current)\S+/);
    expect(action.className).not.toContain('outline-current');
  });

  it('lets long unbroken text wrap instead of scrolling the page sideways', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({
        id: 'a',
        title: `https://example.com/${'sermon-audio-'.repeat(12)}`,
        date: '2026-02-01',
      }),
    ]);

    renderWith(provider);

    const link = await screen.findByRole('link', { name: /example\.com/ });
    for (const span of Array.from(link.querySelectorAll('span'))) {
      if (span.textContent?.includes('example.com')) {
        expect(span.className).toContain('break-words');
      }
    }
  });

  it('keeps exactly one h1 and never skips a heading level', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'One', date: '2026-02-01' })]);

    renderWith(provider);

    await screen.findByRole('link', { name: /One/ });

    const levels = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My journey');
  });
});
