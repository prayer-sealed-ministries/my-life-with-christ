/**
 * Sharing one page of the journal.
 *
 * Nothing here writes to storage, and that is the design rather than an
 * accident of where it sits. A person chooses what to include, sees it, and
 * hands it to the operating system's own share sheet. Cancelling, a failed
 * render and a dismissed chooser all leave the journal exactly as it was,
 * because at no point has the journal been opened.
 *
 * WHAT IS OFF BY DEFAULT, AND WHY IT IS NOT A PREFERENCE
 *
 * Reflection, prayer and provided notes start unchecked. Rule 5 of this
 * repository: "Reflections and prayers require their own affirmative choice,
 * per share." The common share is "here are this morning's notes"; a person
 * doing that must not send their own spiritual response to the sermon because
 * they did not notice a switch. There is no undo for a message already sent.
 *
 * The selection is not remembered between shares for the same reason. A
 * setting that quietly persists "include my prayer" turns one considered
 * decision into every future share.
 */

import { useMemo, useState } from 'react';

import { Button, LiveRegion } from '../components/ui';
import { useSharer } from '../platform/context';
import {
  PRIVATE_BY_DEFAULT,
  buildSharedEntryDocument,
  renderSharedEntryText,
  scriptureReferences,
  sharedEntryFilename,
  type ShareScope,
} from '../share/entry-document';
import type { Entry } from '../types';

/** The switches, in the order they appear, with the wording a reader sees. */
const CHOICES: Array<{ key: keyof ShareScope; label: string; hint?: string }> = [
  { key: 'includeScripture', label: 'Scripture references' },
  { key: 'includeDetails', label: 'Speaker, place and series' },
  { key: 'includeNotes', label: 'My notes' },
  { key: 'includeReflection', label: 'My reflection', hint: 'What this meant to you' },
  { key: 'includePrayer', label: 'Prayer', hint: 'Off unless you choose it' },
  {
    key: 'includeProvidedNotes',
    label: 'Provided notes',
    hint: 'The material your church handed out',
  },
  { key: 'includeLinks', label: 'Links' },
];

export function ShareEntry({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const sharer = useSharer();
  const [selection, setSelection] = useState<ShareScope>(PRIVATE_BY_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  // Rebuilt on every change so the preview is never a stale description of
  // what will be sent. This is the same function both renderings use, so what
  // is shown IS what leaves.
  const document = useMemo(() => buildSharedEntryDocument(entry, selection), [entry, selection]);
  const preview = useMemo(() => renderSharedEntryText(document), [document]);

  /** Which switches would do nothing, because the entry has no such writing. */
  const empty: Partial<Record<keyof ShareScope, boolean>> = {
    // The same list the document builds, not `scriptureRefs` alone: a
    // reference chosen in the picker is an anchor, and checking only the typed
    // field greyed this switch out over an entry that had three.
    includeScripture: scriptureReferences(entry).length === 0,
    includeDetails: !entry.place && !entry.speaker && !entry.sermonSeries,
    includeNotes: !entry.notes.trim(),
    includeReflection: !entry.reflection.trim(),
    includePrayer: !(entry.prayer ?? '').trim(),
    includeProvidedNotes: !(entry.sourceMaterial?.body ?? '').trim(),
    includeLinks: entry.links.length === 0,
  };

  const nothingSelected = document.sections.length === 0;

  async function shareText() {
    await run(() => sharer.share({ title: document.title, text: preview }));
  }

  async function sharePdf() {
    await run(async () => {
      // Loaded here and nowhere else: a reader who never shares a PDF never
      // downloads a PDF writer.
      const { renderSharedEntryPdf } = await import('../share/pdf');
      const bytes = await renderSharedEntryPdf(document);
      return sharer.share({
        title: document.title,
        file: {
          filename: sharedEntryFilename(document, 'pdf'),
          mimeType: 'application/pdf',
          bytes,
        },
      });
    });
  }

  async function run(action: () => Promise<{ shared: boolean }>) {
    setError('');
    setBusy(true);
    try {
      const { shared } = await action();
      // A dismissed share sheet is a choice, not a fault. Nothing is said
      // about it and nothing has changed.
      setAnnouncement(shared ? 'Shared.' : '');
      if (shared) onClose();
    } catch {
      setError('That could not be shared. Nothing has left this device, and your entry is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="share-entry-heading"
      className="mt-6 rounded-card border border-line-strong bg-surface p-4"
    >
      <h2 id="share-entry-heading" className="font-serif text-lg font-semibold text-ink">
        Share this entry
      </h2>
      <p className="measure mt-1 text-sm text-ink-soft">
        One entry, and only what you tick. Nothing else from your journal goes with it.
      </p>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink-soft">What to include</legend>
        <ul className="mt-2 space-y-1">
          {CHOICES.map((choice) => (
            <li key={choice.key}>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={selection[choice.key]}
                  disabled={empty[choice.key]}
                  onChange={(event) =>
                    setSelection((current) => ({ ...current, [choice.key]: event.target.checked }))
                  }
                />
                <span className={empty[choice.key] ? 'text-ink-muted' : 'text-ink'}>
                  {choice.label}
                  {empty[choice.key] ? (
                    <span className="block text-xs text-ink-muted">Nothing written here</span>
                  ) : choice.hint ? (
                    <span className="block text-xs text-ink-muted">{choice.hint}</span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <h3 className="mt-4 text-sm font-medium text-ink-soft">What will be sent</h3>
      {/* The exact text, not a description of it. Somebody about to send their
          writing to another person is entitled to read it first. */}
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-app p-3 text-sm text-ink">
        {nothingSelected && document.scripture.length === 0 ? 'Nothing selected yet.' : preview}
      </pre>

      {error ? (
        <p
          role="alert"
          className="mt-3 break-words rounded-control border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="primary" disabled={busy || nothingSelected} onClick={() => void sharePdf()}>
          {busy ? 'Preparing…' : 'Share as PDF'}
        </Button>
        <Button disabled={busy || nothingSelected} onClick={() => void shareText()}>
          Share as text
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>

      <LiveRegion message={error || announcement} />
    </section>
  );
}
