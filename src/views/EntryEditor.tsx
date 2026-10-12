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

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { canonBooks, hasOutlineTitles, topics, topicsById } from '../app/data';
import { loadSections, useSectionsOptional, type Sections } from '../app/sections';
import { useFocusMode } from '../app/focus-context';
import { registerOverlay } from '../app/overlay';
import { Link, useRouter } from '../app/router';
import { nextFrame } from '../app/deferred-navigation';
import { useStorage } from '../app/storage';
import { useUnsavedWorkGuard } from '../platform/context';
import { capacitorAppState } from '../platform/app-state';
import { CollapseIcon, ExpandIcon } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { CONTROL_COMPACT, FOCUS } from '../components/styles';
import { Button, EmptyState, Field, FieldRow, LiveRegion, Select, Spinner, TextArea } from '../components/ui';
import { useNotice } from '../app/notice-context';
import { shouldRestoreFocus } from '../lib/focus-restore';
import { resolveFocusIntent } from '../lib/focus-intent';
import { Autosaver, type AutosaveResult } from '../lib/autosave';
import { draftFormsEqual, hasRecoverableChanges } from '../lib/drafts';
import {
  NO_DETAILS,
  recentDetails,
  type DetailField,
  type RecentDetails,
} from '../lib/recent-details';
import { newId } from '../storage/semantics';
import { trackPendingJournalWrite } from '../storage/pending';
import { refToString, versification } from '../lib/bible';
import { BOOK_NAMES } from '../lib/canon';
import {
  findPassages,
  passageStatusText,
  toPassageMatch,
  type PassageSearchResult,
  type PassageMatch,
} from '../lib/passage-search';
import { ENTRY_KINDS, ENTRY_KIND_LABELS, resolveEntryKind } from '../lib/entry-kinds';
import { formatDay } from '../lib/dates';
import { describeProvenance } from '../lib/provided-notes';
import { SermonNotesImport } from './SermonNotesImport';
import { ShareEntry } from './ShareEntry';
import {
  hasIncomingDocument,
  onIncomingDocument,
  releaseIncomingDocument,
  takeIncomingDocument,
} from '../app/incoming-document';
import type { IncomingDocument } from '../import/incoming';
import { segmentRef } from '../lib/passages';
import { todayIso } from '../storage/db';
import type {
  DraftForm,
  DraftLinkRow,
  Entry,
  EntryAnchor,
  EntryKind,
  EntryLink,
  ScriptureRef,
} from '../types';

/** The dropdown, built from the canonical list so it cannot fall behind it. */
const KINDS: Array<{ value: EntryKind; label: string }> = ENTRY_KINDS.map((value) => ({
  value,
  label: ENTRY_KIND_LABELS[value],
}));

/**
 * The editor's own state, and the shape a recovery draft stores verbatim.
 *
 * One type rather than two: a snapshot that could drift from what the editor
 * actually holds would restore something subtly different from what was on the
 * screen, and the whole promise here is that it does not.
 */
type FormState = DraftForm;
/** A link row while it is being edited: every field a string, nothing optional. */
type LinkRow = DraftLinkRow;


/**
 * A fresh form.
 *
 * `kind` defaults to sermon and always has: fast capture assumes a sermon is
 * starting, and `#/entry/new` must keep meaning exactly what it meant before
 * the route could carry a kind at all. A caller passes one only when the
 * reader asked for one.
 */
const blankForm = (kind: EntryKind = 'sermon'): FormState => ({
  kind,
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
  scriptureRefs: [],
  sourceMaterial: null,
});

const formFromEntry = (entry: Entry): FormState => ({
  /*
   * A row can be older than this build. `service` was a kind once, and an entry
   * saved as one still says so in the database — nothing rewrites stored rows on
   * upgrade.
   *
   * Left alone the control does not go blank, which is what made this worth
   * checking rather than assuming: `<select>` matches no option and falls back
   * to the first one, so it reads "Sermon" quite convincingly. The state behind
   * it still says `service`, so the editor takes every not-a-sermon branch —
   * the reader is shown a control saying Sermon above an editor behaving as
   * something else, with the quiet import instead of the prominent one and no
   * way to see why. Saving would keep `service`, and the entry stays invisible
   * to every kind filter.
   *
   * Resolving it here makes the state agree with the word on the screen. The
   * canonical copy used for dirty-tracking comes through this same function, so
   * the entry does not claim unsaved changes; the row is corrected the next time
   * it is saved for a reason of the reader's own, never behind their back.
   */
  kind: resolveEntryKind(entry.kind) ?? 'reflection',
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
  scriptureRefs: entry.scriptureRefs,
  sourceMaterial: entry.sourceMaterial ?? null,
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
      form.links.some(linkHasContent) ||
      // Provided notes count. Importing a handout and saving it to come back
      // to on the way home is a real thing to do, and refusing to save until
      // the reader has typed something of their own would be this app
      // deciding when they are allowed to start.
      form.sourceMaterial !== null,
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
function anchorFromParam(param: string, sections: Sections): EntryAnchor | null {
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
    const segment = sections.findSegment(book.id, param);
    if (!segment) continue;

    // The scripture range is what persists. outlineEntryId is an enhancement and
    // is only ever added on top of a resolved ref, never instead of one.
    const anchor = { kind: 'scripture' as const, ...segmentRef(segment, book.id) };
    return segment.kind === 'outline' ? { ...anchor, outlineEntryId: segment.id } : anchor;
  }
  return null;
}

/**
 * What the passage picker shows before the divisions are here.
 *
 * `searched: false` is the honest answer — nothing was looked up — and it is
 * the same value the picker holds before the query is long enough to search,
 * so `passageStatusText` already says nothing for it. A "Nothing matched"
 * computed against an empty set would be a wrong answer stated confidently.
 */
const NO_PASSAGE_RESULTS: PassageSearchResult = {
  query: '',
  searched: false,
  searchedTitles: hasOutlineTitles,
  matches: [],
  more: 0,
};

/** Stable identity for an anchor, for React keys and for de-duplication. */
function anchorKey(anchor: EntryAnchor): string {
  if (anchor.kind === 'topic') return `topic:${anchor.topicId}`;
  if (anchor.kind === 'book') return `book:${anchor.book}`;
  return `ref:${anchor.book}:${anchor.chapterStart}:${anchor.verseStart}:${anchor.chapterEnd}:${anchor.verseEnd}`;
}

/**
 * What an anchor is called on screen.
 *
 * The reference is always available; the outline title that may be appended to
 * it is not, so `sections` is nullable and an absent one simply leaves the
 * title off. Never a placeholder and never a guess — the reference alone is
 * the truth, and the title is the enhancement it has always been.
 */
function anchorLabel(anchor: EntryAnchor, sections: Sections | null): string {
  if (anchor.kind === 'topic') {
    return `Topic: ${topicsById.get(anchor.topicId)?.name ?? anchor.topicId}`;
  }
  if (anchor.kind === 'book') return BOOK_NAMES[anchor.book] ?? anchor.book;

  const reference = refToString(anchor, BOOK_NAMES[anchor.book] ?? anchor.book);
  if (!hasOutlineTitles || !anchor.outlineEntryId || !sections) return reference;

  // Under refs-only segmentTitle returns the reference itself, so this appends
  // nothing rather than repeating the reference twice.
  const segment = sections.findSegment(anchor.book, anchor.outlineEntryId);
  const title = segment ? sections.segmentTitle(segment) : reference;
  return title === reference ? reference : `${reference} — ${title}`;
}

/**
 * Details this reader has saved before, offered back as one tap each.
 *
 * Buttons, not an autocomplete and not a default: the field above stays
 * exactly as empty as it was until somebody presses one of these. Tapping puts
 * the value in the field and nothing else happens — no flag on the entry, no
 * record that it was suggested rather than typed. It is the reader's value
 * from that moment, theirs to edit or clear like any other.
 *
 * The accessible name says what pressing it will do and where: "Use speaker
 * Pastor James". The field's own label is still what identifies the
 * destination, so a screen reader user who has just heard "Speaker, edit text"
 * is not left guessing what these belong to.
 */
function RecentDetailChips({
  field,
  spoken,
  values,
  onChoose,
}: {
  field: DetailField;
  /** How the field is named out loud, inside the button's name. */
  spoken: string;
  values: string[];
  onChoose: (field: DetailField, value: string) => void;
}) {
  const headingId = useId();
  if (values.length === 0) return null;

  return (
    <div className="mt-2">
      {/* Quiet on purpose: the box above is the field, and this is a
          convenience under it. Not a live region — announcing a list of
          historical values every time a panel opens would be noise. */}
      <p id={headingId} className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        Recent
      </p>
      <ul aria-labelledby={headingId} className="mt-1 flex flex-wrap gap-2">
        {values.map((value) => (
          /*
             `min-w-0` is load-bearing, not tidiness. A flex item's minimum is
             its content's intrinsic width, so without it a chip holding "First
             Baptist, Tallahassee, FL" refuses to shrink and takes the page
             sideways with it — 459px of content in a 320px viewport at 200%
             text, which is the reflow criterion failing rather than a cosmetic
             nicety. It has to be on the item AND the button for the truncation
             inside to have anything to truncate against.
          */
          <li key={value} className="min-w-0 max-w-full">
            <button
              type="button"
              onClick={() => onChoose(field, value)}
              aria-label={`Use ${spoken} ${value}`}
              className={`inline-flex min-h-11 min-w-0 max-w-full items-center rounded-pill border border-line-strong bg-surface px-3 py-1 text-sm text-ink-soft transition-colors hover:bg-raised ${FOCUS}`}
            >
              {/* Wraps rather than truncates. An ellipsis is lost content,
                  which is the 1.4.4 criterion failing at 200% text — a church
                  called "First Baptist, Tallahassee, FL" needs 336px in a
                  124px box and must become two lines, not three dots. */}
              <span className="break-words text-left">{value}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
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
  kindParam,
  draftParam,
}: {
  entryId?: string;
  anchorParam?: string;
  /**
   * Which unfinished piece of work this editor is resuming.
   *
   * Only meaningful for a new entry: a saved entry finds its own draft by id.
   * Carried in the route so that "Continue writing" reopens the same draft
   * rather than a different blank page, and so two started notes stay distinct.
   */
  draftParam?: string;
  /**
   * The kind the route asked for, already validated by the parser.
   *
   * Seeds a NEW entry and nothing else. It is read inside the `!entryId`
   * branch below, so an existing entry cannot be re-kinded by a URL: a hash
   * like `#/entry/abc?kind=prayer` does not even parse to a kind, and if it
   * somehow arrived here it would never be reached.
   */
  kindParam?: EntryKind;
}) {
  const { storage, ready, touch, error: storageError } = useStorage();
  const unsavedWork = useUnsavedWorkGuard();
  const { navigate, navigateNextFrame } = useRouter();

  const [form, setForm] = useState<FormState | null>(null);
  const currentEntryId = useRef(entryId);
  currentEntryId.current = entryId;
  /**
   * The newest form React has rendered, including changes accepted while an
   * explicit Save is awaiting storage. Event handlers close over the form that
   * existed when Save began; this ref is the authority after any await.
   */
  const latestForm = useRef<FormState | null>(null);
  latestForm.current = form;
  /** Deliberate discard/delete is the only route leave that must not recover. */
  const recoverOnUnmount = useRef(true);

  // --- crash-safe drafts --------------------------------------------------
  //
  // Everything typed here is snapshotted into its own durable collection as it
  // is written, so a process death costs at most the text typed inside the
  // current settle window. See docs/ADR-CRASH-SAFE-DRAFTS.md. The draft is not
  // an entry and never becomes one until Save says so.

  /**
   * This editor's draft id, stable for as long as it is open.
   *
   * Minted lazily — a blank editor someone opened and closed must leave
   * nothing behind — and then held, so a second new entry cannot overwrite the
   * first one's unfinished work.
   */
  const draftId = useRef<string | null>(draftParam ?? null);
  /** Parent of future draft writes; changes when a new entry is first saved. */
  const draftEntryId = useRef<string | undefined>(entryId);
  /** When the draft was first written, so "started at" means something. */
  const draftCreatedAt = useRef<string | null>(null);
  /**
   * The saved entry as this editor would show it, and the thing "changed" means
   * changed FROM.
   *
   * `null` while there is no saved entry behind the form — a new entry, or one
   * still loading. Set from the entry every time one is loaded, and again after
   * a save, because a save is precisely the moment the journal catches up with
   * the screen and there stops being anything to recover.
   *
   * A ref rather than state: it is read inside the snapshot effect to decide
   * whether to write at all, and holding it in state would run that effect a
   * second time on every load just to tell it what it already knew.
   */
  const canonicalForm = useRef<FormState | null>(null);
  /**
   * Whether there is unfinished work to offer discarding.
   *
   * State rather than reading the ref while rendering: the ref is the
   * authority for async callbacks, but a ref changing does not re-render, so
   * the control would not appear at the moment the draft was minted.
   */
  const [hasDraft, setHasDraft] = useState(Boolean(draftParam));
  /** Said once, quietly, when work was brought back. */
  const [draftRestored, setDraftRestored] = useState(false);
  /** Shown only once persistence has failed repeatedly; never per keystroke. */
  const [draftTrouble, setDraftTrouble] = useState(false);
  /**
   * Is there text on screen that has not reached durable storage yet?
   *
   * This — not "is the form different from the saved entry" — is what the
   * unsaved-work guard now protects. Once a snapshot is written, leaving does
   * not lose anything, and warning about a loss that cannot happen teaches
   * people to click through warnings.
   */
  const [notYetDurable, setNotYetDurable] = useState(false);
  /**
   * The id that turned out not to exist, not a bare flag.
   *
   * The route switch renders this same component for "new entry" and for an
   * existing entry, so the instance survives a move between them. A boolean set
   * here would still be set on the next route; an id can simply be compared
   * against the one being edited now.
   */
  const [missingId, setMissingId] = useState<string | null>(null);
  /** A failed read is not evidence that an entry or draft is absent. */
  const [loadError, setLoadError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  /**
   * Details this reader has saved before, for the fields inside Details.
   *
   * Empty until the panel is actually opened. That is the whole performance
   * story of this feature: fast capture opens the editor straight into the
   * notes box, and reading the journal to work out who preached last week has
   * no business happening on that path. See the effect below.
   */
  const [saved, setSaved] = useState<RecentDetails>(NO_DETAILS);
  /** Read once per editor, and only after somebody asks for Details. */
  const detailsRead = useRef(false);
  const [saving, setSaving] = useState(false);
  const { showNotice } = useNotice();
  const { focused, enterFocus, exitFocus } = useFocusMode();
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Open only on a saved entry, and only when there is nothing unsaved. */
  /**
   * The saved entry, loaded when Share is pressed, or null when it is closed.
   *
   * Read from storage rather than assembled from the form on screen. What a
   * person shares is what is SAVED — the version that exists, that they could
   * open again tomorrow — and the editor may be holding edits that are not
   * that. Sharing is offered only when there is nothing unsaved, so the two
   * agree; loading it anyway means they cannot silently disagree.
   */
  const [sharing, setSharing] = useState<Entry | null>(null);
  const [shareProblem, setShareProblem] = useState('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const discardRef = useRef<HTMLButtonElement>(null);
  /** Is the church-notes import panel open? Nothing is written while it is. */
  const [importingNotes, setImportingNotes] = useState(false);

  /*
   * A document the operating system shared into the app.
   *
   * Claimed in an effect, and never inside a state updater. That is the whole
   * lesson of this one.
   *
   * The first version took it inside `setShared(current => …)`. A state
   * updater must be PURE: React may call it more than once from the same base
   * state, and when it did, the first call took the document and the second —
   * starting from `null` again — found the slot already empty and settled on
   * nothing. Every unit test passed. On a device the panel simply never
   * opened, with no error anywhere, because a handout taken and dropped looks
   * exactly like no handout at all.
   *
   * `takeIncomingDocument` clears the slot, which is what keeps a redelivered
   * Android intent from becoming a second copy of the same handout. Only for a
   * new entry: a share opens a fresh sermon, so an editor holding a saved one
   * must not swallow it.
   */
  const [shared, setShared] = useState<IncomingDocument | null>(null);

  /*
   * A document can also arrive AFTER this editor is on screen, and the initial
   * read above would miss it.
   *
   * Found on an emulator, not in a test. The web view restores the hash it was
   * last on, so a cold share into an app that was last left on `#/entry/new`
   * mounts the editor FIRST, with an empty slot, and the navigation that
   * follows is to the address already showing — no hash change, no remount,
   * and a handout sitting in the slot with nothing watching it. Every unit
   * test passed because they all offered the document before mounting.
   *
   * Subscribing covers that and the warm case together: a share that arrives
   * while the reader is on this page opens the panel where they are.
   */
  useEffect(() => {
    if (entryId) return undefined;

    const claim = () => {
      // The registry refuses a second offer while one is in hand, so this can
      // never displace a review already on screen.
      if (!hasIncomingDocument()) return;
      const document = takeIncomingDocument();
      if (document) setShared(document);
    };

    // One that was already waiting, and one that arrives later.
    claim();
    return onIncomingDocument(claim);
  }, [entryId]);

  // Release the slot when this editor goes away however it goes away — applied,
  // cancelled, navigated off. Until it is released, a second share is told to
  // wait rather than replacing what is on screen.
  useEffect(() => () => releaseIncomingDocument(), []);
  const [confirmingRemoveProvided, setConfirmingRemoveProvided] = useState(false);
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
  const chapterPickerId = useId();
  const versePickerId = useId();
  const verseEndPickerId = useId();
  const browseModeName = useId();
  const reasonId = useId();
  const focusKindId = useId();
  const providedId = useId();

  const notesBoxRef = useRef<HTMLDivElement>(null);
  /** The control that turns focus mode on; where focus goes when it turns off. */
  const focusToggleRef = useRef<HTMLButtonElement>(null);
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
  const versePickerRef = useRef<HTMLSelectElement>(null);
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
  /**
   * Where the reader has asked focus to go next, and nothing else.
   *
   * Held as a resolver rather than a ready-made focus call, so it can be
   * re-tried against the DOM on each commit: the control being waited for
   * usually does not exist at the moment it is requested. See
   * src/lib/focus-intent.ts for why an intent is never spent unhonoured.
   */
  const focusIntent = useRef<(() => HTMLElement | null | undefined) | null>(null);
  /** Cancels the deferred default claim, while one is still in flight. */
  const cancelDefaultFocus = useRef<(() => void) | null>(null);

  /**
   * Record where the reader wants to land, and retire the editor's default.
   *
   * A reader who pressed a button has said where they want to be, and that
   * outranks the opening "cursor into the notes box" claim which may still be
   * sitting on a frame — the exact collision that sent the caret to Notes when
   * someone pressed "Add a link".
   */
  const claimFocus = useCallback((resolve: () => HTMLElement | null | undefined) => {
    focusIntent.current = resolve;
    cancelDefaultFocus.current?.();
    cancelDefaultFocus.current = null;
  }, []);
  const [topicChoice, setTopicChoice] = useState('');
  const [passageQuery, setPassageQuery] = useState('');
  /** Book chosen in the browse picker, and the section chosen within it. */
  const [browseBook, setBrowseBook] = useState('');
  const [browseSegmentId, setBrowseSegmentId] = useState('');
  /*
   * Which kind of reference the browse controls are choosing.
   *
   * Passage by default, because that is what this picker did before and what a
   * sermon usually names. Verse is the same reference either way — one
   * `ScriptureRef` with a start and an end, formatted as "John 3:16" when they
   * meet — so this decides which controls are on screen and nothing else. There
   * is no second kind of anchor and nothing downstream asks which one was used.
   */
  const [browseMode, setBrowseMode] = useState<'passage' | 'verse'>('passage');
  const [browseChapter, setBrowseChapter] = useState('');
  const [browseVerse, setBrowseVerse] = useState('');
  /** Empty means "just the one verse", which is the common case. */
  const [browseVerseEnd, setBrowseVerseEnd] = useState('');

  /*
   * The divisions, asked for only by the parts of this editor that are about
   * Scripture.
   *
   * Writing is not one of them. A sermon note started from the widget has no
   * anchors and an untouched passage picker, so nothing here is true and the
   * payload is never requested — the reader types into Notes while three
   * quarters of a megabyte of section headings stays unparsed on disk.
   *
   * It becomes true when the reader reaches for Scripture: typing in the
   * passage search, choosing a book to browse, or holding an anchor whose
   * outline title this editor would otherwise have to leave off.
   */
  const needsSections =
    passageQuery.length > 0 ||
    // Passage mode only. Choosing a verse needs verse COUNTS, which ship in the
    // startup chunk under both data profiles; the section headings are three
    // quarters of a megabyte fetched on demand, and pulling them to populate a
    // list of numbers would undo what src/app/sections.ts exists for.
    (browseMode === 'passage' && browseBook !== '') ||
    (form?.anchors.some(
      (anchor) => anchor.kind === 'scripture' && Boolean(anchor.outlineEntryId),
    ) ??
      false);
  const sections = useSectionsOptional(needsSections);

  const loaded = form !== null;
  /**
   * The writer. One per editor, created lazily so a blank editor makes nothing.
   *
   * `write` is given the snapshot and does exactly one thing with it — there is
   * no conversion to an entry here, because converting trims and drops empty
   * link rows, and a recovery snapshot must give back the half-typed state the
   * reader actually had.
   */
  const autosaver = useRef<Autosaver<FormState> | null>(null);

  const onAutosaveResult = useCallback((result: AutosaveResult) => {
    // Never per-cycle noise. A single failure is usually transient; a run of
    // them means the writing is not being kept and the reader should be told.
    if (result.status === 'saved') {
      setDraftTrouble(false);
      // A newer generation may have arrived while the successful write was in
      // flight. Only the generation that is actually durable clears the guard.
      setNotYetDurable(result.pending);
      return;
    }
    // A failed write leaves the words on screen and nowhere else, so the guard
    // must keep saying so.
    setNotYetDurable(true);
    if (result.consecutiveFailures >= 3) setDraftTrouble(true);
  }, []);

  const getAutosaver = useCallback((): Autosaver<FormState> => {
    if (!autosaver.current) {
      autosaver.current = new Autosaver<FormState>({
        write: async (snapshot) => {
          const id = draftId.current;
          if (!id) return;
          const now = new Date().toISOString();
          draftCreatedAt.current ??= now;
          await storage.putDraft({
            id,
            ...(draftEntryId.current ? { entryId: draftEntryId.current } : {}),
            form: snapshot,
            createdAt: draftCreatedAt.current,
            updatedAt: now,
          });
        },
        onResult: onAutosaveResult,
      });
    }
    return autosaver.current;
  }, [onAutosaveResult, storage]);

  /**
   * Throw away a draft whose reason to exist has gone.
   *
   * The editor has come back to exactly what the journal holds — by an undo, by
   * a discard, or by never having been touched at all. Leaving the record
   * behind would offer somebody "continue writing" for work that no longer
   * differs from what they can already read.
   *
   * The ordering is the same one the save path uses, and for the same reason:
   * fence the writer, wait for anything already past the fence to land, and
   * only then delete. Deleting first leaves the in-flight write to recreate the
   * draft a moment later, which is worse than never having retired it — nothing
   * on screen would say so.
   */
  const retireDraft = useCallback(async (options: { requireDeletion?: boolean } = {}) => {
    const id = draftId.current;
    const createdAt = draftCreatedAt.current;
    const writer = autosaver.current;
    // Cleared synchronously: the effect below runs again before any of this
    // resolves, and it must not find a draft id still standing and re-enter.
    draftId.current = null;
    draftCreatedAt.current = null;
    writer?.retire();
    autosaver.current = null;
    setHasDraft(false);
    setDraftRestored(false);
    await writer?.settled();
    if (!id) return;
    try {
      await storage.deleteDraft(id);
    } catch (cause) {
      if (!options.requireDeletion) return;

      // A rejected delete has an unknown outcome at this boundary: it may have
      // failed before the transaction, or the provider may have committed and
      // then lost its connection. Restore the identity and rewrite the latest
      // snapshot so either outcome leaves the writing recoverable.
      draftId.current = id;
      draftCreatedAt.current = createdAt;
      setHasDraft(true);
      setNotYetDurable(true);
      const snapshot = latestForm.current;
      if (snapshot) {
        const replacement = getAutosaver();
        replacement.queue(snapshot);
        await replacement.flush();
      }
      throw cause;
    }
  }, [getAutosaver, storage]);

  /**
   * Snapshot the editor whenever it changes.
   *
   * Change-driven rather than timer-driven: the autosaver coalesces a burst of
   * keystrokes into one write and refuses any write carrying stale content, so
   * nothing here depends on a timer winning a race.
   *
   * The gate is "does this differ from what the journal already holds", not
   * "is there anything here". Those are the same question on a blank page and
   * different questions on a saved entry: hydrating the editor with an entry
   * somebody opened to READ used to satisfy the second one and mint a draft for
   * a note nobody had touched.
   */
  useEffect(() => {
    if (!form) return;
    if (!hasRecoverableChanges(form, canonicalForm.current)) {
      // Nothing to lose: the words on screen are the words in the journal.
      queueMicrotask(() => setNotYetDurable(false));
      if (draftId.current) void retireDraft();
      return;
    }

    // First meaningful keystroke on a new entry: the work becomes recoverable
    // from this moment, without anyone having pressed Save.
    if (!draftId.current) {
      draftId.current = newId();
      setHasDraft(true);
      // Deliberately NOT written into the route. Putting it there rewrote the
      // URL on the first keystroke, and since the route is part of this view's
      // React key that remounted the editor mid-sentence. The way back to this
      // work after a relaunch is "Continue writing" on the home page, which
      // opens `#/entry/new?draft=<id>` explicitly.
    }
    // Deferred to a microtask for the reason the storage hook defers its own
    // loading flag: a synchronous setState inside an effect costs an extra
    // render pass before paint, and this runs on every keystroke.
    queueMicrotask(() => setNotYetDurable(true));
    getAutosaver().queue(form);
  }, [form, getAutosaver, retireDraft]);

  /**
   * A native process can be suspended immediately after backgrounding. Push
   * the latest rendered snapshot through the same ordered writer as soon as
   * the lifecycle signal arrives instead of waiting for the debounce timer.
   */
  useEffect(() => {
    const source = capacitorAppState();
    return source.subscribe(
      (active) => {
        if (active) return;
        const snapshot = latestForm.current;
        if (!snapshot || !hasRecoverableChanges(snapshot, canonicalForm.current)) return;
        if (!draftId.current) {
          draftId.current = newId();
          setHasDraft(true);
        }
        setNotYetDurable(true);
        const writer = getAutosaver();
        // Queue again deliberately: it closes the tiny gap where React has
        // rendered the keystroke but the ordinary snapshot effect has not run.
        writer.queue(snapshot);
        void writer.flush().catch(() => {
          setNotYetDurable(true);
          setDraftTrouble(true);
        });
      },
      () => {
        // A missing lifecycle signal cannot itself save text. Keep the normal
        // autosaver running, but never imply that pending words are durable.
        if (autosaver.current?.hasPendingWork) setNotYetDurable(true);
      },
    );
  }, [getAutosaver]);

  /**
   * Leaving through in-app navigation is not a licence to wait out the debounce.
   * Start the newest draft write during cleanup and register it outside React,
   * where the Data page can await it before taking a backup/import snapshot.
   */
  useEffect(
    () => () => {
      if (!recoverOnUnmount.current) return;
      const snapshot = latestForm.current;
      if (!snapshot || !hasRecoverableChanges(snapshot, canonicalForm.current)) return;
      if (!draftId.current) draftId.current = newId();
      const writer = getAutosaver();
      writer.queue(snapshot);
      trackPendingJournalWrite(writer.flush());
    },
    [getAutosaver],
  );

  /** What a save writes to: the entry being edited, or the one just created. */
  const targetId = entryId ?? createdId;

  // Load, or seed a blank form. Deliberately NOT keyed on storage `revision`:
  // a write somewhere else in the app must never overwrite what is being typed
  // here, and this is the one view where that would cost real words.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    draftEntryId.current = entryId;

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
    setLoadError('');
    setConfirmingDelete(false);
    setDeleting(false);
    setImportingNotes(false);
    setConfirmingRemoveProvided(false);
    setSaving(false);
    setSaveError('');
    setCreatedId(null);

    if (!entryId) {
      // Deferred to a microtask for the same reason as elsewhere: a synchronous
      // setState in an effect body costs an extra render pass before paint.
      void (async () => {
        // Work in progress wins over a blank page. There is no ambiguity to
        // resolve here — nothing has ever been saved under this id, so the
        // draft IS the entry as far as the reader is concerned.
        let resuming;
        try {
          resuming = draftParam ? await storage.getDraft(draftParam) : undefined;
        } catch (cause) {
          if (!cancelled) {
            setLoadError(
              cause instanceof Error
                ? `Your unfinished writing could not be opened: ${cause.message}`
                : 'Your unfinished writing could not be opened.',
            );
          }
          return;
        }
        if (cancelled) return;

        if (resuming) {
          draftId.current = resuming.id;
          draftEntryId.current = resuming.entryId;
          draftCreatedAt.current = resuming.createdAt;
          // Nothing has ever been saved under this id, so there is no canonical
          // state to be the same as. Set with the form, never apart from it: a
          // baseline describing a different entry than the one on screen would
          // call every field changed.
          canonicalForm.current = null;
          setHasDraft(true);
          setForm(resuming.form);
          setDetailsOpen(hasDetails(resuming.form));
          setDraftRestored(true);
          return;
        }

        /*
         * An anchor in the URL is the one thing on this path that needs the
         * divisions: the parameter is a SEGMENT id, and resolving it is how
         * the passage gets attached at all. So this waits — and only this.
         * Fast Capture carries no anchor and never reaches the await, which is
         * what `fast-capture-startup.test.tsx` holds the loader to prove.
         */
        const anchor = anchorParam ? anchorFromParam(anchorParam, await loadSections()) : null;
        if (cancelled) return;
        const initial: FormState = { ...blankForm(kindParam), anchors: anchor ? [anchor] : [] };
        canonicalForm.current = null;
        setForm(initial);
        setDetailsOpen(false);
      })();
      return () => {
        cancelled = true;
      };
    }

    Promise.all([storage.getEntry(entryId), storage.getDraftForEntry(entryId)])
      .then(([entry, draft]) => {
        if (cancelled) return;
        if (!entry) {
          setMissingId(entryId);
          return;
        }
        const saved = formFromEntry(entry);
        // What "unchanged" means for the rest of this editor's life.
        canonicalForm.current = saved;

        // Unsaved edits to this entry outrank the saved copy on screen, because
        // they are the newer thing the reader wrote. The saved entry is not
        // touched — it stays exactly as it was until Save says otherwise, so
        // discarding the draft still gets them back to it.
        if (draft && !draftFormsEqual(draft.form, saved)) {
          draftId.current = draft.id;
          draftCreatedAt.current = draft.createdAt;
          setHasDraft(true);
          setForm(draft.form);
          setDetailsOpen(hasDetails(draft.form));
          setDraftRestored(true);
          return;
        }

        // A draft holding exactly what the journal holds has nothing to give
        // back, and saying "we brought your work back" about it would be a
        // small lie. Adopting the id — without announcing anything — is what
        // lets the snapshot effect retire the record instead of leaving it to
        // go on offering itself. Versions before this one wrote such a draft
        // every time an entry was merely opened, so there are real ones out
        // there to clean up.
        if (draft) {
          draftId.current = draft.id;
          draftCreatedAt.current = draft.createdAt;
        }
        setForm(saved);
        setDetailsOpen(hasDetails(saved));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error
              ? `That entry could not be opened: ${cause.message}`
              : 'That entry could not be opened.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, storage, entryId, anchorParam, kindParam, draftParam]);

  /**
   * Read the journal for previously saved details — but only once Details is open.
   *
   * Keyed on `detailsOpen` rather than run on mount, and guarded by a ref so
   * reopening the panel does not read again. Two things follow, and both are
   * deliberate:
   *
   * Fast capture never pays for it. The route that exists to get somebody
   * writing during a sermon reaches a focused notes box without this having
   * been considered, let alone awaited.
   *
   * And what it reads is the SAVED journal. `listEntries` sees entries;
   * unfinished recovery drafts live in their own collection and are not
   * consulted here, which is why something half-typed in another editor can
   * never be offered back as though it had been decided on.
   */
  useEffect(() => {
    if (!ready || !detailsOpen || detailsRead.current) return;
    detailsRead.current = true;
    let cancelled = false;
    void storage
      .listEntries()
      .then((entries) => {
        if (!cancelled) setSaved(recentDetails(entries));
      })
      .catch(() => {
        // Nothing to offer is a fine outcome: the fields still work, and the
        // reader types as they did before.
      });
    return () => {
      cancelled = true;
    };
  }, [ready, detailsOpen, storage]);

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
  //
  // In focus mode the claim also applies to an entry that already exists, which
  // is how writing survives a save. Saving a new entry navigates, App remounts
  // this view under a new key, and the shell then moves focus to the page
  // heading — so in the ordinary editor the caret leaves the notes box and, on
  // a phone, the keyboard closes with it. That is defensible when the page has
  // visibly changed. In focus mode nothing changed: the reader is mid-sermon
  // and the next point is already being spoken. The guard below is what makes
  // this safe to widen — it still only takes focus from the shell's own
  // wrapper or from nothing, never from somewhere the reader chose.
  useEffect(() => {
    if (!loaded) return;
    if (entryId && !focused) return;
    // The reader has already said where they want to be. Do not queue a
    // default that would compete with it.
    if (focusIntent.current) return;
    const cancel = nextFrame(() => {
      cancelDefaultFocus.current = null;
      // An intent raised after this frame was queued still outranks it. Without
      // this the default wins any moment the intent's control has not mounted
      // yet, because focus is on <body> and that reads as "free".
      if (focusIntent.current) return;
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
        // `preventScroll` matters: focusing scrolls the target into view, and
        // the notes box sits below the heading, the kind and the title. Without
        // it a new entry opened already scrolled past its own top, so the first
        // thing a reader saw was the middle of a form. Fast capture means the
        // cursor is waiting in the notes box — not that the page has moved.
        textarea.focus({ preventScroll: true });
      }
    });
    cancelDefaultFocus.current = cancel;
    return () => {
      cancelDefaultFocus.current = null;
      cancel();
    };
  }, [entryId, loaded, focused]);

  // Unsaved-changes guard, asked for through the platform rather than wired to
  // `beforeunload` here.
  //
  // The distinction is not cosmetic. `beforeunload` protects a browser tab; an
  // installed app gets no equivalent promise, because iOS may terminate a
  // backgrounded process without running anything of ours. So this port warns a
  // person who is still present and can still choose, and nothing more —
  // durable writes must never depend on it firing. Saving remains explicit, on
  // the Save button, exactly as before.
  /**
   * Warn only about a loss that is real.
   *
   * This used to fire on `dirty` — any difference from the saved entry — and
   * that is no longer true of anything. Work in progress is written to its own
   * durable record as it is typed, so closing the tab with unsaved changes
   * keeps them; they come back as a draft. The only text genuinely at risk is
   * text inside the current settle window, or text whose write failed, which is
   * exactly what `notYetDurable` tracks.
   *
   * Left deliberately in place rather than removed: that window is real, and
   * the guard is what covers it.
   */
  useEffect(() => {
    if (!notYetDurable) return;
    return unsavedWork.protect(() => true);
  }, [notYetDurable, unsavedWork]);


  /**
   * Enter focus mode and put the cursor where the point of it is.
   *
   * Safe to take focus unconditionally, unlike the fast-capture claim above:
   * this runs from a click on the toggle, so the reader has just said "I want
   * to write" and the thing holding focus is the button they pressed.
   */
  const openFocus = useCallback(() => {
    claimFocus(() => notesBoxRef.current?.querySelector('textarea'));
    enterFocus();
  }, [claimFocus, enterFocus]);

  /**
   * Leave focus mode, handing focus back to the control that reappears.
   *
   * The button that was just pressed is inside the focus bar, which this
   * unmounts. Without the handover a keyboard user is dropped on <body> and
   * starts again from the top of the document.
   */
  const closeFocus = useCallback(() => {
    claimFocus(() => focusToggleRef.current);
    exitFocus();
  }, [claimFocus, exitFocus]);

  /**
   * Android Back leaves focus mode before it leaves the entry.
   *
   * Nothing here knows it is on Android, and that is the point. `decideBack`
   * already ranks "something is on top — dismiss it" above navigating, and the
   * overlay registry is how a view says it is that something. Registering here
   * gets the behaviour for free and keeps every trace of platform identity out
   * of this file, which the platform boundary requires.
   *
   * (The policy test that enforces that boundary is a literal text search, and
   * it rightly caught the earlier wording of this very comment. Naming the
   * check you are satisfying is not worth weakening it to allow.)
   *
   * The registry holds one entry, which is sound here because the only other
   * claimant is the app menu — and the menu lives in the header, which focus
   * mode does not render. `EntryEditor.focus-back.test.tsx` holds that invariant rather
   * than leaving it as a comment.
   */
  useEffect(() => {
    if (!focused) return;
    registerOverlay(closeFocus);
    return () => registerOverlay(null);
  }, [focused, closeFocus]);

  // Send focus to the confirm button so a keyboard user is standing on the
  // decision rather than hunting for where the page changed.
  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
  }, [confirmingDelete]);

  // No dependency list on purpose: the element to focus appears on whichever
  // render follows the click, and the ref guard makes every other pass a single
  // null check.
  useEffect(() => {
    const resolve = focusIntent.current;
    if (!resolve) return;

    const target = resolve();
    const outcome = resolveFocusIntent({
      target,
      active: document.activeElement,
      body: document.body,
    });

    // `wait` is the whole point: the control asked for is not on the page yet,
    // so the request survives to the next commit instead of being spent on a
    // render that could never have honoured it.
    if (outcome === 'wait') return;

    focusIntent.current = null;
    if (outcome === 'focus') (target as HTMLElement).focus();
  });

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  /**
   * Put a previously saved detail into its field.
   *
   * Exactly `update`, and deliberately nothing more. It goes through the same
   * form state every keystroke goes through, so the crash-safe draft, the
   * dirty check, Save, search and the archive all see a value the reader
   * chose — indistinguishable from one they typed, because that is what it is.
   */
  const chooseDetail = (field: DetailField, value: string) => update(field, value);

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

  /*
   * Recomputed per keystroke, which is cheap: this is string matching over a
   * few thousand titles, and nothing is fetched or parsed. `segmentsForBook`
   * caches each book the first time it is asked.
   *
   * Held back until the divisions are actually here. Searching an empty set
   * would not report "still arriving", it would report "Nothing matched
   * “sermon on the mount”" — a confident wrong answer, which is worse than
   * a blank moment.
   */
  const passageResults = useMemo(
    () =>
      sections
        ? findPassages(passageQuery, {
            segmentsForBook: sections.segmentsForBook,
            segmentTitle: sections.segmentTitle,
            hasOutlineTitles,
          })
        : NO_PASSAGE_RESULTS,
    [passageQuery, sections],
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
    () => (sections && browseBook ? sections.segmentsForBook(browseBook) : []),
    [browseBook, sections],
  );

  /*
   * The chapters and verses a chosen book actually has.
   *
   * Derived from versification rather than validated after the fact, so an
   * impossible selection cannot be made in the first place: the verse list is
   * the chosen chapter's, and the end-verse list starts at the chosen verse.
   * A range that runs backwards, or a verse beyond the chapter, is not a state
   * these controls can reach — which is a better guarantee than an error
   * message, and the same one `referenceSpan` enforces on a typed reference.
   */
  // Not memoized by hand: at most 176 numbers, and the React Compiler keeps
  // what it can on its own. A useMemo here was one it could not preserve, which
  // costs the whole component its optimisation for an array that is cheaper to
  // build than to cache.
  const chapterCounts = browseBook ? (versification[browseBook] ?? []) : [];
  const verseCount = browseChapter ? (chapterCounts[Number(browseChapter) - 1] ?? 0) : 0;
  const verseOptions = Array.from({ length: verseCount }, (_, index) => index + 1);
  const endVerseOptions = browseVerse
    ? verseOptions.filter((verse) => verse >= Number(browseVerse))
    : [];

  /** Forget a selection the new book or chapter cannot hold. */
  const resetVerseChoice = () => {
    setBrowseChapter('');
    setBrowseVerse('');
    setBrowseVerseEnd('');
  };

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
    const label = anchorLabel(anchor, sections);
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

  /**
   * Attach a plain scripture range.
   *
   * No `outlineEntryId`, because a verse chosen by number is not a division
   * anybody named — and the stored shape is otherwise identical to what
   * `addPassage` writes, which is the point: one reference model, two ways of
   * arriving at it.
   *
   * The announcement is shared with `addPassage` for the same reason it exists
   * there. Focus is left to the caller: the two ways in have different controls
   * to hand it back to.
   */
  const addScriptureRef = (ref: ScriptureRef) => {
    const anchor: EntryAnchor = { kind: 'scripture', ...ref };
    const label = anchorLabel(anchor, sections);
    const already = form?.anchors.some((existing) => anchorKey(existing) === anchorKey(anchor));

    addAnchor(anchor);
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

    // This is the exact version licensed by this press of Save. A later edit
    // must never be folded into it accidentally or deleted as though it were.
    const submittedForm = form;

    const links: EntryLink[] = submittedForm.links
      .filter(linkHasContent)
      .map((link) => ({
        url: link.url.trim(),
        label: link.label.trim() || undefined,
        capturedTitle: link.capturedTitle.trim() || undefined,
        capturedAt: link.capturedTitle.trim() ? link.capturedAt : undefined,
      }));

    const patch: Partial<Entry> = {
      kind: submittedForm.kind,
      title: submittedForm.title.trim(),
      date: submittedForm.date || todayIso(),
      place: submittedForm.place.trim() || undefined,
      speaker: submittedForm.speaker.trim() || undefined,
      sermonSeries: submittedForm.sermonSeries.trim() || undefined,
      notes: submittedForm.notes,
      reflection: submittedForm.reflection,
      prayer: submittedForm.prayer.trim() || undefined,
      tags: parseTags(submittedForm.tagsText),
      links,
      anchors: submittedForm.anchors,
      forDescendants: submittedForm.forDescendants,
      scriptureRefs: submittedForm.scriptureRefs,
      // Somebody else's words, written down as somebody else's. `notes` above
      // carries the reader's and is untouched by any of this.
      sourceMaterial: submittedForm.sourceMaterial ?? undefined,
    };

    // Set the instant the canonical transaction succeeds. Work after that
    // point is recovery-draft bookkeeping; if it fails, telling somebody the
    // entry itself was not saved would invite a second create and a duplicate.
    let canonicalSaved: Entry | null = null;

    try {
      // Flush before the canonical write, so Save cannot race the settle
      // window and commit against text the reader can no longer see.
      const savingWriter = getAutosaver();
      await savingWriter.flush().catch(() => {
        // A draft that would not write does not stop an explicit save: the
        // canonical write below is the one that matters, and it reports its own
        // failure. Swallowing here only means the draft is stale, and the next
        // line is about to make it irrelevant.
      });

      const saved = targetId
        ? await storage.updateEntry(targetId, patch)
        : await storage.createEntry(patch);
      canonicalSaved = saved;

      // Fence the writer used by this save. Anything it already started is
      // allowed to finish before the draft is changed or removed; anything
      // still queued is represented by `latestForm` and is handled below.
      savingWriter.retire();
      await savingWriter.settled();
      // Retiring is permanent for that writer, which is the point of the fence.
      // Editing does not stop when a save happens, though: dropping the
      // reference means the next keystroke builds a fresh writer and a fresh
      // draft, so work done after a save is protected exactly as before it.
      autosaver.current = null;
      const finishedDraft = draftId.current;
      draftEntryId.current = saved.id;

      const savedForm = formFromEntry(saved);
      let newest = latestForm.current ?? submittedForm;
      const changedDuringSave = !draftFormsEqual(newest, submittedForm);

      if (changedDuringSave) {
        // Reuse the same recovery identity where possible. While the durable
        // write is in progress, keep checking the rendered form: a person can
        // continue typing during a slow native transaction, and the last
        // accepted version—not merely the first late version—must win.
        const id = finishedDraft ?? newId();
        const createdAt = draftCreatedAt.current ?? new Date().toISOString();
        draftId.current = id;
        draftCreatedAt.current = createdAt;
        setHasDraft(true);
        setDraftRestored(false);

        for (;;) {
          const candidate = newest;
          const now = new Date().toISOString();
          await storage.putDraft({
            id,
            entryId: saved.id,
            form: candidate,
            createdAt,
            updatedAt: now,
          });
          // Let any already-dispatched React change commit before deciding the
          // snapshot is current.
          await Promise.resolve();
          newest = latestForm.current ?? candidate;
          if (draftFormsEqual(newest, candidate)) break;
        }
      } else {
        draftId.current = null;
        draftCreatedAt.current = null;
        setHasDraft(false);
        setDraftRestored(false);
        if (finishedDraft) {
          await storage.deleteDraft(finishedDraft).catch(() => {
            // A redundant draft is safer than deleting writing after a save.
            // It will be recognised as identical and retired on next open.
          });
        }
        // Reflect the canonical normalization (trimmed metadata, empty link
        // rows removed) only when no later edit would be overwritten by it.
        setForm(savedForm);
      }

      // The journal now holds what the screen holds, so "unchanged" means this
      // from here on. Taken from the saved entry rather than from `form`,
      // because a save trims and drops empty rows: the baseline has to be what
      // reopening this entry would actually show.
      canonicalForm.current = savedForm;
      // Claimed before anything else, so a second submit lands on an update.
      setCreatedId(saved.id);
      touch();
      // The route switch renders this same component for "new entry" and for an
      // existing entry, so saving a new note does NOT unmount this instance —
      // it just changes the props. Anything left set here would still be set in
      // the edit view that follows, which is why `saving` is cleared explicitly
      // rather than left to a remount that never comes.
      setSaving(false);
      // Published above the routed view rather than held here. Saving a new
      // entry navigates to `#/entry/<id>`, which changes this component's key
      // and remounts it — any confirmation kept in local state is destroyed in
      // the same tick it is set. `notice.tsx` explains the rest.
      showNotice(changedDuringSave ? 'Saved. Newer changes were kept as a draft.' : 'Saved');
      // The live region has to sit in the DOM for a beat before this view
      // unmounts, or the announcement is never picked up.
      //
      // Deferred through the router rather than by a bare frame, so it stands
      // down if the reader has gone somewhere else in the meantime. Saving an
      // entry that already exists navigates to the address already showing,
      // which makes this frame invisible — and an invisible frame that fires
      // late took the reader back off the page they had just opened.
      navigateNextFrame({ name: 'entry', id: saved.id });
    } catch (cause) {
      setSaving(false);
      if (canonicalSaved) {
        const savedForm = formFromEntry(canonicalSaved);
        canonicalForm.current = savedForm;
        draftEntryId.current = canonicalSaved.id;
        setCreatedId(canonicalSaved.id);
        touch();

        // The submitted version is safe, but a later edit accepted while that
        // write was in flight is not. Keep it on screen, keep the navigation
        // here, and restart the ordered writer so a transient failure can heal
        // without requiring another keystroke.
        const newest = latestForm.current;
        if (newest && !draftFormsEqual(newest, savedForm)) {
          if (!draftId.current) draftId.current = newId();
          draftCreatedAt.current ??= new Date().toISOString();
          setHasDraft(true);
          setNotYetDurable(true);
          setDraftTrouble(true);
          getAutosaver().queue(newest);
        }

        setSaveError(
          cause instanceof Error
            ? `The version you submitted was saved, but newer changes could not yet be added to the recovery draft: ${cause.message} Keep this page open and press Save again.`
            : 'The version you submitted was saved, but newer changes could not yet be added to the recovery draft. Keep this page open and press Save again.',
        );
        return;
      }
      setSaveError(
        cause instanceof Error
          ? `Your entry could not be saved: ${cause.message}`
          : 'Your entry could not be saved.',
      );
    }
  }

  /**
   * Throw the unfinished work away, on purpose.
   *
   * Emptying the boxes and waiting is not a way to discard something — it
   * leaves a draft that says nothing and still offers to be continued. This is
   * the deliberate act, and it is confirmed because it destroys writing.
   */
  async function handleDiscardDraft() {
    setConfirmingDiscard(false);
    setSaveError('');
    // The exact version the confirmation applies to. Inputs remain usable
    // while storage responds, so anything accepted after this point is a new
    // generation and is not covered by the earlier decision to discard.
    const confirmedForm = latestForm.current;
    /*
     * The same retirement every other path uses, rather than a second one.
     *
     * This used to fence the writer and delete in the next breath, which
     * leaves a write already awaiting storage free to land afterwards and put
     * the discarded draft back — the reader having been told, on screen, that
     * it was thrown away. `retireDraft` waits for that write. Two
     * implementations of one ordering is how the weaker of them survives:
     * there is now only the one.
     */
    try {
      await retireDraft({ requireDeletion: true });
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? `This draft could not be discarded: ${cause.message} Your writing is still here.`
          : 'This draft could not be discarded. Your writing is still here.',
      );
      return;
    }

    const newest = latestForm.current;
    if (confirmedForm && newest && !draftFormsEqual(confirmedForm, newest)) {
      if (!draftId.current) draftId.current = newId();
      draftCreatedAt.current ??= new Date().toISOString();
      setHasDraft(true);
      setNotYetDurable(true);
      const writer = getAutosaver();
      writer.queue(newest);
      try {
        await writer.flush();
        setMessage('The earlier draft was discarded. Newer changes were kept as a draft.');
      } catch (cause) {
        setDraftTrouble(true);
        setSaveError(
          cause instanceof Error
            ? `The earlier draft was discarded, but newer changes could not yet be saved: ${cause.message}`
            : 'The earlier draft was discarded, but newer changes could not yet be saved.',
        );
      }
      return;
    }

    if (entryId) {
      // Back to the entry as the journal has it. The saved copy was never
      // touched by the draft, so this is a real return rather than a guess.
      const saved = canonicalForm.current;
      if (saved) setForm(saved);
      return;
    }
    recoverOnUnmount.current = false;
    navigate({ name: 'timeline' });
  }

  async function handleDelete() {
    if (!entryId || deleting || saving) return;
    setDeleting(true);
    try {
      await storage.deleteEntry(entryId);
      touch();
      // Same reason as the save above: this navigates, so anything said from
      // here would be gone before it could be read. Deleting something and
      // being told nothing at all is its own small cruelty.
      showNotice('Entry deleted');
      // The reader may have used global navigation while the provider was
      // working. Deleting the entry they confirmed is still correct; dragging
      // a different editor back to the timeline when it completes is not.
      if (currentEntryId.current !== entryId) {
        setDeleting(false);
        return;
      }
      recoverOnUnmount.current = false;
      navigate({ name: 'timeline' });
    } catch (cause) {
      setDeleting(false);
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

  if (loadError) {
    return (
      <>
        <h1 className="font-serif text-2xl font-semibold">{heading}</h1>
        <p
          role="alert"
          className="mt-6 rounded-card border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
        >
          {loadError} Nothing was changed. Try opening it again.
        </p>
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

  const kindLabels = KINDS.map((kind) => (
    <option key={kind.value} value={kind.value}>
      {kind.label}
    </option>
  ));

  return (
    <>
      {/* The heading stays in focus mode and stops being seen.
          It is the view's only h1 and the target the shell moves focus to after
          navigation, so removing it would break both the document outline and
          the route announcement. `sr-only` keeps every bit of that and gives
          the writing surface the hundred pixels it was spending on a title the
          reader can already see they are on. */}
      {focused ? (
        <h1 className="sr-only">{heading}</h1>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold">{heading}</h1>
            <p className="measure mt-1 text-sm text-ink-soft">
              Write the notes now. Everything else can wait, or stay empty.
            </p>
          </div>
          {/* Not the Fullscreen API, deliberately. This hides the application's
              own chrome and nothing else: no permission prompt, no system
              gesture to learn, no platform call, and it works identically in a
              browser tab and in the installed app. */}
          <Button ref={focusToggleRef} onClick={openFocus} className="shrink-0">
            <ExpandIcon className="h-5 w-5" />
            Focus
          </Button>
        </div>
      )}

      <LiveRegion message={message} />

      {storageError ? (
        <p
          role="alert"
          className="mt-4 rounded-control border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {storageError}
        </p>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className={focused ? 'measure mx-auto' : 'mt-6'}
      >
        <fieldset disabled={deleting} className="m-0 min-w-0 space-y-6 border-0 p-0">
        {/* The only chrome in focus mode: the way out, what this entry is, and
            Save. Inside the form on purpose — a submit button outside its form
            needs the `form` attribute, and this way the button is simply a
            submit button, which is the version that cannot go wrong.

            `safe-top` on the outer element and the padding on the inner one,
            because `.safe-top` sets `padding-top` outright and a `py-*` class
            on the same element would beat it. */}
        {focused ? (
          <div className="safe-top sticky top-0 z-30 -mx-5 border-b border-line bg-app px-5">
            {/*
              One line when one line fits, two when it does not.

              THE BREAKPOINT IS MEASURED, NOT CHOSEN. Every part of this bar is
              sized in rem — the icon, the paddings, the text — so what it needs
              is a constant number of rem whatever the reader's text size is.
              Measured in the browser: the way out is 2.6rem, the widest kind
              ("Bible reading") needs 7.7rem to show in full, Save is 4.7rem
              while it says "Saving…", two 0.5rem gaps and the page's 2.5rem of
              side padding. That is 18.5rem, so the switch is at 19rem with the
              half-rem of slack left over for font metrics that will not be
              Chromium's on a phone.

              Being in rem is the whole point. A reader at 200% text on a 320px
              phone is at 10rem, which is below the threshold for the same
              reason a 280px window is: the content genuinely does not fit. One
              rule covers narrow screens and large text, because to this bar
              they are the same problem.

              Below it the kind takes a line of its own at full width, which is
              the only arrangement where its value can still be read: at 320px
              and 200% text, "Bible reading" needs 6.6rem of a 7.5rem line, and
              there is no sharing that.

              `order-last` rather than a grid: it moves the kind below the two
              actions visually and leaves the DOM alone, so a keyboard still
              goes out, kind, save — a sequence that reads the same as the
              sentence it describes.
            */}
            <div className="flex flex-wrap items-center gap-2 py-2">
              <Button
                variant="ghost"
                size="compact"
                onClick={closeFocus}
                aria-label="Leave focus mode"
                title="Leave focus mode"
                className="shrink-0"
              >
                <CollapseIcon />
              </Button>
              {/* A real <label>, hidden. The select shows the current kind, so
                  a sighted reader needs no second copy of the word; the a11y
                  suite rightly refuses aria-label as a substitute for one. */}
              <label htmlFor={focusKindId} className="sr-only">
                Kind
              </label>
              <select
                id={focusKindId}
                value={form.kind}
                onChange={(event) => update('kind', event.target.value as EntryKind)}
                className={`${CONTROL_COMPACT} ${FOCUS} order-last basis-full min-[19rem]:order-none min-[19rem]:w-auto min-[19rem]:flex-1 min-[19rem]:basis-0`}
              >
                {kindLabels}
              </select>
              <Button
                type="submit"
                variant="primary"
                size="compact"
                disabled={!canSave}
                aria-describedby={canSave ? undefined : reasonId}
                className="ml-auto shrink-0"
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Both fields subgrid onto these row tracks, so the two controls sit on
            one baseline even though only Title carries helper text. */}
        {/* Kind moves into the focus bar rather than being duplicated there:
            one control for one value, wherever it is rendered. Title stays put.
            It is optional, but it is also the first thing a reader types for a
            sermon, and burying it behind a disclosure to win 96 pixels would
            trade the wrong thing away. */}
        <FieldRow>
          {focused ? null : (
            <Select
              label="Kind"
              hint="You can change this later."
              value={form.kind}
              onChange={(event) => update('kind', event.target.value as EntryKind)}
            >
              {kindLabels}
            </Select>
          )}
          <Field
            label="Title"
            /* The helper goes in focus mode and the label does not. Two wrapped
               lines of "Optional. Left blank, the entry is filed by its date."
               is 36px of the writing surface spent telling somebody who has
               just asked for fewer words that a field is optional. */
            hint={focused ? undefined : 'Optional. Left blank, the entry is filed by its date.'}
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
          />
        </FieldRow>

        {/*
          Somebody else's words, before the reader's and never among them.

          The heading says "Provided notes", the line under it says who
          provided them, and the text is rendered rather than put in a box the
          reader can type into. That last part is the point: the moment a
          church's outline is editable in the same way as Notes, it stops being
          a quotation and starts being indistinguishable from the journal. The
          only thing that can be done to it is to take it away.
        */}
        {form.sourceMaterial ? (
          <section aria-labelledby={providedId} className="rounded-card border border-line-strong bg-raised p-4">
            <h2 id={providedId} className={SECTION_HEADING}>
              Provided notes
            </h2>
            <p className="mt-1 break-words text-sm text-ink-soft">
              {describeProvenance(form.sourceMaterial)}
              {form.sourceMaterial.speaker ? ` · ${form.sourceMaterial.speaker}` : ''}
              {form.sourceMaterial.date ? ` · ${formatDay(form.sourceMaterial.date)}` : ''}
              {` · Imported from ${form.sourceMaterial.filename}`}
            </p>
            {/*
              `ink-soft`, not `ink-muted`. This sits on a RAISED panel, where
              muted is 4.48:1 against #24282e at 12px — a hair under AA. It
              passes at 5.06:1 on the ordinary background, which is why it went
              unnoticed: the a11y sweep never renders this line, because its
              fixtures have no provided notes to describe.
            */}
            <p className="mt-0.5 text-xs text-ink-soft">Not your own writing.</p>

            <div className="measure mt-3 text-sm leading-relaxed text-ink">
              <Markdown source={form.sourceMaterial.body} />
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {confirmingRemoveProvided ? (
                <>
                  <Button
                    variant="danger"
                    onClick={() => {
                      update('sourceMaterial', null);
                      setConfirmingRemoveProvided(false);
                      setMessage('Provided notes removed. Your own writing is untouched.');
                    }}
                  >
                    Yes, remove them
                  </Button>
                  <Button onClick={() => setConfirmingRemoveProvided(false)}>Keep them</Button>
                </>
              ) : (
                <Button onClick={() => setConfirmingRemoveProvided(true)}>
                  Remove provided notes
                </Button>
              )}
              {!importingNotes ? (
                <Button onClick={() => setImportingNotes(true)}>Import different notes</Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* The way in. Restrained on purpose: most entries are typed from
            nothing, and a large permanent control for a file most people will
            never have would be the loudest thing on a blank form. */}
        {importingNotes || shared ? (
          <SermonNotesImport
            replacing={form.sourceMaterial !== null}
            incoming={shared}
            // The panel is framed the way the way in was. Pressing a neutral
            // "Import notes…" on a prayer and being told this is about notes
            // your church handed out would undo the point of the neutral label.
            church={form.kind === 'sermon'}
            onCancel={() => {
              setImportingNotes(false);
              // Cancelling a shared document discards the candidate and frees
              // the slot. Nothing was written, so there is nothing to undo.
              setShared(null);
              releaseIncomingDocument();
            }}
            onUse={(proposal) => {
              setImportingNotes(false);
              setShared(null);
              releaseIncomingDocument();
              setForm((current) => {
                if (!current) return current;
                const next: FormState = { ...current, sourceMaterial: proposal.material };
                // Metadata may seed the entry's own fields, and only where the
                // reader has not already put something there. Prose never
                // does: `notes`, `reflection` and `prayer` are not touched by
                // an import at all, on any path through this function.
                const { title, date, speaker, scripture } = proposal.suggested;
                if (title && !current.title.trim()) next.title = title;
                if (date) next.date = date;
                if (speaker && !current.speaker.trim()) next.speaker = speaker;
                if (scripture?.length && current.scriptureRefs.length === 0) {
                  next.scriptureRefs = scripture;
                }
                return next;
              });
              setMessage(
                'Provided notes added. Your notes, reflection and prayer are still yours to write.',
              );
            }}
          />
        ) : !form.sourceMaterial ? (
          /*
            Prominent for a sermon, quiet everywhere else.

            A sermon is the entry kind somebody arrives at holding a handout, so
            the way in is a real button with a line saying what it takes. A
            prayer is not: offering "Import church notes" above an empty prayer
            is the app guessing wrong about what somebody came to do, in the
            largest control on the screen.

            It is not taken away, though. The unusual case is real, and a person
            who does have a file for a reading or a reflection should not have to
            change the kind of their entry to reach it. It becomes one quiet
            line, neutrally worded, because on those kinds the material may have
            nothing to do with a church.
          */
          form.kind === 'sermon' ? (
            <div>
              <Button onClick={() => setImportingNotes(true)}>Import church notes</Button>
              <p className="measure mt-1 text-xs text-ink-muted">
                A file your church handed out. It is kept separately from your own writing.
              </p>
            </div>
          ) : (
            <div>
              <Button variant="ghost" size="compact" onClick={() => setImportingNotes(true)}>
                Import notes&hellip;
              </Button>
            </div>
          )
        ) : null}

        {form.sourceMaterial ? (
          <h2 className={SECTION_HEADING}>Your own writing</h2>
        ) : null}

        {/* Rule 4: what was taught and what it meant to me stay separate fields.
            The separation is carried by the labels and their helper text, which
            say what each is for — an outer "Notes" heading above a field already
            labelled "Notes" said the same thing twice and bought nothing, and
            wrapping a bordered textarea in a bordered card was a box in a box. */}
        <div ref={notesBoxRef}>
          <MarkdownEditor
            label="Notes"
            hint="What was taught"
            // The point of the mode: the space the header, the footer, the page
            // heading and the kind field gave up goes to the box being typed in.
            rows={focused ? 16 : 8}
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
            rows={focused ? 8 : 5}
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
                    const label = anchorLabel(anchor, sections);
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

                {/* Two radios rather than a segmented control or a pair of
                    tabs. The choice has to be announced as a choice, the
                    selected one must not be told apart by colour alone, and a
                    native radio gives arrow-key movement and a real checked
                    state for free — all of which a styled div would have to
                    reimplement and would get subtly wrong on a screen reader.
                    The label text is the whole target, so it is comfortably
                    past 44px without a minimum height anywhere. */}
                <div role="radiogroup" aria-label="What to add" className="mt-2 flex flex-wrap gap-4">
                  {([
                    ['passage', 'A passage'],
                    ['verse', 'A verse'],
                  ] as const).map(([value, label]) => (
                    <label
                      key={value}
                      htmlFor={`${browseModeName}-${value}`}
                      className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink"
                    >
                      <input
                        id={`${browseModeName}-${value}`}
                        type="radio"
                        name={browseModeName}
                        value={value}
                        checked={browseMode === value}
                        onChange={() => {
                          setBrowseMode(value);
                          // Neither half's selection means anything in the
                          // other, and a stale one would be added by a button
                          // the reader thinks is describing what they can see.
                          setBrowseSegmentId('');
                          resetVerseChoice();
                        }}
                        className="size-4 accent-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                      />
                      {label}
                    </label>
                  ))}
                </div>

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
                        // Same for a chapter and verse: Psalm 119 has 176
                        // verses and Jude has 25, so a number carried across
                        // books is how an impossible reference gets saved.
                        resetVerseChoice();
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

                  {browseMode === 'passage' ? (
                    <>
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
                            const title = sections ? sections.segmentTitle(segment) : segment.ref;
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
                          if (!sections) return;
                          addPassage(toPassageMatch(segment, browseBook, sections.segmentTitle));
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
                    </>
                  ) : (
                    <>
                      {/* Three short selects rather than one long list. A book
                          is at most 150 chapters and a chapter at most 176
                          verses, and both are numbers a reader already knows —
                          the native control is the compact layout here, and on
                          a phone it opens the platform's own picker. */}
                      <div className="min-w-0 basis-28">
                        <label htmlFor={chapterPickerId} className={LABEL_CLASS}>
                          Chapter
                        </label>
                        <select
                          id={chapterPickerId}
                          value={browseChapter}
                          disabled={!browseBook}
                          onChange={(event) => {
                            setBrowseChapter(event.target.value);
                            // Verse 40 exists in John 3 and not in John 2.
                            setBrowseVerse('');
                            setBrowseVerseEnd('');
                          }}
                          className={CONTROL_CLASS}
                        >
                          <option value="">{browseBook ? '—' : 'Book first'}</option>
                          {chapterCounts.map((_, index) => (
                            <option key={index + 1} value={String(index + 1)}>
                              {index + 1}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0 basis-28">
                        <label htmlFor={versePickerId} className={LABEL_CLASS}>
                          Verse
                        </label>
                        <select
                          id={versePickerId}
                          ref={versePickerRef}
                          value={browseVerse}
                          disabled={!browseChapter}
                          onChange={(event) => {
                            setBrowseVerse(event.target.value);
                            // The end list begins at the new start, so a stale
                            // end that now precedes it must go rather than be
                            // silently reinterpreted.
                            setBrowseVerseEnd('');
                          }}
                          className={CONTROL_CLASS}
                        >
                          <option value="">{browseChapter ? '—' : 'Chapter first'}</option>
                          {verseOptions.map((verse) => (
                            <option key={verse} value={String(verse)}>
                              {verse}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0 basis-32">
                        <label htmlFor={verseEndPickerId} className={LABEL_CLASS}>
                          To verse
                        </label>
                        <select
                          id={verseEndPickerId}
                          value={browseVerseEnd}
                          disabled={!browseVerse}
                          onChange={(event) => setBrowseVerseEnd(event.target.value)}
                          className={CONTROL_CLASS}
                        >
                          {/* Optional, and named as what it does rather than
                              left blank: one verse is the ordinary case. */}
                          <option value="">
                            {browseVerse ? 'Just this verse' : 'Verse first'}
                          </option>
                          {endVerseOptions.map((verse) => (
                            <option key={verse} value={String(verse)}>
                              {verse}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button
                        disabled={!browseVerse}
                        onClick={() => {
                          const chapter = Number(browseChapter);
                          const from = Number(browseVerse);
                          const to = browseVerseEnd ? Number(browseVerseEnd) : from;
                          // One ScriptureRef, exactly as a passage produces:
                          // start and end, equal when it is a single verse.
                          // Nothing downstream is told which control made it.
                          addScriptureRef({
                            book: browseBook,
                            chapterStart: chapter,
                            verseStart: from,
                            chapterEnd: chapter,
                            verseEnd: to,
                          });
                          // The book and chapter stay: a reader adding John
                          // 3:16 is more likely to want 3:17 next than to move
                          // to Habakkuk.
                          setBrowseVerse('');
                          setBrowseVerseEnd('');
                          versePickerRef.current?.focus();
                        }}
                      >
                        Add verse
                      </Button>
                    </>
                  )}
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
                  below={
                    <RecentDetailChips
                      field="place"
                      spoken="place"
                      values={saved.place}
                      onChoose={chooseDetail}
                    />
                  }
                />
                <Field
                  label="Speaker"
                  value={form.speaker}
                  onChange={(event) => update('speaker', event.target.value)}
                  below={
                    <RecentDetailChips
                      field="speaker"
                      spoken="speaker"
                      values={saved.speaker}
                      onChoose={chooseDetail}
                    />
                  }
                />
                <Field
                  label="Series"
                  value={form.sermonSeries}
                  onChange={(event) => update('sermonSeries', event.target.value)}
                  below={
                    <RecentDetailChips
                      field="sermonSeries"
                      spoken="series"
                      values={saved.sermonSeries}
                      onChoose={chooseDetail}
                    />
                  }
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
                              // Synchronous on purpose: the button is already
                              // on the page, and moving focus before React
                              // detaches this row means focus never touches
                              // <body> at all. Registered as an intent too, so
                              // the default claim stands down and the
                              // destination is re-asserted if a later commit
                              // disturbs it.
                              addLinkRef.current?.focus();
                              claimFocus(() => addLinkRef.current);
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
                    claimFocus(() =>
                      linksListRef.current?.querySelector<HTMLInputElement>(
                        'li:last-child input[type="url"]',
                      ),
                    );
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
                    const added = anchorLabel({ kind: 'topic', topicId: topicChoice }, sections);
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

        {/*
          Said once, when work is brought back, and then it goes away on the
          next change. Deliberately NOT announced on every settle cycle: a
          screen reader repeating "draft saved" every few hundred milliseconds
          would make the editor unusable, which is why ordinary autosave is
          silent and only the meaningful events speak.
        */}
        {draftRestored ? (
          <p
            role="status"
            className="rounded-control border border-line bg-raised px-3 py-2 text-sm text-ink-soft"
          >
            Your recent changes were restored.
          </p>
        ) : null}

        {/*
          Only after persistence has failed repeatedly. One failed write is
          usually nothing; a run of them means the writing is not being kept,
          and staying quiet about that would be the same lie as claiming a
          backup exists.
        */}
        {draftTrouble ? (
          <p
            role="alert"
            className="rounded-control border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-100"
          >
            Your writing is on the screen but is not being saved to this device.
            Use <strong>Save</strong> to keep it, and export a copy if this continues.
          </p>
        ) : null}

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
          {/* One Save, wherever it is. In focus mode it is in the bar, which is
              on screen the whole time, and a second one at the foot of the form
              would be two controls with one name — ambiguous to announce, and
              ambiguous to write a test against, which is how it was found. */}
          {focused ? null : (
            /* Not disabled while saving: disabling the button under a keyboard
               user's own finger throws focus to <body>, and saving an edit does
               not change the route, so nothing hands it back. handleSubmit
               already refuses a second submit while one is in flight, and a
               repeat save updates what the first one wrote rather than
               duplicating it. */
            <Button
              type="submit"
              variant="primary"
              disabled={!canSave}
              aria-describedby={canSave ? undefined : reasonId}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
          {/* The entry route IS this editor, so there is no "back to the
              entry" to offer — the way out of both modes is the timeline. */}
          <Link
            to={{ name: 'timeline' }}
            className="inline-flex min-h-11 items-center rounded-control px-4 py-2 text-sm font-medium text-ink-soft underline hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {entryId ? 'Back to my journey' : 'Cancel'}
          </Link>

          {/*
            Only offered when there is unfinished work to throw away. Leaving
            the editor keeps the draft, so this is the deliberate act of
            deciding not to keep it.
          */}
          {hasDraft && !focused ? (
            confirmingDiscard ? (
              <span className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink-soft">Throw this draft away?</span>
                <Button variant="danger" onClick={() => void handleDiscardDraft()}>
                  Yes, discard it
                </Button>
                <Button
                  onClick={() => {
                    claimFocus(() => discardRef.current);
                    setConfirmingDiscard(false);
                  }}
                >
                  Keep writing
                </Button>
              </span>
            ) : (
              <Button ref={discardRef} onClick={() => setConfirmingDiscard(true)}>
                Discard draft
              </Button>
            )
          ) : null}
        </div>
        </fieldset>
      </form>

      {entryId ? (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className={SECTION_HEADING}>Share</h2>
          {sharing ? (
            <ShareEntry entry={sharing} onClose={() => setSharing(null)} />
          ) : (
            <div className="mt-2">
              <p className="measure text-sm text-ink-soft">
                Send this one entry to somebody — a message, an email, a file. Your journal
                stays here.
              </p>
              {/*
                Offered only when there is nothing unsaved.
                A draft means the version on screen is newer than the version
                that exists. Sharing the saved one silently would send somebody
                an older page than the reader is looking at; sharing the draft
                would send something they have not committed to. Neither is a
                choice this should make on their behalf, so it asks.
              */}
              {hasDraft ? (
                <p className="mt-2 text-sm text-ink-soft">
                  Save your changes first — sharing sends the saved version of this entry.
                </p>
              ) : null}
              {shareProblem ? (
                <p role="alert" className="mt-2 text-sm text-ink-soft">
                  {shareProblem}
                </p>
              ) : null}
              <div className="mt-2">
                <Button
                  disabled={hasDraft}
                  onClick={() => {
                    setShareProblem('');
                    void storage
                      .getEntry(entryId)
                      .then((found) => {
                        if (found) setSharing(found);
                        else setShareProblem('This entry could not be read just now.');
                      })
                      .catch(() => setShareProblem('This entry could not be read just now.'));
                  }}
                >
                  Share this entry
                </Button>
              </div>
            </div>
          )}

          <h2 className={`${SECTION_HEADING} mt-10`}>
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
                <Button
                  ref={confirmRef}
                  variant="danger"
                  disabled={deleting || saving}
                  onClick={handleDelete}
                >
                  {deleting ? 'Deleting…' : 'Yes, delete it'}
                </Button>
                <Button
                  disabled={deleting}
                  onClick={() => {
                    // Backing out unmounts this button; hand focus to the one
                    // that takes its place rather than letting it drop.
                    claimFocus(() => deleteRef.current);
                    setConfirmingDelete(false);
                  }}
                >
                  Keep this entry
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <Button
                ref={deleteRef}
                variant="danger"
                disabled={saving || deleting}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete this entry
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
