/**
 * Bringing in notes somebody already has.
 *
 * The shape of this screen is the feature's argument. A file is read, what was
 * found is shown, the reader corrects it, and only then is anything written.
 * There is no step at which choosing a file changes the journal, and cancelling
 * at any point leaves it exactly as it was — which is why the commit button
 * says how many notes it is about to write.
 *
 * Everything happens on the device. No byte of a chosen document is sent
 * anywhere, and `src/import/security.test.ts` holds that claim by replacing
 * every network primitive with a spy that fails the test if it is touched.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';

import { Link, useRouter } from '../app/router';
import { useStorage } from '../app/storage';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { CONTROL, cardClasses } from '../components/styles';
import { Button, EmptyState, Field, LiveRegion, Select, Spinner, Tag } from '../components/ui';
import { KIND_LABELS } from '../export/context';
import { labelRef } from '../import/detect';
import {
  formatFromName,
  parseDocument,
  type Candidate,
  type ParsedDocument,
  type ReviewReason,
} from '../import/candidates';
import { commitImport, findDuplicates, type DuplicateReport } from '../import/commit';
import { ImportError, MAX_FILE_BYTES, describeBytes } from '../import/limits';
import type { EntryKind } from '../types';

/** Said in words next to the control that reads a file, not buried in settings. */
const PRIVACY =
  'Your file is processed on this device. Nothing is uploaded, and your original file is not changed.';

const REASON_TEXT: Record<ReviewReason, string> = {
  'no-date': 'No date found',
  'uncertain-date': 'Date was a guess',
  'uncertain-kind': 'Type was a guess',
  'no-title': 'No title found',
  'body-truncated': 'Very long — shortened',
  'multiple-refs': 'Several references',
};

const KINDS = Object.keys(KIND_LABELS) as EntryKind[];

/** Read a File without ever handing it to anything but the parsers. */
async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

type Stage = 'choose' | 'reading' | 'review' | 'done';

export default function ImportView() {
  const { storage, ready, touch } = useStorage();
  const { navigate } = useRouter();

  const fileInputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('choose');
  const [document_, setDocument] = useState<ParsedDocument | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ imported: number; failures: string[] } | null>(null);

  const duplicateOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const finding of duplicates?.findings ?? []) {
      if (finding.kind === 'same-content') map.set(finding.candidateId, finding.existingTitle);
    }
    return map;
  }, [duplicates]);

  const selected = candidates.filter((candidate) => candidate.include).length;

  const reset = useCallback(() => {
    setStage('choose');
    setDocument(null);
    setCandidates([]);
    setDuplicates(null);
    setExpanded(null);
    setError('');
    setResult(null);
    if (fileInput.current) fileInput.current.value = '';
  }, []);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError('');
      setResult(null);

      if (!formatFromName(file.name)) {
        setError('Import handles .txt, .md, .docx and text-based .pdf files.');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(
          `That file is ${describeBytes(file.size)}, larger than the ${describeBytes(MAX_FILE_BYTES)} import limit.`,
        );
        return;
      }

      setStage('reading');
      setMessage(`Reading ${file.name}.`);

      try {
        const parsed = await parseDocument(await readBytes(file), file.name);
        const existing = await storage.listEntries();
        const report = await findDuplicates(parsed, parsed.candidates, existing);

        setDocument(parsed);
        setCandidates(parsed.candidates);
        setDuplicates(report);
        setStage('review');
        setMessage(
          `${parsed.stats.notes} ${parsed.stats.notes === 1 ? 'note' : 'notes'} found. Nothing has been saved yet.`,
        );
      } catch (cause) {
        // An ImportError carries wording written for a person. Anything else is
        // a library's internal message and must not reach the screen.
        setError(
          cause instanceof ImportError
            ? cause.message
            : 'That file could not be read. It may be damaged or in an unsupported format.',
        );
        setStage('choose');
        setMessage('');
      }
    },
    [storage],
  );

  const patch = (id: string, changes: Partial<Candidate>) =>
    setCandidates((current) =>
      current.map((candidate) => (candidate.id === id ? { ...candidate, ...changes } : candidate)),
    );

  async function onCommit() {
    if (!document_) return;
    setMessage('');
    const outcome = await commitImport(document_, candidates, storage);
    touch();
    setResult(outcome);
    setStage('done');
    setMessage(
      outcome.failures.length === 0
        ? `${outcome.imported} ${outcome.imported === 1 ? 'note' : 'notes'} imported.`
        : outcome.failures.join(' '),
    );
  }

  if (!ready) {
    return (
      <>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Import notes</h1>
        <Spinner label="Opening your journal" />
      </>
    );
  }

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Import notes</h1>
      <p className="measure mt-4 leading-relaxed text-ink-soft">
        Bring in notes you already have — sermon notes, devotionals, prayer lists, study notes — so
        your journal does not begin empty.
      </p>

      <LiveRegion message={message} />

      {/* Stated where the choosing happens, in the words the reader needs. */}
      <p className="measure mt-3 text-sm text-ink-muted">{PRIVACY}</p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-card border border-red-400 bg-surface px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {stage === 'choose' || stage === 'reading' ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl font-semibold tracking-tight">Choose a file</h2>
          <div className="mt-3">
            <label htmlFor={fileInputId} className="block text-sm font-medium text-ink-soft">
              File to import
            </label>
            <p id={`${fileInputId}-hint`} className="mt-1 text-xs text-ink-muted">
              A .txt, .md, .docx or text-based .pdf file, up to {describeBytes(MAX_FILE_BYTES)}.
            </p>
            <input
              ref={fileInput}
              id={fileInputId}
              type="file"
              accept=".txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              aria-describedby={`${fileInputId}-hint`}
              disabled={stage === 'reading'}
              onChange={(event) => void onFile(event.target.files?.[0])}
              className={`mt-2 ${CONTROL} text-sm file:mr-3 file:min-h-9 file:rounded-control file:border-0 file:bg-raised file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink`}
            />
          </div>

          {stage === 'reading' ? <Spinner label="Reading your file" /> : null}

          <p className="measure mt-6 text-sm text-ink-muted">
            Bringing back a journal this app exported? That has its own, higher-fidelity path on the{' '}
            <Link
              to={{ name: 'data' }}
              className="rounded-control underline decoration-line-strong underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              journal page
            </Link>
            .
          </p>
        </section>
      ) : null}

      {stage === 'review' && document_ ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl font-semibold tracking-tight">{document_.filename}</h2>

          {/* The summary the brief asks for, as plain sentences rather than tiles. */}
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
            <li>
              {document_.stats.notes} {document_.stats.notes === 1 ? 'note' : 'notes'} found
            </li>
            <li>{document_.stats.references} with a Bible reference</li>
            <li>{document_.stats.dates} with a date</li>
            <li>
              {document_.stats.needReview}{' '}
              {document_.stats.needReview === 1 ? 'item needs' : 'items need'} review
            </li>
          </ul>

          {document_.notices.length > 0 ? (
            <ul className="measure mt-3 space-y-1 text-sm text-ink-muted">
              {document_.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          ) : null}

          {duplicates?.fileSeenBefore ? (
            <p
              role="status"
              className="measure mt-3 rounded-card border border-amber-400 bg-surface px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:text-amber-200"
            >
              A file with this name has been imported before. Nothing is merged or removed
              automatically — look through the list and untick anything you already have.
            </p>
          ) : null}

          <p className="mt-4 text-sm font-medium text-ink">
            Nothing has been saved yet. {selected} of {candidates.length} selected.
          </p>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                setCandidates((current) => current.map((c) => ({ ...c, include: true })))
              }
            >
              Select all
            </Button>
            <Button
              onClick={() =>
                setCandidates((current) => current.map((c) => ({ ...c, include: false })))
              }
            >
              Select none
            </Button>
          </div>

          {/* Collapsed rows, expanded one at a time. Rendering several hundred
              full editors at once is what makes a large import lock a browser. */}
          <ul className="mt-4 space-y-2">
            {candidates.map((candidate, index) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                index={index}
                duplicateOf={duplicateOf.get(candidate.id)}
                open={expanded === candidate.id}
                onToggleOpen={() => setExpanded(expanded === candidate.id ? null : candidate.id)}
                onChange={(changes) => patch(candidate.id, changes)}
              />
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={selected === 0} onClick={() => void onCommit()}>
              {selected === 0
                ? 'Nothing selected'
                : `Import ${selected} ${selected === 1 ? 'note' : 'notes'}`}
            </Button>
            <Button onClick={reset}>Cancel</Button>
          </div>
        </section>
      ) : null}

      {stage === 'done' && result ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl font-semibold tracking-tight">
            {result.failures.length === 0 ? 'Imported' : 'Import did not finish'}
          </h2>
          {result.failures.length === 0 ? (
            <>
              <p className="mt-3 text-ink-soft">
                {result.imported} {result.imported === 1 ? 'note' : 'notes'} imported.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="primary" onClick={() => navigate({ name: 'timeline' })}>
                  See them in my journey
                </Button>
                <Button onClick={reset}>Import another file</Button>
              </div>
            </>
          ) : (
            <>
              <div role="alert" className="mt-3">
                <EmptyState title="Nothing was imported">
                  {result.failures.map((failure) => (
                    <p key={failure}>{failure}</p>
                  ))}
                </EmptyState>
              </div>
              <div className="mt-4">
                <Button onClick={reset}>Try another file</Button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}

function CandidateRow({
  candidate,
  index,
  duplicateOf,
  open,
  onToggleOpen,
  onChange,
}: {
  candidate: Candidate;
  index: number;
  duplicateOf?: string;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (changes: Partial<Candidate>) => void;
}) {
  const includeId = useId();
  const name = candidate.title || `Note ${index + 1}`;

  return (
    <li className={cardClasses()}>
      <div className="flex flex-wrap items-start gap-3 p-4">
        <label
          htmlFor={includeId}
          className="flex min-h-11 items-center gap-3 text-sm text-ink-soft"
        >
          <input
            id={includeId}
            type="checkbox"
            checked={candidate.include}
            onChange={(event) => onChange({ include: event.target.checked })}
            className="size-5 rounded border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          <span className="sr-only">Include {name}</span>
        </label>

        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-ink">{name}</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {[
              candidate.date || 'No date',
              KIND_LABELS[candidate.kind],
              candidate.ref ? labelRef(candidate.ref) : null,
              candidate.page ? `page ${candidate.page}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {/* Review flags as words, never as a colour on its own. */}
          {candidate.reasons.length > 0 || duplicateOf ? (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {duplicateOf ? <Tag>Already in your journal: {duplicateOf}</Tag> : null}
              {candidate.reasons.map((reason) => (
                <Tag key={reason}>{REASON_TEXT[reason]}</Tag>
              ))}
            </p>
          ) : null}
        </div>

        <Button aria-expanded={open} onClick={onToggleOpen}>
          {open ? 'Close' : 'Review'}
        </Button>
      </div>

      {open ? (
        <div className="border-t border-line p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`Title for ${name}`}
              value={candidate.title}
              onChange={(event) => onChange({ title: event.target.value })}
            />
            <Field
              label={`Date for ${name}`}
              type="date"
              hint="Left empty, the entry is filed without one."
              value={candidate.date}
              onChange={(event) => onChange({ date: event.target.value })}
            />
            <Select
              label={`Type for ${name}`}
              value={candidate.kind}
              onChange={(event) => onChange({ kind: event.target.value as EntryKind })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </Select>
            <Select
              label={`Bible reference for ${name}`}
              hint="Only references found in the text are offered."
              value={candidate.ref ? labelRef(candidate.ref) : ''}
              onChange={(event) => {
                const hit = candidate.detectedRefs.find((r) => r.label === event.target.value);
                onChange({ ref: hit?.ref });
              }}
            >
              <option value="">No reference</option>
              {candidate.detectedRefs.map((hit) => (
                <option key={hit.label} value={hit.label}>
                  {hit.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-4">
            <MarkdownEditor
              label={`Notes for ${name}`}
              hint="What was taught. Formatting is kept as plain Markdown."
              rows={8}
              value={candidate.body}
              onChange={(body) => onChange({ body })}
            />
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Any other references found in this note are kept on the entry alongside the one chosen
            above.
          </p>
        </div>
      ) : null}
    </li>
  );
}
