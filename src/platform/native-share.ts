/**
 * Documents the operating system hands this app, on the way to the importer.
 *
 * Same shape as `native-back.ts` and `native-launch.ts`: the decision lives in
 * shared, pure code — `src/import/incoming.ts` decides what is acceptable and
 * `src/app/incoming-document.ts` holds the one slot — and this file is only the
 * binding that reads the platform and performs.
 *
 * WHY POLLING ON RESUME RATHER THAN AN EVENT
 *
 * A VIEW intent carrying a URL arrives as Capacitor's `appUrlOpen`, which is
 * how the launcher shortcut is handled. A SEND intent has no URL — the document
 * is an extra — so there is no event to listen for. Rather than invent a second
 * notification channel, the app asks on every resume whether something is
 * waiting. `takeSharedDocument` is take-once on the native side, so asking
 * often is free and asking twice cannot produce two copies.
 *
 * That also covers the cold case without a special path: the first ask happens
 * at startup, which is the resume that matters most.
 */

import { App } from '@capacitor/app';

import { offerIncomingDocument } from '../app/incoming-document';
import { acceptIncomingDocument, type IncomingDocument } from '../import/incoming';
import { ImportError } from '../import/limits';
import { href, type Route } from '../app/router';
import { JourneyDocuments, fromBase64 } from './native-documents';
import { nativePlatform } from './runtime';

/** Where a shared sermon document is reviewed: a new sermon, import panel open. */
export const SHARE_REVIEW_ROUTE: Route = { name: 'newEntry', kind: 'sermon' };

export interface ShareBindingHost {
  /** Go to the review destination. */
  go: (route: Route) => void;
  /** Tell the person something, in the place the app tells them things. */
  say: (message: string) => void;
}

export function shareHost(say: (message: string) => void): ShareBindingHost {
  return {
    // Replace, not push: the share IS the way in, so back from the review
    // should leave rather than reveal a home screen nobody asked for.
    go: (route) => window.location.replace(href(route)),
    say,
  };
}

/**
 * Ask the platform whether a document is waiting, and deal with it.
 *
 * Exported for the tests, which drive it directly rather than through a
 * lifecycle event.
 */
export async function collectSharedDocument(host: ShareBindingHost): Promise<boolean> {
  let handed: Awaited<ReturnType<typeof JourneyDocuments.takeSharedDocument>>;
  try {
    handed = await JourneyDocuments.takeSharedDocument();
  } catch {
    // No bridge, or a bridge that failed. Nothing was shared as far as the app
    // is concerned, and a normal launch is the right outcome.
    return false;
  }

  if (!handed?.present) return false;

  // Something arrived but the platform could not deliver it — a revoked grant,
  // a provider that refused, a file past the size the native side will read.
  if (handed.error || typeof handed.base64 !== 'string') {
    host.say(handed.error || 'That document could not be read.');
    return false;
  }

  const incoming: IncomingDocument = {
    name: handed.name ?? '',
    mimeType: handed.mimeType ?? '',
    bytes: fromBase64(handed.base64),
  };

  // The same gate the file chooser's bytes go through. A refusal here is the
  // same wording a picked file would have produced, because it is the same
  // code raising it.
  try {
    acceptIncomingDocument(incoming);
  } catch (error) {
    host.say(error instanceof ImportError ? error.message : 'That document could not be read.');
    return false;
  }

  const offer = offerIncomingDocument(incoming);
  if (!offer.accepted) {
    host.say(offer.reason ?? 'You are already reviewing a document.');
    return false;
  }

  host.go(SHARE_REVIEW_ROUTE);
  return true;
}

/**
 * Attach. Returns a function that detaches.
 *
 * A no-op on the web, where nothing shares documents into a page, so callers do
 * not need to know where they are. Never throws: a share that cannot be read is
 * an ordinary launch.
 */
export async function bindSharedDocuments(host: ShareBindingHost): Promise<() => void> {
  if (nativePlatform() === null) return () => {};

  // The cold case.
  await collectSharedDocument(host).catch(() => false);

  // And every time the app comes back to the front, because a share that
  // arrives while it is running resumes the activity rather than starting it.
  const handle = await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void collectSharedDocument(host).catch(() => false);
  });

  return () => {
    void handle.remove();
  };
}
