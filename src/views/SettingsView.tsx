/**
 * Settings: deliberately small.
 *
 * A settings page is where products go to accumulate switches nobody asked
 * for, and every switch shown to a person is a promise that it does something.
 * So this holds exactly what exists today — the theme and how often the app
 * asks about backing up — plus a way to reach the journal's own page and a
 * plain statement of where the words live.
 *
 * Nothing here invents a second preference system. The theme comes from the
 * same `useTheme` the header has always used. The reminder interval goes
 * through `StorageProvider` beside `lastExportAt`, because a setting that
 * drives the export reminder is not the kind of thing that may quietly vanish.
 */

import { Link } from '../app/router';
import AppLockSettings from './AppLockSettings';
import { useStorage } from '../app/storage';
import { useTheme, type ThemeChoice } from '../app/theme';
import {
  backupReminderDays,
  REMINDER_AFTER_DAYS,
  REMINDER_INTERVAL_CHOICES,
} from '../export/reminder';

const THEMES: Array<{ value: ThemeChoice; label: string; hint: string }> = [
  { value: 'system', label: 'System', hint: 'Follow the device setting.' },
  { value: 'light', label: 'Light', hint: 'Always light.' },
  { value: 'dark', label: 'Dark', hint: 'Always dark.' },
];

const intervalLabel = (days: number) => `${days} days`;

/**
 * How a chooseable row looks, selected or not.
 *
 * Derived from the value React already has, rather than from `:has(:checked)`.
 * Two reasons, and the second is the binding one:
 *
 *   - `:has()` did not reach WebKit until iOS 15.4, and this app's declared
 *     floor is iOS 15.0. On 15.0-15.3 the selected row had no accent border and
 *     no accent background — the choice was invisible bar the radio dot itself.
 *   - The hint inside a selected row has to change with it. Muted ink on the
 *     accent-soft background measures 3.69:1 in dark, under the 4.5:1 AA asks
 *     for; `text-ink-soft` measures 6.08:1 there and 7.74:1 in light, while the
 *     label above it stays at 10.21:1 and 14.61:1. So the row keeps its two
 *     levels of emphasis instead of flattening into one.
 *
 * `--ink-muted` itself is not wrong and is left alone: it meets AA on the
 * backgrounds it actually sits on elsewhere (5.00:1 dark, 5.99:1 light on an
 * unselected row). It fails on one background only, which is why the treatment
 * changes here rather than the token.
 */
const ROW_BASE = 'flex min-h-11 gap-3 rounded-card border px-3 py-2.5';

const rowClasses = (selected: boolean) =>
  `${ROW_BASE} ${selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`;

/** Secondary text inside a row, at a contrast the row's background can carry. */
const hintClasses = (selected: boolean) => (selected ? 'text-ink-soft' : 'text-ink-muted');

export default function SettingsView() {
  const { choice, setChoice } = useTheme();
  const { settings, updateSettings } = useStorage();
  const reminderDays = backupReminderDays(settings);

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
                className={`${rowClasses(choice === option.value)} items-start`}
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
                  <span
                    id={`theme-${option.value}-hint`}
                    className={`block text-xs ${hintClasses(choice === option.value)}`}
                  >
                    {option.hint}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      </section>

      {/*
        The same radio group as Appearance, for the same reasons — and one more
        that is specific here: a native webview puts a modal picker over a
        <select>, which is a poor way to answer a question about your own
        journal.

        What this does NOT do is change what is true. Choosing 90 days is a
        statement about how often somebody wants to be told, not a claim that
        their journal is safe, so the footer warning and the Data & Backup
        status say exactly what they said before.
      */}
      <section aria-labelledby="backup-reminder" className="space-y-3">
        <h2 id="backup-reminder" className="font-serif text-lg font-semibold">
          Backup reminder
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          Exporting is what creates a copy you own. When a while goes by without one, your journal
          page says so. This is how long it waits before saying it.
        </p>

        <fieldset>
          <legend className="text-sm font-medium text-ink-soft">
            Remind me if I have not exported for
          </legend>
          <div className="mt-2 space-y-2">
            {REMINDER_INTERVAL_CHOICES.map((days) => (
              <div key={days} className={`${rowClasses(reminderDays === days)} items-center`}>
                <input
                  id={`reminder-${days}`}
                  type="radio"
                  name="backup-reminder"
                  value={days}
                  checked={reminderDays === days}
                  onChange={() => {
                    // The write is the whole change: nothing else is touched,
                    // and in particular not the date of the last export. A
                    // reminder preference is not an export.
                    void updateSettings({ backupReminderDays: days }).catch(() => {});
                  }}
                  className="h-5 w-5 shrink-0"
                />
                <label htmlFor={`reminder-${days}`} className="min-w-0 cursor-pointer">
                  <span className="block text-sm font-medium text-ink">
                    {intervalLabel(days)}
                    {days === REMINDER_AFTER_DAYS ? (
                      <span className={`font-normal ${hintClasses(reminderDays === days)}`}>
                        {' · default'}
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        <p className="measure text-sm leading-relaxed text-ink-soft">
          Whichever you choose, the copy on this device is still not a backup. Only an export is.
        </p>
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

      <AppLockSettings />

      <section aria-labelledby="privacy" className="space-y-3">
        <h2 id="privacy" className="font-serif text-lg font-semibold">
          Privacy
        </h2>
        <p className="measure text-sm leading-relaxed text-ink-soft">
          What you write is stored on this device. There is no account, this app uploads
            nothing, and it works with no network at all. If you save an export to a cloud folder,
            that is your choice and your copy — not something this app requires or arranges.
          </p>
          <p className="measure text-sm leading-relaxed text-ink-soft">
            Operating-system backup is separate: on iOS and Android, the system may include what
            the app stores in your own device or cloud backup when backup is enabled. That is
            Apple&rsquo;s or Android&rsquo;s feature, not this app&rsquo;s, and your App Lock PIN is never
            included in it.
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
