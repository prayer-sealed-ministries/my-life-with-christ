/**
 * Turning the lock on, changing it, and turning it off.
 *
 * The assertion that matters in the last two is not "a dialog appeared" but
 * that the PIN the person typed was actually HANDED to the native side. A
 * settings screen that collected a PIN and then called `disable()` without it
 * would look identical on screen and be no protection at all — the native side
 * would refuse, but only because it, separately, does not trust this layer.
 * Both halves are checked: here, that the proof is passed along; and in
 * `scripts/__tests__/app-lock-policy.test.mjs`, that no bypass exists.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AppLockSettings from './AppLockSettings';
import { AppLockContext, type AppLockContextValue } from '../app/app-lock-context';
import { PlatformContext } from '../platform/context';
import { webPlatform } from '../platform/web';
import type { AppLock } from '../platform/app-lock';
import type { Platform } from '../platform/ports';

const spies = () => ({
  setPin: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  setTimeout: vi.fn(async () => {}),
  setRecentsPrivacy: vi.fn(async () => {}),
  authenticateDeviceCredential: vi.fn(async () => true),
});

function renderSettings(options: {
  enabled: boolean;
  supported?: boolean;
  recoveryAvailable?: boolean;
  calls?: ReturnType<typeof spies>;
}) {
  const calls = options.calls ?? spies();
  const lock: AppLock = {
    supported: options.supported ?? true,
    getState: async () => ({
      enabled: options.enabled,
      timeoutMs: 0,
      failures: 0,
      lastFailureAt: null,
      recoveryAvailable: options.recoveryAvailable ?? true,
      now: { elapsedMs: 0, bootId: 'b' },
    }),
    now: async () => ({ elapsedMs: 0, bootId: 'b' }),
    verifyPin: async () => ({
      ok: false,
      failures: 0,
      lastFailureAt: null,
      now: { elapsedMs: 0, bootId: 'b' },
    }),
    ...calls,
  };

  const context: AppLockContextValue = {
    phase: 'unlocked',
    supported: options.supported ?? true,
    enabled: options.enabled,
    timeoutMs: 0,
    recoveryAvailable: options.recoveryAvailable ?? true,
    penaltyMs: 0,
    failures: 0,
    lockError: null,
    unlock: async () => true,
    refresh: async () => {},
    retry: () => {},
    lockNow: () => {},
  };

  const platform: Platform = { ...webPlatform, appLock: lock };
  render(
    <PlatformContext.Provider value={platform}>
      <AppLockContext.Provider value={context}>
        <AppLockSettings />
      </AppLockContext.Provider>
    </PlatformContext.Provider>,
  );
  return calls;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(cleanup);

describe('when the edition cannot enforce a lock', () => {
  it('offers nothing at all, rather than a disabled switch', () => {
    renderSettings({ enabled: false, supported: false });

    expect(screen.queryByText('App Lock')).toBeNull();
    expect(screen.queryByRole('button', { name: /App Lock/i })).toBeNull();
  });
});

describe('turning App Lock on', () => {
  it('is off to begin with', () => {
    renderSettings({ enabled: false });

    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on App Lock' })).toBeInTheDocument();
  });

  it('says what happens if the PIN is forgotten, before it is set', () => {
    renderSettings({ enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    expect(
      screen.getByText(/reset it by confirming your device’s screen lock/i),
    ).toBeInTheDocument();
  });

  it('warns when the device has no screen lock to fall back on', () => {
    renderSettings({ enabled: false, recoveryAvailable: false });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    expect(screen.getByText(/no way to reset a forgotten PIN/i)).toBeInTheDocument();
  });

  it('refuses a PIN that is too short, and sets nothing', async () => {
    const calls = renderSettings({ enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    type('New PIN', '1234');
    type('Confirm PIN', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    // Said once and announced once, so there are two nodes by design.
    expect(await screen.findAllByText(/at least 6 digits/i)).toHaveLength(2);
    expect(calls.setPin).not.toHaveBeenCalled();
  });

  it('refuses a confirmation that does not match, and sets nothing', async () => {
    const calls = renderSettings({ enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    type('New PIN', '135792');
    type('Confirm PIN', '135793');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    // Said once and announced once, so there are two nodes by design.
    expect(await screen.findAllByText(/not the same/i)).toHaveLength(2);
    expect(calls.setPin).not.toHaveBeenCalled();
  });

  it('sets the PIN and asks for the app switcher to be covered', async () => {
    const calls = renderSettings({ enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    type('New PIN', '135792');
    type('Confirm PIN', '135792');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on App Lock' }));

    await waitFor(() => expect(calls.setPin).toHaveBeenCalledWith('135792'));
    expect(calls.setRecentsPrivacy).toHaveBeenCalledWith(true);
  });
});

describe('turning App Lock off', () => {
  it('asks for the PIN rather than trusting an open app', () => {
    renderSettings({ enabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off App Lock' }));

    expect(screen.getByLabelText('Current PIN')).toBeInTheDocument();
  });

  it('hands that PIN to the native side as the proof', async () => {
    const calls = renderSettings({ enabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off App Lock' }));

    type('Current PIN', '135792');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off App Lock' }));

    // The point of the test: not that a field existed, but that what was typed
    // travelled. `disable()` with nothing would leave the native refusal as the
    // only thing standing between an unattended phone and an unlocked journal.
    await waitFor(() => expect(calls.disable).toHaveBeenCalledWith('135792'));
    expect(calls.disable).not.toHaveBeenCalledWith(undefined);
    expect(calls.disable).not.toHaveBeenCalledWith('');
  });

  it('leaves the lock on when the native side refuses', async () => {
    const calls = spies();
    calls.disable = vi.fn(async () => {
      throw new Error('wrong pin');
    });
    renderSettings({ enabled: true, calls });

    fireEvent.click(screen.getByRole('button', { name: 'Turn off App Lock' }));
    type('Current PIN', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off App Lock' }));

    // Said once and announced once, so there are two nodes by design.
    expect(await screen.findAllByText(/not right, so nothing changed/i)).toHaveLength(2);
    expect(calls.setRecentsPrivacy).not.toHaveBeenCalledWith(false);
  });
});

describe('changing the PIN', () => {
  it('requires the current one alongside the new one', async () => {
    const calls = renderSettings({ enabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));

    type('Current PIN', '135792');
    type('New PIN', '246813');
    type('Confirm new PIN', '246813');
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));

    await waitFor(() => expect(calls.setPin).toHaveBeenCalledWith('246813', '135792'));
  });

  it('offers the device screen lock as the only other way through', async () => {
    const calls = renderSettings({ enabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    fireEvent.click(screen.getByRole('button', { name: /device screen lock/i }));

    await waitFor(() => expect(calls.authenticateDeviceCredential).toHaveBeenCalled());
  });

  it('keeps the old PIN working when the change is refused', async () => {
    const calls = spies();
    calls.setPin = vi.fn(async () => {
      throw new Error('wrong pin');
    });
    renderSettings({ enabled: true, calls });

    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    type('Current PIN', '000000');
    type('New PIN', '246813');
    type('Confirm new PIN', '246813');
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));

    // Said once and announced once, so there are two nodes by design.
    expect(await screen.findAllByText(/not right, so nothing changed/i)).toHaveLength(2);
  });
});
