/**
 * Scanning on the web: honestly unavailable.
 *
 * There is no on-device text recogniser a browser can promise. The alternative
 * — shipping a WASM engine, or worse, posting the page to a server — is exactly
 * what this product does not do, so the web edition says so plainly and the
 * editor hides Scan notes rather than offering something it cannot deliver.
 */
import type { PageScanner, ScanFailure } from './ports';

const unsupported = async (): Promise<ScanFailure> => ({ reason: 'unsupported' });

export const webPageScanner: PageScanner = {
  supported: false,
  capture: unsupported,
  choose: unsupported,
  recognise: unsupported,
  // The web has no on-device recogniser, so a scanned PDF page is reported as
  // a page that could not be read rather than quietly skipped.
  recognisePrepared: unsupported,
  async discard() {
    // Nothing was ever created, so there is nothing to throw away.
  },
};
