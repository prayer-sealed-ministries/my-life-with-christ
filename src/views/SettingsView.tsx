/**
 * Settings: deliberately small.
 *
 * A settings page is where products go to accumulate switches nobody asked
 * for, and every switch shown to a person is a promise that it does something.
 * So this holds exactly what exists today — the theme, which the app already
 * implements — plus a way to reach the journal's own page and a plain statement
 * of where the words live.
 *
 * Nothing here invents a second preference system: the theme comes from the
 * same `useTheme` the header has always used, so changing it in either place is
 * the same change.
 */

import { Link } from '../app/router';
import { useTheme, type ThemeChoice } from '../app/theme';

const THEMES: Array<{ value: ThemeChoice; label: string; hint: string }> = [
  { value: 'system', label: 'System', hint: 'Follow the device setting.' },
  { value: 'light', label: 'Light', hint: 'Always light.' },
  { value: 'dark', label: 'Dark', hint: 'Always dark.' },
];

export default function SettingsView() {
  const { choice, setChoice } = useTheme();

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="measure mt-2 text-sm leading-relaxed text-ink-soft">
          There is very little here on purpose. Anything this app can do, it does without asking
          you to configure it first.
        </p>
      </header>

      {/*
        A radio group rather than a <select>.

        The header keeps its compact select, which is right for a toolbar. Here
        there is room to show all three with their meanings, the selected one is
        announced as selected rather than as the value of a collapsed control,
        and it avoids the modal picker a native webview puts over a <select>.
      */}
      <section aria-labelledby="appearance" className="space-y-3">
        <h2 id="appearance" className="font-serif text-lg font-semibold">
          Appearance
        </h2>

        <fieldset>
          <legend className="text-sm font-medium text-ink-soft">Theme</legend>
          <div className="mt-2 space-y-2">
            {THEMES.map((option) => (
              <div
                key={option.value}
                className="flex min-h-11 items-start gap-3 rounded-card border border-line bg-surface px-3 py-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  id={`theme-${option.value}`}
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value)}
                  aria-describedby={`theme-${option.value}-hint`}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                {/* Associated by id rather than by wrapping: the control's name
                    is then exactly the option's name, and the hint is a
                    description rather than part of it. */}
                <label htmlFor={`theme-${option.value}`} className="min-w-0 cursor-pointer">
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span id={`theme-${option.value}-hint`} className="block text-xs text-ink-muted">
                    {option.hint}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="data" className="space-y-3">
        <h2 id="data" className="font-serif text-lg font-semibold">
          Data &amp; backup
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Your journal is stored on this device. Exporting creates a copy that belongs to you —
          keep one somewhere safe.
        </p>
        {/* The one place export and import live. Settings links to it rather
            than growing a second copy of the same screen. */}
        <Link
          to={{ name: 'data' }}
          className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Open Data &amp; Backup
        </Link>
      </section>

      <section aria-labelledby="privacy" className="space-y-3">
        <h2 id="privacy" className="font-serif text-lg font-semibold">
          Privacy
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          What you write stays on this device. There is no account, nothing is uploaded, and the
          app works with no network at all. If you save an export to a cloud folder, that is your
          choice and your copy — not something this app requires or arranges.
        </p>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          More detail is in{' '}
          <Link to={{ name: 'about' }} className="underline focus-visible:outline-2">
            About
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
