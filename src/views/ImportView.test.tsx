/**
 * The import screen, driven the way a person drives it.
 *
 * The assertion that matters most is negative: after a file is chosen and
 * parsed, the journal must still be empty. Everything else on this screen is
 * convenience; that one is the promise.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { examinedAtLeast } from '../testing/floor';
import ImportView from './ImportView';

let counter = 0;

function setup() {
  window.location.hash = '#/import';
  const storage = new DexieStorageProvider(`import-view-${(counter += 1)}`);
  const view = render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>
        <ImportView />
      </StorageContextProvider>
    </RouterProvider>,
  );
  return { storage, ...view };
}

/**
 * A File the component can read.
 *
 * jsdom's File has no arrayBuffer(), so it is supplied here rather than the
 * component being bent around the gap.
 */
function fakeFile(name: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.buffer.slice(0, bytes.byteLength),
  });
  Object.defineProperty(file, 'size', { value: bytes.byteLength });
  return file;
}

const choose = async (name: string, content: string) => {
  const input = screen.getByLabelText('File to import');
  fireEvent.change(input, { target: { files: [fakeFile(name, content)] } });
  return input;
};


/**
 * Query the visible page, excluding the polite live region.
 *
 * The announcement deliberately repeats the summary wording, so a bare
 * `getByText` finds two nodes and throws. Scoping keeps both behaviours — the
 * announcement is asserted separately, by its own test.
 */
const visible = () => {
  const live = document.querySelector('[aria-live]');
  live?.setAttribute('data-testid', 'live-region');
  return {
    text: (pattern: RegExp) =>
      screen
        .getAllByText(pattern)
        .filter((el) => !el.closest('[aria-live]')),
  };
};

const TWO = '# First sermon\n\nOn Romans 8:28.\n\n# Second sermon\n\nOn Psalm 23.';

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ImportView — before anything is committed', () => {
  it('says plainly that the file stays on the device', async () => {
    setup();
    await screen.findByLabelText('File to import');
    expect(
      screen.getByText(/processed on this device/i).textContent,
    ).toMatch(/Nothing is uploaded, and your original file is not changed/i);
  });

  it('shows what it found without writing anything', async () => {
    const { storage } = setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);

    await screen.findByText('sermons.md');
    expect(visible().text(/2 notes found/).length).toBeGreaterThan(0);
    expect(visible().text(/Nothing has been saved yet/).length).toBeGreaterThan(0);

    // The promise.
    expect(await storage.listEntries()).toHaveLength(0);
  });

  it('reports references, dates and items needing review', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);

    await screen.findByText('sermons.md');
    expect(screen.getByText(/2 with a Bible reference/)).toBeInTheDocument();
    expect(screen.getByText(/0 with a date/)).toBeInTheDocument();
    expect(screen.getByText(/items need review/)).toBeInTheDocument();
  });

  it('lets a candidate be deselected, and counts what is left', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    expect(screen.getByRole('button', { name: 'Import 2 notes' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Include First sermon'));
    expect(screen.getByRole('button', { name: 'Import 1 note' })).toBeInTheDocument();
  });

  it('refuses to commit when nothing is selected', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getByRole('button', { name: 'Nothing selected' })).toBeDisabled();
  });

  it('lets a candidate be edited before it is written', async () => {
    const { storage } = setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    // Date before title: every field on the row is named after the note, so
    // renaming it first would move the label this next query is looking for.
    fireEvent.change(screen.getByLabelText('Date for First sermon'), {
      target: { value: '2024-09-14' },
    });
    fireEvent.change(screen.getByLabelText('Title for First sermon'), {
      target: { value: 'Renamed by hand' },
    });

    // Still nothing written.
    expect(await storage.listEntries()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 notes' }));
    await screen.findAllByText('2 notes imported.');

    const entries = await storage.listEntries();
    const renamed = entries.find((entry) => entry.title === 'Renamed by hand');
    expect(renamed).toBeDefined();
    expect(renamed?.date).toBe('2024-09-14');
  });

  it('cancelling writes nothing and returns to the file chooser', async () => {
    const { storage } = setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await storage.listEntries()).toHaveLength(0);
    expect(await screen.findByLabelText('File to import')).toBeInTheDocument();
    expect(screen.queryAllByText(/Nothing has been saved yet/).filter((el) => !el.closest('[aria-live]'))).toHaveLength(0);
  });
});

describe('ImportView — committing', () => {
  it('writes the notes and reports the exact number', async () => {
    const { storage } = setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 notes' }));

    await screen.findAllByText('2 notes imported.');
    const entries = await storage.listEntries();
    expect(entries).toHaveLength(2);
    examinedAtLeast(entries.length, 2, 'entries written by the import');
  });

  it('uses the singular for one note', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('one.txt', 'A single note with nothing to split on.');
    await screen.findByText('one.txt');

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 note' }));
    await screen.findAllByText('1 note imported.');
  });
});

describe('ImportView — refusals are explained', () => {
  it('names the formats it handles when given another', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('notes.rtf', 'whatever');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/\.txt, \.md, \.docx and text-based \.pdf/);
  });

  it('explains an unreadable file without leaking anything internal', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('broken.docx', 'this is not a zip archive at all');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/damaged|not a readable/i);
    // No stack, no offsets, no paths.
    expect(alert.textContent).not.toMatch(/at .*\(|\.ts:|RangeError|byte \d/);
  });

  it('says an empty file is empty', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('empty.txt', '');

    expect((await screen.findByRole('alert')).textContent).toMatch(/empty/i);
  });
});

describe('ImportView — duplicates', () => {
  it('warns when the same file arrives again, and changes nothing', async () => {
    const { storage } = setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 notes' }));
    await screen.findAllByText('2 notes imported.');

    fireEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    expect(screen.getByText(/imported before/i)).toBeInTheDocument();
    // In words, on the row, not by colour alone.
    expect(screen.getAllByText(/Already in your journal/i).length).toBeGreaterThan(0);
    // And nothing has been merged or removed on its own.
    expect(await storage.listEntries()).toHaveLength(2);
  });
});

describe('ImportView — accessibility of the flow', () => {
  it('labels the file picker with a real label element', async () => {
    const { container } = setup();
    const input = await screen.findByLabelText('File to import');
    expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
  });

  it('announces what was found', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);

    await waitFor(() => {
      const live = [...document.querySelectorAll('[aria-live]')].map((el) => el.textContent ?? '');
      expect(live.some((text) => /2 notes found/.test(text))).toBe(true);
    });
  });

  it('gives every control a real name and a 44px target', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');
    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);

    const buttons = screen.getAllByRole('button');
    examinedAtLeast(buttons.length, 8, 'buttons on the review screen');
    for (const button of buttons) {
      expect(
        button.getAttribute('aria-label') ?? button.textContent ?? '',
        'a button with no accessible name',
      ).not.toBe('');
      expect(button.className, `${button.textContent} is under 44px`).toMatch(/min-h-11/);
    }
  });

  it('marks the review state in words, never by colour alone', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    // "No date found" is the words; there is no colour-only signal to rely on.
    expect(screen.getAllByText('No date found').length).toBeGreaterThan(0);
  });

  it('expands one candidate at a time rather than rendering every editor', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    // Collapsed to begin with: no body editors on the page at all.
    expect(screen.queryByLabelText(/^Notes for /)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    expect(screen.getAllByLabelText(/^Notes for /)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getAllByLabelText(/^Notes for /)).toHaveLength(1);
  });

  it('marks the open row with aria-expanded', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('sermons.md', TWO);
    await screen.findByText('sermons.md');

    const review = screen.getAllByRole('button', { name: 'Review' })[0];
    expect(review).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(review);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('ImportView — imported markup stays inert', () => {
  it('shows script-like text as text', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('hostile.md', '# Note\n\n<script>window.__pwned = true</script>\n');
    await screen.findByText('hostile.md');

    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    const body = screen.getByLabelText(/^Notes for /) as HTMLTextAreaElement;
    expect(body.value).toContain('<script>');

    // Nothing ran, and no element was created from it.
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    expect(document.querySelector('script[data-imported]')).toBeNull();
  });

  it('renders a preview without turning markup into elements', async () => {
    setup();
    await screen.findByLabelText('File to import');
    await choose('hostile.md', '# Note\n\n<img src=x onerror="window.__pwned = true">\n');
    await screen.findByText('hostile.md');

    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    const preview = screen.getByRole('button', { name: 'Write' }).closest('div')?.parentElement;
    expect(within(preview as HTMLElement).getByText(/onerror/)).toBeInTheDocument();
    expect(preview?.querySelector('img')).toBeNull();
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });
});
