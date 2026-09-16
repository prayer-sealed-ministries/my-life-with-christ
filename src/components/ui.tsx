/**
 * The small set of shared primitives.
 *
 * Accessibility is a stated non-negotiable, so the rules live here rather than
 * being re-derived per view: every interactive element is a real button or
 * anchor, focus is always visible, touch targets clear 44px, and colour never
 * carries meaning on its own.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react';

import { CONTROL, FOCUS, SURFACE } from './styles';

export function Button({
  variant = 'secondary',
  className = '',
  ref,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  // One height, one radius, one weight across all four. Only colour and border
  // differ, because only emphasis differs.
  const variants = {
    primary: 'border border-accent bg-accent text-accent-ink hover:bg-accent-hover',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-raised',
    danger:
      'border border-red-400 bg-surface text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40',
    ghost: 'border border-transparent text-ink-soft hover:bg-raised',
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

const LABEL = 'text-sm font-medium text-ink-soft';
const HINT = 'text-xs text-ink-muted';

/**
 * The shared skeleton every field uses: label, helper, control — three grid rows.
 *
 * The helper row is *reserved even when empty*. That is the whole point. Two
 * fields side by side where only one carries helper text used to leave their
 * controls on different baselines, because each field stacked its own parts and
 * the taller one pushed its control down. With `grid-rows-subgrid` both fields
 * borrow the row track from the row container, so the label row, the helper row
 * and the control row each line up across the whole row — no margin guessing,
 * and it holds however long the helper text wraps.
 */
export function FieldShell({
  label,
  hint,
  htmlFor,
  hintId,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  hintId?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // `min-w-0` matters more than it looks: a grid item defaults to a minimum
    // of its content's intrinsic width, and <input type="date"> carries a wide
    // one because of its picker UI. At 200% text in a 320px viewport that
    // pushed the whole page sideways rather than letting the field shrink.
    // `grid-cols-1` is load-bearing, not decoration. Tailwind's grid-cols-1 is
    // `minmax(0, 1fr)`, which caps the column at the container. Without it the
    // implicit `auto` track is sized to the widest child's min-content — and
    // <input type="date"> carries a large intrinsic width from its picker UI,
    // so the track grew to 313px inside a 190px shell and every sibling,
    // labels included, stretched out with it.
    <div
      className={`grid min-w-0 grid-cols-1 content-start gap-1 sm:row-span-3 sm:grid-rows-subgrid ${className}`}
    >
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
      </label>
      {/* Empty but present: the row must exist so controls stay aligned. */}
      {hint ? (
        <p id={hintId} className={HINT}>
          {hint}
        </p>
      ) : (
        <div aria-hidden="true" />
      )}
      <div>{children}</div>
    </div>
  );
}

/** The row container fields sit in, supplying the tracks they subgrid onto. */
export function FieldRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid min-w-0 grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 sm:grid-rows-[auto_auto_auto] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A labelled text field.
 *
 * The label is always rendered and always associated — a placeholder is not a
 * label, and a field whose only cue disappears on focus fails 3.3.2.
 */
export function Field({
  label,
  hint,
  className = '',
  ...rest
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <FieldShell label={label} hint={hint} htmlFor={id} hintId={hintId} className={className}>
      <input id={id} aria-describedby={hint ? hintId : undefined} className={`${CONTROL} ${FOCUS}`} {...rest} />
    </FieldShell>
  );
}

/** A labelled select, sharing the field skeleton so it aligns with the rest. */
export function Select({
  label,
  hint,
  className = '',
  children,
  ...rest
}: { label: string; hint?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <FieldShell label={label} hint={hint} htmlFor={id} hintId={hintId} className={className}>
      <select id={id} aria-describedby={hint ? hintId : undefined} className={`${CONTROL} ${FOCUS}`} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

/**
 * A labelled textarea that grows with what is typed.
 *
 * `rows` sets where it starts, not where it stops. A box that opens half a
 * screen tall is mostly dead space on a desktop, and one that never grows makes
 * a long note a scroll-within-a-scroll on a phone — so it begins small and
 * follows the text.
 *
 * The resize handle is deliberately kept. Auto-growing overrides a manual drag
 * on the next keystroke, which is the same trade most editors make: the handle
 * is there for reading back a long note, and typing resumes the automatic fit.
 */
export function TextArea({
  label,
  hint,
  className = '',
  autoGrow = true,
  maxRows = 24,
  onChange,
  value,
  ...rest
}: {
  label: string;
  hint?: string;
  autoGrow?: boolean;
  maxRows?: number;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const ref = useRef<HTMLTextAreaElement>(null);

  const minRows = Number(rest.rows ?? 6);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !autoGrow) return;
    const style = getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);

    el.style.height = 'auto';
    const wanted = Math.max(el.scrollHeight, minRows * lineHeight + padding);
    el.style.height = `${Math.min(wanted, maxRows * lineHeight + padding)}px`;
  }, [autoGrow, maxRows, minRows]);

  // Fit on mount and whenever the value changes from outside (loading an entry
  // to edit), not only on keystrokes.
  useLayoutEffect(fit, [fit, value]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  return (
    <FieldShell label={label} hint={hint} htmlFor={id} hintId={hintId} className={className}>
      <textarea
        ref={ref}
        id={id}
        value={value}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => {
          fit();
          onChange?.(event);
        }}
        className={`resize-y py-3 leading-relaxed ${CONTROL} ${FOCUS}`}
        {...rest}
      />
    </FieldShell>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`${SURFACE} p-5 ${className}`}>{children}</div>;
}

/** A short label. Never the only carrier of meaning — always paired with text. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-pill bg-raised px-2.5 py-0.5 text-xs font-medium text-ink-soft">
      {children}
    </span>
  );
}

/** Announce something to assistive tech without stealing focus. */
export function LiveRegion({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-center text-sm text-ink-muted">
      {label}…
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong p-8 text-center">
      <p className="font-medium text-ink-soft">{title}</p>
      {children ? <div className="mt-2 text-sm text-ink-muted">{children}</div> : null}
    </div>
  );
}
