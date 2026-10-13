/**
 * Export and import: the page the whole product leans on.
 *
 * Two obligations shape it. First, the warning goes at the top, in full size,
 * before anything else — browser storage really does disappear (a cleared
 * cache, a dead laptop, a private window closed), and a person who loses a
 * decade of writing was not helped by a footnote. Second, export is two taps:
 * open this page, press the button. Anything that makes the safe action slower
 * than the unsafe one is a design failure.
 *
 * Import is the mirror image, and it is deliberately slower. It can overwrite a
 * lifetime of writing, so nothing is ever written on file-select alone: the
 * file is parsed, the consequences are rendered, and only an explicit press
 * applies them.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  DATA_PROFILE,
  topics,
  topicsById,
  versification,
} from '../app/data';
import { useSections, type Sections } from '../app/sections';
import { Link } from '../app/router';
import { useStorage, useStorageQuery } from '../app/storage';
import type { JournalSnapshot } from '../storage/StorageProvider';
import { useFilePicker, useFileSaver } from '../platform/context';
import { pickFailureMessage, type PickedFile } from '../platform/ports';
import { pickedFromDomFile } from '../platform/web';
import { MAX_JOURNAL_FILE_BYTES } from '../lib/journal-limits';
import { Button, Card, Field, FieldRow, LiveRegion, Spinner } from '../components/ui';
import { shouldAbandonRestore, shouldRestoreFocus } from '../lib/focus-restore';
import { Attribution } from '../components/Attribution';
import { KIND_LABELS } from '../export/context';
import { exportEverything } from '../export/download';
import { ProtectedTransferPasswordRequired } from '../export/protected-transfer';
import {
  ArchiveIntegrityError,
  applyImport,
  parseImport,
  previewImport,
  type ParsedImport,
} from '../export/importer';
import { segmentRef } from '../lib/passages';
import type {
  Entry,
  EntryKind,
  ExportFilter,
  ImportMode,
  ImportPreview,
  ScriptureRef,
} from '../types';

const KINDS = Object.keys(KIND_LABELS) as EntryKind[];

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const messageOf = (cause: unknown, fallback: string): string =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/**
 * An outline id, resolved to the scripture range it names.
 *
 * Old journals stored anchors as bare outline ids. Under `refs-only` there is no
 * outline layer to resolve against at all — the profile ships no outline data,
 * not merely no titles — so this returns undefined there, and the migration
 * preserves the raw id in `_unmigrated` with a warning rather than inventing a
 * reference for it. The entry still imports in full, and the warning is shown in
 * the preview before anything is written.
 */
function resolveOutlineId(id: string, sections: Sections): ScriptureRef | undefined {
  const entry = sections.outlineEntriesById.get(id);
  if (!entry) return undefined;
  const segment = sections.findSegment(entry.book, id);
  return segment ? segmentRef(segment, entry.book) : undefined;
}

/** Will every anchor on this entry still mean something in this build? */
function anchorsResolve(entry: Entry): boolean {
  return entry.anchors.every((anchor) =>
    anchor.kind === 'topic' ? topicsById.has(anchor.topicId) : Boolean(versification[anchor.book]),
  );
}

/**
 * "Last exported 12 days ago", in words rather than a timestamp.
 *
 * A raw ISO date makes the reader do arithmetic to answer the only question
 * that matters: is my journal backed up or not?
 */
function lastExportedWords(iso: string | undefined, now: Date): string {
  if (!iso) return 'Never exported. There is no copy of your own yet.';

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Last exported: the date on record cannot be read.';

  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Last exported today.';
  if (days === 1) return 'Last exported yesterday.';
  if (days < 30) return `Last exported ${days} days ago.`;

  const months = Math.max(1, Math.round(days / 30));
  return `Last exported ${days} days ago — ${months === 1 ? 'about a month' : `about ${months} months`}. Worth doing again now.`;
}

/**
 * Debug-only tooling. The import sits behind the build-time constant rather
 * than only the render, because a statically imported module survives
 * tree-shaking: the first attempt rendered nothing in a release build and
 * still shipped the component's code. With the import guarded, a release build
 * drops the module from the graph entirely.
 */
const SyntheticCleanup = __DEBUG_TOOLS__
  ? lazy(async () => ({
      default: (await import('../debug/SyntheticCleanup')).SyntheticCleanup,
    }))
  : null;

export default function DataView() {
  // The archive carries division ids, and an import resolves them, so this
  // surface genuinely needs the whole dataset before it can act.
  const sections = useSections();
  const { storage, settings, updateSettings, touch, error: storageError } = useStorage();
  const files = useFileSaver();
  const picker = useFilePicker();

  const { data: entryCount, loading: counting } = useStorageQuery(
    async (provider) => (await provider.listEntries()).length,
    [],
    0,
  );

  // A broken database is not a reason to offer an export that cannot read it,
  // or an import that cannot write. The message below says so; these enforce it.
  const blocked = Boolean(storageError);

  /**
   * Put focus back after a control disappears or goes disabled under the user.
   *
   * Pressing "Export everything" disables the button that has focus, and
   * confirming an import unmounts it entirely; either way focus drops and a
   * keyboard user restarts from the top of the page. The effect runs after
   * every render and hands focus back once the target is interactive again —
   * and drops the request silently if the user has already moved somewhere
   * else, so focus is never stolen.
   *
   * "Somewhere else" has to mean a real, still-connected element. An earlier
   * version abandoned the request whenever activeElement was not <body>, which
   * looked equivalent and was not: between a control unmounting and the browser
   * resetting focus, activeElement is briefly the DETACHED node. Treating that
   * as a deliberate move cancelled the restore and left focus on nothing at
   * all. It survived locally and failed in CI, which is exactly the kind of
   * timing a keyboard user would meet on a slow machine.
   */
  // The target, plus the element focus is expected to leave. Without the
  // second, an effect that runs before React detaches the outgoing control sees
  // it still connected, reads that as a deliberate move, and cancels the
  // restore — which failed about one run in twenty.
  const refocus = useRef<{ target: HTMLElement; from: Element | null } | null>(null);
  useEffect(() => {
    const queued = refocus.current;
    if (!queued) return;

    const state = {
      active: document.activeElement,
      target: queued.target,
      from: queued.from,
      body: document.body,
    };

    if (shouldRestoreFocus(state)) {
      refocus.current = null;
      queued.target.focus();
      return;
    }
    // A disabled target means "not yet", not "never" — keep the request.
    if (shouldAbandonRestore(state)) refocus.current = null;
  });

  // --- export ------------------------------------------------------------
  const [busy, setBusy] = useState<'none' | 'full' | 'partial'>('none');
  const [exportMessage, setExportMessage] = useState('');
  /**
   * Said when an export ended without a file.
   *
   * Kept apart from `exportMessage` because that one is rendered as a success —
   * green, with a tick — and a cancellation is not a success. The words alone
   * were not enough: "Nothing was saved" inside a green ✓ box reads as a
   * cheerful confirmation at a glance, which is the same lie in a different
   * font.
   */
  const [exportNothing, setExportNothing] = useState('');
  const [exportError, setExportError] = useState('');
  const fullExportButton = useRef<HTMLButtonElement>(null);
  const partialExportButton = useRef<HTMLButtonElement>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kinds, setKinds] = useState<EntryKind[]>([]);
  const [descendantsOnly, setDescendantsOnly] = useState(false);

  const partialFilter = useMemo((): ExportFilter | undefined => {
    const filter: ExportFilter = {};
    if (from) filter.from = from;
    if (to) filter.to = to;
    if (kinds.length > 0) filter.kinds = kinds;
    if (descendantsOnly) filter.forDescendantsOnly = true;
    // An empty filter would produce a "partial" archive identical to the whole
    // journal but without the export being recorded. Refuse it instead.
    return Object.keys(filter).length > 0 ? filter : undefined;
  }, [from, to, kinds, descendantsOnly]);

  const runExport = async (filter?: ExportFilter) => {
    // Narrowing does not survive into a callback, and the guard is real: the
    // archive records which division each anchor names, so an export written
    // without them would be a quietly poorer archive rather than a failure.
    if (!sections) return;
    setBusy(filter ? 'partial' : 'full');
    setExportMessage('');
    setExportNothing('');
    setExportError('');
    try {
      const { archive, save, reminderRecorded } = await exportEverything({
        storage,
        outlineBooks: sections.outlineBooks,
        topics,
        profile: DATA_PROFILE,
        filter,
        // Where the bytes go is the platform's business, not this view's.
        files,
      });

      // exportEverything records lastExportAt straight to storage. Re-read it
      // through the context — an empty patch changes nothing — so the line
      // below updates without this view keeping a second copy of the truth.
      if (!filter && save.status === 'saved' && reminderRecorded) {
        await updateSettings({}).catch(() => undefined);
      }

      // Only a save that happened may be announced. Backing out of the file
      // picker used to land here too, so the app said "Saved <filename> — 2
      // entries. Keep it somewhere that is not this device." over a file that
      // was never written.
      setExportNothing(
        save.status === 'cancelled'
          ? 'Nothing was saved. Your journal is unchanged — you can export again whenever you like.'
          : save.status === 'initiated-unverified'
            ? `The browser started downloading ${archive.filename}, but cannot confirm that a file was kept. Check your Downloads before relying on it. Your backup reminder was not reset.`
            : '',
      );
      setExportError(
        save.status === 'failed'
          ? 'The file could not be saved. Nothing in your journal was changed.'
          : save.status === 'saved' && !reminderRecorded
            ? `Saved ${archive.filename}, but the app could not update its backup reminder. Keep the file; the reminder may still say a backup is due.`
            : '',
      );
      setExportMessage(
        save.status !== 'saved'
          ? ''
          : filter
            ? `Saved ${archive.filename} — ${plural(archive.entryCount, 'entry', 'entries')}, with ${plural(archive.excludedCount, 'entry', 'entries')} left out. This is not a backup of the whole journal.`
            : `Saved ${archive.filename} — ${plural(archive.entryCount, 'entry', 'entries')}. Keep it somewhere that is not this device.`,
      );
    } catch (cause) {
      setExportError(
        `The export did not finish: ${messageOf(cause, 'something went wrong building the file')}. Nothing in your journal was changed.`,
      );
    } finally {
      // Queue the focus request before the re-render that re-enables the button.
      {
      const target = filter ? partialExportButton.current : fullExportButton.current;
      if (target) refocus.current = { target, from: document.activeElement };
    }
      setBusy('none');
    }
  };

  const toggleKind = (kind: EntryKind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind],
    );

  // --- import ------------------------------------------------------------
  // Either the `<input type="file">` the page draws, or the button that opens
  // the platform's own picker. Typed as the common ancestor rather than cast at
  // each use: it is genuinely one or the other.
  const fileInput = useRef<HTMLElement>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [existing, setExisting] = useState<Entry[] | null>(null);
  const reviewedJournal = useRef<JournalSnapshot | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState('');
  const [protectedFile, setProtectedFile] = useState<PickedFile | null>(null);
  const [transferPassword, setTransferPassword] = useState('');
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (protectedFile && !reading) passwordInput.current?.focus();
  }, [protectedFile, reading]);

  // Pure, so changing the mode re-answers "what would this do?" with no reparse
  // and — the point of the whole flow — no write.
  const preview = useMemo(
    () => (parsed && existing ? previewImport(parsed, existing, mode, anchorsResolve) : null),
    [parsed, existing, mode],
  );

  /**
   * Which file-read is the current one.
   *
   * Choosing a second file while the first is still being read would otherwise
   * race: a small .json settles after a large .zip, and the preview ends up
   * describing one file while naming the other — with a confirm button that
   * writes the one the user is no longer looking at.
   */
  const readToken = useRef(0);
  useEffect(() => () => { readToken.current += 1; }, []);

  const clearPending = () => {
    readToken.current += 1;
    setParsed(null);
    setExisting(null);
    reviewedJournal.current = null;
    setFileName('');
    setReading(false);
    setProtectedFile(null);
    setTransferPassword('');
    // Clearing the element's value lets the same file be chosen again, which is
    // exactly what someone does after cancelling. Only an `<input>` carries a
    // value; a button that opens the OS picker has nothing to reset.
    if (fileInput.current instanceof HTMLInputElement) fileInput.current.value = '';
    // The card holding this button is about to unmount; keep focus on the page.
    if (fileInput.current) refocus.current = { target: fileInput.current, from: document.activeElement };
  };

  /**
   * Handle a chosen archive, in the platform's shape rather than the browser's.
   *
   * Takes a name and bytes. The `<input>` below converts a DOM `File` first; a
   * native document picker will hand the same shape straight in.
   */
  const onFileChosen = async (file: PickedFile | null, password?: string, requestedToken?: number) => {
    const token = requestedToken ?? (readToken.current += 1);
    if (token !== readToken.current) return;
    setParsed(null);
    setExisting(null);
    reviewedJournal.current = null;
    setProtectedFile(password === undefined ? null : file);
    setTransferPassword('');
    setImportError('');
    setImportResult('');
    if (!file) {
      setFileName('');
      // This request supersedes any read still in flight, and it reads nothing.
      setReading(false);
      return;
    }

    if (!sections) return;
    setFileName(file.name);
    setReading(true);
    try {
      const [incoming, mine, mineDrafts] = await Promise.all([
        parseImport(file.bytes, {
          resolveOutlineId: (id: string) => resolveOutlineId(id, sections),
          isTopicId: (id) => topicsById.has(id),
          isBookId: (id) => Boolean(versification[id]),
        }, password),
        storage.listEntries(),
        storage.listDrafts(),
      ]);
      if (token !== readToken.current) return;
      setParsed(incoming);
      setExisting(mine);
      reviewedJournal.current = { entries: mine, drafts: mineDrafts };
      setProtectedFile(null);
    } catch (cause) {
      if (token !== readToken.current) return;
      if (cause instanceof ProtectedTransferPasswordRequired) {
        setProtectedFile(file);
        return;
      }
      // A failed unlock keeps the encrypted original available for retry. The
      // password input itself is cleared on every attempt and cancellation.
      if (password !== undefined) setProtectedFile(file);
      setImportError(
        cause instanceof ArchiveIntegrityError
          ? // An archive that did not match its own manifest. Deliberately not
            // "could not be read" — it read perfectly well, which is the
            // problem — and deliberately no accusation: a bad copy, a failing
            // card or a half-finished sync produce this too, and are likelier
            // than anyone meddling. The failing checksums stay out of the UI.
            `${file.name} could not be verified and was not restored. The file may be damaged or incomplete. Nothing was changed.`
          : `${file.name} could not be read: ${messageOf(cause, 'it is not a Journey export')}. Nothing was changed.`,
      );
      if (password === undefined) setFileName('');
    } finally {
      if (token === readToken.current) setReading(false);
    }
  };

  const confirmImport = async () => {
    if (!parsed || !reviewedJournal.current) return;
    setImporting(true);
    setImportError('');
    try {
      const outcome = await applyImport(parsed, storage, mode, reviewedJournal.current);
      touch();
      setImportResult(
        outcome.replaced
          ? `Replaced your journal from ${fileName}: the previous entries and unfinished drafts were replaced atomically by ${plural(outcome.imported, 'entry', 'entries')} and ${plural(outcome.draftsImported, 'unfinished draft', 'unfinished drafts')}.`
          : `Merged ${fileName}: ${plural(outcome.imported, 'entry', 'entries')} and ${plural(outcome.draftsImported, 'unfinished draft', 'unfinished drafts')} written; ${plural(outcome.entriesSkipped, 'entry', 'entries')} and ${plural(outcome.draftsSkipped, 'draft', 'drafts')} already present and skipped${outcome.conflictsPreserved ? `; ${plural(outcome.conflictsPreserved, 'conflicting entry', 'conflicting entries')} kept as separate copies` : ''}${outcome.draftConflictsPreserved ? `; ${plural(outcome.draftConflictsPreserved, 'conflicting draft', 'conflicting drafts')} kept as separate copies` : ''}.`,
      );
      clearPending();
    } catch (cause) {
      setImportError(`The import did not finish: ${messageOf(cause, 'something went wrong')}.`);
    } finally {
      setImporting(false);
    }
  };

  /**
   * The two ways an import can land, described from the preview itself.
   *
   * The replace count comes from `preview.existing` — the very list the preview
   * was computed from — and never from the page's own entry count. Those are
   * two reads taken at two moments, and the count above starts at 0 until its
   * read lands: choose a file quickly enough and the old code offered "Deletes
   * all 0 entries in this journal first. There is no undo." over a journal that
   * was not empty. The line beside a destructive action is the last place a
   * number may be guessed at, and taking it from the preview means there is no
   * second read left to disagree.
   */
  const describeModes = (
    counted: ImportPreview,
  ): Array<{ value: ImportMode; label: string; detail: string }> => [
    {
      value: 'merge',
      label: 'Merge (recommended)',
      detail: 'Keeps what is here. If the same entry differs, both versions are preserved instead of guessing from device clocks.',
    },
    {
      value: 'replace',
      label: 'Replace — destructive',
      detail: `Atomically replaces all ${plural(counted.existing, 'entry', 'entries')} and every unfinished draft with exactly what is in the file. There is no undo.`,
    },
  ];

  // After every hook. The archive writes division ids and an import resolves
  // them, so this page cannot act until the divisions are here — and it must
  // not offer an export it would write incorrectly.
  if (!sections) return <Spinner label="Loading" />;

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-semibold">Your journal</h1>

      {/*
        The lead, not the fine print. Amber carries none of the meaning on its
        own — the word "Warning" and the sentence do.
      */}
      <div className="rounded-card border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="text-base font-semibold">
          <span aria-hidden="true">⚠ </span>
          Warning: the copy on this device is not a backup.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Everything you have written lives on this device. Clearing this app&rsquo;s data,
          removing it, or losing the device takes your journal with it. If Android&rsquo;s backup
          is switched on for this app, Android may include what it stores in your device backup —
          that is Android&rsquo;s own feature, not something this app arranges, and not something
          to rely on. An export is the copy you control.
        </p>
        <p className="mt-2 text-sm leading-relaxed">{lastExportedWords(settings.lastExportAt, new Date())}</p>
      </div>

      <section aria-labelledby="export-heading" className="space-y-4">
        <h2 id="export-heading" className="font-serif text-xl font-semibold">
          Export everything
        </h2>

        {/*
          Never "0 entries in this journal" when the count could not be read:
          that reads as an answer, and the answer would be wrong.
        */}
        <p role="status" className="text-sm text-ink-soft">
          {blocked
            ? 'Your entries cannot be counted while the journal is unavailable.'
            : counting
              ? 'Counting your entries…'
              : `${plural(entryCount, 'entry', 'entries')} in this journal.`}
        </p>

        <Button
          ref={fullExportButton}
          variant="primary"
          className="w-full sm:w-auto"
          onClick={() => void runExport()}
          disabled={busy !== 'none' || blocked}
        >
          {busy === 'full' ? 'Building your archive…' : 'Export everything'}
        </Button>

        {busy === 'full' ? <Spinner label="Building your archive. This can take a moment" /> : null}

        {exportMessage ? (
          <p className="rounded-control border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
            <span aria-hidden="true">✓ </span>
            {exportMessage}
          </p>
        ) : null}

        {exportNothing ? (
          <p className="rounded-control border border-line bg-raised p-3 text-sm text-ink-soft">
            {exportNothing}
          </p>
        ) : null}

        {exportError ? (
          <p className="rounded-control border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
            {exportError}
          </p>
        ) : null}

        <LiveRegion message={exportError || exportMessage || exportNothing} />

        <details className="rounded-card border border-line bg-surface">
          {/*
            No `flex` here: a summary is display:list-item, and overriding that
            removes the browser's own disclosure triangle — leaving a row that
            gives a sighted user no sign it opens. py-3 on text-sm already clears
            the 44px target without it.
          */}
          <summary className="min-h-11 cursor-pointer rounded-card px-4 py-3 text-sm font-medium">
            Export only part of it
          </summary>

          <div className="space-y-4 border-t border-line p-4">
            <p className="text-sm text-ink-soft">
              A partial export is not a backup of your journal. It leaves entries behind on purpose,
              and the file says so inside, so nobody later mistakes it for the whole thing.
            </p>

            {/* FieldRow, not a hand-rolled grid: it supplies the row tracks
                the fields subgrid onto, so From and To align on their controls
                rather than on their labels. */}
            <FieldRow>
              <Field
                label="From"
                hint="Earliest date to include. Leave empty for no limit."
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <Field
                label="To"
                hint="Latest date to include. Leave empty for no limit."
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </FieldRow>

            <fieldset className="border-0 p-0">
              <legend className="text-sm font-medium text-ink-soft">
                Kinds of entry
              </legend>
              <p className="mt-0.5 text-xs text-ink-muted">
                Tick none to include every kind.
              </p>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                {KINDS.map((kind) => (
                  <label
                    key={kind}
                    className="flex min-h-11 items-center gap-3 text-sm text-ink-soft"
                  >
                    <input
                      type="checkbox"
                      checked={kinds.includes(kind)}
                      onChange={() => toggleKind(kind)}
                      className="h-5 w-5 rounded border-line-strong"
                    />
                    {KIND_LABELS[kind]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex min-h-11 items-center gap-3 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={descendantsOnly}
                onChange={(event) => setDescendantsOnly(event.target.checked)}
                className="h-5 w-5 rounded border-line-strong"
              />
              Only entries marked for those who come after
            </label>

            <Button
              ref={partialExportButton}
              className="w-full sm:w-auto"
              onClick={() => void runExport(partialFilter)}
              disabled={busy !== 'none' || blocked || !partialFilter}
            >
              {busy === 'partial' ? 'Building that part…' : 'Export the selected part'}
            </Button>

            {partialFilter ? null : (
              <p className="text-sm text-ink-soft">
                Choose a date, a kind, or the descendants filter first — otherwise use “Export
                everything” above, which also records that your journal is backed up.
              </p>
            )}

            {busy === 'partial' ? <Spinner label="Building that part of your journal" /> : null}
          </div>
        </details>
      </section>

      <section aria-labelledby="inside-heading" className="space-y-3">
        <h2 id="inside-heading" className="font-serif text-xl font-semibold">
          What is in the file
        </h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          One zip, built so it can be read in 2060 by someone with a text editor and no app. Nothing
          in it needs Journey, or any program, to make sense.
        </p>
        <Card>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">README.txt and MANIFEST.txt</dt>
              <dd className="text-ink-soft">
                What this is, for a stranger; then every file with its size and checksum, so damage
                is detectable rather than silent.
              </dd>
            </div>
            <div>
              <dt className="font-medium">notes/</dt>
              <dd className="text-ink-soft">
                One plain Markdown file per entry — the real archive. Readable in any text editor.
              </dd>
            </div>
            <div>
              <dt className="font-medium">data/</dt>
              <dd className="text-ink-soft">
                journey.json, the copy this app can read back in, with its own schema beside it and
                a flat CSV for a spreadsheet.
              </dd>
            </div>
            <div>
              <dt className="font-medium">indexes/ and book/</dt>
              <dd className="text-ink-soft">
                Cross-references into notes/, and one self-contained HTML file —{' '}
                <em>My Journey With Christ</em> — that prints as a book.{' '}
                <Link to={{ name: 'legacy' }} className="underline">
                  You can read and print that here too
                </Link>
                .
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      {/*
        Two ways in, kept apart because they are not the same operation. This
        one reads an archive this app wrote and restores ids, dates and anchors
        exactly. The other reads somebody's Word document and can only ever
        propose what it thinks it found. Merging them into one control would
        promise a fidelity the document path cannot deliver.
      */}
      <section aria-labelledby="documents-heading" className="space-y-4">
        <h2 id="documents-heading" className="font-serif text-xl font-semibold">
          Bring in notes you already have
        </h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          Sermon notes, devotionals, prayer lists or study notes from a .txt, .md, .docx or
          text-based .pdf file. Everything is read on this device, you review what was found before
          anything is saved, and your original file is not changed.
        </p>
        <p>
          <Link
            to={{ name: 'import' }}
            className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Import notes from a document
          </Link>
        </p>
      </section>

      <section aria-labelledby="import-heading" className="space-y-4">
        <h2 id="import-heading" className="font-serif text-xl font-semibold">
          Bring a journal back in
        </h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          Choose an export and you will be shown exactly what it would do. Nothing is written until
          you press the button that says so.
        </p>

        <div>
          <label
            htmlFor="import-file"
            className="block text-sm font-medium text-ink-soft"
          >
            Journal file to read
          </label>
          <p id="import-file-hint" className="mt-0.5 text-xs text-ink-muted">
            A Journey export: a .zip archive, a bare journey.json, or a password-protected .lwc transfer.
          </p>
          {/*
            Which control depends on whether the picker has an interface of its
            own — a property of the capability, not a question about the
            platform. Where the page must draw it, the `<input type="file">`
            stays: it is keyboard reachable, label-associated and covered by the
            accessibility suite. Where the operating system draws it, a second
            in-page control would be a worse one that saves into the sandbox.
          */}
          {picker.presentsOwnUI ? (
            <button
              id="import-file"
              ref={fileInput as React.RefObject<HTMLButtonElement>}
              type="button"
              aria-describedby="import-file-hint"
              disabled={importing || blocked}
              onClick={() => {
                const token = ++readToken.current;
                setParsed(null);
                setExisting(null);
                reviewedJournal.current = null;
                setProtectedFile(null);
                setTransferPassword('');
                setFileName('');
                setReading(false);
                setImportResult('');
                setImportError('');
                void picker
                  .pick({
                    accept: ['application/zip', 'application/json', 'application/octet-stream', '.zip', '.json', '.lwc'],
                    maxBytes: MAX_JOURNAL_FILE_BYTES,
                  })
                  .then((result) => {
                    if (token !== readToken.current) return;
                    if (result.status === 'picked') void onFileChosen(result.file, undefined, token);
                    else if (result.status === 'cancelled') void onFileChosen(null, undefined, token);
                    else setImportError(`${pickFailureMessage(result.reason, 'journal file')} Nothing was changed.`);
                  })
                  .catch(() => {
                    if (token === readToken.current) setImportError('The file picker could not be opened. Nothing was changed.');
                  });
              }}
              className="mt-1 block min-h-11 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              Choose a journal file…
            </button>
          ) : (
            <input
              id="import-file"
              ref={fileInput as React.RefObject<HTMLInputElement>}
              type="file"
              accept=".zip,.json,.lwc,application/zip,application/json,application/octet-stream"
              aria-describedby="import-file-hint"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                // Fence at selection time, before a DOM File finishes reading.
                // A slower previous file must never replace the latest choice.
                const token = ++readToken.current;
                setParsed(null);
                setExisting(null);
                reviewedJournal.current = null;
                setProtectedFile(null);
                setTransferPassword('');
                setFileName('');
                setReading(false);
                setImportResult('');
                setImportError('');
                // The web binding: a DOM File becomes the shape every edition uses.
                if (chosen && chosen.size > MAX_JOURNAL_FILE_BYTES) {
                  setImportError('That journal file is larger than the supported 256 MiB limit. Nothing was read or changed.');
                } else if (chosen) {
                  setFileName(chosen.name);
                  setReading(true);
                  void pickedFromDomFile(chosen)
                    .then((file) => onFileChosen(file, undefined, token))
                    .catch((cause) => {
                      if (token === readToken.current) {
                        setReading(false);
                        setImportError(`${cause instanceof Error ? cause.message : 'That file could not be read.'} Nothing was changed.`);
                      }
                    });
                }
                else void onFileChosen(null, undefined, token);
              }}
              disabled={importing || blocked}
              className="mt-1 block w-full min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:min-h-9 file:rounded-control file:border-0 file:bg-raised file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
            />
          )}
        </div>

        {reading ? <Spinner label={`Reading ${fileName}`} /> : null}

        {protectedFile ? (
          <Card className="space-y-3">
            <h3 className="font-serif text-lg font-semibold">Unlock your protected transfer</h3>
            <p className="text-sm text-ink-soft">
              {fileName} stays on this device. Enter its password to review the writing before importing.
              The password is not saved. There is no password recovery.
            </p>
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              if (!reading) void onFileChosen(protectedFile, transferPassword);
            }}>
              <Field
                ref={passwordInput}
                label="Transfer password"
                type="password"
                autoComplete="off"
                value={transferPassword}
                onChange={(event) => setTransferPassword(event.target.value)}
                disabled={reading}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" variant="primary" disabled={reading || !transferPassword}>Unlock and review</Button>
                <Button type="button" onClick={clearPending}>Cancel</Button>
              </div>
            </form>
          </Card>
        ) : null}

        {/* break-words throughout: these carry a filename the user chose, and one
            long unbroken name would scroll a 360px page sideways. */}
        {importError ? (
          <p className="break-words rounded-control border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
            {importError}
          </p>
        ) : null}

        {importResult ? (
          <p className="break-words rounded-control border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
            <span aria-hidden="true">✓ </span>
            {importResult}
          </p>
        ) : null}

        <LiveRegion message={importError || importResult} />

        {preview ? (
          <Card className="space-y-4">
            <h3 className="font-medium">What this would do</h3>

            <p className="break-words text-sm text-ink-soft">
              {fileName} holds {plural(preview.incoming, 'entry', 'entries')}
              {parsed && parsed.drafts.length > 0
                ? `, and ${plural(parsed.drafts.length, 'unfinished draft', 'unfinished drafts')}`
                : ''}
              .
            </p>

            <ul className="space-y-1 text-sm">
              <li>
                <strong>{preview.newEntries}</strong> new — not in this journal yet.
              </li>
              <li>
                <strong>{preview.updated}</strong> different versions overwritten automatically —
                merge never does this.
              </li>
              <li>
                <strong>{preview.unchanged}</strong> unchanged — this journal already has the same
                copy.
              </li>
              <li>
                <strong>{preview.conflicts.length}</strong>{' '}
                {preview.conflicts.length === 1 ? 'conflict' : 'conflicts'} — edited on both sides.
              </li>
              {preview.danglingAnchors > 0 ? (
                <li>
                  <strong>{preview.danglingAnchors}</strong> with a passage or topic this build does
                  not know. The entries import in full; the anchor simply will not link anywhere.
                </li>
              ) : null}
              {preview.migratedFrom !== undefined ? (
                <li>Written by an older version (format {preview.migratedFrom}) and brought up to date.</li>
              ) : null}
            </ul>

            {preview.conflicts.length > 0 ? (
              <div>
                <h4 className="text-sm font-medium">Edited on both sides</h4>
                <ul className="mt-1 space-y-1 break-words text-sm text-ink-soft">
                  {preview.conflicts.slice(0, 10).map((conflict) => (
                    <li key={conflict.id}>
                      {conflict.title} — here {conflict.mineUpdatedAt.slice(0, 10)}, in the file{' '}
                      {conflict.theirsUpdatedAt.slice(0, 10)}.{' '}
                      {mode === 'replace'
                        ? 'Replace keeps the file’s copy.'
                        : 'Merge keeps both versions as separate entries.'}
                    </li>
                  ))}
                  {preview.conflicts.length > 10 ? (
                    <li>…and {preview.conflicts.length - 10} more.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {preview.warnings.length > 0 ? (
              <div className="rounded-control border border-amber-400 bg-amber-50 p-3 dark:border-amber-500 dark:bg-amber-950/40">
                <h4 className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                  <span aria-hidden="true">⚠ </span>
                  Worth reading first
                </h4>
                {/* Index in the key: two entries can raise the same warning
                    word for word, and a duplicate key would drop one of them. */}
                <ul className="mt-1 space-y-1 text-sm text-amber-950 dark:text-amber-100">
                  {preview.warnings.map((warning, index) => (
                    <li key={`${index}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <fieldset className="border-0 p-0">
              <legend className="text-sm font-medium text-ink-soft">
                How should it come in?
              </legend>
              {/*
                The input and both lines of text are direct children of the
                label: the radio sits in column one spanning both rows, so the
                label's own text is never buried in a wrapper element.
              */}
              {describeModes(preview).map((option) => (
                <label
                  key={option.value}
                  className="mt-1 grid min-h-11 grid-cols-[auto_1fr] items-start gap-x-3 py-1 text-sm text-ink-soft"
                >
                  <input
                    type="radio"
                    name="import-mode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className="row-span-2 mt-1 h-5 w-5"
                  />
                  <span className="font-medium">{option.label}</span>
                  <span className="text-ink-soft">{option.detail}</span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant={mode === 'replace' ? 'danger' : 'primary'}
                onClick={() => void confirmImport()}
                disabled={importing}
              >
                {importing
                  ? 'Importing…'
                  : mode === 'replace'
                    ? `Delete everything and import ${plural(preview.incoming, 'entry', 'entries')}`
                    : `Merge ${plural(preview.incoming, 'entry', 'entries')}`}
              </Button>
              <Button onClick={clearPending} disabled={importing}>
                Cancel
              </Button>
            </div>

            {importing ? <Spinner label="Writing the entries" /> : null}
          </Card>
        ) : null}
      </section>

      {SyntheticCleanup ? (
        <Suspense fallback={null}>
          <SyntheticCleanup />
        </Suspense>
      ) : null}

      {/* Not legally required for either source. Given because a record that
          outlives its software should say where its words came from. */}
      <Attribution />
    </div>
  );
}
