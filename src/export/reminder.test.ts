import { describe, expect, it } from 'vitest';

import {
  backupReminderDays,
  exportReminder,
  REMINDER_AFTER_DAYS,
  REMINDER_INTERVAL_CHOICES,
  shouldShowBackupReminder,
} from './reminder';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('exportReminder', () => {
  it('stays quiet when there is nothing written yet', () => {
    expect(exportReminder({}, 0, NOW).show).toBe(false);
  });

  it('warns when a journal has never been exported at all', () => {
    const state = exportReminder({}, 3, NOW);
    expect(state.show).toBe(true);
    expect(state.neverExported).toBe(true);
    expect(state.message).toMatch(/not a backup/);
  });

  it('stays quiet inside the 30-day window', () => {
    expect(exportReminder({ lastExportAt: daysAgo(REMINDER_AFTER_DAYS - 1) }, 5, NOW).show).toBe(false);
  });

  it('warns once the window has passed, naming the number of days', () => {
    const state = exportReminder({ lastExportAt: daysAgo(45) }, 5, NOW);
    expect(state.show).toBe(true);
    expect(state.daysSinceExport).toBe(45);
    expect(state.message).toMatch(/45 days ago/);
  });

  it('holds its peace for a week after being dismissed', () => {
    const settings = { lastExportAt: daysAgo(45), reminderDismissedAt: daysAgo(2) };
    expect(exportReminder(settings, 5, NOW).show).toBe(false);
  });

  it('returns after the dismissal lapses', () => {
    const settings = { lastExportAt: daysAgo(45), reminderDismissedAt: daysAgo(10) };
    expect(exportReminder(settings, 5, NOW).show).toBe(true);
  });

  it('still counts the days while dismissed, for the settings screen', () => {
    const settings = { lastExportAt: daysAgo(45), reminderDismissedAt: daysAgo(1) };
    expect(exportReminder(settings, 5, NOW).daysSinceExport).toBe(45);
  });
});

describe('backupReminderDays', () => {
  it('is 30 days when nothing has been chosen', () => {
    expect(backupReminderDays({})).toBe(30);
    expect(REMINDER_AFTER_DAYS, 'the default moved without this test noticing').toBe(30);
  });

  it('honours every interval the settings screen offers', () => {
    // A floor as much as a check: if the offered list ever shrank, a loop over
    // it would keep passing while testing less. Naming the five means the test
    // fails rather than quietly covering four.
    expect([...REMINDER_INTERVAL_CHOICES]).toEqual([7, 14, 30, 60, 90]);
    for (const days of [7, 14, 30, 60, 90]) {
      expect(backupReminderDays({ backupReminderDays: days })).toBe(days);
    }
  });

  it('falls back to the default rather than trusting a broken record', () => {
    // Every one of these has to land on 30. A stored 4000 that was honoured
    // would silence the reminder for eleven years, which is the whole journal.
    const broken = [0, -7, 4000, 31, 1.5, NaN, Infinity];
    for (const value of broken) {
      expect(backupReminderDays({ backupReminderDays: value }), `${value} was honoured`).toBe(30);
    }
    expect(backupReminderDays({ backupReminderDays: undefined })).toBe(30);
    expect(backupReminderDays({ backupReminderDays: '7' as unknown as number })).toBe(30);
  });
});

describe('shouldShowBackupReminder', () => {
  it('is due immediately when nothing was ever exported', () => {
    expect(shouldShowBackupReminder(undefined, NOW, 90)).toBe(true);
  });

  it('is not due below the interval, and is due at it and above', () => {
    expect(shouldShowBackupReminder(daysAgo(13), NOW, 14), 'below the interval').toBe(false);
    // At the interval, not after it — this is what the old `days < 30` did.
    expect(shouldShowBackupReminder(daysAgo(14), NOW, 14), 'at the interval').toBe(true);
    expect(shouldShowBackupReminder(daysAgo(15), NOW, 14), 'above the interval').toBe(true);
  });

  it('uses the interval it is given, not the default', () => {
    const twentyDaysAgo = daysAgo(20);
    expect(shouldShowBackupReminder(twentyDaysAgo, NOW, 7)).toBe(true);
    expect(shouldShowBackupReminder(twentyDaysAgo, NOW, 14)).toBe(true);
    expect(shouldShowBackupReminder(twentyDaysAgo, NOW, 30)).toBe(false);
    expect(shouldShowBackupReminder(twentyDaysAgo, NOW, 60)).toBe(false);
    expect(shouldShowBackupReminder(twentyDaysAgo, NOW, 90)).toBe(false);
  });
});

describe('the reminder honours the chosen interval', () => {
  // The worked example from the change itself: twenty days since an export is
  // quiet at thirty and overdue at fourteen, and nothing about the journal
  // changed in between — only what the reader asked to be told.
  const twentyDaysAgo = { lastExportAt: daysAgo(20) };

  it('says nothing at twenty days when the interval is the default thirty', () => {
    expect(exportReminder(twentyDaysAgo, 5, NOW).show).toBe(false);
  });

  it('speaks up at twenty days once the reader asks for fourteen', () => {
    const state = exportReminder({ ...twentyDaysAgo, backupReminderDays: 14 }, 5, NOW);
    expect(state.show).toBe(true);
    expect(state.daysSinceExport).toBe(20);
  });

  it('goes quiet again at twenty days once the reader asks for sixty', () => {
    expect(exportReminder({ ...twentyDaysAgo, backupReminderDays: 60 }, 5, NOW).show).toBe(false);
  });

  it('still counts from the export, not from when the interval changed', () => {
    // Changing a preference is not exporting. The days reported are the days
    // since the export, whatever the interval now is.
    for (const days of REMINDER_INTERVAL_CHOICES) {
      expect(exportReminder({ ...twentyDaysAgo, backupReminderDays: days }, 5, NOW).daysSinceExport).toBe(20);
    }
  });

  it('warns a never-exported journal whatever interval is chosen', () => {
    // The pre-existing rule, held explicitly: never exported is not a timing
    // question, and the longest interval must not buy silence.
    for (const days of REMINDER_INTERVAL_CHOICES) {
      const state = exportReminder({ backupReminderDays: days }, 3, NOW);
      expect(state.show, `${days} days silenced a journal that was never exported`).toBe(true);
      expect(state.neverExported).toBe(true);
    }
  });

  it('still says nothing at all when there is nothing written', () => {
    // And an empty journal stays quiet whatever the interval — a new reader
    // does not open the app to a warning about entries they have not written.
    for (const days of REMINDER_INTERVAL_CHOICES) {
      expect(exportReminder({ backupReminderDays: days }, 0, NOW).show).toBe(false);
    }
  });

  it('falls back to thirty days when the stored interval is unusable', () => {
    const corrupt = { lastExportAt: daysAgo(20), backupReminderDays: 4000 };
    expect(exportReminder(corrupt, 5, NOW).show, 'a corrupt interval silenced the reminder').toBe(false);
    const older = { lastExportAt: daysAgo(45), backupReminderDays: 4000 };
    expect(exportReminder(older, 5, NOW).show).toBe(true);
  });
});
