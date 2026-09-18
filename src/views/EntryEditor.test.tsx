/**
 * These tests drive the real form: a real Dexie database on fake-indexeddb, the
 * real hash router, no mocked storage. What is asserted is what a person in a
 * pew would experience — the cursor lands in the notes box, notes alone saves,
 * and the two fields that must never merge do not merge.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { hasOutlineTitles, segmentTitle, segmentsForBook } from '../app/data';
import { CANON } from '../lib/canon';
import { examinedAtLeast } from '../testing/floor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { refToString } from '../lib/bible';
import { segmentRef } from '../lib/passages';
import { DexieStorageProvider, todayIso } from '../storage/db';
import type { Entry } from '../types';
import EntryEditor from './EntryEditor';

let counter = 0;

function setup(ui: ReactElement, hash = '#/entry/new') {
  window.location.hash = hash;
  // A fresh database per test: entries written by one test must not be visible
  // to the next.
  const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
  const view = render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>{ui}</StorageContextProvider>
    </RouterProvider>,
  );
  return { storage, ...view };
}

/** Wait for the form itself, not just the shell around it. */
const notesBox = () => screen.findByLabelText('Notes');

const save = () => screen.getByRole('button', { name: 'Save' });

/**
 * Wait for the save to land, then hand back the entry.
 *
 * Waiting on the hash alone is not enough: the create route is already
 * "#/entry/new", so a pattern match on it passes before anything is written.
 */
const savedEntry = async (storage: DexieStorageProvider): Promise<Entry> => {
  let entries: Entry[] = [];
  await waitFor(async () => {
    entries = await storage.listEntries();
    expect(entries).toHaveLength(1);
  });
  return entries[0];
};

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  // This project's vitest runs without `globals`, so Testing Library never gets
  // to register its own afterEach and nothing is unmounted automatically.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('EntryEditor — fast capture', () => {
  it('opens on a sermon dated today with the cursor already in the notes box', async () => {
    const { container } = setup(<EntryEditor />);

    const notes = await notesBox();
    expect(screen.getByLabelText('Kind')).toHaveValue('sermon');
    expect(screen.getByLabelText('Date')).toHaveValue(todayIso());
    await waitFor(() => expect(notes).toHaveFocus());

    // Everything optional stays out of the way until it is asked for.
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it('saves an entry that has nothing in it but notes', async () => {
    const { storage } = setup(<EntryEditor />);

    fireEvent.change(await notesBox(), { target: { value: 'Grace is not earned.' } });
    fireEvent.click(save());

    const entry = await savedEntry(storage);
    expect(entry.notes).toBe('Grace is not earned.');
    expect(entry.title).toBe('');
    expect(entry.reflection).toBe('');
    expect(entry.kind).toBe('sermon');
    expect(entry.date).toBe(todayIso());
    // Navigation lands a frame after the write, so the announcement has a
    // moment in the DOM before this view goes away.
    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${entry.id}`));
  });

  it('announces the save', async () => {
    setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Something worth keeping.' } });
    fireEvent.click(save());

    // The same words are now also shown on screen beside the Save button, so
    // this names the announcement specifically rather than matching whichever
    // node came first.
    const nodes = await screen.findAllByText('Entry saved.');
    const live = nodes.find((node) => node.getAttribute('aria-live') === 'polite');
    expect(live, 'the save was not announced to a screen reader').toBeTruthy();
  });

  it('keeps what was taught and what it meant to me in separate fields', async () => {
    const { storage } = setup(<EntryEditor />);

    fireEvent.change(await notesBox(), { target: { value: 'Romans 8, no condemnation.' } });
    fireEvent.change(screen.getByLabelText('Reflection'), {
      target: { value: 'I have been carrying condemnation for years.' },
    });
    fireEvent.click(save());

    const entry = await savedEntry(storage);
    expect(entry.notes).toBe('Romans 8, no condemnation.');
    expect(entry.reflection).toBe('I have been carrying condemnation for years.');
    // Never concatenated, in either direction.
    expect(entry.notes).not.toContain('carrying condemnation');
    expect(entry.reflection).not.toContain('Romans 8');
  });

  it('refuses an entirely empty entry and says why', async () => {
    setup(<EntryEditor />);
    await notesBox();

    const button = save();
    expect(button).toBeDisabled();

    const reason = screen.getByText(/Nothing to save yet/);
    expect(button).toHaveAttribute('aria-describedby', reason.id);

    // A title alone is enough; validation is minimal by design.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sunday morning' } });
    expect(save()).toBeEnabled();
  });

  it('has exactly one h1 and no skipped heading levels', async () => {
    setup(<EntryEditor />);
    await notesBox();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New entry');
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('EntryEditor — anchors', () => {
  // Taken from whatever this build actually ships. Under `full` that is an
  // outline segment; under `refs-only` it is a whole chapter. Either way the
  // rule under test is the same one: the anchor stored is always a resolved
  // scripture range, and an outline id is only ever added on top of it.
  const segment = segmentsForBook('genesis')[1];
  const reference = refToString(segmentRef(segment, 'genesis'), 'Genesis');
  const removeChip = () =>
    screen.getByRole('button', {
      name: (name: string) => name.startsWith(`Remove ${reference}`),
    });

  it('resolves a segment id from the URL and stores a scripture ref, never an outline id alone', async () => {
    const { storage } = setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    expect(removeChip()).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Before the fall.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);

    expect(entry.anchors).toHaveLength(1);
    expect(entry.anchors[0]).toMatchObject({
      kind: 'scripture',
      ...segmentRef(segment, 'genesis'),
    });
    if (segment.kind === 'outline') {
      expect(entry.anchors[0]).toMatchObject({ outlineEntryId: segment.id });
    } else {
      expect(entry.anchors[0]).not.toHaveProperty('outlineEntryId');
    }
  });

  it('ignores an anchor this build cannot resolve', async () => {
    setup(<EntryEditor anchorParam="not-a-real-segment-9-9" />);
    await notesBox();
    expect(screen.getByText('Not attached to anything yet.')).toBeInTheDocument();
  });

  it('lets an anchor be removed', async () => {
    setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    fireEvent.click(removeChip());
    expect(screen.getByText('Not attached to anything yet.')).toBeInTheDocument();
  });

  it('adds a topic anchor from the picker', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Add a topic'), { target: { value: 'marriage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    expect(screen.getByText('Topic: Marriage')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'On covenant love.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.anchors).toContainEqual({ kind: 'topic', topicId: 'marriage' });
  });

  /**
   * An entry written under `full` and reopened under `refs-only` carries
   * anchors whose outline ids resolve to nothing — as do anchors for a topic or
   * a book this build has never heard of. None of them may take the editor
   * down, and every one still has to name itself.
   */
  it('renders anchors that nothing in this build resolves, without crashing', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({
      notes: 'Written somewhere else.',
      anchors: [
        { kind: 'topic', topicId: 'no-such-topic' },
        { kind: 'book', book: 'no-such-book' },
        {
          kind: 'scripture',
          book: 'genesis',
          chapterStart: 1,
          verseStart: 1,
          chapterEnd: 1,
          verseEnd: 5,
          // An outline id from a build that had the outline layer.
          outlineEntryId: 'not-an-id-here',
        },
      ],
    });

    window.location.hash = `#/entry/${existing.id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Notes')).toHaveValue('Written somewhere else.'),
    );
    // The unresolved names fall back to their ids rather than rendering blank.
    expect(screen.getByText('Topic: no-such-topic')).toBeInTheDocument();
    expect(screen.getByText('no-such-book')).toBeInTheDocument();
    // The scripture anchor names itself from its own range, never from the
    // outline layer, so it reads the same under both data profiles.
    expect(screen.getByText('Genesis 1:1-5')).toBeInTheDocument();
  });

  it('names a scripture anchor from its range, with no outline title assumed', async () => {
    setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    const chip = removeChip().getAttribute('aria-label') ?? '';
    expect(chip.startsWith(`Remove ${reference}`)).toBe(true);
    // Under refs-only there is no title to append, and the label is the bare
    // reference. Under full a title may follow it, but never replace it.
    if (!hasOutlineTitles) expect(chip).toBe(`Remove ${reference}`);
  });

  it('keeps focus on the page when an anchor is removed', async () => {
    setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    const chip = removeChip();
    chip.focus();
    fireEvent.click(chip);

    // The clicked button is gone. Focus must not fall to <body>, which would
    // drop a keyboard user back at the top of the document. It lands on the
    // control that directly follows the chip list, not one further down.
    expect(document.body).not.toHaveFocus();
    expect(screen.getByLabelText('Add a passage')).toHaveFocus();
    expect(await screen.findByText(/removed\.$/)).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps focus on the page after a topic is added', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Add a topic'), { target: { value: 'marriage' } });
    const add = screen.getByRole('button', { name: 'Add topic' });
    add.focus();
    fireEvent.click(add);

    // Adding clears the choice, which disables this very button — and a
    // disabled element cannot hold focus.
    expect(add).toBeDisabled();
    expect(screen.getByLabelText('Add a topic')).toHaveFocus();
  });
});

/**
 * The passage picker: how somebody files a note against what they actually
 * heard. The pastor preached on the sermon on the mount; nobody remembers that
 * Jesus at the well is John 4.
 *
 * Nothing here hardcodes a title. The two published schemes word John 4
 * differently and `refs-only` gives it no title at all, so the words to search
 * are taken from the build under test — see passage-search.test.ts for why.
 */
describe('EntryEditor — the passage picker', () => {
  const johnFour = segmentsForBook('john').find((segment) => segment.chapterStart === 4);

  const search = () => screen.getByLabelText('Add a passage');

  it('is offered on a blank entry, and says how it can be searched', async () => {
    setup(<EntryEditor />);
    await notesBox();
    expect(search()).toBeInTheDocument();
    // The hint must be a real description, not a placeholder.
    const hintId = search().getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toMatch(/reference/i);
  });

  it('finds a passage by a typed reference and attaches it as a scripture range', async () => {
    expect(johnFour).toBeDefined();
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(search(), { target: { value: 'John 4:7' } });
    const result = await screen.findByRole('button', { name: /^Add John 4/ });
    fireEvent.click(result);

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'At the well.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);

    expect(entry.anchors).toHaveLength(1);
    const anchor = entry.anchors[0];
    expect(anchor).toMatchObject({ kind: 'scripture', book: 'john' });
    // Rule 2: the portable range is always there. The outline id is an extra,
    // present only where this build has a titled division to point at.
    expect(anchor).toMatchObject(segmentRef(johnFour!, 'john'));
    if (johnFour!.kind === 'outline') {
      expect(anchor).toMatchObject({ outlineEntryId: johnFour!.id });
    } else {
      expect(anchor).not.toHaveProperty('outlineEntryId');
    }
  });

  it.runIf(hasOutlineTitles)('finds a passage by the name the Bible view shows', async () => {
    expect(johnFour?.kind).toBe('outline');
    const title = segmentTitle(johnFour!);
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(search(), { target: { value: title } });
    // Named by its reference first, because that is what is stored — the title
    // is what was remembered, and both are shown.
    const result = await screen.findByRole('button', {
      name: `Add ${refToString(segmentRef(johnFour!, 'john'), 'John')} — ${title}`,
    });
    fireEvent.click(result);

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'At the well.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.anchors[0]).toMatchObject({
      kind: 'scripture',
      book: 'john',
      outlineEntryId: johnFour!.id,
    });
  });

  it('says what it searched when a name finds nothing', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(search(), { target: { value: 'zzzzznotathing' } });
    const status = await screen.findByText(/Nothing matched/);
    expect(status).toHaveAttribute('aria-live', 'polite');
    // Under refs-only "no such passage" would be a lie about the data rather
    // than about the query: there are no titles to have matched.
    if (hasOutlineTitles) expect(status.textContent).not.toMatch(/no passage titles/);
    else expect(status.textContent).toMatch(/no passage titles/);
  });

  /**
   * The search field sits inside the entry form, so in a browser Enter submits
   * it — saving a half-written note the moment somebody looked for where to
   * file it.
   *
   * What is asserted here is that the keystroke was *cancelled*, not that
   * nothing was saved. jsdom does not implement a form's implicit submission at
   * all, so "the database is still empty" passes whether the guard exists or
   * not: deleting preventDefault left that assertion green, which is how this
   * test was caught being a decoration. The browser half of the claim — that an
   * uncancelled Enter really would save — is in tests/e2e/keyboard.spec.ts,
   * where a real form can do it.
   */
  it('cancels an Enter keystroke rather than letting the form submit it', async () => {
    setup(<EntryEditor />);
    await notesBox();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Half a thought.' } });

    // A whole chapter, which every profile divides into at least one passage.
    fireEvent.change(search(), { target: { value: 'John 4' } });
    const results = await screen.findAllByRole('button', { name: /^Add John 4/ });

    // fireEvent returns false when the handler called preventDefault.
    const uncancelled = fireEvent.keyDown(search(), { key: 'Enter' });
    expect(uncancelled, 'Enter was left to the form, which would submit it').toBe(false);
    // And the keyboard is put on the first result instead.
    expect(results[0]).toHaveFocus();
  });

  it('keeps focus on the page after a passage is added, and clears the search', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(search(), { target: { value: 'John 4:7' } });
    const result = await screen.findByRole('button', { name: /^Add John 4/ });
    result.focus();
    fireEvent.click(result);

    // Clearing the query unmounts the clicked button.
    expect(search()).toHaveValue('');
    expect(document.body).not.toHaveFocus();
    expect(search()).toHaveFocus();
    expect(await screen.findByText(/added\.$/)).toHaveAttribute('aria-live', 'polite');
  });

  it('says so rather than claiming a second add, when the passage is already attached', async () => {
    setup(<EntryEditor />);
    await notesBox();

    for (let round = 0; round < 2; round += 1) {
      fireEvent.change(search(), { target: { value: 'John 4:7' } });
      fireEvent.click(await screen.findByRole('button', { name: /^Add John 4/ }));
    }

    expect(await screen.findByText(/is already attached\.$/)).toBeInTheDocument();
    // And the chip list did not grow a duplicate.
    expect(screen.getAllByRole('button', { name: /^Remove John 4/ })).toHaveLength(1);
  });
});

/**
 * The other way to attach a passage: book first, then the passage within it.
 *
 * Searching only helps somebody who remembers a name. This is for "it was
 * somewhere in Acts" — and it has to land the identical anchor the search box
 * lands, or two routes to the same passage would write two different things.
 */
/**
 * Where the passage controls SIT, not merely that they exist.
 *
 * This is a containment test on purpose. Every other test in this file passed
 * with the picker buried at the bottom of a collapsed <details>, because
 * Testing Library queries find elements inside a shut disclosure perfectly
 * well — jsdom renders them, the browser just does not show them. So "the test
 * finds it" and "a person can see it" are different claims, and only the second
 * one was the complaint.
 */
describe('EntryEditor — the passage controls are not hidden', () => {
  it('puts passage selection on the form itself, not behind the Details disclosure', async () => {
    const { container } = setup(<EntryEditor />);
    await notesBox();

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    // A new entry opens with the disclosure shut, so anything inside it is
    // invisible until clicked.
    expect((details as HTMLDetailsElement).open).toBe(false);

    for (const label of ['Add a passage', 'Book', 'Passage']) {
      expect(
        details!.contains(screen.getByLabelText(label)),
        `"${label}" is inside the collapsed Details panel, where nobody finds it`,
      ).toBe(false);
    }
  });

  it('leaves the genuinely optional half folded away', async () => {
    const { container } = setup(<EntryEditor />);
    await notesBox();
    const details = container.querySelector('details')!;

    // Topics, tags, links and the rest are still optional extras.
    expect(details.contains(screen.getByLabelText('Add a topic'))).toBe(true);
    expect(details.contains(screen.getByLabelText('Tags'))).toBe(true);
  });
});

describe('EntryEditor — the book-first picker', () => {
  const segments = segmentsForBook('john');
  const target = segments.find((segment) => segment.chapterStart === 4)!;

  const bookPicker = () => screen.getByLabelText('Book');
  const passagePicker = () => screen.getByLabelText('Passage');

  it('will not offer passages until a book is chosen', async () => {
    setup(<EntryEditor />);
    await notesBox();

    expect(passagePicker()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add passage' })).toBeDisabled();
    expect(passagePicker()).toHaveTextContent('Choose a book first');
  });

  it('lists a chosen book\u2019s passages in the order the Bible view lists them', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(bookPicker(), { target: { value: 'john' } });
    expect(passagePicker()).toBeEnabled();

    const options = within(passagePicker())
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options).toEqual(segments.map((segment) => segment.id));
  });

  /**
   * Rule 3: a passage reachable by browsing must be reachable here too.
   *
   * John cannot carry this claim — it has no gaps under any profile, so a
   * picker that silently dropped every uncovered span would still list all of
   * John and pass. Filtering the list to outline-backed divisions was tried as
   * a deliberate sabotage and John noticed nothing. So the book under test is
   * whichever one this build actually leaves a hole in.
   *
   * Which build that is matters, and all three differ: `full` leaves 42 real
   * gaps, `refs-only` is nothing BUT uncovered chapters, and the BSB scheme
   * under `public` is a complete partition with no gap anywhere. The last of
   * those cannot be tested, only stated — so it is stated, rather than passed
   * off as a test that ran.
   */
  it('offers uncovered passages too, not only the titled ones', async () => {
    const gapped = CANON.map((bookId) => ({ bookId, list: segmentsForBook(bookId) })).find(
      ({ list }) => list.some((segment) => segment.kind === 'uncovered'),
    );

    if (!gapped) {
      // Not a skip dressed up as a pass: assert the reason no gap was found,
      // so this fails loudly if a build ever loses coverage silently.
      const everySegment = CANON.flatMap((bookId) => segmentsForBook(bookId));
      examinedAtLeast(everySegment.length, 100, 'divisions across the canon');
      expect(everySegment.every((segment) => segment.kind === 'outline')).toBe(true);
      return;
    }

    setup(<EntryEditor />);
    await notesBox();
    fireEvent.change(bookPicker(), { target: { value: gapped.bookId } });

    const options = within(passagePicker())
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);

    const uncovered = gapped.list.filter((segment) => segment.kind === 'uncovered');
    examinedAtLeast(uncovered.length, 1, `uncovered spans in ${gapped.bookId}`);
    for (const segment of uncovered) expect(options).toContain(segment.id);
  });

  it('attaches the same anchor the search box would attach', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(bookPicker(), { target: { value: 'john' } });
    fireEvent.change(passagePicker(), { target: { value: target.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add passage' }));

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'At the well.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);

    expect(entry.anchors).toHaveLength(1);
    expect(entry.anchors[0]).toMatchObject({
      kind: 'scripture',
      ...segmentRef(target, 'john'),
    });
    if (target.kind === 'outline') {
      expect(entry.anchors[0]).toMatchObject({ outlineEntryId: target.id });
    } else {
      expect(entry.anchors[0]).not.toHaveProperty('outlineEntryId');
    }
  });

  it('clears the section but keeps the book, so a second passage is one click away', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(bookPicker(), { target: { value: 'john' } });
    fireEvent.change(passagePicker(), { target: { value: target.id } });
    const add = screen.getByRole('button', { name: 'Add passage' });
    add.focus();
    fireEvent.click(add);

    expect(bookPicker()).toHaveValue('john');
    expect(passagePicker()).toHaveValue('');
    // Adding disables the button under the user's own finger.
    expect(add).toBeDisabled();
    expect(document.body).not.toHaveFocus();
    expect(passagePicker()).toHaveFocus();
  });

  it('drops a stale section when the book changes', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(bookPicker(), { target: { value: 'john' } });
    fireEvent.change(passagePicker(), { target: { value: target.id } });
    expect(screen.getByRole('button', { name: 'Add passage' })).toBeEnabled();

    // A section id from John means nothing in Acts, and must not survive.
    fireEvent.change(bookPicker(), { target: { value: 'acts' } });
    expect(passagePicker()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add passage' })).toBeDisabled();
  });
});

describe('EntryEditor — details', () => {
  it('captures a link with what it pointed to, and makes no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Web address for link 1'), {
      target: { value: 'https://example.org/sermon-42' },
    });
    fireEvent.change(screen.getByLabelText('What this link is (link 1)'), {
      target: { value: 'Audio of the 8am service' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Linked.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.links).toHaveLength(1);
    expect(entry.links[0].url).toBe('https://example.org/sermon-42');
    expect(entry.links[0].capturedTitle).toBe('Audio of the 8am service');
    expect(entry.links[0].capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  /**
   * A row with nothing but its display text is dropped on save. Save must not
   * light up for it either, or pressing it writes an entry with nothing in it
   * at all — a blank page in the book handed to a grandchild.
   */
  it('does not treat a link with only display text as something to save', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Link text for link 1'), {
      target: { value: 'The audio' },
    });

    expect(save()).toBeDisabled();
    expect(screen.getByText(/Nothing to save yet/)).toBeInTheDocument();
  });

  it('keeps a link row once it has an address, and saves what is there', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Link text for link 1'), {
      target: { value: 'The audio' },
    });
    fireEvent.change(screen.getByLabelText('Web address for link 1'), {
      target: { value: 'https://example.org/audio' },
    });

    expect(save()).toBeEnabled();
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.links).toEqual([{ url: 'https://example.org/audio', label: 'The audio' }]);
  });

  it('moves focus into a new link row, and back out of a removed one', async () => {
    setup(<EntryEditor />);
    await notesBox();

    const addLink = screen.getByRole('button', { name: 'Add a link' });
    fireEvent.click(addLink);
    // The new row renders above the button that made it, so focus has to follow
    // it there rather than sitting behind it.
    await waitFor(() => expect(screen.getByLabelText('Web address for link 1')).toHaveFocus());

    const remove = screen.getByRole('button', { name: 'Remove link 1' });
    remove.focus();
    fireEvent.click(remove);

    expect(screen.queryByLabelText('Web address for link 1')).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(addLink).toHaveFocus();
  });

  it('parses comma-separated tags and drops repeats', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Tags'), {
      target: { value: ' grace , patience, grace ,, ' },
    });
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.tags).toEqual(['grace', 'patience']);
  });

  it('records the descendants choice', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'For the children.' } });
    fireEvent.click(screen.getByLabelText('Include in the book for my descendants'));
    fireEvent.click(save());
    expect((await savedEntry(storage)).forDescendants).toBe(true);
  });
});

describe('EntryEditor — editing', () => {
  const seed = async (storage: DexieStorageProvider, patch: Partial<Entry> = {}) =>
    storage.createEntry({
      kind: 'sermon',
      title: 'Sunday morning',
      date: '2025-03-02',
      speaker: 'Pastor Ruiz',
      place: 'First Baptist',
      notes: 'Original notes.',
      reflection: 'Original reflection.',
      tags: ['grace'],
      ...patch,
    });

  it('loads the entry and opens the details panel when there is something in it', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await seed(storage);

    window.location.hash = `#/entry/${existing.id}`;
    const { container } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('Original notes.'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit entry');
    expect(screen.getByLabelText('Speaker')).toHaveValue('Pastor Ruiz');
    expect(screen.getByLabelText('Tags')).toHaveValue('grace');
    expect(container.querySelector('details')?.open).toBe(true);

    // Editing does not steal the cursor; the shell owns focus on navigation.
    expect(screen.getByLabelText('Notes')).not.toHaveFocus();
  });

  it('leaves the details panel shut for an entry with nothing but notes', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({ notes: 'Just words.', date: '2025-04-01' });

    window.location.hash = `#/entry/${existing.id}`;
    const { container } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('Just words.'));
    expect(container.querySelector('details')?.open).toBe(false);
  });

  it('saves changes back to the same entry', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await seed(storage);

    window.location.hash = `#/entry/${existing.id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('Original notes.'));
    fireEvent.change(screen.getByLabelText('Reflection'), { target: { value: 'Changed my mind.' } });
    fireEvent.click(save());

    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${existing.id}`));
    const entries = await storage.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].reflection).toBe('Changed my mind.');
    expect(entries[0].notes).toBe('Original notes.');
    // Two nodes carry these words now — the announcement and the visible
    // confirmation beside the button. Both are wanted; the assertion is that
    // the edit was confirmed at all.
    expect((await screen.findAllByText('Changes saved.')).length).toBeGreaterThan(0);
  });

  it('shows a plain page when the entry is gone', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    window.location.hash = '#/entry/missing';
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId="missing" />
        </StorageContextProvider>
      </RouterProvider>,
    );

    expect(await screen.findByText('That entry is not here.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('EntryEditor — the route switch reuses this instance', () => {
  // App.tsx renders <EntryEditor> for BOTH the "new entry" route and the entry
  // route, so React reuses the component when one becomes the other. Nothing
  // set during a save may survive into the view that follows it.
  const swapTo = (
    rerender: (ui: ReactElement) => void,
    storage: DexieStorageProvider,
    props: { entryId?: string; anchorParam?: string },
  ) =>
    rerender(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor {...props} />
        </StorageContextProvider>
      </RouterProvider>,
    );

  it('leaves a working editor behind after a new note becomes a saved one', async () => {
    const { storage, rerender } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'First words.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);

    swapTo(rerender, storage, { entryId: entry.id });

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit entry'),
    );
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('First words.'));
    // Stuck on "Saving…" here would mean the entry could never be edited again.
    expect(save()).toBeEnabled();
  });

  /**
   * The route change lands a frame after the write, so there is a real window
   * in which Save is live again and `entryId` is still undefined. A second tap
   * in that window used to write a second copy of the same note.
   */
  it('does not write a second copy when Save is pressed twice', async () => {
    const { storage } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Only once.' } });

    fireEvent.click(save());
    const first = await savedEntry(storage);
    await waitFor(() => expect(save()).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Only once, edited.' } });
    fireEvent.click(save());

    await waitFor(async () => {
      const entries = await storage.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(first.id);
      expect(entries[0].notes).toBe('Only once, edited.');
    });
  });

  /**
   * Every piece of transient state has to be stood down when the target
   * changes. A delete confirmation left standing from the previous entry is one
   * tap away from destroying a note the reader never meant to touch.
   */
  it('does not carry a primed delete confirmation onto the next entry', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const first = await storage.createEntry({ notes: 'The first one.' });
    const second = await storage.createEntry({ notes: 'The second one.' });

    window.location.hash = `#/entry/${first.id}`;
    const { rerender } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={first.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('The first one.'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    expect(screen.getByRole('button', { name: 'Yes, delete it' })).toBeInTheDocument();

    swapTo(rerender, storage, { entryId: second.id });

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('The second one.'));
    expect(screen.queryByRole('button', { name: 'Yes, delete it' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this entry' })).toBeInTheDocument();
  });

  it('does not carry a missing entry over into a new one', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    window.location.hash = '#/entry/gone';
    const { rerender } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId="gone" />
        </StorageContextProvider>
      </RouterProvider>,
    );
    expect(await screen.findByText('That entry is not here.')).toBeInTheDocument();

    swapTo(rerender, storage, {});
    expect(await notesBox()).toBeInTheDocument();
    expect(screen.queryByText('That entry is not here.')).not.toBeInTheDocument();
  });
});

describe('EntryEditor — delete', () => {
  const renderEdit = async (storage: DexieStorageProvider, id: string) => {
    window.location.hash = `#/entry/${id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={id} />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Notes')).toBeInTheDocument());
  };

  it('confirms in the page, never with window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({ notes: 'To be deleted.' });
    await renderEdit(storage, existing.id);

    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));

    const confirmButton = screen.getByRole('button', { name: 'Yes, delete it' });
    expect(confirmButton).toHaveFocus();
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(window.location.hash).toBe('#/timeline'));
    expect(await storage.listEntries()).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('backs out of the confirm without deleting, and hands focus back', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({ notes: 'Keep me.' });
    await renderEdit(storage, existing.id);

    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this entry' }));

    expect(screen.queryByRole('button', { name: 'Yes, delete it' })).not.toBeInTheDocument();
    expect(await storage.listEntries()).toHaveLength(1);
    // Backing out unmounts the button that was clicked; focus goes to the one
    // that replaces it rather than dropping to <body>.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete this entry' })).toHaveFocus(),
    );
  });

  it('offers no delete when there is nothing saved yet', async () => {
    setup(<EntryEditor />);
    await notesBox();
    expect(screen.queryByRole('button', { name: 'Delete this entry' })).not.toBeInTheDocument();
  });
});

describe('EntryEditor — unsaved changes', () => {
  const fireBeforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('does not warn on a form nobody has touched', async () => {
    setup(<EntryEditor />);
    await notesBox();
    expect(fireBeforeUnload()).toBe(false);
  });

  it('warns once there are words in it, and stops warning after a save', async () => {
    const { storage } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Half a thought.' } });
    expect(fireBeforeUnload()).toBe(true);

    fireEvent.click(save());
    await savedEntry(storage);
    await waitFor(() => expect(fireBeforeUnload()).toBe(false));
  });
});

describe('EntryEditor — accessibility of the controls', () => {
  it('gives every control a real label and a 44px target', async () => {
    const { container } = setup(<EntryEditor />);
    await notesBox();

    // No control relies on a placeholder for its name.
    for (const control of container.querySelectorAll('input, select, textarea')) {
      expect(control.getAttribute('placeholder')).toBeNull();
      expect(control.id).toBeTruthy();
      expect(container.querySelector(`label[for="${CSS.escape(control.id)}"]`)).not.toBeNull();
    }

    // Buttons come from the shared primitive, which carries min-h-11 (44px).
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11');
    }
  });

  it('uses a native details element so the optional fields work without JS', async () => {
    const { container } = setup(<EntryEditor />);
    await notesBox();

    const details = container.querySelector('details');
    const summary = details?.querySelector('summary');
    expect(summary).not.toBeNull();
    expect(within(summary as HTMLElement).getByText('Details')).toBeInTheDocument();
  });
});
