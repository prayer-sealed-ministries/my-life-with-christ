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

/** How long an export stays "recent". */
export const REMINDER_AFTER_DAYS = 30;
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
  if (days < REMINDER_AFTER_DAYS) {
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
