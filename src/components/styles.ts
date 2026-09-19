/**
 * The shared visual vocabulary, as class strings.
 *
 * Separate from `ui.tsx` for two reasons. The mechanical one is that a module
 * exporting both components and plain functions breaks React Fast Refresh, and
 * the lint rule says so. The real one is that these are the design system
 * itself: a view that needs a card surface but not a `<Card>` should be able to
 * reach for the same tokens rather than re-typing a background, a border and a
 * radius — which is how two shades of the same surface came to sit side by side
 * on components meant to look identical.
 *
 * Colours here are all semantic tokens from index.css, so none of them carries
 * a `dark:` variant: one class follows the theme by itself.
 */

/**
 * Visible focus, named against the page rather than inherited.
 *
 * `outline-current` is right for ordinary text and wrong for a filled control:
 * a control whose own ink matches the page behind it draws a ring nobody can
 * see, which is a 2.4.7 failure.
 */
export const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';

/** One card surface, used by every panel in the app. */
export const SURFACE = 'rounded-card border border-line bg-surface';

/** The same surface, when the whole card is a link or a button. */
export const SURFACE_INTERACTIVE = `${SURFACE} transition-colors hover:bg-raised ${FOCUS}`;

/**
 * Every control that takes typing or a choice. One height, one radius.
 *
 * Split into a base and its spacing so a tighter variant can be *chosen*
 * rather than overridden. Appending `px-2` to a string that already says
 * `px-3` does not win: both sit in the utilities layer and the cascade decides
 * between them by their order in the generated stylesheet, not by their order
 * in the class attribute. The focus bar was written that way and rendered at
 * the full padding — the same trap the card helper below exists to avoid, and
 * it cost the bar 16px of a 240px line at 200% text.
 */
const CONTROL_BASE =
  'block w-full min-w-0 max-w-full min-h-11 rounded-control border border-line-strong bg-surface text-ink';

export const CONTROL = `${CONTROL_BASE} px-3 py-2 text-base`;

/**
 * The same control, tightened for a bar rather than a form.
 *
 * Only the horizontal padding changes. The height — and with it the touch
 * target — is the shared `min-h-11`, because a compact bar is a narrower place
 * to put a control, not a smaller thing to hit.
 */
export const CONTROL_COMPACT = `${CONTROL_BASE} px-2 py-2 text-sm`;

/**
 * The classes for one card, tone included — never a base plus an override.
 *
 * That distinction is the whole reason this is a function. Appending
 * `bg-accent-soft` after a string already containing `bg-surface` does NOT win:
 * both are background utilities, and Tailwind decides between them by their
 * order in the generated stylesheet, not by their order in the class attribute.
 * The featured card on the front page was written that way and rendered with
 * the ordinary surface colour — looking, once again, like the other three.
 *
 * So the tone is chosen once and exactly one background class is emitted.
 */
export function cardClasses({
  featured = false,
  interactive = false,
}: { featured?: boolean; interactive?: boolean } = {}): string {
  const tone = featured
    ? `border-accent bg-accent-soft${interactive ? ' hover:brightness-[0.97]' : ''}`
    : `border-line bg-surface${interactive ? ' hover:bg-raised' : ''}`;
  return `rounded-card border ${tone}${interactive ? ` transition-colors ${FOCUS}` : ''}`;
}
