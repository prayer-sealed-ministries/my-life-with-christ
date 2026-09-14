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
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';

export function Button({
  variant = 'secondary',
  className = '',
  ref,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary:
      'bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
    secondary:
      'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
    danger:
      'border border-red-300 bg-white text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-slate-700',
    ghost: 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} ${variants[variant]} ${className}`}
      {...rest}
    />
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
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={`mt-1 block w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${FOCUS}`}
        {...rest}
      />
    </div>
  );
}

export function TextArea({
  label,
  hint,
  className = '',
  ...rest
}: { label: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={`mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base leading-relaxed text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${FOCUS}`}
        {...rest}
      />
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60 ${className}`}
    >
      {children}
    </div>
  );
}

/** A short label. Never the only carrier of meaning — always paired with text. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
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
    <p role="status" className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
      {label}…
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
      <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {children ? <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{children}</div> : null}
    </div>
  );
}
