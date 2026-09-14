import { describe, expect, it } from 'vitest';

import { exportReminder, REMINDER_AFTER_DAYS } from './reminder';

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
