/**
 * Whatever is currently on top, and how to dismiss it.
 *
 * A one-entry registry, so the Android back binding can ask "is something modal
 * open?" without the shell importing the platform layer and without the
 * platform layer importing a view. The composition root wires the two together;
 * neither end learns about the other.
 *
 * Deliberately not React state: the back handler is a native callback that runs
 * outside the render tree, and threading a ref through context to reach it would
 * be more machinery than one module-level variable with a clear owner.
 */

let dismiss: (() => void) | null = null;

/** Called by the overlay while it is open; call with `null` when it closes. */
export function registerOverlay(close: (() => void) | null): void {
  dismiss = close;
}

/** Is something modal on top right now? */
export function overlayOpen(): boolean {
  return dismiss !== null;
}

/** Dismiss it. Returns false when there was nothing to dismiss. */
export function closeOverlay(): boolean {
  if (!dismiss) return false;
  dismiss();
  return true;
}
