/**
 * The entry editor — where the journal actually gets written.
 *
 * The governing requirement is fast capture: a sermon starts, a phone comes out
 * of a pocket, and there are maybe eight seconds before the first point lands.
 * So the create form opens with the kind already set to sermon, the date already
 * set to today, and the cursor already in the notes box. Everything else is
 * optional and folded away behind a real <details> element, which costs nothing
 * to ignore and works without JavaScript or a mouse.
 *
 * Notes and reflection are never merged (operating contract, rule 4): what was
 * taught and what it meant to me are different things, and they get separate
 * boxes, separate headings and separate storage.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  canonBooks,
  findSegment,
  hasOutlineTitles,
  segmentTitle,
  segmentsForBook,
  topics,
  topicsById,
} from '../app/data';
import { Link, useRouter } from '../app/router';
import { useStorage } from '../app/storage';
import { useUnsavedWorkGuard } from '../platform/context';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { Button, EmptyState, Field, FieldRow, LiveRegion, Select, Spinner, TextArea } from '../components/ui';
import { shouldRestoreFocus } from '../lib/focus-restore';
import { refToString } from '../lib/bible';
import { BOOK_NAMES } from '../lib/canon';
import {
  findPassages,
  passageStatusText,
  toPassageMatch,
  type PassageMatch,
} from '../lib/passage-search';
import { segmentRef } from '../lib/passages';
import { todayIso } from '../storage/db';
import type { Entry, EntryAnchor, EntryKind, EntryLink } from '../types';

const KINDS: Array<{ value: EntryKind; label: string }> = [
  { value: 'sermon', label: 'Sermon' },
  { value: 'reading', label: 'Bible reading' },
  { value: 'service', label: 'Service' },
  { value: 'prayer', label: 'Prayer' },
  { value: 'reflection', label: 'Reflection' },
  { value: 'letter', label: 'Letter' },
];

/** A link row while it is being edited: every field a string, nothing optional. */
interface LinkRow {
  url: string;
  label: string;
  capturedTitle: string;
  capturedAt?: string;
}

interface FormState {
  kind: EntryKind;
  title: string;
  date: string;
  place: string;
  speaker: string;
  sermonSeries: string;
  notes: string;
  reflection: string;
  prayer: string;
  /** Raw text as typed; split on save. */
  tagsText: string;
  links: LinkRow[];
  anchors: EntryAnchor[];
  forDescendants: boolean;
}

const blankForm = (): FormState => ({
  kind: 'sermon',
  title: '',
  date: todayIso(),
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
});

const formFromEntry = (entry: Entry): FormState => ({
  kind: entry.kind,
  title: entry.title,
  date: entry.date,
  place: entry.place ?? '',
  speaker: entry.speaker ?? '',
  sermonSeries: entry.sermonSeries ?? '',
  notes: entry.notes,
  reflection: entry.reflection,
  prayer: entry.prayer ?? '',
  tagsText: entry.tags.join(', '),
  links: entry.links.map((link) => ({
    url: link.url,
    label: link.label ?? '',
    capturedTitle: link.capturedTitle ?? '',
    capturedAt: link.capturedAt,
  })),
  anchors: entry.anchors,
  forDescendants: entry.forDescendants,
});

/**
 * Does this entry carry anything worth opening the Details panel for?
 *
 * Date is excluded on purpose: every entry has one, so counting it would mean
 * the panel is always open when editing, which defeats the point.
 */
const hasDetails = (form: FormState): boolean =>
  Boolean(
    form.place ||
      form.speaker ||
      form.sermonSeries ||
      form.prayer ||
      form.tagsText ||
      form.links.length,
  );

/**
 * Does this link row survive a save?
 *
 * A row carrying nothing but its display text is one somebody started and
 * abandoned: there is no link in it and nothing to write down. The save drops
 * it, so every other question about it has to be asked through this same
 * predicate — see `hasContent`.
 */
const linkHasContent = (link: LinkRow): boolean =>
  Boolean(link.url.trim() || link.capturedTitle.trim());

/**
 * Is there anything here worth saving?
 *
 * Deliberately generous — notes alone is a valid entry, and so is a title alone.
 * Anchors do not count: an anchor is a filing label, not writing, and an entry
 * with nothing but an anchor would arrive in the descendants' book as a blank
 * page.
 *
 * What counts here has to be exactly what survives `handleSubmit`. Counting a
 * link's display text, which the save then discards, lit up Save and wrote an
 * entry with nothing whatsoever in it.
 */
const hasContent = (form: FormState): boolean =>
  Boolean(
    form.title.trim() ||
      form.notes.trim() ||
      form.reflection.trim() ||
      form.prayer.trim() ||
      form.place.trim() ||
      form.speaker.trim() ||
      form.sermonSeries.trim() ||
      parseTags(form.tagsText).length ||
      form.links.some(linkHasContent),
  );

function parseTags(text: string): string[] {
  const seen = new Set<string>();
  for (const tag of text.split(',')) {
    const trimmed = tag.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Turn the `anchor` URL parameter into a portable anchor.
 *
 * The parameter speaks the same vocabulary `anchorKey` writes: "topic:<id>",
 * "book:<id>", or a bare segment id. This has to be the exact inverse of that
 * function — a form it cannot read is dropped silently, and an entry started
 * from "Write about Grief" would save with nothing filing it under Grief.
 *
 * Both named forms are checked against this build's data, so a link carrying a
 * topic or book that no longer exists yields no anchor rather than a dangling
 * one. Neither form can collide with a segment id: ":" never appears in one.
 */
function anchorFromParam(param: string): EntryAnchor | null {
  const topicId = param.startsWith('topic:') ? param.slice('topic:'.length) : null;
  if (topicId) return topicsById.has(topicId) ? { kind: 'topic', topicId } : null;

  const bookId = param.startsWith('book:') ? param.slice('book:'.length) : null;
  if (bookId) return BOOK_NAMES[bookId] ? { kind: 'book', book: bookId } : null;

  // Book ids contain both hyphens and digits ("1-samuel", "song-of-solomon"),
  // so a segment id like "1-samuel-1-1-2-11" cannot be split back apart by
  // pattern. Ask each book whose id prefixes the segment id whether it owns it
  // instead — the canon has no book id that prefixes another, so at most one
  // can answer.
  for (const book of canonBooks) {
    if (!param.startsWith(`${book.id}-`)) continue;
    const segment = findSegment(book.id, param);
    if (!segment) continue;

    // The scripture range is what persists. outlineEntryId is an enhancement and
    // is only ever added on top of a resolved ref, never instead of one.
    const anchor = { kind: 'scripture' as const, ...segmentRef(segment, book.id) };
    return segment.kind === 'outline' ? { ...anchor, outlineEntryId: segment.id } : anchor;
  }
  return null;
}

/** Stable identity for an anchor, for React keys and for de-duplication. */
function anchorKey(anchor: EntryAnchor): string {
  if (anchor.kind === 'topic') return `topic:${anchor.topicId}`;
  if (anchor.kind === 'book') return `book:${anchor.book}`;
  return `ref:${anchor.book}:${anchor.chapterStart}:${anchor.verseStart}:${anchor.chapterEnd}:${anchor.verseEnd}`;
}

/** What an anchor is called on screen. Never depends on the outline layer. */
function anchorLabel(anchor: EntryAnchor): string {
  if (anchor.kind === 'topic') {
    return `Topic: ${topicsById.get(anchor.topicId)?.name ?? anchor.topicId}`;
  }
  if (anchor.kind === 'book') return BOOK_NAMES[anchor.book] ?? anchor.book;

  const reference = refToString(anchor, BOOK_NAMES[anchor.book] ?? anchor.book);
  if (!hasOutlineTitles || !anchor.outlineEntryId) return reference;

  // Under refs-only segmentTitle returns the reference itself, so this appends
  // nothing rather than repeating the reference twice.
  const segment = findSegment(anchor.book, anchor.outlineEntryId);
  const title = segment ? segmentTitle(segment) : reference;
  return title === reference ? reference : `${reference} — ${title}`;
}

/** rAF where it exists, a timer where it does not. Returns a canceller. */
function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(callback, 16);
  return () => clearTimeout(handle);
}

const CONTROL_CLASS =
  'mt-1 block w-full min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';

/** One passage in the picker's result list. A real button, so Enter and tab work. */
const RESULT_CLASS =
  'block w-full min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-left text-sm text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';

const LABEL_CLASS = 'block text-sm font-medium text-ink-soft';

/** Book list groupings, worded as the browse view words them. */
const TESTAMENTS = [
  { key: 'OT', label: 'Old Testament' },
  { key: 'NT', label: 'New Testament' },
] as const;

const SECTION_HEADING = 'font-serif text-lg font-semibold text-ink';

export default function EntryEditor({
  entryId,
  anchorParam,
}: {
  entryId?: string;
  anchorParam?: string;
}) {
  const { storage, ready, touch, error: storageError } = useStorage();
  const unsavedWork = useUnsavedWorkGuard();
  const { navigate } = useRouter();

  const [form, setForm] = useState<FormState | null>(null);
  /** The serialized form as last loaded or saved; drives the dirty check. */
  const [baseline, setBaseline] = useState('');
  /**
   * The id that turned out not to exist, not a bare flag.
   *
   * The route switch renders this same component for "new entry" and for an
   * existing entry, so the instance survives a move between them. A boolean set
   * here would still be set on the next route; an id can simply be compared
   * against the one being edited now.
   */
  const [missingId, setMissingId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * The id this form created, once it has saved at least once.
   *
   * Navigation to the saved entry lands a frame after the write, so in between
   * the write and the route change `entryId` is still undefined while the Save
   * button is live again. Without this, a second tap — trivially easy on a
   * phone — created a second copy of the same note. With it, the second tap
   * updates what the first one wrote.
   */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const descendantsId = useId();
  const topicPickerId = useId();
  const passagePickerId = useId();
  const bookPickerId = useId();
  const sectionPickerId = useId();
  const reasonId = useId();

  const notesBoxRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Removing a row destroys the button that was clicked, which drops focus to
  // <body>. These two outlive every removal, so they are where focus goes
  // instead — and because they are already on the page, the move can happen in
  // the click handler itself.
  const addLinkRef = useRef<HTMLButtonElement>(null);
  const topicPickerRef = useRef<HTMLSelectElement>(null);
  const passageSearchRef = useRef<HTMLInputElement>(null);
  const passageResultsRef = useRef<HTMLUListElement>(null);
  const bookPickerRef = useRef<HTMLSelectElement>(null);
  const sectionPickerRef = useRef<HTMLSelectElement>(null);
  const linksListRef = useRef<HTMLUListElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  /**
   * Focus to claim once the next render has happened.
   *
   * Some controls here replace themselves: "Add a link" renders the row it is
   * meant to hand focus to, and "Keep this entry" brings back the delete button
   * it is standing in for. Neither target exists at click time, so the move has
   * to wait a render — and if it never happens, focus falls to <body> and a
   * keyboard user is dumped back at the top of the document.
   */
  const focusAfterRender = useRef<(() => void) | null>(null);
  const [topicChoice, setTopicChoice] = useState('');
  const [passageQuery, setPassageQuery] = useState('');
  /** Book chosen in the browse picker, and the section chosen within it. */
  const [browseBook, setBrowseBook] = useState('');
  const [browseSegmentId, setBrowseSegmentId] = useState('');

  const loaded = form !== null;
  const dirty = form !== null && JSON.stringify(form) !== baseline;
  /** What a save writes to: the entry being edited, or the one just created. */
  const targetId = entryId ?? createdId;

  // Load, or seed a blank form. Deliberately NOT keyed on storage `revision`:
  // a write somewhere else in the app must never overwrite what is being typed
  // here, and this is the one view where that would cost real words.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    // The route switch reuses this instance, so every piece of transient state
    // has to be stood down when the target changes. Left standing, a delete
    // confirmation primed for one entry greeted the reader on the next one —
    // one tap away from destroying a note they never meant to touch.
    //
    // Synchronous on purpose: deferring this by even a microtask leaves the
    // primed confirmation on screen for a frame. The lint rule is a performance
    // heuristic and is deliberately overridden. App.tsx also keys this view by
    // route so React remounts it, which makes the reset belt and braces.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMissingId(null);
    setConfirmingDelete(false);
    setSaving(false);
    setSaveError('');
    setCreatedId(null);

    if (!entryId) {
      // Deferred to a microtask for the same reason as elsewhere: a synchronous
      // setState in an effect body costs an extra render pass before paint.
      queueMicrotask(() => {
        if (cancelled) return;
        const anchor = anchorParam ? anchorFromParam(anchorParam) : null;
        const initial: FormState = { ...blankForm(), anchors: anchor ? [anchor] : [] };
        setForm(initial);
        setBaseline(JSON.stringify(initial));
        setDetailsOpen(false);
      });
      return () => {
        cancelled = true;
      };
    }

    storage
      .getEntry(entryId)
      .then((entry) => {
        if (cancelled) return;
        if (!entry) {
          setMissingId(entryId);
          return;
        }
        const next = formFromEntry(entry);
        setForm(next);
        setBaseline(JSON.stringify(next));
        setDetailsOpen(hasDetails(next));
      })
      .catch(() => {
        if (!cancelled) setMissingId(entryId);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, storage, entryId, anchorParam]);

  // Fast capture: the cursor belongs in the notes box the moment the form opens.
  //
  // The shell moves focus to the page heading after every navigation and its
  // effect runs after this one, so the claim is deferred a frame to land after
  // it. TextArea does not forward a ref, hence the wrapper and the query.
  //
  // But a deferred claim is a claim that can arrive LATE. On a slow machine the
  // frame can land after the reader has already clicked something, and the
  // cursor is then yanked out of wherever they went — which is how a focus
  // race got into this view: add a link, remove it, and the pending frame
  // stole focus back to the notes box afterwards.
  //
  // So the claim only takes focus from the shell's own wrapper, or from
  // nothing. Anywhere the reader actually chose, it stands down. `from` names
  // the shell's container, which is the one place it IS allowed to take from.
  useEffect(() => {
    if (entryId || !loaded) return;
    return nextFrame(() => {
      const textarea = notesBoxRef.current?.querySelector('textarea');
      if (!textarea) return;
      const shellTarget = document.querySelector('main [tabindex="-1"]');
      if (
        shouldRestoreFocus({
          active: document.activeElement,
          target: textarea,
          from: shellTarget,
          body: document.body,
        })
      ) {
        textarea.focus();
      }
    });
  }, [entryId, loaded]);

  // Unsaved-changes guard, asked for through the platform rather than wired to
  // `beforeunload` here.
  //
  // The distinction is not cosmetic. `beforeunload` protects a browser tab; an
  // installed app gets no equivalent promise, because iOS may terminate a
  // backgrounded process without running anything of ours. So this port warns a
  // person who is still present and can still choose, and nothing more —
  // durable writes must never depend on it firing. Saving remains explicit, on
  // the Save button, exactly as before.
  useEffect(() => {
    if (!dirty) return;
    return unsavedWork.protect(() => true);
  }, [dirty, unsavedWork]);

  // Send focus to the confirm button so a keyboard user is standing on the
  // decision rather than hunting for where the page changed.
  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
  }, [confirmingDelete]);

  // No dependency list on purpose: the element to focus appears on whichever
  // render follows the click, and the ref guard makes every other pass a single
  // null check.
  useEffect(() => {
    const claim = focusAfterRender.current;
    if (!claim) return;
    focusAfterRender.current = null;
    claim();
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const updateLink = (index: number, patch: Partial<LinkRow>) =>
    setForm((current) => {
      if (!current) return current;
      const links = current.links.map((link, at) => (at === index ? { ...link, ...patch } : link));
      return { ...current, links };
    });

  const addAnchor = (anchor: EntryAnchor) =>
    setForm((current) => {
      if (!current) return current;
      if (current.anchors.some((existing) => anchorKey(existing) === anchorKey(anchor))) return current;
      return { ...current, anchors: [...current.anchors, anchor] };
    });

  const removeAnchor = (key: string) =>
    setForm((current) =>
      current
        ? { ...current, anchors: current.anchors.filter((anchor) => anchorKey(anchor) !== key) }
        : current,
    );

  // Recomputed per keystroke, which is cheap: this is string matching over a few
  // thousand titles, and nothing is fetched or parsed. `segmentsForBook` caches
  // each book the first time it is asked.
  const passageResults = useMemo(
    () => findPassages(passageQuery, { segmentsForBook, segmentTitle, hasOutlineTitles }),
    [passageQuery],
  );

  /**
   * The chosen book's divisions, exactly as the Bible view lists them.
   *
   * Deliberately the same `segmentsForBook` the browse view uses, so a reader
   * who found "Jesus and the Samaritan Woman" by browsing sees that same wording
   * in this dropdown. Uncovered gaps are included for the reason rule 3 exists:
   * leaving them out would make Genesis 35 pickable everywhere except here.
   */
  const browseSegments = useMemo(
    () => (browseBook ? segmentsForBook(browseBook) : []),
    [browseBook],
  );

  /**
   * Attach the passage a result row names.
   *
   * The scripture range is what is stored; `outlineEntryId` only ever goes on
   * top of it, never instead of it, so this entry still names a real passage
   * after an export into a build with no divisions at all.
   */
  const addPassage = (match: PassageMatch) => {
    const anchor: EntryAnchor = match.outlineEntryId
      ? { kind: 'scripture', ...match.ref, outlineEntryId: match.outlineEntryId }
      : { kind: 'scripture', ...match.ref };
    const label = anchorLabel(anchor);
    // addAnchor de-duplicates, so a second tap is harmless — but saying "added"
    // when nothing changed is a small lie to somebody who cannot see the chips.
    const already = form?.anchors.some((existing) => anchorKey(existing) === anchorKey(anchor));

    addAnchor(anchor);
    // Clearing the query unmounts the very button that was clicked, so focus
    // goes back to the field that found it rather than falling to <body>.
    setPassageQuery('');
    passageSearchRef.current?.focus();
    setMessage(already ? `${label} is already attached.` : `${label} added.`);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving || !hasContent(form)) return;

    setSaving(true);
    setSaveError('');
    // Clear first, so saving twice in a row with the same outcome still changes
    // the live region and still gets announced the second time.
    setMessage('');

    const links: EntryLink[] = form.links
      .filter(linkHasContent)
      .map((link) => ({
        url: link.url.trim(),
        label: link.label.trim() || undefined,
        capturedTitle: link.capturedTitle.trim() || undefined,
        capturedAt: link.capturedTitle.trim() ? link.capturedAt : undefined,
      }));

    const patch: Partial<Entry> = {
      kind: form.kind,
      title: form.title.trim(),
      date: form.date || todayIso(),
      place: form.place.trim() || undefined,
      speaker: form.speaker.trim() || undefined,
      sermonSeries: form.sermonSeries.trim() || undefined,
      notes: form.notes,
      reflection: form.reflection,
      prayer: form.prayer.trim() || undefined,
      tags: parseTags(form.tagsText),
      links,
      anchors: form.anchors,
      forDescendants: form.forDescendants,
    };

    try {
      const saved = targetId
        ? await storage.updateEntry(targetId, patch)
        : await storage.createEntry(patch);

      // Claimed before anything else, so a second submit lands on an update.
      setCreatedId(saved.id);
      setBaseline(JSON.stringify(form)); // stands the unsaved-changes guard down
      touch();
      // The route switch renders this same component for "new entry" and for an
      // existing entry, so saving a new note does NOT unmount this instance —
      // it just changes the props. Anything left set here would still be set in
      // the edit view that follows, which is why `saving` is cleared explicitly
      // rather than left to a remount that never comes.
      setSaving(false);
      setMessage(targetId ? 'Changes saved.' : 'Entry saved.');
      // The live region has to sit in the DOM for a beat before this view
      // unmounts, or the announcement is never picked up.
      nextFrame(() => navigate({ name: 'entry', id: saved.id }));
    } catch (cause) {
      setSaving(false);
      setSaveError(
        cause instanceof Error
          ? `Your entry could not be saved: ${cause.message}`
          : 'Your entry could not be saved.',
      );
    }
  }

  async function handleDelete() {
    if (!entryId) return;
    try {
      await storage.deleteEntry(entryId);
      setBaseline(form ? JSON.stringify(form) : baseline);
      touch();
      navigate({ name: 'timeline' });
    } catch (cause) {
      setConfirmingDelete(false);
      setSaveError(
        cause instanceof Error
          ? `That entry could not be deleted: ${cause.message}`
          : 'That entry could not be deleted.',
      );
    }
  }

  const heading = entryId ? 'Edit entry' : 'New entry';

  if (missingId !== null && missingId === entryId) {
    return (
      <>
        <h1 className="font-serif text-2xl font-semibold">{heading}</h1>
        {/* role="status" because this replaces a spinner: a lookup that quietly
            turned into "nothing here" is silent to anyone not watching. */}
        <div role="status" className="mt-6">
          <EmptyState title="That entry is not here.">
            <p>It may have been deleted on this device.</p>
            <p className="mt-2">
              <Link to={{ name: 'timeline' }} className="underline focus-visible:outline-2">
                Back to my journey
              </Link>
            </p>
          </EmptyState>
        </div>
      </>
    );
  }

  if (!form) {
    return (
      <>
        <h1 className="font-serif text-2xl font-semibold">{heading}</h1>
        {/* Wording follows the route: on a new entry there is no entry to open,
            and a slow storage open would otherwise announce one that does not
            exist. */}
        <Spinner label={entryId ? 'Opening the entry' : 'Opening a blank entry'} />
      </>
    );
  }

  const canSave = hasContent(form);

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold">{heading}</h1>
      <p className="measure mt-1 text-sm text-ink-soft">
        Write the notes now. Everything else can wait, or stay empty.
      </p>

      <LiveRegion message={message} />

      {storageError ? (
        <p
          role="alert"
          className="mt-4 rounded-control border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {storageError}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        {/* Both fields subgrid onto these row tracks, so the two controls sit on
            one baseline even though only Title carries helper text. */}
        <FieldRow>
          <Select
            label="Kind"
            hint="You can change this later."
            value={form.kind}
            onChange={(event) => update('kind', event.target.value as EntryKind)}
          >
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
          <Field
            label="Title"
            hint="Optional. Left blank, the entry is filed by its date."
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
          />
        </FieldRow>

        {/* Rule 4: what was taught and what it meant to me stay separate fields.
            The separation is carried by the labels and their helper text, which
            say what each is for — an outer "Notes" heading above a field already
            labelled "Notes" said the same thing twice and bought nothing, and
            wrapping a bordered textarea in a bordered card was a box in a box. */}
        <div ref={notesBoxRef}>
          <MarkdownEditor
            label="Notes"
            hint="What was taught"
            rows={8}
            value={form.notes}
            onChange={(value) => update('notes', value)}
          />
        </div>

        {/* No wrapper, no indent: every control in this column shares one left
            edge. What separates reflection from notes is the label and its
            helper — "what it meant to me" against "what was taught" — which say
            it plainly, where a rule or a tinted box only gestured at it. */}
        <div>
          <MarkdownEditor
            label="Reflection"
            hint="What it meant to me"
            rows={5}
            value={form.reflection}
            onChange={(value) => update('reflection', value)}
          />
        </div>

        {/* Promoted out of the Details panel deliberately. For a sermon note the
            passage is not an optional extra — it is most of what the note is
            about, and behind a collapsed disclosure it was never found. Topics
            stay folded away; they are the genuinely optional half. */}
        <section>
          <h2 className={SECTION_HEADING}>
            What this entry is about
          </h2>


              {form.anchors.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  Not attached to anything yet.
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {form.anchors.map((anchor) => {
                    const key = anchorKey(anchor);
                    const label = anchorLabel(anchor);
                    return (
                      <li
                        key={key}
                        // max-w-full and the wrap: an outline title on a 360px
                        // phone is easily wider than the screen, and a chip
                        // that refuses to break would scroll the whole page
                        // sideways.
                        className="flex max-w-full items-center gap-1 rounded-pill border border-line-strong bg-raised py-1 pl-3 text-sm text-ink"
                      >
                        <span className="min-w-0 break-words">{label}</span>
                        <Button
                          variant="ghost"
                          className="min-w-11 shrink-0 rounded-pill px-2"
                          aria-label={`Remove ${label}`}
                          onClick={() => {
                            removeAnchor(key);
                            // Same as the link rows: this button is about to be
                            // unmounted, so focus moves to the control that
                            // follows it rather than falling to <body>.
                            passageSearchRef.current?.focus();
                            setMessage(`${label} removed.`);
                          }}
                        >
                          <span aria-hidden="true">✕</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* A pastor preached on the sermon on the mount, or Jesus at the well.
                  Nobody remembers that the second one is John 4, so the passage
                  is found by the name the Bible view shows it under — and by a
                  typed reference, which is the only name it has under a build
                  with no titles. */}
              <div className="mt-4">
                <label htmlFor={passagePickerId} className={LABEL_CLASS}>
                  Add a passage
                </label>
                <p
                  id={`${passagePickerId}-hint`}
                  className="mt-1 text-xs text-ink-muted"
                >
                  {hasOutlineTitles
                    ? 'By name or by reference \u2014 \u201csermon on the mount\u201d, or \u201cJohn 4\u201d.'
                    : 'By reference \u2014 \u201cJohn 4\u201d. This version of the site carries no passage titles.'}
                </p>
                <input
                  id={passagePickerId}
                  ref={passageSearchRef}
                  type="search"
                  autoComplete="off"
                  aria-describedby={`${passagePickerId}-hint`}
                  value={passageQuery}
                  onChange={(event) => setPassageQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    // This field sits inside the entry form, so Enter would
                    // submit it — saving a half-written note the moment somebody
                    // searched for where to file it. Take the keystroke and put
                    // the keyboard on the first result instead.
                    event.preventDefault();
                    passageResultsRef.current?.querySelector('button')?.focus();
                  }}
                  className={CONTROL_CLASS}
                />
                {/* Announced as it changes, so the count is not something only a
                    sighted reader gets. Empty until there is a query to report on. */}
                <p aria-live="polite" className="mt-2 text-sm text-ink-soft">
                  {passageStatusText(passageResults)}
                </p>
                {passageResults.matches.length ? (
                  <ul ref={passageResultsRef} className="mt-1 space-y-2">
                    {passageResults.matches.map((match) => {
                      const named = match.title
                        ? `${match.reference} \u2014 ${match.title}`
                        : match.reference;
                      return (
                        <li key={match.key}>
                          <button
                            type="button"
                            aria-label={`Add ${named}`}
                            className={RESULT_CLASS}
                            onClick={() => addPassage(match)}
                          >
                            {/* The title leads because it is what was
                                remembered; the reference is always under it
                                because it is what actually gets stored. */}
                            <span className="block break-words font-medium">
                              {match.title || match.reference}
                            </span>
                            {match.title ? (
                              <span className="mt-0.5 block text-xs text-ink-muted">
                                {match.reference}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              {/* The other way in: browse to it. Searching only helps somebody who
                  remembers a name, and half the time the memory is "it was
                  somewhere in Acts". Book first, then that book's sections in
                  the order they occur — the same list, in the same words, that
                  the Bible view shows. */}
              {/* A fieldset, not a heading: this is a group of related controls,
                  which is what a legend is for. An <h3> here would also be the
                  only level-3 heading in the view, under an <h2> that is itself
                  inside a collapsed <details> — a heading outline that changes
                  shape depending on whether a disclosure happens to be open. */}
              <fieldset className="mt-6">
                <legend className="text-sm font-medium text-ink-soft">
                  Or find it by book
                </legend>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1 basis-40">
                    <label htmlFor={bookPickerId} className={LABEL_CLASS}>
                      Book
                    </label>
                    <select
                      id={bookPickerId}
                      ref={bookPickerRef}
                      value={browseBook}
                      onChange={(event) => {
                        setBrowseBook(event.target.value);
                        // The old section id belongs to the old book. Left
                        // standing it would either name nothing or, worse, name
                        // a real division in a book nobody chose.
                        setBrowseSegmentId('');
                      }}
                      className={CONTROL_CLASS}
                    >
                      <option value="">Choose a book…</option>
                      {TESTAMENTS.map((testament) => (
                        <optgroup key={testament.key} label={testament.label}>
                          {canonBooks
                            .filter((book) => book.testament === testament.key)
                            .map((book) => (
                              <option key={book.id} value={book.id}>
                                {book.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0 flex-1 basis-56">
                    <label htmlFor={sectionPickerId} className={LABEL_CLASS}>
                      Passage
                    </label>
                    <select
                      id={sectionPickerId}
                      ref={sectionPickerRef}
                      value={browseSegmentId}
                      disabled={!browseBook}
                      onChange={(event) => setBrowseSegmentId(event.target.value)}
                      className={CONTROL_CLASS}
                    >
                      <option value="">
                        {browseBook ? 'Choose a passage…' : 'Choose a book first'}
                      </option>
                      {browseSegments.map((segment) => {
                        // An <option> is plain text, so the title and reference
                        // share one line here rather than stacking as they do on
                        // a result row.
                        const title = segmentTitle(segment);
                        const reference = refToString(
                          segmentRef(segment, browseBook),
                          BOOK_NAMES[browseBook] ?? browseBook,
                        );
                        return (
                          <option key={segment.id} value={segment.id}>
                            {title && title !== reference ? `${title} — ${reference}` : reference}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <Button
                    disabled={!browseSegmentId}
                    onClick={() => {
                      const segment = browseSegments.find((row) => row.id === browseSegmentId);
                      if (!segment) return;
                      addPassage(toPassageMatch(segment, browseBook, segmentTitle));
                      // Adding clears the choice, which disables this very
                      // button, and a disabled element cannot hold focus. The
                      // book stays chosen: picking two passages from one sermon
                      // is the common case, not the rare one.
                      setBrowseSegmentId('');
                      sectionPickerRef.current?.focus();
                    }}
                  >
                    Add passage
                  </Button>
                </div>
              </fieldset>
        </section>

        <details
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
          className="rounded-card border border-line bg-surface p-4"
        >
          <summary className="min-h-11 cursor-pointer py-2 text-ink">
            <span className="font-medium">Details</span>
            <span className="ml-2 text-xs text-ink-muted">
              Date, place, speaker, series, tags, links, prayer, topics
            </span>
          </summary>

          <div className="mt-4 space-y-8">
            <section>
              <h2 className={SECTION_HEADING}>
                When and where
              </h2>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Date"
                  type="date"
                  hint="When it happened, not when it was typed."
                  value={form.date}
                  onChange={(event) => update('date', event.target.value)}
                />
                <Field
                  label="Place"
                  hint="A church, or a back porch."
                  value={form.place}
                  onChange={(event) => update('place', event.target.value)}
                />
                <Field
                  label="Speaker"
                  value={form.speaker}
                  onChange={(event) => update('speaker', event.target.value)}
                />
                <Field
                  label="Series"
                  value={form.sermonSeries}
                  onChange={(event) => update('sermonSeries', event.target.value)}
                />
                <Field
                  className="sm:col-span-2"
                  label="Tags"
                  hint="Separated by commas, e.g. grace, patience"
                  value={form.tagsText}
                  onChange={(event) => update('tagsText', event.target.value)}
                />
              </div>

              <label
                htmlFor={descendantsId}
                className="mt-4 flex min-h-11 items-center gap-3 text-sm text-ink-soft"
              >
                <input
                  id={descendantsId}
                  type="checkbox"
                  checked={form.forDescendants}
                  onChange={(event) => update('forDescendants', event.target.checked)}
                  className="size-5 rounded border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2"
                />
                <span>Include in the book for my descendants</span>
              </label>
            </section>

            <section>
              <h2 className={SECTION_HEADING}>
                Links
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Nothing is fetched. What a link pointed to is only ever what you type here.
              </p>

              {form.links.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No links yet.</p>
              ) : (
                <ul ref={linksListRef} className="mt-3 space-y-4">
                  {form.links.map((link, index) => (
                    <li key={index}>
                      <fieldset className="rounded-control border border-line p-3">
                        <legend className="px-1 text-sm font-medium text-ink-soft">
                          Link {index + 1}
                        </legend>
                        <div className="grid gap-3">
                          <Field
                            label={`Web address for link ${index + 1}`}
                            type="url"
                            inputMode="url"
                            value={link.url}
                            onChange={(event) => updateLink(index, { url: event.target.value })}
                          />
                          <Field
                            label={`Link text for link ${index + 1}`}
                            hint="How you want it to read."
                            value={link.label}
                            onChange={(event) => updateLink(index, { label: event.target.value })}
                          />
                          <Field
                            label={`What this link is (link ${index + 1})`}
                            hint="Recorded now, so this note still says what it pointed to if the link dies."
                            value={link.capturedTitle}
                            onChange={(event) => {
                              const capturedTitle = event.target.value;
                              // Stamp the capture time the moment there is
                              // something to stamp, and drop it again when the
                              // text is cleared — a timestamp with no text is a
                              // claim about nothing.
                              const capturedAt = capturedTitle.trim()
                                ? (link.capturedAt ?? new Date().toISOString())
                                : undefined;
                              updateLink(index, { capturedTitle, capturedAt });
                            }}
                          />
                        </div>
                        <div className="mt-3">
                          <Button
                            variant="danger"
                            aria-label={`Remove link ${index + 1}`}
                            onClick={() => {
                              update(
                                'links',
                                form.links.filter((_, at) => at !== index),
                              );
                              // This button is about to stop existing. Move
                              // focus somewhere real first, or it lands on
                              // <body> and a keyboard user loses their place
                              // entirely. Announce it too: a row vanishing is
                              // silent to anyone not watching the screen.
                              addLinkRef.current?.focus();
                              setMessage(`Link ${index + 1} removed.`);
                            }}
                          >
                            Remove link
                          </Button>
                        </div>
                      </fieldset>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3">
                <Button
                  ref={addLinkRef}
                  onClick={() => {
                    // The new row renders above this button, so leaving focus
                    // here would put the fields it just created behind the user.
                    focusAfterRender.current = () =>
                      linksListRef.current
                        ?.querySelector<HTMLInputElement>('li:last-child input[type="url"]')
                        ?.focus();
                    update('links', [...form.links, { url: '', label: '', capturedTitle: '' }]);
                    setMessage(`Link ${form.links.length + 1} added.`);
                  }}
                >
                  Add a link
                </Button>
              </div>
            </section>

            <section>
              <h2 className={SECTION_HEADING}>
                Prayer
              </h2>
              <div className="mt-2">
                <TextArea
                  label="Prayer"
                  hint="What you asked, or what you want to keep praying."
                  rows={4}
                  value={form.prayer}
                  onChange={(event) => update('prayer', event.target.value)}
                />
              </div>
            </section>

            <section>
              <h2 className={SECTION_HEADING}>
                Topics
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Life themes, rather than a place in the text. What is attached shows above, with
                the passages.
              </p>

              <div className="mt-6 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={topicPickerId} className={LABEL_CLASS}>
                    Add a topic
                  </label>
                  <select
                    id={topicPickerId}
                    ref={topicPickerRef}
                    value={topicChoice}
                    onChange={(event) => setTopicChoice(event.target.value)}
                    className={CONTROL_CLASS}
                  >
                    <option value="">Choose a topic…</option>
                    {topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  disabled={!topicChoice}
                  onClick={() => {
                    if (!topicChoice) return;
                    addAnchor({ kind: 'topic', topicId: topicChoice });
                    const added = anchorLabel({ kind: 'topic', topicId: topicChoice });
                    setTopicChoice('');
                    // Clearing the choice disables this very button, and a
                    // disabled element cannot hold focus — so hand it back to
                    // the picker rather than letting it fall to <body>.
                    topicPickerRef.current?.focus();
                    setMessage(`${added} added.`);
                  }}
                >
                  Add topic
                </Button>
              </div>
            </section>
          </div>
        </details>

        {saveError ? (
          <p
            role="alert"
            className="rounded-control border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {saveError}
          </p>
        ) : null}

        {!canSave ? (
          <p id={reasonId} className="text-sm text-ink-soft">
            Nothing to save yet — write a note, a reflection, or a title first.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {/* Not disabled while saving: disabling the button under a keyboard
              user's own finger throws focus to <body>, and saving an edit does
              not change the route, so nothing hands it back. handleSubmit
              already refuses a second submit while one is in flight, and a
              repeat save updates what the first one wrote rather than
              duplicating it. */}
          <Button
            type="submit"
            variant="primary"
            disabled={!canSave}
            aria-describedby={canSave ? undefined : reasonId}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {/* The entry route IS this editor, so there is no "back to the
              entry" to offer — the way out of both modes is the timeline. */}
          <Link
            to={{ name: 'timeline' }}
            className="inline-flex min-h-11 items-center rounded-control px-4 py-2 text-sm font-medium text-ink-soft underline hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {entryId ? 'Back to my journey' : 'Cancel'}
          </Link>
        </div>
      </form>

      {entryId ? (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className={SECTION_HEADING}>
            Delete
          </h2>
          {/* Two steps, both on the page. window.confirm is a modal that blocks
              the whole tab and reads badly on a phone. */}
          {confirmingDelete ? (
            <div className="mt-2">
              <p className="text-sm text-ink-soft">
                Delete this entry for good? It is not in the export unless you have already made
                one, and this cannot be undone.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button ref={confirmRef} variant="danger" onClick={handleDelete}>
                  Yes, delete it
                </Button>
                <Button
                  onClick={() => {
                    // Backing out unmounts this button; hand focus to the one
                    // that takes its place rather than letting it drop.
                    focusAfterRender.current = () => deleteRef.current?.focus();
                    setConfirmingDelete(false);
                  }}
                >
                  Keep this entry
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <Button ref={deleteRef} variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete this entry
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
