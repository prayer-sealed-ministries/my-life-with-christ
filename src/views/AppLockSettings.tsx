/**
 * App Lock, in Settings.
 *
 * ABSENT RATHER THAN DISABLED ON THE WEB
 *
 * If the edition cannot enforce a lock, this renders nothing at all. A greyed
 * toggle saying "not available here" invites the obvious fix — store a
 * verifier in localStorage and compare it in JavaScript — which would guard a
 * journal in ordinary browser storage with a secret in ordinary browser
 * storage. That is a gesture, and it would be described to somebody as
 * protection. Better to not offer it.
 *
 * AUTHENTICATION IS NOT A FORMALITY HERE
 *
 * Turning App Lock off, and changing the PIN, both ask for the current PIN —
 * even though the person is looking at an unlocked app. An unlocked app is
 * exactly the state a phone left on a table is in. The native side enforces
 * this independently; the dialogs below are the polite half of it.
 */

import { useState } from 'react';

import { Button, Card, Field, LiveRegion, Select } from '../components/ui';
import { useAppLockOptional } from '../app/app-lock-context';
import {
  PIN_MAX_DIGITS,
  PIN_MIN_DIGITS,
  TIMEOUT_CHOICES_MS,
  pinProblemMessage,
  timeoutLabel,
  validateNewPin,
} from '../app/lock-policy';
import { usePlatform } from '../platform/context';

type Panel = 'none' | 'enable' | 'change' | 'disable';

export default function AppLockSettings() {
  const { appLock } = usePlatform();
  const lock = useAppLockOptional();

  const [panel, setPanel] = useState<Panel>('none');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // The whole section, absent — on an edition that cannot enforce a lock, and
  // anywhere the provider is not above this. See the note above.
  if (!lock || !lock.supported) return null;
  const { enabled, timeoutMs, recoveryAvailable, refresh } = lock;

  const reset = () => {
    setPin('');
    setConfirm('');
    setCurrentPin('');
  };

  const closePanel = () => {
    setPanel('none');
    reset();
  };

  const onEnable = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateNewPin(pin, confirm);
    if (problem) {
      setMessage(pinProblemMessage(problem));
      return;
    }
    setBusy(true);
    try {
      await appLock.setPin(pin);
      await appLock.setRecentsPrivacy(true);
      await refresh();
      setMessage('App Lock is on.');
      closePanel();
    } catch {
      setMessage('App Lock could not be turned on.');
    } finally {
      setBusy(false);
    }
  };

  const onChange = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateNewPin(pin, confirm);
    if (problem) {
      setMessage(pinProblemMessage(problem));
      return;
    }
    setBusy(true);
    try {
      // Native refuses this without the current PIN, so a wrong one leaves the
      // old PIN working — which is the failure mode to want.
      await appLock.setPin(pin, currentPin);
      await refresh();
      setMessage('Your PIN was changed.');
      closePanel();
    } catch {
      setMessage('That PIN was not right, so nothing changed.');
      setCurrentPin('');
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await appLock.disable(currentPin);
      await appLock.setRecentsPrivacy(false);
      await refresh();
      setMessage('App Lock is off.');
      closePanel();
    } catch {
      setMessage('That PIN was not right, so nothing changed.');
      setCurrentPin('');
    } finally {
      setBusy(false);
    }
  };

  const onRecover = async () => {
    setBusy(true);
    try {
      const ok = await appLock.authenticateDeviceCredential();
      setMessage(
        ok
          ? 'Confirmed. Choose a new PIN.'
          : 'That was not confirmed, so nothing changed.',
      );
      if (ok) {
        setPanel('change');
        setCurrentPin('');
      }
    } catch {
      setMessage('This device cannot confirm your screen lock.');
    } finally {
      setBusy(false);
    }
  };

  const onTimeout = async (value: number) => {
    await appLock.setTimeout(value);
    await refresh();
  };

  return (
    <section aria-labelledby="app-lock" className="space-y-3">
      <h2 id="app-lock" className="font-serif text-lg font-semibold">
        Privacy &amp; Security
      </h2>

      <Card className="space-y-4">
        <div className="space-y-1">
          <h3 className="font-medium">App Lock</h3>
          <p className="measure text-sm leading-relaxed text-ink-soft">
            Require a PIN to open My Life With Christ.
          </p>
          <p className="measure text-sm leading-relaxed text-ink-soft">
            App Lock protects access through this app on this device. It does not encrypt the
            journal database and does not replace your device&rsquo;s own screen lock.
          </p>
          <p className="measure text-sm leading-relaxed text-ink-soft">
            Your PIN stays on this device. It is never included in Android&rsquo;s backup, so
            restoring your journal onto another phone will not bring App Lock with it — you would
            turn it on again there.
          </p>
        </div>

        <p className="text-sm font-medium text-ink">{enabled ? 'On' : 'Off'}</p>

        {enabled && (
          <Select
            label="Lock after leaving the app"
            value={String(timeoutMs)}
            onChange={(event) => void onTimeout(Number(event.target.value))}
          >
            {TIMEOUT_CHOICES_MS.map((choice) => (
              <option key={choice} value={choice}>
                {timeoutLabel(choice)}
              </option>
            ))}
          </Select>
        )}

        {panel === 'none' && (
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <>
                <Button onClick={() => setPanel('change')}>Change PIN</Button>
                <Button variant="danger" onClick={() => setPanel('disable')}>
                  Turn off App Lock
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => setPanel('enable')}>
                Turn on App Lock
              </Button>
            )}
          </div>
        )}

        {panel === 'enable' && (
          <form onSubmit={onEnable} className="space-y-3" noValidate>
            <Field
              label="New PIN"
              hint={`${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            />
            <Field
              label="Confirm PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))}
            />
            {/* Said before it is turned on, not discovered afterwards. */}
            <p className="measure text-sm leading-relaxed text-ink-soft">
              {recoveryAvailable
                ? 'If you forget this PIN, you can reset it by confirming your device’s screen lock. There is no other way in, and nobody can recover it for you.'
                : 'This device has no screen lock set up, so there is no way to reset a forgotten PIN. Set a device screen lock first if you want that safety net.'}
            </p>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy}>
                Turn on App Lock
              </Button>
              <Button type="button" onClick={closePanel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {panel === 'change' && (
          <form onSubmit={onChange} className="space-y-3" noValidate>
            <Field
              label="Current PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={currentPin}
              onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ''))}
            />
            <Field
              label="New PIN"
              hint={`${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            />
            <Field
              label="Confirm new PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={busy}>
                Change PIN
              </Button>
              <Button type="button" onClick={closePanel} disabled={busy}>
                Cancel
              </Button>
              {recoveryAvailable && (
                <Button type="button" variant="ghost" onClick={onRecover} disabled={busy}>
                  Use device screen lock instead
                </Button>
              )}
            </div>
          </form>
        )}

        {panel === 'disable' && (
          <form onSubmit={onDisable} className="space-y-3" noValidate>
            <p className="measure text-sm leading-relaxed text-ink">
              Enter your PIN to turn App Lock off.
            </p>
            <Field
              label="Current PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={currentPin}
              onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ''))}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={busy}>
                Turn off App Lock
              </Button>
              <Button type="button" onClick={closePanel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {message && (
          <p role="status" className="text-sm text-ink">
            {message}
          </p>
        )}
        <LiveRegion message={message} />
      </Card>
    </section>
  );
}
