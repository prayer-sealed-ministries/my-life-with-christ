/**
 * The export reminder.
 *
 * Browser storage is not a backup. A cleared cache or a reinstalled browser can
 * take a lifetime of writing with it, and the user has no way to know that until
 * it happens. So the app says it out loud.
 *
 * Two rules on how it says it:
 *   - Never mid-writing. Interrupting someone composing a reflection to nag them
 *     about backups is the wrong moment, every time. It surfaces on the timeline.
 *   - Dismissible, and it stays dismissed for a while. A warning that cannot be
 *     silenced stops being read.
 */

import type { Settings } from '../types';

/**
 * How long an export stays "recent", when the reader has not said otherwise.
 *
 * This is the only definition of the interval in the product. Everything that
 * needs it — the banner, the settings screen, the tests — reads it from here or
 * from `backupReminderDays`, so there is one number to change and one place
 * that decides whether a stored preference is trustworthy.
 */
export const REMINDER_AFTER_DAYS = 30;

/**
 * The intervals a reader may choose between, in days.
 *
 * A short list rather than a free-text field: the point of the setting is to
 * let someone who exports weekly stop being nagged monthly, not to let them
 * enter 4000. Every value here is offered in Settings, and nothing outside it
 * is honoured — see `backupReminderDays`.
 *
 * There is deliberately no "never". The reminder is the one thing standing
 * between a lifetime of writing and a lost device, and an off switch for it is
 * a product decision nobody has made.
 */
export const REMINDER_INTERVAL_CHOICES = [7, 14, 30, 60, 90] as const;

export type ReminderIntervalDays = (typeof REMINDER_INTERVAL_CHOICES)[number];

/** How long a dismissal holds before the reminder may return. */
export const DISMISSAL_HOLDS_DAYS = 7;

const DAY_MS = 86_400_000;

export interface ReminderState {
  show: boolean;
  /** Null when nothing has ever been exported. */
  daysSinceExport: number | null;
  /** True the first time — a journal that has never been backed up at all. */
  neverExported: boolean;
  message: string;
}

const daysBetween = (from: string, now: Date): number =>
  Math.floor((now.getTime() - new Date(from).getTime()) / DAY_MS);

/**
 * The reader's chosen interval, or the default when there is nothing usable.
 *
 * Validated rather than trusted. A settings record is written by this app but
 * read by it years later, possibly after an import from another edition, and a
 * corrupt or unknown number must not be able to silence the reminder for a
 * decade. Anything not on the offered list falls back to the default, which is
 * the safe direction: a reminder too often costs a tap, one too rarely costs a
 * journal.
 */
export function backupReminderDays(settings: Settings): ReminderIntervalDays {
  const stored = settings.backupReminderDays;
  return REMINDER_INTERVAL_CHOICES.find((days) => days === stored) ?? REMINDER_AFTER_DAYS;
}

/**
 * Has enough time passed since the last export to say something?
 *
 * Pure, and takes the clock as an argument, so the interval can be tested
 * without moving the wall clock. Never having exported is always due — that is
 * the existing rule and it is not a timing question; `exportReminder` is what
 * decides whether there is anything worth warning about at all.
 *
 * Due *at* the interval, not after it: a reader who set 7 days is told on the
 * seventh, which is what the previous 30-day comparison did.
 */
export function shouldShowBackupReminder(
  lastExportAt: string | undefined,
  now: Date,
  intervalDays: number = REMINDER_AFTER_DAYS,
): boolean {
  if (!lastExportAt) return true;
  return daysBetween(lastExportAt, now) >= intervalDays;
}

/**
 * Should the banner show, and what should it say?
 *
 * @param settings persisted app settings
 * @param entryCount how many entries exist — there is nothing to lose at zero
 */
export function exportReminder(settings: Settings, entryCount: number, now = new Date()): ReminderState {
  const quiet: ReminderState = { show: false, daysSinceExport: null, neverExported: false, message: '' };

  // Nothing written yet, so nothing to warn about.
  if (entryCount === 0) return quiet;

  if (settings.reminderDismissedAt) {
    const sinceDismissal = daysBetween(settings.reminderDismissedAt, now);
    if (sinceDismissal < DISMISSAL_HOLDS_DAYS) {
      return { ...quiet, daysSinceExport: settings.lastExportAt ? daysBetween(settings.lastExportAt, now) : null };
    }
  }

  if (!settings.lastExportAt) {
    return {
      show: true,
      daysSinceExport: null,
      neverExported: true,
      message:
        `You have ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} and have never exported. ` +
        'The copy on this device is not a backup — losing the device, or clearing this app\u2019s data, would erase all of it.',
    };
  }

  const days = daysBetween(settings.lastExportAt, now);
  if (!shouldShowBackupReminder(settings.lastExportAt, now, backupReminderDays(settings))) {
    return { ...quiet, daysSinceExport: days };
  }

  return {
    show: true,
    daysSinceExport: days,
    neverExported: false,
    message:
      `Your last export was ${days} days ago. The copy on this device is not a backup — ` +
      'export now to keep a copy you actually own.',
  };
}
