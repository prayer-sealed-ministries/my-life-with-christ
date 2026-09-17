/**
 * The backup reminder interval, driven through the real Settings screen.
 *
 * `reminder.test.ts` proves the decision. This proves the screen is wired to
 * it: that the radio the reader presses reaches storage, that reopening the app
 * shows what they chose, and — the one that matters most — that choosing a
 * longer interval does not touch the record of when they last exported.
 *
 * A reminder preference is not an export. If those two ever became the same
 * write, somebody could silence the warning and be told their journal was
 * recent when nothing had left the device.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { ThemeProvider } from '../app/theme';
import { REMINDER_INTERVAL_CHOICES } from '../export/reminder';
import { DexieStorageProvider } from '../storage/db';
import SettingsView from './SettingsView';

let dbCounter = 0;
const freshProvider = () => new DexieStorageProvider(`journey-settings-test-${(dbCounter += 1)}`);

function renderSettings(provider: DexieStorageProvider) {
  return render(
    <ThemeProvider>
      <RouterProvider>
        <StorageContextProvider provider={provider}>
          <SettingsView />
        </StorageContextProvider>
      </RouterProvider>
    </ThemeProvider>,
  );
}

/** The radio for one interval, found the way a person finds it: by its name. */
const option = (days: number) => screen.getByRole('radio', { name: new RegExp(`^${days} days`) });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('choosing how long before the reminder', () => {
  it('starts on 30 days, and says so', async () => {
    const provider = freshProvider();
    renderSettings(provider);

    await waitFor(() => expect(option(30)).toBeChecked());
    expect(option(30).closest('div')?.textContent).toMatch(/default/i);

    // Nothing was written just by looking. A settings screen that recorded a
    // preference on render would make "never chosen" indistinguishable from
    // "chose the default".
    expect((await provider.getSettings()).backupReminderDays).toBeUndefined();
  });

  it('offers exactly the five intervals and no way to type another', () => {
    renderSettings(freshProvider());

    for (const days of REMINDER_INTERVAL_CHOICES) expect(option(days)).toBeTruthy();
    expect(screen.getAllByRole('radio', { name: /days/ })).toHaveLength(5);
    // No "Never": an off switch for the reminder is a product decision nobody
    // has made, and this is where one would quietly appear.
    expect(screen.queryByRole('radio', { name: /never/i })).toBeNull();
  });

  it.each([7, 14, 30, 60, 90])('records %i days when it is chosen', async (days) => {
    const provider = freshProvider();
    // Start somewhere else, always. Pressing a radio that is already selected
    // fires no change event, so a test that started on the default would have
    // asserted nothing at all for the 30-day case — and passed.
    const startFrom = days === 90 ? 7 : 90;
    await provider.updateSettings({ backupReminderDays: startFrom });

    renderSettings(provider);
    await waitFor(() => expect(option(startFrom)).toBeChecked());

    fireEvent.click(option(days));

    await waitFor(async () => {
      expect((await provider.getSettings()).backupReminderDays).toBe(days);
    });
    expect(option(days)).toBeChecked();
    expect(option(startFrom)).not.toBeChecked();
  });

  it('shows what was chosen when the screen is opened again', async () => {
    const provider = freshProvider();
    await provider.updateSettings({ backupReminderDays: 7 });

    renderSettings(provider);

    // The same provider, a fresh mount: this is reopening the app, not
    // remembering a React state that never went anywhere.
    await waitFor(() => expect(option(7)).toBeChecked());
    expect(option(30)).not.toBeChecked();
  });

  it('shows 30 days when the stored value is corrupt, without failing', async () => {
    const provider = freshProvider();
    await provider.updateSettings({ backupReminderDays: 4000 });

    renderSettings(provider);

    await waitFor(() => expect(option(30)).toBeChecked());
  });
});

describe('changing the reminder is not exporting', () => {
  it('leaves the last-export date exactly where it was', async () => {
    const provider = freshProvider();
    const exportedAt = '2026-01-01T00:00:00.000Z';
    await provider.updateSettings({ lastExportAt: exportedAt });

    renderSettings(provider);
    await waitFor(() => expect(option(30)).toBeChecked());

    fireEvent.click(option(90));
    await waitFor(async () => {
      expect((await provider.getSettings()).backupReminderDays).toBe(90);
    });

    const settings = await provider.getSettings();
    expect(settings.lastExportAt, 'choosing a longer reminder rewrote the export date').toBe(
      exportedAt,
    );
    // Nor may it count as having answered the warning: a dismissal is its own
    // deliberate act, with its own week-long hold.
    expect(settings.reminderDismissedAt).toBeUndefined();
  });

  it('never claims the journal is backed up', async () => {
    renderSettings(freshProvider());
    await waitFor(() => expect(option(30)).toBeChecked());

    fireEvent.click(option(90));

    // The longest interval available, and the page still says the plain thing.
    await waitFor(() =>
      expect(screen.getByText(/the copy on this device is still not a backup/i)).toBeTruthy(),
    );
  });
});

describe('the control is a real one', () => {
  it('is a labelled radio group, not a placeholder', () => {
    renderSettings(freshProvider());

    const group = screen.getByRole('group', { name: /remind me if i have not exported for/i });
    expect(group.tagName).toBe('FIELDSET');

    // Each radio carries its own accessible name, so a screen reader announces
    // the interval and which one is selected rather than reading a collapsed
    // control's current value.
    for (const days of REMINDER_INTERVAL_CHOICES) {
      expect(option(days).getAttribute('type')).toBe('radio');
      expect(option(days).getAttribute('name')).toBe('backup-reminder');
    }
  });
});
