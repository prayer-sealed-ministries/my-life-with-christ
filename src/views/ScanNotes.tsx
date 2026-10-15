/**
 * Scan notes: photograph a page, read it on this device, review it, then decide.
 *
 * The review step is the feature, not a formality. Recognition is assistance;
 * what reaches the journal is what the person read and approved, in the field
 * they chose. Every state below is a change to a scan session and to nothing
 * else — `onAccept` is the only way out that touches an entry, and it is only
 * reachable from a button a person presses.
 *
 * Wording here avoids three things deliberately: the word OCR, any suggestion
 * that a page is sent anywhere, and any comment on somebody's handwriting. The
 * photograph is what can be blurry.
 */
import { useEffect, useRef, useState } from 'react';

import { Button, Spinner, TextArea } from '../components/ui';
import { usePlatform } from '../platform/context';
import type { ScannedPage } from '../platform/ports';
import {
  acceptScan,
  canAccept,
  failureMessage,
  isScanFailure,
  newScanSession,
  reduceScan,
  type ScanAcceptance,
  type ScanDestination,
  type ScanSession,
} from '../scan/session';

interface ScanNotesProps {
  /** Applied only when a person presses Use text. */
  onAccept(acceptance: ScanAcceptance): void;
  onClose(): void;
  /** Whether each destination already holds writing, so we can say so. */
  existing: { notes: boolean; providedNotes: boolean };
}

const DESTINATIONS: Array<{ value: ScanDestination; label: string; hint: string }> = [
  { value: 'notes', label: 'My Notes', hint: 'Words you wrote, or are copying in as your own.' },
  { value: 'providedNotes', label: 'Provided notes', hint: 'A handout or someone else’s material.' },
];

export function ScanNotes({ onAccept, onClose, existing }: ScanNotesProps) {
  const { scanner } = usePlatform();
  const [session, setSession] = useState<ScanSession>(newScanSession);
  const [busy, setBusy] = useState(false);
  const [ignoreBlur, setIgnoreBlur] = useState(false);
  const accepted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  /** The page the cleanup effect should throw away. A ref, so it is current. */
  const held = useRef<ScannedPage | undefined>(undefined);

  // Opening the sheet moves focus to its heading, so a screen reader announces
  // where it has arrived rather than leaving focus behind on the editor.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Kept in an effect rather than assigned during render: a ref written while
  // rendering is a lie under StrictMode's double invocation, and this one
  // decides whether a file is deleted.
  useEffect(() => {
    held.current = session.page;
  }, [session.page]);

  /*
    Whatever else happens, the photograph goes.

    Cancel and Use text both discard explicitly, but neither runs when the tree
    is torn down underneath this sheet — and that is not a hypothetical. App
    Lock does exactly that: on Android, opening the camera backgrounds the app,
    and a lock timeout of "Immediately" means the gate unmounts everything
    before the person is back. Without this, a photograph of somebody's
    notebook would sit in the cache until the next cold start swept it.
  */
  useEffect(
    () => () => {
      if (held.current) void scanner.discard(held.current);
    },
    [scanner],
  );

  /**
   * Throw our temporary copy away whenever a page stops being the one in hand.
   *
   * Also forgets it, so the cleanup effect above does not discard the same
   * page a second time on the way out. `discard` is documented as safe to call
   * twice and this is not a correctness fix — it is so that "how many times was
   * a photograph deleted" has one obvious answer.
   */
  const release = (page: ScannedPage | undefined) => {
    if (page) void scanner.discard(page);
    held.current = undefined;
  };

  const acquire = async (how: 'capture' | 'choose') => {
    if (busy) return;
    setBusy(true);
    setIgnoreBlur(false);
    release(session.page);

    // Bump the generation first: anything still in flight for the previous page
    // is now stale and will be ignored when it lands.
    let next = reduceScan(session, { type: 'acquiring' });
    setSession(next);
    const generation = next.generation;

    const result = how === 'capture' ? await scanner.capture() : await scanner.choose();
    if (isScanFailure(result)) {
      setBusy(false);
      setSession((current) => reduceScan(current, { type: 'failed', failure: result, generation }));
      return;
    }

    next = reduceScan(next, { type: 'acquired', page: result, generation });
    setSession(next);

    const recognition = await scanner.recognise(result);
    setBusy(false);
    setSession((current) =>
      isScanFailure(recognition)
        ? reduceScan(current, { type: 'failed', failure: recognition, generation })
        : reduceScan(current, { type: 'recognised', recognition, generation }),
    );
  };

  const cancel = () => {
    release(session.page);
    setSession(newScanSession());
    onClose();
  };

  const use = () => {
    // Fenced against a double press: one approval is one insertion.
    if (accepted.current) return;
    const acceptance = acceptScan(session);
    if (!acceptance) return;
    accepted.current = true;
    release(session.page);
    onAccept(acceptance);
    onClose();
  };

  const failure = session.stage === 'failed' && session.failure ? failureMessage(session.failure) : '';
  const destinationHasText =
    session.destination === 'notes'
      ? existing.notes
      : session.destination === 'providedNotes'
        ? existing.providedNotes
        : false;

  return (
    <section
      aria-labelledby="scan-notes-heading"
      className="flex flex-col gap-4 rounded-2xl border border-stone-300 bg-white p-4 dark:border-stone-600 dark:bg-stone-900"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="scan-notes-heading"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold text-stone-900 outline-none dark:text-stone-50"
          >
            Scan notes
          </h2>
          <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
            Take a photo of printed notes or clear handwriting.
          </p>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Text recognition happens on this device. Your page isn’t uploaded for recognition.
          </p>
        </div>
      </header>

      {session.stage === 'idle' || session.stage === 'failed' ? (
        <div className="flex flex-col gap-3">
          {failure ? (
            <p role="alert" className="text-sm text-stone-800 dark:text-stone-200">
              {failure}
            </p>
          ) : null}
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Printed notes usually work best. Clear handwriting may also be recognized.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void acquire('capture')} disabled={busy}>
              Take photo
            </Button>
            <Button variant="secondary" onClick={() => void acquire('choose')} disabled={busy}>
              Choose photo
            </Button>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {session.stage === 'acquiring' || session.stage === 'recognising' ? (
        <div className="flex items-center gap-3 py-6" aria-live="polite">
          <Spinner />
          <span className="text-sm text-stone-700 dark:text-stone-300">Reading your page…</span>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}

      {session.stage === 'reviewing' && session.page ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* The page itself, large enough to actually check the words against. */}
          <div className="lg:w-1/2">
            <img
              src={session.page.preview}
              alt="Scanned page preview"
              className="max-h-80 w-full rounded-lg border border-stone-300 object-contain dark:border-stone-600 lg:max-h-[32rem]"
            />
            {session.page.blurWarning && !ignoreBlur ? (
              <div role="alert" className="mt-2 rounded-lg border border-stone-300 p-3 dark:border-stone-600">
                <p className="text-sm text-stone-800 dark:text-stone-200">
                  This page may be too blurry to read clearly.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button onClick={() => void acquire('capture')}>Retake</Button>
                  <Button variant="secondary" onClick={() => setIgnoreBlur(true)}>
                    Use anyway
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 lg:w-1/2">
            {/*
              The shared TextArea owns its own <label> and hint, which is what
              the accessibility suite checks for: a placeholder is never allowed
              to stand in for a label.
            */}
            <TextArea
              id="scan-transcription"
              label="Transcription"
              hint="Compare the transcription with your page and correct anything that wasn’t read clearly."
              rows={10}
              value={session.draftText}
              onChange={(event) =>
                setSession((current) => reduceScan(current, { type: 'edited', text: event.target.value }))
              }
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-stone-900 dark:text-stone-100">
                Add this text to
              </legend>
              {/*
                No default. A photograph cannot tell you who wrote the page —
                somebody may photograph their own notebook, a church handout, or
                a friend's notes — so the person chooses every time.
              */}
              {DESTINATIONS.map((option) => (
                <div key={option.value}>
                  {/*
                    The hint sits outside the label and is attached with
                    aria-describedby. Inside it, it would be read as part of the
                    radio's name — "My Notes, Words you wrote, or are copying in
                    as your own" every time focus moved — when it is a
                    description, not what the option is called.
                  */}
                  <label
                    htmlFor={`scan-destination-${option.value}`}
                    className="flex items-center gap-2 text-sm font-medium text-stone-800 dark:text-stone-200"
                  >
                    <input
                      id={`scan-destination-${option.value}`}
                      type="radio"
                      name="scan-destination"
                      value={option.value}
                      checked={session.destination === option.value}
                      aria-describedby={`scan-destination-${option.value}-hint`}
                      onChange={() =>
                        setSession((current) =>
                          reduceScan(current, { type: 'destination', destination: option.value }),
                        )
                      }
                    />
                    {option.label}
                  </label>
                  <p
                    id={`scan-destination-${option.value}-hint`}
                    className="ml-6 text-sm text-stone-600 dark:text-stone-400"
                  >
                    {option.hint}
                  </p>
                </div>
              ))}
            </fieldset>

            {destinationHasText ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-stone-900 dark:text-stone-100">
                  There’s already writing there
                </legend>
                <label
                  htmlFor="scan-placement-append"
                  className="flex items-center gap-2 text-sm text-stone-800 dark:text-stone-200"
                >
                  <input
                    id="scan-placement-append"
                    type="radio"
                    name="scan-placement"
                    checked={session.placement === 'append'}
                    onChange={() => setSession((c) => reduceScan(c, { type: 'placement', placement: 'append' }))}
                  />
                  Add below existing text
                </label>
                <label
                  htmlFor="scan-placement-replace"
                  className="flex items-center gap-2 text-sm text-stone-800 dark:text-stone-200"
                >
                  <input
                    id="scan-placement-replace"
                    type="radio"
                    name="scan-placement"
                    checked={session.placement === 'replace'}
                    onChange={() => setSession((c) => reduceScan(c, { type: 'placement', placement: 'replace' }))}
                  />
                  Replace existing text
                </label>
                {session.placement === 'replace' ? (
                  <p role="alert" className="text-sm text-stone-700 dark:text-stone-300">
                    Replacing removes what’s there now.
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={use} disabled={!canAccept(session)}>
                Use text
              </Button>
              <Button variant="secondary" onClick={() => void acquire('capture')}>
                Retake
              </Button>
              <Button variant="secondary" onClick={() => void acquire('choose')}>
                Choose another
              </Button>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </div>
            {!canAccept(session) && session.draftText.trim().length > 0 ? (
              <p className="text-sm text-stone-600 dark:text-stone-400">
                Choose where this text should go.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
