/**
 * Crash-safe drafts, from the product surface.
 *
 * The promise is narrow and absolute: what somebody typed is still there after
 * the process dies, without them having pressed Save. These drive that through
 * the real editor, a real Dexie store and the real autosaver — the only thing
 * stubbed is the clock, so no test waits on a debounce.
 *
 * "Reopening" here means mounting a second editor over the same store, which is
 * the nearest a unit test gets to a relaunch. The device proof is separate.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import HomeView from './HomeView';
import {
  DRAFT_DEBOUNCE_MS,
  draftFormsEqual,
  hasDraftContent,
  hasRecoverableChanges,
} from '../lib/drafts';
import type { DraftForm, Entry } from '../types';

let counter = 0;
let db: DexieStorageProvider;
let storeName: string;

const open = async (name: string) => {
  const provider = new DexieStorageProvider(name);
  await provider.open();
  return provider;
};

beforeEach(async () => {
  window.location.hash = '#/entry/new';
  storeName = `drafts-${(counter += 1)}`;
  db = await open(storeName);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(provider: DexieStorageProvider, props: Record<string, unknown> = {}) {
  return render(
    <RouterProvider>
      <StorageContextProvider provider={provider}>
        <EntryEditor {...props} />
      </StorageContextProvider>
    </RouterProvider>,
  );
}

const notes = () => screen.findByLabelText('Notes');

/** Let the debounce elapse without waiting on a real clock. */
const settle = async (provider: DexieStorageProvider, expected = 1) => {
  await waitFor(async () => expect((await provider.listDrafts()).length).toBe(expected), {
    timeout: 5_000,
  });
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('a new entry nobody has saved', () => {
  it('leaves nothing behind when the editor is opened and abandoned blank', async () => {
    mount(db);
    await notes();
    // Long enough that a write would have happened if one were coming.
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 3));

    expect(
      await db.listDrafts(),
      'an untouched editor must not litter the store with empty drafts',
    ).toHaveLength(0);
  });

  it('makes the first real sentence durable without anyone pressing Save', async () => {
    mount(db);
    await notes();

    type('Notes', 'He read the whole letter aloud.');
    await settle(db);

    const [draft] = await db.listDrafts();
    expect(draft.form.notes).toBe('He read the whole letter aloud.');
    expect(await db.listEntries(), 'a draft is not an entry').toHaveLength(0);
  });

  it('flushes the newest sentence immediately when in-app navigation unmounts the editor', async () => {
    mount(db);
    await notes();
    type('Notes', 'Written immediately before leaving.');

    // No wait for the ordinary settle window: route replacement unmounts now.
    cleanup();

    await waitFor(async () => {
      const [draft] = await db.listDrafts();
      expect(draft?.form.notes).toBe('Written immediately before leaving.');
    });
  });

  it.each([
    ['Title', 'Grace at the door'],
    ['Notes', 'What was said.'],
    ['Reflection', 'What it meant.'],
  ])('a %s on its own is enough to preserve', async (label, value) => {
    mount(db);
    await notes();

    type(label, value);
    await settle(db);

    expect((await db.listDrafts())).toHaveLength(1);
  });

  it('does not invent a title for untitled work', async () => {
    mount(db);
    await notes();

    type('Notes', 'Just the notes, no title.');
    await settle(db);

    const [draft] = await db.listDrafts();
    expect(draft.form.title, 'blank stays blank').toBe('');
  });

  /** The central promise, as near as a unit test can stage it. */
  it('gives the exact text back when the editor is opened again over the same store', async () => {
    const paragraphs = [
      'Philemon is a letter about a debt somebody else offered to pay.',
      '',
      'He said: "charge it to my account" — and then wrote it in his own hand.',
      '',
      'I owe someone a letter like that. Trailing space on purpose.   ',
    ].join('\n');

    mount(db);
    await notes();
    type('Notes', paragraphs);
    type('Reflection', 'Write the letter this week.');
    await settle(db);

    const [saved] = await db.listDrafts();
    cleanup();

    // A second editor over the same store, resuming that draft.
    const reopened = await open(storeName);
    mount(reopened, { draftParam: saved.id });
    await notes();

    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe(paragraphs),
    );
    expect((screen.getByLabelText('Reflection') as HTMLTextAreaElement).value).toBe(
      'Write the letter this week.',
    );
    expect(screen.getByText('Your recent changes were restored.')).toBeInTheDocument();
  });

  it('keeps two unfinished pieces of work apart', async () => {
    mount(db);
    await notes();
    type('Notes', 'the sermon');
    await settle(db);
    cleanup();

    // A second new entry, started fresh — no draft parameter.
    window.location.hash = '#/entry/new';
    const second = await open(storeName);
    mount(second);
    await notes();
    type('Notes', 'the prayer');
    await settle(second, 2);

    const all = await second.listDrafts();
    expect(all.map((d) => d.form.notes).sort()).toEqual(['the prayer', 'the sermon']);
  });
});

describe('an entry that has been saved', () => {
  it('recovers edits that were never saved, without touching the saved copy', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.hash = `#/entry/${entry.id}`;

    mount(db, { entryId: entry.id });
    await notes();
    type('Notes', 'The original notes.\n\nThree new paragraphs nobody saved.');
    await settle(db);

    // The journal itself is untouched: the draft is separate by construction.
    expect((await db.getEntry(entry.id))?.notes).toBe('The original notes.');
    cleanup();

    const reopened = await open(storeName);
    mount(reopened, { entryId: entry.id });
    await notes();

    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toContain(
        'Three new paragraphs nobody saved.',
      ),
    );
    expect(await reopened.listEntries(), 'one entry, not two').toHaveLength(1);
  });
});

describe('explicit Save', () => {
  it('writes the entry, retires the draft, and no stale write brings it back', async () => {
    mount(db);
    await notes();
    type('Notes', 'Worth keeping.');
    await settle(db);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [entry] = await db.listEntries();
    expect(entry.notes).toBe('Worth keeping.');

    // The draft is gone, and stays gone: the autosaver is fenced, so a write
    // queued before the save cannot recreate it afterwards.
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 3));
    expect(
      await db.listDrafts(),
      'a stale autosave resurrected the draft after Save retired it',
    ).toHaveLength(0);
  });

  it('saves the newest text even when the settle window has not elapsed', async () => {
    mount(db);
    await notes();
    type('Notes', 'First.');
    await settle(db);

    // Typed and saved immediately — inside the window, with no pause.
    type('Notes', 'First. And the sentence typed just before pressing Save.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [entry] = await db.listEntries();
    expect(entry.notes, 'Save must flush the pending snapshot first').toBe(
      'First. And the sentence typed just before pressing Save.',
    );
  });

  it('keeps text typed while a slow Save is in flight as a parented draft', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });

    const slow = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'createEntry') {
          return async (...args: Parameters<DexieStorageProvider['createEntry']>) => {
            signalStarted();
            await held;
            return target.createEntry(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as DexieStorageProvider;

    mount(slow);
    await notes();
    type('Notes', 'The version submitted.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await started;

    // This edit is visibly accepted while the canonical write is still held.
    type('Notes', 'The version typed while Save was waiting.');
    release();

    await waitFor(async () => {
      const entries = await db.listEntries();
      const drafts = await db.listDrafts();
      expect(entries).toHaveLength(1);
      expect(entries[0].notes).toBe('The version submitted.');
      expect(drafts).toHaveLength(1);
      expect(drafts[0].entryId).toBe(entries[0].id);
      expect(drafts[0].form.notes).toBe('The version typed while Save was waiting.');
    });
  });

  it('does not misreport a saved entry when preserving a later edit initially fails', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let failedParentedWrite = false;

    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'createEntry') {
          return async (...args: Parameters<DexieStorageProvider['createEntry']>) => {
            signalStarted();
            await held;
            return target.createEntry(...args);
          };
        }
        if (prop === 'putDraft') {
          return async (draft: Parameters<DexieStorageProvider['putDraft']>[0]) => {
            // Fail the first write that identifies the newly-created parent.
            // Counting calls made this test depend on a 400 ms debounce not
            // expiring while createEntry was held, which is not true on a busy
            // machine and is unrelated to the behavior under test.
            if (draft.entryId && !failedParentedWrite) {
              failedParentedWrite = true;
              throw new Error('temporary draft failure');
            }
            return target.putDraft(draft);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as DexieStorageProvider;

    mount(flaky);
    await notes();
    type('Notes', 'The version submitted.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await started;
    type('Notes', 'The later sentence still on screen.');
    release();

    expect(await screen.findByText(/version you submitted was saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/Your entry could not be saved/i)).toBeNull();
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe(
      'The later sentence still on screen.',
    );

    const [entry] = await db.listEntries();
    expect(entry.notes).toBe('The version submitted.');
    await waitFor(async () => {
      const [draft] = await db.listDrafts();
      expect(draft.entryId).toBe(entry.id);
      expect(draft.form.notes).toBe('The later sentence still on screen.');
    });
  });
});

describe('meaningful content', () => {
  const form = (overrides: Partial<DraftForm> = {}): DraftForm => ({
    kind: 'sermon',
    title: '',
    date: '2026-03-01',
    place: '',
    speaker: '',
    sermonSeries: '',
    notes: '',
    reflection: '',
    prayer: '',
    tagsText: '',
    links: [],
    anchors: [],
    forDescendants: false,
    scriptureRefs: [],
    sourceMaterial: null,
    ...overrides,
  });

  it('says no to a blank editor, and to one holding only whitespace', () => {
    expect(hasDraftContent(form())).toBe(false);
    expect(hasDraftContent(form({ notes: '   \n  ' }))).toBe(false);
  });

  it.each([
    ['title', { title: 'A title' }],
    ['notes', { notes: 'Some notes' }],
    ['reflection', { reflection: 'A reflection' }],
    ['prayer', { prayer: 'A prayer' }],
    ['a tag', { tagsText: 'grace' }],
    ['an anchor', { anchors: [{ kind: 'topic' as const, topicId: 'humility' }] }],
    ['a half-typed link row', { links: [{ url: '', label: 'the audio', capturedTitle: '' }] }],
  ])('says yes to %s', (_what, overrides) => {
    expect(hasDraftContent(form(overrides))).toBe(true);
  });

  it('does not count the date and kind every blank editor already has', () => {
    // Otherwise every editor anyone opened would be "meaningful" and the
    // predicate would answer yes to nothing having happened.
    expect(hasDraftContent(form({ kind: 'prayer', date: '2026-12-25' }))).toBe(false);
  });
});

/**
 * Reading is not writing.
 *
 * Opening a saved entry hydrates the editor with everything that entry holds,
 * and the snapshot gate used to ask "is there anything here" — which is yes for
 * every entry ever written. So merely LOOKING at a note minted a recovery
 * draft, and the home page then offered to "continue writing" something nobody
 * had touched. A draft is for what the journal does not have yet.
 *
 * These drive the real editor over a real store, and the only thing waited on
 * is the debounce, several times over, so a write that was coming would have
 * arrived.
 */
describe('an entry somebody only opened', () => {
  /** Long enough that a snapshot would have been written if one were coming. */
  const pastTheWindow = () => new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 4));

  const openSaved = async (entry: Entry, provider: DexieStorageProvider = db) => {
    window.location.hash = `#/entry/${entry.id}`;
    mount(provider, { entryId: entry.id });
    await notes();
  };

  it('writes no draft for an entry that is only read', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });

    await openSaved(entry);
    await pastTheWindow();

    expect(
      await db.listDrafts(),
      'opening an entry to read it is not unfinished work',
    ).toHaveLength(0);
  });

  it('writes no draft for one carrying a reflection and a prayer', async () => {
    const entry = await db.createEntry({
      title: 'Sunday',
      notes: 'What was taught.',
      reflection: 'What it meant to me.',
      prayer: 'Keep me in it this week.',
    });

    await openSaved(entry);
    await pastTheWindow();

    expect(await db.listDrafts()).toHaveLength(0);
  });

  it('writes no draft for one carrying details, tags, links and anchors', async () => {
    const entry = await db.createEntry({
      title: 'The narrow gate',
      notes: 'Notes.',
      place: 'St Mary the Virgin',
      speaker: 'Revd Hall',
      sermonSeries: 'Sermon on the Mount',
      tags: ['grace', 'obedience'],
      links: [{ url: 'https://example.org/handout', label: 'Handout' }],
      anchors: [
        {
          kind: 'scripture',
          book: 'Matthew',
          chapterStart: 7,
          verseStart: 13,
          chapterEnd: 7,
          verseEnd: 14,
        },
      ],
      scriptureRefs: ['Matthew 7:13-14'],
      forDescendants: true,
    });

    await openSaved(entry);
    await pastTheWindow();

    expect(
      await db.listDrafts(),
      'every field must hydrate back to exactly what was saved',
    ).toHaveLength(0);
  });

  it('still writes a draft the moment the notes actually change', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });

    await openSaved(entry);
    type('Notes', 'The original notes. And a sentence nobody saved.');
    await settle(db);

    const [draft] = await db.listDrafts();
    expect(draft.entryId, 'the draft must belong to the entry being edited').toBe(entry.id);
    expect(draft.form.notes).toBe('The original notes. And a sentence nobody saved.');
  });

  it('writes nothing when a change is undone inside the settle window', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });

    await openSaved(entry);
    // Typed and taken straight back out, faster than the window elapses.
    type('Notes', 'The original notes. Mistake.');
    type('Notes', 'The original notes.');
    await pastTheWindow();

    expect(
      await db.listDrafts(),
      'a change that was undone before it settled was never a change',
    ).toHaveLength(0);
  });

  it('retires a draft that has already been written once the text comes back', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });

    await openSaved(entry);
    type('Notes', 'The original notes. Second thoughts.');
    await settle(db);
    expect(await db.listDrafts(), 'the edit is protected while it stands').toHaveLength(1);

    // Taken back out again — now the editor holds what the journal holds.
    type('Notes', 'The original notes.');

    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0), { timeout: 5_000 });
    await pastTheWindow();
    expect(
      await db.listDrafts(),
      'a retired draft must not be recreated by a write still in flight',
    ).toHaveLength(0);
  });

  it('treats what a save just wrote as the new unchanged state', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });

    await openSaved(entry);
    type('Notes', 'The original notes. Finished on the way home.');
    await settle(db);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await db.getEntry(entry.id))?.notes).toBe(
        'The original notes. Finished on the way home.',
      ),
    );

    // Touched and untouched again. The journal already holds this, so there is
    // nothing left to recover — and that is only true if the save moved what
    // "unchanged" means.
    type('Notes', 'The original notes. Finished on the way home. x');
    type('Notes', 'The original notes. Finished on the way home.');
    await pastTheWindow();

    expect(
      await db.listDrafts(),
      'a save makes the screen and the journal agree; a draft would say otherwise',
    ).toHaveLength(0);
  });

  /**
   * The one ordering that cannot be reached by typing quickly.
   *
   * Retiring a draft is fence-then-delete, and a write already awaiting storage
   * is past the fence. If the delete does not wait for it, the delete runs
   * first, the write lands second, and the record the reader just took back is
   * put straight back — with nothing on screen to say so.
   *
   * Driven rather than hoped for: `putDraft` is held open, the revert happens
   * while it hangs, and only then is it released. Both orderings are decided
   * here instead of by whichever promise happens to settle first.
   */
  it('cannot be resurrected by a write that was already past the fence', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });

    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let holdNext = true;

    const gated = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'putDraft') {
          return async (draft: Parameters<DexieStorageProvider['putDraft']>[0]) => {
            if (holdNext) {
              holdNext = false;
              started();
              await held;
            }
            return target.putDraft(draft);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as DexieStorageProvider;

    await openSaved(entry, gated);
    type('Notes', 'The original notes. Second thoughts.');
    await writeStarted;

    // The revert happens while that write hangs, so the retirement has to
    // decide what to do about a write it can no longer stop.
    type('Notes', 'The original notes.');
    await Promise.resolve();
    release();

    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0), { timeout: 5_000 });
    await pastTheWindow();
    expect(
      await db.listDrafts(),
      'the held write landed after the delete and recreated the draft',
    ).toHaveLength(0);
  });

  it(
    'leaves nothing behind after being opened and closed over and over',
    async () => {
      const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });

      for (let visit = 0; visit < 4; visit += 1) {
        await openSaved(entry);
        await pastTheWindow();
        cleanup();
      }

      expect(await db.listDrafts(), 'four visits, four chances to litter').toHaveLength(0);
    },
    // Four full settle windows, waited out for real. The point is the count of
    // visits, so the time is spent rather than faked.
    20_000,
  );

  it('retires a false draft an older version left behind, without claiming a recovery', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    // Exactly what the previous implementation wrote on a read-only open: a
    // snapshot identical to the entry itself.
    await db.putDraft({
      id: 'stale-false-draft',
      entryId: entry.id,
      form: {
        kind: entry.kind,
        title: entry.title,
        date: entry.date,
        place: '',
        speaker: '',
        sermonSeries: '',
        notes: entry.notes,
        reflection: entry.reflection,
        prayer: '',
        tagsText: '',
        links: [],
        anchors: [],
        forDescendants: false,
        scriptureRefs: [],
        sourceMaterial: null,
      },
      createdAt: '2026-03-01T09:00:00.000Z',
      updatedAt: '2026-03-01T09:00:00.000Z',
    });

    await openSaved(entry);

    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0), { timeout: 5_000 });
    expect(
      screen.queryByText(/brought back|restored/i),
      'nothing was recovered, so nothing may say it was',
    ).toBeNull();
  });
});

/**
 * The same defect, seen from where it actually bothered somebody.
 *
 * The home page is where a false draft did its damage: it offered to continue
 * writing an entry that had been read and put down. Asserting it there as well
 * as in the store is deliberate — this is the surface the complaint was about.
 */
describe('the home page after an entry was only read', () => {
  it('does not offer to continue writing it', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.hash = `#/entry/${entry.id}`;
    mount(db, { entryId: entry.id });
    await notes();
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 4));
    cleanup();

    window.location.hash = '#/';
    render(
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <HomeView />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await screen.findByText('Recently written');
    expect(
      screen.queryByRole('link', { name: /Continue sermon/i }),
      'an entry that was read is not work in progress',
    ).toBeNull();
  });

  it('still offers it when there really are unsaved edits', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.hash = `#/entry/${entry.id}`;
    mount(db, { entryId: entry.id });
    await notes();
    type('Notes', 'The original notes. Written on the train and never saved.');
    await settle(db);
    cleanup();

    window.location.hash = '#/';
    render(
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <HomeView />
        </StorageContextProvider>
      </RouterProvider>,
    );

    const continuation = await screen.findByRole('link', { name: /Continue sermon/i });
    expect(
      continuation,
      'suppressing false drafts must not suppress real ones',
    ).toBeInTheDocument();
    expect(
      continuation.getAttribute('href'),
      'a draft for a saved entry must reopen its parent rather than create a duplicate',
    ).toBe(`#/entry/${entry.id}`);
  });
});

/**
 * What "changed" means, as a predicate.
 *
 * The editor asks this question on every keystroke, and the answer decides
 * whether an hour of writing survives a process death. Driven directly, because
 * the fields that go wrong are the ones nobody thinks to type into during a
 * render test.
 */
describe('recoverable changes', () => {
  const canonical = (overrides: Partial<DraftForm> = {}): DraftForm => ({
    kind: 'sermon',
    title: 'Sunday',
    date: '2026-03-01',
    place: 'St Mary the Virgin',
    speaker: 'Revd Hall',
    sermonSeries: 'Sermon on the Mount',
    notes: 'What was taught.',
    reflection: 'What it meant to me.',
    prayer: 'Keep me in it.',
    tagsText: 'grace, obedience',
    links: [{ url: 'https://example.org', label: 'Handout', capturedTitle: '' }],
    anchors: [
      {
        kind: 'scripture',
        book: 'Matthew',
        chapterStart: 7,
        verseStart: 13,
        chapterEnd: 7,
        verseEnd: 14,
      },
    ],
    forDescendants: false,
    scriptureRefs: ['Matthew 7:13-14'],
    sourceMaterial: null,
    ...overrides,
  });

  it('says no when the editor holds exactly what was saved', () => {
    expect(hasRecoverableChanges(canonical(), canonical())).toBe(false);
  });

  it('falls back to "has anybody begun" when nothing has ever been saved', () => {
    const blank = canonical({
      title: '',
      place: '',
      speaker: '',
      sermonSeries: '',
      notes: '',
      reflection: '',
      prayer: '',
      tagsText: '',
      links: [],
      anchors: [],
      scriptureRefs: [],
    });
    expect(hasRecoverableChanges(blank, null), 'a blank new entry leaves nothing behind').toBe(
      false,
    );
    expect(hasRecoverableChanges(canonical({ notes: 'The first sentence.' }), null)).toBe(true);
  });

  it.each([
    ['title', { title: 'Sunday evening' }],
    ['kind', { kind: 'prayer' as const }],
    ['date', { date: '2026-03-08' }],
    ['notes', { notes: 'What was taught, plus a line more.' }],
    ['reflection', { reflection: 'Something else entirely.' }],
    ['prayer', { prayer: 'And for my daughter.' }],
    ['place', { place: 'All Saints' }],
    ['speaker', { speaker: 'Revd Okafor' }],
    ['series', { sermonSeries: 'Advent' }],
    ['tags', { tagsText: 'grace, obedience, fear' }],
    ['a link', { links: [{ url: 'https://example.org/other', label: '', capturedTitle: '' }] }],
    ['a link label only', { links: [{ url: 'https://example.org', label: 'Order of service', capturedTitle: '' }] }],
    ['a removed link', { links: [] }],
    ['for descendants', { forDescendants: true }],
    ['a scripture ref', { scriptureRefs: ['Matthew 7:13-14', 'Luke 13:24'] }],
    ['an anchor verse', {
      anchors: [
        {
          kind: 'scripture' as const,
          book: 'Matthew',
          chapterStart: 7,
          verseStart: 13,
          chapterEnd: 7,
          verseEnd: 20,
        },
      ],
    }],
    ['an anchor kind', { anchors: [{ kind: 'book' as const, book: 'Matthew' }] }],
    ['a topic anchor', { anchors: [{ kind: 'topic' as const, topicId: 'fear' }] }],
    ['an outline id on an anchor', {
      anchors: [
        {
          kind: 'scripture' as const,
          book: 'Matthew',
          chapterStart: 7,
          verseStart: 13,
          chapterEnd: 7,
          verseEnd: 14,
          outlineEntryId: 'mt-7-narrow',
        },
      ],
    }],
  ])('says yes when the reader changes %s', (_field, change) => {
    expect(hasRecoverableChanges(canonical(change), canonical())).toBe(true);
  });

  it('notices a single trailing space, because a snapshot restores what was typed', () => {
    expect(hasRecoverableChanges(canonical({ notes: 'What was taught. ' }), canonical())).toBe(
      true,
    );
  });

  it('says no again once a change is taken back exactly', () => {
    const changed = canonical({ notes: 'A second thought.' });
    expect(hasRecoverableChanges(changed, canonical())).toBe(true);
    expect(hasRecoverableChanges(canonical(), canonical())).toBe(false);
  });

  it('does not make an unchanged editor dirty over provided material', () => {
    const material = {
      format: 'pdf' as const,
      filename: 'sermon.pdf',
      importedAt: '2026-03-01T09:00:00.000Z',
      body: "Somebody else's words.",
      parserVersion: 2,
      scripture: ['Matthew 7:13-14'],
    };
    const saved = canonical({ sourceMaterial: material });
    // A restored snapshot carries a structurally identical handout that is a
    // different object; reference equality would call it changed forever.
    const restored = canonical({ sourceMaterial: { ...material, scripture: [...material.scripture] } });
    expect(hasRecoverableChanges(restored, saved)).toBe(false);

    expect(
      hasRecoverableChanges(canonical({ sourceMaterial: null }), saved),
      'removing the handout is a real change',
    ).toBe(true);
  });

  it('compares every field the form has, so a new one cannot be forgotten', () => {
    const a = canonical();
    const b = canonical();
    for (const key of Object.keys(a) as (keyof DraftForm)[]) {
      expect(draftFormsEqual(a, b), 'the baseline pair must be equal').toBe(true);
      const mutated = { ...a, [key]: mutate(a[key]) } as DraftForm;
      expect(draftFormsEqual(mutated, b), `${key} is not compared`).toBe(false);
    }
  });
});

/**
 * Change one field to something a reader could plausibly have put there.
 *
 * Used to prove the comparison actually reads every field: a value that differs
 * must make the forms unequal, whatever the field's type.
 */
function mutate(value: unknown): unknown {
  if (typeof value === 'string') return `${value}!`;
  if (typeof value === 'boolean') return !value;
  if (Array.isArray(value)) return [];
  if (value === null) {
    return {
      format: 'txt' as const,
      filename: 'handout.txt',
      importedAt: '2026-03-01T09:00:00.000Z',
      body: 'Provided.',
      parserVersion: 1,
    };
  }
  return null;
}

/**
 * Throwing unfinished work away on purpose.
 *
 * Discarding is the one place in the editor that destroys writing at the
 * reader's request, so what it promises has to be exactly true: after they
 * confirm it, the draft is gone and stays gone. It used to fence the writer
 * and delete in the next breath, which left a write already awaiting storage
 * free to land afterwards and put the record straight back — with the screen
 * saying it had been thrown away.
 *
 * That ordering cannot be reached by clicking quickly, so the last case here
 * does not try: it holds `putDraft` open and decides the interleaving.
 */
describe('discarding a draft', () => {
  const pastTheWindow = () => new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 4));

  const discard = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, discard it' }));
  };

  it('A — removes the draft', async () => {
    mount(db);
    await notes();
    type('Notes', 'Started and thought better of.');
    await settle(db);

    await discard();

    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
  });

  it('B — keeps it when the reader changes their mind at the confirmation', async () => {
    mount(db);
    await notes();
    type('Notes', 'Worth keeping after all.');
    await settle(db);

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep writing' }));
    await pastTheWindow();

    const [draft] = await db.listDrafts();
    expect(draft?.form.notes, 'backing out of the confirmation destroyed the work').toBe(
      'Worth keeping after all.',
    );
  });

  it('C — cannot be undone by a write that was already past the fence', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    // Only the SECOND write is held. The first has to land, or there is no
    // draft on screen to offer discarding and the case tests nothing.
    let writes = 0;
    let holdNext = false;

    const gated = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'putDraft') {
          return async (draft: Parameters<DexieStorageProvider['putDraft']>[0]) => {
            writes += 1;
            if (holdNext) {
              holdNext = false;
              started();
              await held;
            }
            return target.putDraft(draft);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as DexieStorageProvider;

    mount(gated);
    await notes();
    type('Notes', 'A first sentence.');
    await settle(db);
    expect(writes, 'the first snapshot never reached storage').toBeGreaterThan(0);

    // A second sentence, whose write is caught mid-flight.
    holdNext = true;
    type('Notes', 'A first sentence. And a second.');
    await writeStarted;

    // Discarded while that write hangs, then it is let go.
    await discard();
    await Promise.resolve();
    release();

    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0), { timeout: 5_000 });
    await pastTheWindow();
    expect(
      await db.listDrafts(),
      'the held write landed after the delete and brought the draft back',
    ).toHaveLength(0);
  });

  it('D — stays gone once the settle window has passed', async () => {
    mount(db);
    await notes();
    type('Notes', 'Started and thought better of.');
    await settle(db);

    await discard();
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    await pastTheWindow();

    expect(await db.listDrafts(), 'a queued snapshot recreated it afterwards').toHaveLength(0);
  });

  it('E — is still gone when the editor is opened again over the same store', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.hash = `#/entry/${entry.id}`;
    mount(db, { entryId: entry.id });
    await notes();
    type('Notes', 'The original notes. An edit nobody kept.');
    await settle(db);

    await discard();
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    cleanup();

    const reopened = await open(storeName);
    mount(reopened, { entryId: entry.id });
    await notes();

    // The saved copy, not the discarded edit.
    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe(
        'The original notes.',
      ),
    );
    await pastTheWindow();
    expect(await reopened.listDrafts(), 'the discarded draft came back on reopen').toHaveLength(0);
  });

  it('F — leaves somebody else’s unfinished work alone', async () => {
    // One draft belonging to a saved entry, and one belonging to nothing.
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.hash = `#/entry/${entry.id}`;
    mount(db, { entryId: entry.id });
    await notes();
    type('Notes', 'The original notes. An edit nobody kept.');
    await settle(db);
    cleanup();

    window.location.hash = '#/entry/new';
    mount(db);
    await notes();
    type('Notes', 'A different thing entirely.');
    await settle(db, 2);

    await discard();

    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(1));
    const [survivor] = await db.listDrafts();
    expect(survivor.entryId, 'the wrong draft was thrown away').toBe(entry.id);
    expect(survivor.form.notes).toBe('The original notes. An edit nobody kept.');
  });

  it('G — reports a failed delete and restores the draft even when the outcome was ambiguous', async () => {
    const ambiguousDelete = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'deleteDraft') {
          return async (id: string) => {
            // Model a provider that commits and then loses its connection. A
            // rejection alone cannot tell the editor whether the row survived.
            await target.deleteDraft(id);
            throw new Error('storage disconnected after delete');
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as DexieStorageProvider;

    mount(ambiguousDelete);
    await notes();
    type('Notes', 'These words must survive a failed discard.');
    await settle(db);

    await discard();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /draft could not be discarded.*writing is still here/i,
    );
    await waitFor(async () => {
      const [restored] = await db.listDrafts();
      expect(restored?.form.notes).toBe('These words must survive a failed discard.');
    });
    expect(window.location.hash).toBe('#/entry/new');
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
  });

  it('H — keeps words typed while a slow discard is in flight as a new draft', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const slowDelete = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'deleteDraft') {
          return async (id: string) => {
            signalStarted();
            await held;
            return target.deleteDraft(id);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as DexieStorageProvider;

    mount(slowDelete);
    await notes();
    type('Notes', 'The version deliberately discarded.');
    await settle(db);

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, discard it' }));
    await started;
    type('Notes', 'Words typed after confirming the earlier discard.');
    release();

    expect(
      await screen.findByText(/earlier draft was discarded.*newer changes were kept/i),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const drafts = await db.listDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0].form.notes).toBe('Words typed after confirming the earlier discard.');
    });
    expect(window.location.hash).toBe('#/entry/new');
  });
});
