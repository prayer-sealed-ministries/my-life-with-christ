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

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  DATA_PROFILE,
  findSegment,
  outlineBooks,
  outlineEntriesById,
  topics,
  topicsById,
  versification,
} from '../app/data';
import { Link } from '../app/router';
import { useStorage, useStorageQuery } from '../app/storage';
import { Button, Card, Field, FieldRow, LiveRegion, Spinner } from '../components/ui';
import { shouldRestoreFocus } from '../lib/focus-restore';
import { Attribution } from '../components/Attribution';
import { KIND_LABELS } from '../export/context';
import { exportEverything } from '../export/download';
import { applyImport, parseImport, previewImport, type ParsedImport } from '../export/importer';
import { segmentRef } from '../lib/passages';
import type { Entry, EntryKind, ExportFilter, ImportMode, ScriptureRef } from '../types';

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
function resolveOutlineId(id: string): ScriptureRef | undefined {
  const entry = outlineEntriesById.get(id);
  if (!entry) return undefined;
  const segment = findSegment(entry.book, id);
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
  if (!iso) return 'Never exported. Nothing here has ever left this device.';

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Last exported: the date on record cannot be read.';

  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Last exported today.';
  if (days === 1) return 'Last exported yesterday.';
  if (days < 30) return `Last exported ${days} days ago.`;

  const months = Math.max(1, Math.round(days / 30));
  return `Last exported ${days} days ago — ${months === 1 ? 'about a month' : `about ${months} months`}. Worth doing again now.`;
}

export default function DataView() {
  const { storage, settings, updateSettings, touch, error: storageError } = useStorage();

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
  const refocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;

    if (shouldRestoreFocus({ active: document.activeElement, target, body: document.body })) {
      refocus.current = null;
      target.focus();
      return;
    }

    // Stand down only for a real, connected element the user moved to.
    const active = document.activeElement;
    if (active && active !== document.body && active !== target && active.isConnected) {
      refocus.current = null;
    }
  });

  // --- export ------------------------------------------------------------
  const [busy, setBusy] = useState<'none' | 'full' | 'partial'>('none');
  const [exportMessage, setExportMessage] = useState('');
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
    setBusy(filter ? 'partial' : 'full');
    setExportMessage('');
    setExportError('');
    try {
      const archive = await exportEverything({
        storage,
        outlineBooks,
        topics,
        profile: DATA_PROFILE,
        filter,
      });

      // exportEverything records lastExportAt straight to storage. Re-read it
      // through the context — an empty patch changes nothing — so the line
      // below updates without this view keeping a second copy of the truth.
      if (!filter) await updateSettings({});

      setExportMessage(
        filter
          ? `Saved ${archive.filename} — ${plural(archive.entryCount, 'entry', 'entries')}, with ${plural(archive.excludedCount, 'entry', 'entries')} left out. This is not a backup of the whole journal.`
          : `Saved ${archive.filename} — ${plural(archive.entryCount, 'entry', 'entries')}. Keep it somewhere that is not this device.`,
      );
    } catch (cause) {
      setExportError(
        `The export did not finish: ${messageOf(cause, 'something went wrong building the file')}. Nothing in your journal was changed.`,
      );
    } finally {
      // Queue the focus request before the re-render that re-enables the button.
      refocus.current = filter ? partialExportButton.current : fullExportButton.current;
      setBusy('none');
    }
  };

  const toggleKind = (kind: EntryKind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind],
    );

  // --- import ------------------------------------------------------------
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [existing, setExisting] = useState<Entry[] | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState('');

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

  const clearPending = () => {
    readToken.current += 1;
    setParsed(null);
    setExisting(null);
    setFileName('');
    setReading(false);
    // Clearing the element's value lets the same file be chosen again, which is
    // exactly what someone does after cancelling.
    if (fileInput.current) fileInput.current.value = '';
    // The card holding this button is about to unmount; keep focus on the page.
    refocus.current = fileInput.current;
  };

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const token = (readToken.current += 1);
    setParsed(null);
    setExisting(null);
    setImportError('');
    setImportResult('');
    if (!file) {
      setFileName('');
      // This request supersedes any read still in flight, and it reads nothing.
      setReading(false);
      return;
    }

    setFileName(file.name);
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [incoming, mine] = await Promise.all([
        parseImport(bytes, {
          resolveOutlineId,
          isTopicId: (id) => topicsById.has(id),
          isBookId: (id) => Boolean(versification[id]),
        }),
        storage.listEntries(),
      ]);
      if (token !== readToken.current) return;
      setParsed(incoming);
      setExisting(mine);
    } catch (cause) {
      if (token !== readToken.current) return;
      setImportError(
        `${file.name} could not be read: ${messageOf(cause, 'it is not a Journey export')}. Nothing was changed.`,
      );
      setFileName('');
    } finally {
      if (token === readToken.current) setReading(false);
    }
  };

  const confirmImport = async () => {
    if (!parsed) return;
    setImporting(true);
    setImportError('');
    try {
      const outcome = await applyImport(parsed, storage, mode);
      touch();
      setImportResult(
        outcome.replaced
          ? `Replaced your journal from ${fileName}: everything that was here before was deleted, and ${plural(outcome.imported, 'entry', 'entries')} written.`
          : `Merged ${fileName}: ${plural(outcome.imported, 'entry', 'entries')} written, ${plural(outcome.preview.unchanged, 'entry', 'entries')} left as they were.`,
      );
      clearPending();
    } catch (cause) {
      setImportError(`The import did not finish: ${messageOf(cause, 'something went wrong')}.`);
    } finally {
      setImporting(false);
    }
  };

  const modes: Array<{ value: ImportMode; label: string; detail: string }> = [
    {
      value: 'merge',
      label: 'Merge (recommended)',
      detail: 'Keeps what is here. Where the same entry exists on both sides, the newer one wins.',
    },
    {
      value: 'replace',
      label: 'Replace — destructive',
      detail: `Deletes all ${plural(entryCount, 'entry', 'entries')} in this journal first, then writes the file's entries. There is no undo.`,
    },
  ];

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-2xl font-semibold">Your journal</h1>

      {/*
        The lead, not the fine print. Amber carries none of the meaning on its
        own — the word "Warning" and the sentence do.
      */}
      <div className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="text-base font-semibold">
          <span aria-hidden="true">⚠ </span>
          Warning: browser storage is not a backup.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Everything you have written lives in this browser on this device. Clearing site data,
          reinstalling the browser, a private window closing, or a lost phone takes it with it. No
          copy exists anywhere else until you export one.
        </p>
        <p className="mt-2 text-sm leading-relaxed">{lastExportedWords(settings.lastExportAt, new Date())}</p>
      </div>

      {storageError ? (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
        >
          {storageError} Export and import cannot run until that is fixed.
        </p>
      ) : null}

      <section aria-labelledby="export-heading" className="space-y-4">
        <h2 id="export-heading" className="font-serif text-xl font-semibold">
          Export everything
        </h2>

        {/*
          Never "0 entries in this journal" when the count could not be read:
          that reads as an answer, and the answer would be wrong.
        */}
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
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
          <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
            <span aria-hidden="true">✓ </span>
            {exportMessage}
          </p>
        ) : null}

        {exportError ? (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
            {exportError}
          </p>
        ) : null}

        <LiveRegion message={exportError || exportMessage} />

        <details className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60">
          {/*
            No `flex` here: a summary is display:list-item, and overriding that
            removes the browser's own disclosure triangle — leaving a row that
            gives a sighted user no sign it opens. py-3 on text-sm already clears
            the 44px target without it.
          */}
          <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 text-sm font-medium">
            Export only part of it
          </summary>

          <div className="space-y-4 border-t border-slate-200 p-4 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-300">
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
              <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Kinds of entry
              </legend>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Tick none to include every kind.
              </p>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                {KINDS.map((kind) => (
                  <label
                    key={kind}
                    className="flex min-h-11 items-center gap-3 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={kinds.includes(kind)}
                      onChange={() => toggleKind(kind)}
                      className="h-5 w-5 rounded border-slate-400 dark:border-slate-500"
                    />
                    {KIND_LABELS[kind]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={descendantsOnly}
                onChange={(event) => setDescendantsOnly(event.target.checked)}
                className="h-5 w-5 rounded border-slate-400 dark:border-slate-500"
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
              <p className="text-sm text-slate-600 dark:text-slate-300">
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
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          One zip, built so it can be read in 2060 by someone with a text editor and no app. Nothing
          in it needs Journey, or any program, to make sense.
        </p>
        <Card>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">README.txt and MANIFEST.txt</dt>
              <dd className="text-slate-600 dark:text-slate-300">
                What this is, for a stranger; then every file with its size and checksum, so damage
                is detectable rather than silent.
              </dd>
            </div>
            <div>
              <dt className="font-medium">notes/</dt>
              <dd className="text-slate-600 dark:text-slate-300">
                One plain Markdown file per entry — the real archive. Readable in any text editor.
              </dd>
            </div>
            <div>
              <dt className="font-medium">data/</dt>
              <dd className="text-slate-600 dark:text-slate-300">
                journey.json, the copy this app can read back in, with its own schema beside it and
                a flat CSV for a spreadsheet.
              </dd>
            </div>
            <div>
              <dt className="font-medium">indexes/ and book/</dt>
              <dd className="text-slate-600 dark:text-slate-300">
                Cross-references into notes/, and one self-contained HTML file —{' '}
                <em>My Journey with God</em> — that prints as a book.{' '}
                <Link to={{ name: 'legacy' }} className="underline">
                  You can read and print that here too
                </Link>
                .
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      <section aria-labelledby="import-heading" className="space-y-4">
        <h2 id="import-heading" className="font-serif text-xl font-semibold">
          Bring a journal back in
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Choose an export and you will be shown exactly what it would do. Nothing is written until
          you press the button that says so.
        </p>

        <div>
          <label
            htmlFor="import-file"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Journal file to read
          </label>
          <p id="import-file-hint" className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            A Journey export: a .zip archive, or a bare journey.json.
          </p>
          <input
            id="import-file"
            ref={fileInput}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            aria-describedby="import-file-hint"
            onChange={(event) => void onFileChosen(event)}
            disabled={importing || blocked}
            className="mt-1 block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:file:bg-slate-700 dark:file:text-slate-100"
          />
        </div>

        {reading ? <Spinner label={`Reading ${fileName}`} /> : null}

        {/* break-words throughout: these carry a filename the user chose, and one
            long unbroken name would scroll a 360px page sideways. */}
        {importError ? (
          <p className="break-words rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
            {importError}
          </p>
        ) : null}

        {importResult ? (
          <p className="break-words rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100">
            <span aria-hidden="true">✓ </span>
            {importResult}
          </p>
        ) : null}

        <LiveRegion message={importError || importResult} />

        {preview ? (
          <Card className="space-y-4">
            <h3 className="font-medium">What this would do</h3>

            <p className="break-words text-sm text-slate-600 dark:text-slate-300">
              {fileName} holds {plural(preview.incoming, 'entry', 'entries')}.
            </p>

            <ul className="space-y-1 text-sm">
              <li>
                <strong>{preview.newEntries}</strong> new — not in this journal yet.
              </li>
              <li>
                <strong>{preview.updated}</strong> updated — a newer version of an entry already
                here.
              </li>
              <li>
                <strong>{preview.unchanged}</strong> unchanged — this journal already has the same
                or a newer copy.
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
                <ul className="mt-1 space-y-1 break-words text-sm text-slate-600 dark:text-slate-300">
                  {preview.conflicts.slice(0, 10).map((conflict) => (
                    <li key={conflict.id}>
                      {conflict.title} — here {conflict.mineUpdatedAt.slice(0, 10)}, in the file{' '}
                      {conflict.theirsUpdatedAt.slice(0, 10)}.{' '}
                      {mode === 'replace'
                        ? 'Replace keeps the file’s copy.'
                        : conflict.theirsUpdatedAt > conflict.mineUpdatedAt
                          ? 'The file’s copy is newer and will win.'
                          : 'Your copy is newer and will be kept.'}
                    </li>
                  ))}
                  {preview.conflicts.length > 10 ? (
                    <li>…and {preview.conflicts.length - 10} more.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {preview.warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-500 dark:bg-amber-950/40">
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
              <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">
                How should it come in?
              </legend>
              {/*
                The input and both lines of text are direct children of the
                label: the radio sits in column one spanning both rows, so the
                label's own text is never buried in a wrapper element.
              */}
              {modes.map((option) => (
                <label
                  key={option.value}
                  className="mt-1 grid min-h-11 grid-cols-[auto_1fr] items-start gap-x-3 py-1 text-sm text-slate-700 dark:text-slate-200"
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
                  <span className="text-slate-600 dark:text-slate-300">{option.detail}</span>
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

      {/* Not legally required for either source. Given because a record that
          outlives its software should say where its words came from. */}
      <Attribution />
    </div>
  );
}
