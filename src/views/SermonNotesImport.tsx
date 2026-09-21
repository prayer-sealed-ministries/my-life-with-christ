/**
 * Bringing a church's sermon notes into an entry the reader is about to write.
 *
 * Nothing here writes to storage, and that is the design rather than an
 * accident of where it sits. A file is chosen, parsed, shown, and only then —
 * on an explicit press — handed to the editor as a proposal. Parsing that
 * fails, validation that fails, and a person who changes their mind all leave
 * the journal in exactly the state they found it, because at no point has the
 * journal been touched.
 *
 * The other half of the design is whose words these are. What comes out of
 * here is `SourceMaterial`, which the editor renders under its own heading and
 * never puts in `notes`. The reader's Notes, Reflection and Prayer are as
 * empty after an import as they are on any blank entry — the handout is what
 * they were given, not what they wrote.
 */

import { useEffect, useRef, useState } from 'react';

import { FileChooser } from '../components/FileChooser';
import { Button, LiveRegion, Spinner } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ImportError } from '../import/limits';
import { acceptIncomingDocument, type IncomingDocument } from '../import/incoming';
import {
  MAX_SERMON_NOTES_BYTES,
  SERMON_NOTES_ACCEPT,
  readSermonNotes,
  type SermonNotesProposal,
} from '../import/sermon-notes';
import { describeBytes } from '../import/limits';
import { describeProvenance } from '../lib/provided-notes';
import { formatDay } from '../lib/dates';
import type { PickedFile } from '../platform/ports';

/** How much of the material the preview shows. Enough to recognise, not to read. */
const PREVIEW_CHARS = 700;

function previewOf(body: string): { text: string; truncated: boolean } {
  if (body.length <= PREVIEW_CHARS) return { text: body, truncated: false };
  return { text: `${body.slice(0, PREVIEW_CHARS).trimEnd()}…`, truncated: true };
}

export function SermonNotesImport({
  /** True when the entry already carries provided notes this would replace. */
  replacing,
  /**
   * A document the operating system handed over, rather than one picked here.
   *
   * The only difference a share makes: the bytes are already in hand, so the
   * file chooser is skipped. Everything after this point — the gate, the
   * parser, the preview, the explicit press — is the same code on both paths,
   * because there is one importer and a second one would be a second set of
   * rules about somebody else's words.
   */
  incoming,
  onUse,
  onCancel,
}: {
  replacing: boolean;
  incoming?: IncomingDocument | null;
  onUse: (proposal: SermonNotesProposal) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<SermonNotesProposal | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  async function onFile(file: PickedFile | null) {
    // Cancelling is an ordinary outcome. No error, no state, nothing changed.
    if (!file) return;

    setError('');
    setProposal(null);
    setBusy(true);
    try {
      setProposal(await readSermonNotes(file.bytes, file.name));
    } catch (cause) {
      // An ImportError carries wording written for a person. Anything else is
      // a library's internal message and must not reach the screen.
      setError(
        cause instanceof ImportError
          ? cause.message
          : 'That file could not be read. It may be damaged, or in a format this app does not import.',
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * Read a shared document once.
   *
   * Guarded by a ref rather than by the effect's dependencies: React runs
   * effects twice in development StrictMode, and a second parse must not
   * happen. It is not merely wasted work for a PDF — pdfjs takes ownership of
   * the buffer it is handed and DETACHES it, so a second read of the same
   * bytes finds a zero-length array and reports "That file is empty" about a
   * document that is nothing of the kind.
   */
  const read = useRef<IncomingDocument | null>(null);
  useEffect(() => {
    if (!incoming || read.current === incoming) return;
    read.current = incoming;

    let cancelled = false;
    setError('');
    setProposal(null);
    setBusy(true);

    void (async () => {
      try {
        // The gate first — a name and a media type chosen by the sender are
        // hints, and the bytes settle any disagreement — then the same parser
        // a picked file reaches.
        const accepted = acceptIncomingDocument(incoming);
        const result = await readSermonNotes(accepted.bytes, accepted.filename);
        if (!cancelled) setProposal(result);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof ImportError
            ? cause.message
            : 'That file could not be read. It may be damaged, or in a format this app does not import.',
        );
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [incoming]);

  const material = proposal?.material;
  const facts: Array<[string, string]> = [];
  if (proposal && material) {
    if (proposal.suggested.title) facts.push(['Title', proposal.suggested.title]);
    if (material.church) facts.push(['Church', material.church]);
    if (material.speaker) facts.push(['Speaker', material.speaker]);
    if (material.date) facts.push(['Date', formatDay(material.date)]);
    if (material.scripture?.length) facts.push(['Scripture', material.scripture.join(', ')]);
    facts.push(['File', material.filename]);
    facts.push([
      'Length',
      proposal.pages
        ? `${proposal.characters.toLocaleString()} characters from ${proposal.pages} ${
            proposal.pages === 1 ? 'page' : 'pages'
          }`
        : `${proposal.characters.toLocaleString()} characters`,
    ]);
  }

  const preview = material ? previewOf(material.body) : null;

  return (
    <section
      aria-labelledby="sermon-notes-import-heading"
      className="mt-6 rounded-card border border-line-strong bg-surface p-4"
    >
      <h2
        id="sermon-notes-import-heading"
        className="font-serif text-lg font-semibold text-ink"
      >
        Import church notes
      </h2>
      <p className="measure mt-1 text-sm text-ink-soft">
        Notes your church handed out. They are kept as provided notes, under their own
        heading — your own writing stays yours and starts blank.
      </p>

      {proposal === null ? (
        <div className="mt-4">
          <FileChooser
            label="Sermon notes file"
            hint={
              <>
                A .txt, .md, .json or text-based .pdf file, up to{' '}
                {describeBytes(MAX_SERMON_NOTES_BYTES)}. Nothing leaves this device.
              </>
            }
            accept={SERMON_NOTES_ACCEPT}
            disabled={busy}
            buttonLabel="Choose a file…"
            onFile={(file) => void onFile(file)}
          />

          {busy ? <Spinner label="Reading the file" /> : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 break-words rounded-control border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-4">
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          {/* What is about to happen, before it happens. */}
          <h3 className="font-serif text-base font-semibold text-ink">
            {describeProvenance(material!)}
          </h3>

          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm min-[26rem]:grid-cols-[auto_1fr]">
            {facts.map(([term, value]) => (
              <div key={term} className="min-[26rem]:contents">
                <dt className="font-medium text-ink-soft min-[26rem]:text-right">{term}</dt>
                <dd className="break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <h4 className="mt-4 text-sm font-medium text-ink-soft">
            {preview!.truncated ? 'The first part of these notes' : 'These notes'}
          </h4>
          {/* Rendered by the journal's own Markdown component, which produces
              React elements and never an HTML string. A script tag in a
              church's file is characters on a page. */}
          <div className="mt-1 max-h-72 overflow-y-auto rounded-control border border-line bg-app p-3 text-sm">
            <Markdown source={preview!.text} />
          </div>

          {replacing && !confirmingReplace ? (
            <p className="mt-4 text-sm text-ink-soft">
              This entry already has provided notes. Using these will replace them.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            {replacing && !confirmingReplace ? (
              <Button variant="primary" onClick={() => setConfirmingReplace(true)}>
                Replace the provided notes
              </Button>
            ) : (
              <Button variant="primary" onClick={() => onUse(proposal)}>
                {replacing ? 'Yes, replace them' : 'Use these notes'}
              </Button>
            )}
            <Button
              onClick={() => {
                setProposal(null);
                setConfirmingReplace(false);
              }}
            >
              Choose a different file
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}

      <LiveRegion
        message={
          error ||
          (proposal
            ? `${proposal.characters.toLocaleString()} characters read from ${proposal.material.filename}. Nothing has been saved yet.`
            : '')
        }
      />
    </section>
  );
}
