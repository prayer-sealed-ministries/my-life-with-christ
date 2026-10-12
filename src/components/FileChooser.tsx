/**
 * Asking for a file, in whichever shape the edition's picker takes.
 *
 * There is one picker architecture here — `FilePicker` in the platform layer —
 * and two ways of presenting it. On the web the page must draw an
 * `<input type="file">`, which is keyboard reachable, label-associated and
 * covered by the accessibility suite. On a native edition the operating system
 * draws the picker itself, so the page offers a button and gets out of the way.
 *
 * Which one is chosen by `presentsOwnUI`, a property of the CAPABILITY and not
 * a question about the platform. A view using this component never learns
 * where it is running, which is the boundary this repository holds.
 *
 * Extracted because a third copy was about to be written. DataView and
 * ImportView each grew their own before this existed; they behave identically
 * and should be moved onto this when something else takes them apart.
 */

import { useId, useRef, type ReactNode } from 'react';

import { usePlatform } from '../platform/context';
import { pickedFromDomFile } from '../platform/web';
import type { PickedFile } from '../platform/ports';

export function FileChooser({
  label,
  hint,
  accept,
  disabled,
  buttonLabel,
  onFile,
  onError,
}: {
  /** The control's accessible name. A real <label>, never a placeholder. */
  label: string;
  hint?: ReactNode;
  /** Extensions and media types to suggest. A hint to the picker, never a guarantee. */
  accept: string[];
  disabled?: boolean;
  /** What the native button says, where the system draws the picker. */
  buttonLabel: string;
  /** Called with the chosen file, or with null when the person cancelled. */
  onFile: (file: PickedFile | null) => void;
  /** Called when a chosen file or its provider could not be opened or read. */
  onError: (error: unknown) => void;
}) {
  const { picker } = usePlatform();
  const id = useId();
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-soft">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="mt-0.5 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}

      {picker.presentsOwnUI ? (
        <button
          id={id}
          type="button"
          aria-describedby={hint ? hintId : undefined}
          disabled={disabled}
          onClick={() => {
            void picker
              .pick({ accept })
              .then((file) => onFile(file))
              // Cancellation resolves to null. A rejected provider/read is a
              // different outcome and must stay visible to the person.
              .catch(onError);
          }}
          className="mt-1 block min-h-11 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      ) : (
        <input
          id={id}
          ref={inputRef}
          type="file"
          accept={accept.join(',')}
          aria-describedby={hint ? hintId : undefined}
          disabled={disabled}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            // Cleared so choosing the same file twice in a row still fires.
            event.target.value = '';
            if (chosen) void pickedFromDomFile(chosen).then(onFile).catch(onError);
            else onFile(null);
          }}
          className="mt-1 block w-full min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:min-h-9 file:rounded-control file:border-0 file:bg-raised file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
        />
      )}
    </div>
  );
}
