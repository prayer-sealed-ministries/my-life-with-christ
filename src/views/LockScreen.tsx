/**
 * The screen shown when the journal is locked.
 *
 * WHAT IT MAY SAY
 *
 * The product's name, that it is locked, and how to unlock it. Nothing else.
 * No entry title, no draft, no speaker, no church, no verse, no counts — not
 * "you have 47 entries", not "last written on Sunday". A lock screen that
 * reported how much there was to read would be telling whoever is holding the
 * phone something they had not earned.
 *
 * It is also opaque by construction rather than by styling: the journal is not
 * rendered behind it. See `src/app/app-lock.tsx`.
 */

import { useState } from 'react';

import { Button, Card, Field, LiveRegion } from '../components/ui';
import { useAppLock } from '../app/app-lock-context';
import {
  PIN_MAX_DIGITS,
  PIN_MIN_DIGITS,
  penaltyMessage,
  pinProblemMessage,
  validateNewPin,
} from '../app/lock-policy';
import { usePlatform } from '../platform/context';

type Mode = 'unlock' | 'recover';

export default function LockScreen() {
  const { unlock, penaltyMs, recoveryAvailable, refresh, lockError, retry } = useAppLock();
  const { appLock } = usePlatform();

  const [mode, setMode] = useState<Mode>('unlock');
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const blocked = penaltyMs > 0;

  const onUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const ok = await unlock(pin);
      if (!ok) {
        // Never says whether the length was right, whether a PIN exists, or
        // how close the guess was. One sentence for every wrong answer.
        setMessage('That PIN is not right.');
        setPin('');
      }
    } catch {
      setMessage('That PIN could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  const onStartRecovery = async () => {
    setBusy(true);
    setMessage('');
    try {
      const ok = await appLock.authenticateDeviceCredential();
      if (ok) {
        setMode('recover');
      } else {
        setMessage('That was not confirmed, so nothing changed.');
      }
    } catch {
      setMessage('This device cannot confirm your screen lock.');
    } finally {
      setBusy(false);
    }
  };

  const onResetPin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const problem = validateNewPin(newPin, confirmPin);
    if (problem) {
      setMessage(pinProblemMessage(problem));
      return;
    }

    setBusy(true);
    try {
      // The native side accepts this because it conducted the device-credential
      // check itself moments ago, and it consumes that grant here. There is no
      // token this layer could forge or replay.
      await appLock.setPin(newPin);
      await refresh();
      const ok = await unlock(newPin);
      if (!ok) setMessage('The PIN was changed. Enter it to continue.');
      setMode('unlock');
      setNewPin('');
      setConfirmPin('');
    } catch {
      setMessage('That PIN could not be set.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-app px-4 py-10 text-ink">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="font-serif text-2xl font-semibold text-ink">My Life With Christ</h1>
          <p className="text-sm text-ink-soft">App locked</p>
        </header>

        <Card className="space-y-4">
          {lockError ? (
            <div className="space-y-4">
              <p role="alert" className="text-sm text-ink">{lockError}</p>
              <Button type="button" variant="primary" className="w-full" onClick={retry}>
                Try App Lock again
              </Button>
            </div>
          ) : mode === 'unlock' ? (
            <form onSubmit={onUnlock} className="space-y-4" noValidate>
              <Field
                label="PIN"
                hint={`${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`}
                type="password"
                // A numeric keypad without turning the field into one: the
                // browser's own password input already conceals, is labelled,
                // and is reachable by every assistive technology. A hand-built
                // keypad would have to re-earn all of that.
                inputMode="numeric"
                autoComplete="off"
                // Off, deliberately: a PIN offered back by a password manager
                // or a keyboard suggestion strip is a PIN somewhere else.
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                name="app-lock-pin"
                value={pin}
                disabled={busy || blocked}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              />

              <Button type="submit" variant="primary" className="w-full" disabled={busy || blocked}>
                Unlock
              </Button>
            </form>
          ) : (
            <form onSubmit={onResetPin} className="space-y-4" noValidate>
              <p className="text-sm text-ink-soft">Choose a new PIN.</p>
              <Field
                label="New PIN"
                hint={`${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                name="app-lock-new-pin"
                value={newPin}
                disabled={busy}
                onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))}
              />
              <Field
                label="Confirm new PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                name="app-lock-confirm-pin"
                value={confirmPin}
                disabled={busy}
                onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
              />
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                Set new PIN
              </Button>
            </form>
          )}

          {/* Errors are readable without colour: they are sentences, in the
              flow, and announced. Nothing here depends on the text being red. */}
          {!lockError && (message || blocked) && (
            <p role="alert" className="text-sm text-ink">
              {blocked ? penaltyMessage(penaltyMs) : message}
            </p>
          )}
          <LiveRegion message={lockError || (blocked ? penaltyMessage(penaltyMs) : message)} />
        </Card>

        {!lockError && mode === 'unlock' && recoveryAvailable && (
          <div className="text-center">
            <Button variant="ghost" onClick={onStartRecovery} disabled={busy}>
              Forgot your PIN?
            </Button>
            <p className="mt-1 text-xs text-ink-soft">
              You will be asked for this device&rsquo;s screen lock.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
