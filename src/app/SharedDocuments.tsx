/**
 * Binds the operating system's "share a document with this app" to the importer.
 *
 * Rendered inside the providers and above the routed view, because it needs two
 * things the composition root does not have: somewhere to navigate, and
 * somewhere to say a sentence. It renders nothing.
 *
 * It is not in `main.tsx` alongside the back button and the launcher shortcut
 * for that reason alone. Those two need only the browser's own history and a
 * hash; this one needs the notice provider, and reaching it from outside React
 * would mean a second module-level registry whose only purpose was to carry a
 * message inwards.
 *
 * A no-op on the web: `bindSharedDocuments` attaches nothing off native.
 */

import { useEffect } from 'react';

import { useNotice } from './notice-context';
import { bindSharedDocuments, shareHost } from '../platform/native-share';

export function SharedDocuments() {
  const { showNotice } = useNotice();

  useEffect(() => {
    let detach: (() => void) | null = null;
    let cancelled = false;

    void bindSharedDocuments(shareHost(showNotice))
      .then((off) => {
        if (cancelled) off();
        else detach = off;
      })
      // A share that cannot be bound is an ordinary launch. It is never a
      // crash on the screen somebody opened to read a handout.
      .catch(() => undefined);

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [showNotice]);

  return null;
}
