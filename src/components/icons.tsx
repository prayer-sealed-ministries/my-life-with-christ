/**
 * The few line icons Home needs, drawn here rather than installed.
 *
 * Four quick actions and a book do not justify an icon package: a dependency
 * would ship hundreds of glyphs, a licence and an upgrade path in exchange for
 * five shapes. These are 24×24 stroked paths on `currentColor`, so they take
 * the colour of whatever they sit in and need no dark-mode variants.
 *
 * Every one is `aria-hidden`. The label beside an icon is the accessible name;
 * an icon that also announced itself would say everything twice.
 */

interface IconProps {
  /** Tailwind sizing, so a caller can ask for a smaller one. */
  className?: string;
}

const base = (className?: string) => ({
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: className ?? 'h-6 w-6',
});

/** A pen over a line: writing something down as it is said. */
export function PenIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4 20h16" />
      <path d="M15.2 4.8a2 2 0 0 1 2.8 2.8L9.5 16.1 6 17l.9-3.5Z" />
    </svg>
  );
}

/** An open book. */
export function BookIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 6.5C10.6 5.2 8.6 4.6 6 4.6c-.7 0-1.3 0-1.9.1v13c.6-.1 1.2-.1 1.9-.1 2.6 0 4.6.6 6 1.9" />
      <path d="M12 6.5c1.4-1.3 3.4-1.9 6-1.9.7 0 1.3 0 1.9.1v13c-.6-.1-1.2-.1-1.9-.1-2.6 0-4.6.6-6 1.9" />
      <path d="M12 6.5v13" />
    </svg>
  );
}

/** Concentric rings: subjects gathered around a centre. */
export function TopicsIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.2v2.3M12 19.5v2.3M2.2 12h2.3M19.5 12h2.3" />
    </svg>
  );
}

/** A magnifier. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

/**
 * A lit candle.
 *
 * Praying hands were tried first and abandoned after three attempts: at one
 * stroke weight and 20 rendered pixels the shape read as a tulip, then a
 * pencil, then a sailboat. Every version was a fair drawing of hands and none
 * of them survived being small, which is the only size this icon is ever used
 * at. A candle is unambiguous at any size, is as devotional a symbol as the
 * hands were, and sits beside a card that says "Prayer" in words.
 */
export function PrayIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3.2c1.5 1.7 2.3 2.9 2.3 3.9a2.3 2.3 0 0 1-4.6 0c0-1 .8-2.2 2.3-3.9Z" />
      <path d="M12 9.1v2.1" />
      <path d="M9.4 11.2h5.2a1 1 0 0 1 1 1v6.6H8.4v-6.6a1 1 0 0 1 1-1Z" />
      <path d="M6.8 18.8h10.4" />
    </svg>
  );
}

/**
 * A thought, trailing away: what this meant to me, rather than what was said.
 *
 * Not a speech bubble and not the concentric rings Topics already owns — a
 * water-reflection glyph was tried first and read as a landscape photograph.
 */
export function ReflectIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M8 4.8h8a3.2 3.2 0 0 1 3.2 3.2v3.6a3.2 3.2 0 0 1-3.2 3.2H8a3.2 3.2 0 0 1-3.2-3.2V8A3.2 3.2 0 0 1 8 4.8Z" />
      <circle cx="7.6" cy="17.6" r="1.3" />
      <circle cx="4.6" cy="20.4" r=".9" />
    </svg>
  );
}

/** A bound volume: the journal as it becomes a book. */
export function VolumeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M6.5 3.5h13v17h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M4.5 17.5h15" />
      <path d="M10 3.5v6l2.2-1.6L14.4 9.5v-6" />
    </svg>
  );
}

/** Four arrows pushing outward: give this box the whole screen. */
export function ExpandIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" />
    </svg>
  );
}

/** The same four arrows pulled back in: hand the screen back to the app. */
export function CollapseIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5" />
    </svg>
  );
}
