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

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { canonBooks, findSegment, hasOutlineTitles, segmentTitle, topics, topicsById } from '../app/data';
import { Link, useRouter } from '../app/router';
import { useStorage } from '../app/storage';
import { Button, Card, EmptyState, Field, LiveRegion, Spinner, TextArea } from '../components/ui';
import { refToString } from '../lib/bible';
import { BOOK_NAMES } from '../lib/canon';
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
      form.links.length ||
      form.anchors.length,
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

const SELECT_CLASS =
  'mt-1 block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

const LABEL_CLASS = 'block text-sm font-medium text-slate-700 dark:text-slate-300';

const SECTION_HEADING = 'font-serif text-lg font-semibold text-slate-900 dark:text-slate-100';

export default function EntryEditor({
  entryId,
  anchorParam,
}: {
  entryId?: string;
  anchorParam?: string;
}) {
  const { storage, ready, touch, error: storageError } = useStorage();
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

  const kindId = useId();
  const descendantsId = useId();
  const topicPickerId = useId();
  const reasonId = useId();

  const notesBoxRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Removing a row destroys the button that was clicked, which drops focus to
  // <body>. These two outlive every removal, so they are where focus goes
  // instead — and because they are already on the page, the move can happen in
  // the click handler itself.
  const addLinkRef = useRef<HTMLButtonElement>(null);
  const topicPickerRef = useRef<HTMLSelectElement>(null);
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
  // The shell moves focus to the page heading after every navigation and its
  // effect runs after this one, so claim focus back a frame later. TextArea does
  // not forward a ref, hence the wrapper and the query.
  useEffect(() => {
    if (entryId || !loaded) return;
    return nextFrame(() => notesBoxRef.current?.querySelector('textarea')?.focus());
  }, [entryId, loaded]);

  // Unsaved-changes guard. Modern browsers show their own wording; the handler
  // only has to exist and cancel.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

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
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Write the notes now. Everything else can wait, or stay empty.
      </p>

      <LiveRegion message={message} />

      {storageError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {storageError}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={kindId} className={LABEL_CLASS}>
              Kind
            </label>
            <select
              id={kindId}
              value={form.kind}
              onChange={(event) => update('kind', event.target.value as EntryKind)}
              className={SELECT_CLASS}
            >
              {KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Title"
            hint="Optional. Left blank, the entry is filed by its date."
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
          />
        </div>

        {/* Rule 4: what was taught and what it meant to me are separate fields,
            separate sections, and separate on the page. */}
        <section>
          <h2 className={SECTION_HEADING}>
            Notes
          </h2>
          <Card className="mt-2">
            <div ref={notesBoxRef}>
              <TextArea
                label="Notes"
                hint="What was taught"
                rows={10}
                value={form.notes}
                onChange={(event) => update('notes', event.target.value)}
              />
            </div>
          </Card>
        </section>

        <section>
          <h2 className={SECTION_HEADING}>
            Reflection
          </h2>
          <Card className="mt-2 border-l-4 border-l-slate-400 dark:border-l-slate-500">
            <TextArea
              label="Reflection"
              hint="What it meant to me"
              rows={6}
              value={form.reflection}
              onChange={(event) => update('reflection', event.target.value)}
            />
          </Card>
        </section>

        <details
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60"
        >
          <summary className="min-h-11 cursor-pointer py-2 text-slate-900 dark:text-slate-100">
            <span className="font-medium">Details</span>
            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
              Date, place, speaker, series, tags, links, prayer, what it is about
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
                className="mt-4 flex min-h-11 items-center gap-3 text-sm text-slate-700 dark:text-slate-300"
              >
                <input
                  id={descendantsId}
                  type="checkbox"
                  checked={form.forDescendants}
                  onChange={(event) => update('forDescendants', event.target.checked)}
                  className="size-5 rounded border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-500"
                />
                <span>Include in the book for my descendants</span>
              </label>
            </section>

            <section>
              <h2 className={SECTION_HEADING}>
                Links
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Nothing is fetched. What a link pointed to is only ever what you type here.
              </p>

              {form.links.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No links yet.</p>
              ) : (
                <ul ref={linksListRef} className="mt-3 space-y-4">
                  {form.links.map((link, index) => (
                    <li key={index}>
                      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                        <legend className="px-1 text-sm font-medium text-slate-700 dark:text-slate-300">
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
                What this entry is about
              </h2>

              {form.anchors.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
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
                        className="flex max-w-full items-center gap-1 rounded-2xl border border-slate-300 bg-slate-100 py-1 pl-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                      >
                        <span className="min-w-0 break-words">{label}</span>
                        <Button
                          variant="ghost"
                          className="min-w-11 shrink-0 rounded-2xl px-2"
                          aria-label={`Remove ${label}`}
                          onClick={() => {
                            removeAnchor(key);
                            // Same as the link rows: this button is about to be
                            // unmounted, so focus moves to the control that
                            // follows it rather than falling to <body>.
                            topicPickerRef.current?.focus();
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

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={topicPickerId} className={LABEL_CLASS}>
                    Add a topic
                  </label>
                  <select
                    id={topicPickerId}
                    ref={topicPickerRef}
                    value={topicChoice}
                    onChange={(event) => setTopicChoice(event.target.value)}
                    className={SELECT_CLASS}
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
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {saveError}
          </p>
        ) : null}

        {!canSave ? (
          <p id={reasonId} className="text-sm text-slate-600 dark:text-slate-400">
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
            className="inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-medium text-slate-700 underline hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {entryId ? 'Back to my journey' : 'Cancel'}
          </Link>
        </div>
      </form>

      {entryId ? (
        <section className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-700">
          <h2 className={SECTION_HEADING}>
            Delete
          </h2>
          {/* Two steps, both on the page. window.confirm is a modal that blocks
              the whole tab and reads badly on a phone. */}
          {confirmingDelete ? (
            <div className="mt-2">
              <p className="text-sm text-slate-700 dark:text-slate-300">
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
