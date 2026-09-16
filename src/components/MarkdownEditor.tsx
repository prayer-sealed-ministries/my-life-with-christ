/**
 * A writing box with a formatting toolbar, for people who do not know Markdown.
 *
 * It is a plain `<textarea>` underneath, and that is a deliberate choice rather
 * than a shortcut. A contenteditable rich-text surface stores HTML, and HTML in
 * the journal would mean sanitising it on the way in, on the way out, and in
 * every export for the next forty years. The field stays Markdown — which the
 * schema has always said it was — so the archive remains a folder of plain text
 * a grandchild can read without this app.
 *
 * UNDO. Every toolbar action writes through `document.execCommand('insertText')`
 * rather than by assigning to `textarea.value`. Assigning to `value` wipes the
 * browser's native undo stack, so a bolded word could not be un-bolded with
 * ctrl-Z and a whole paragraph of typing would be lost with it. Going through
 * the editing command keeps every action on that stack, which is where undo and
 * redo come from here — no history is reimplemented, because the browser's is
 * better than a hand-rolled one and already knows the platform's keys.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Markdown } from './Markdown';
import { CONTROL, FOCUS } from './styles';

interface Action {
  label: string;
  /** Spoken name, where the visible label is a symbol. */
  title: string;
  hint?: string;
  apply: (state: Selection) => Edit;
}

interface Selection {
  value: string;
  start: number;
  end: number;
  selected: string;
  /** The whole line(s) the selection sits on. */
  lineStart: number;
  lineEnd: number;
}

interface Edit {
  /** Replacement text for the range below. */
  text: string;
  from: number;
  to: number;
  /** Where the caret should end up, relative to `from`. */
  caret?: number;
  selectLength?: number;
}

/** Wrap the selection, or drop a placeholder to type over. */
function wrap(state: Selection, marker: string, placeholder: string): Edit {
  const inner = state.selected || placeholder;
  const already =
    state.value.slice(state.start - marker.length, state.start) === marker &&
    state.value.slice(state.end, state.end + marker.length) === marker;

  // Toggling off: strip the markers that are already there.
  if (already) {
    return {
      text: inner,
      from: state.start - marker.length,
      to: state.end + marker.length,
      selectLength: inner.length,
    };
  }
  return {
    text: `${marker}${inner}${marker}`,
    from: state.start,
    to: state.end,
    caret: marker.length,
    selectLength: inner.length,
  };
}

/** Put a prefix on every line the selection touches, or take it off again. */
function prefixLines(state: Selection, prefix: (index: number) => string): Edit {
  const block = state.value.slice(state.lineStart, state.lineEnd);
  const lines = block.split('\n');
  const pattern = /^(\s*)(#{1,6}\s+|[-*+]\s+|\d{1,3}[.)]\s+|>\s?)/;

  const allPrefixed = lines.every((line) => !line.trim() || line.startsWith(prefix(0)));
  const next = lines
    .map((line, index) => {
      if (!line.trim()) return line;
      const bare = line.replace(pattern, '');
      return allPrefixed ? bare : `${prefix(index)}${bare}`;
    })
    .join('\n');

  return { text: next, from: state.lineStart, to: state.lineEnd, selectLength: next.length };
}

const ACTIONS: Action[] = [
  { label: 'B', title: 'Bold', hint: 'Ctrl+B', apply: (s) => wrap(s, '**', 'bold text') },
  { label: 'I', title: 'Italic', hint: 'Ctrl+I', apply: (s) => wrap(s, '*', 'italic text') },
  { label: 'H', title: 'Heading', apply: (s) => prefixLines(s, () => '## ') },
  { label: '•', title: 'Bulleted list', apply: (s) => prefixLines(s, () => '- ') },
  { label: '1.', title: 'Numbered list', apply: (s) => prefixLines(s, (i) => `${i + 1}. `) },
  { label: '❝', title: 'Quote', apply: (s) => prefixLines(s, () => '> ') },
  {
    label: '🔗',
    title: 'Link',
    apply: (s) => {
      const text = s.selected || 'link text';
      const body = `[${text}](https://)`;
      return { text: body, from: s.start, to: s.end, caret: body.length - 1, selectLength: 0 };
    },
  },
];

const BUTTON =
  `inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-transparent px-2 text-sm font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-raised ${FOCUS}`;

export function MarkdownEditor({
  label,
  hint,
  value,
  onChange,
  rows = 8,
  className = '',
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    el.style.height = 'auto';
    const wanted = Math.max(el.scrollHeight, rows * lineHeight + padding);
    el.style.height = `${Math.min(wanted, 32 * lineHeight + padding)}px`;
  }, [rows]);

  useEffect(fit, [fit, value, preview]);

  const runAction = useCallback(
    (action: Action) => {
      const el = ref.current;
      if (!el) return;
      el.focus();

      const start = el.selectionStart;
      const end = el.selectionEnd;
      const text = el.value;
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const lineEndRaw = text.indexOf('\n', end);
      const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;

      const edit = action.apply({
        value: text,
        start,
        end,
        selected: text.slice(start, end),
        lineStart,
        lineEnd,
      });

      el.setSelectionRange(edit.from, edit.to);

      // The editing command, not `value =`, so this lands on the browser's own
      // undo stack and ctrl-Z puts it back exactly as typing would.
      const inserted =
        typeof document.execCommand === 'function' &&
        document.execCommand('insertText', false, edit.text);

      if (!inserted) {
        // Older or restricted engines: fall back so the button still works,
        // accepting that this one action will not be undoable.
        const next = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
        el.value = next;
        onChange(next);
      }

      const caret = edit.from + (edit.caret ?? 0);
      el.setSelectionRange(caret, caret + (edit.selectLength ?? 0));
      setAnnouncement(`${action.title} applied.`);
      fit();
    },
    [fit, onChange],
  );

  return (
    <div className={`grid min-w-0 grid-cols-1 content-start gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-ink-soft">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : (
        <div aria-hidden="true" />
      )}

      <div>
        {/* A real toolbar, so a screen reader announces it as one and arrow-key
            conventions apply. Every control is a button with a spoken name; the
            symbols on them are decorative and never the only label. */}
        <div
          role="toolbar"
          aria-label={`Formatting for ${label}`}
          aria-controls={id}
          className="flex flex-wrap items-center gap-0.5 rounded-t-control border border-line-strong border-b-0 bg-sunken px-1.5 py-1"
        >
          {ACTIONS.map((action) => (
            <button
              key={action.title}
              type="button"
              className={BUTTON}
              aria-label={action.hint ? `${action.title} (${action.hint})` : action.title}
              title={action.hint ? `${action.title} (${action.hint})` : action.title}
              disabled={preview}
              onClick={() => runAction(action)}
            >
              <span aria-hidden="true">{action.label}</span>
            </button>
          ))}

          <span className="ml-auto">
            <button
              type="button"
              className={BUTTON}
              aria-pressed={preview}
              onClick={() => setPreview((on) => !on)}
            >
              {preview ? 'Write' : 'Preview'}
            </button>
          </span>
        </div>

        {preview ? (
          <div
            className={`${CONTROL} rounded-t-none`}
            style={{ minHeight: `${rows * 1.6}rem` }}
            data-testid={`${id}-preview`}
          >
            {value.trim() ? (
              <Markdown source={value} />
            ) : (
              <p className="text-ink-muted">Nothing written yet.</p>
            )}
          </div>
        ) : (
          <textarea
            ref={ref}
            id={id}
            value={value}
            rows={rows}
            aria-describedby={hint ? hintId : undefined}
            onChange={(event) => {
              onChange(event.target.value);
              fit();
            }}
            onKeyDown={(event) => {
              // The two shortcuts people try without being told.
              const meta = event.metaKey || event.ctrlKey;
              if (!meta) return;
              const key = event.key.toLowerCase();
              if (key === 'b') {
                event.preventDefault();
                runAction(ACTIONS[0]);
              } else if (key === 'i') {
                event.preventDefault();
                runAction(ACTIONS[1]);
              }
            }}
            className={`resize-y rounded-t-none py-3 leading-relaxed ${CONTROL} ${FOCUS}`}
          />
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
