/**
 * The binding between a system share and the importer.
 *
 * `incoming.test.ts` owns what is acceptable and `incoming-document.test.ts`
 * owns the one-slot policy. This owns the wiring either side of them: that the
 * web is untouched, that a good document reaches the review destination, and
 * that every way the platform can fail ends with nothing imported and something
 * honest on screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetIncomingDocuments, hasIncomingDocument } from '../app/incoming-document';
import type { Route } from '../app/router';

const handed = vi.hoisted(() => ({
  value: { present: false } as Record<string, unknown>,
  throws: false,
}));
const platform = vi.hoisted(() => ({ value: 'android' as 'android' | 'ios' | null }));
const listeners = vi.hoisted(() => [] as Array<(e: { isActive: boolean }) => void>);
const removeListener = vi.hoisted(() => vi.fn());

vi.mock('./runtime', () => ({ nativePlatform: () => platform.value }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_name: string, handler: (e: { isActive: boolean }) => void) => {
      listeners.push(handler);
      return { remove: removeListener };
    },
  },
}));
vi.mock('./native-documents', async () => {
  const actual = await vi.importActual<typeof import('./native-documents')>('./native-documents');
  return {
    ...actual,
    JourneyDocuments: {
      takeSharedDocument: async () => {
        if (handed.throws) throw new Error('no bridge');
        return handed.value;
      },
    },
  };
});

const { bindSharedDocuments, collectSharedDocument, SHARE_REVIEW_ROUTE } = await import(
  './native-share'
);

const base64 = (text: string) => btoa(text);

function host() {
  const went: Route[] = [];
  const said: string[] = [];
  return { went, said, go: (r: Route) => void went.push(r), say: (m: string) => void said.push(m) };
}

beforeEach(() => {
  resetIncomingDocuments();
  handed.value = { present: false };
  handed.throws = false;
  platform.value = 'android';
  listeners.length = 0;
  vi.clearAllMocks();
});

afterEach(() => resetIncomingDocuments());

describe('on the web', () => {
  it('binds nothing', async () => {
    platform.value = null;
    handed.value = { present: true, name: 'a.txt', mimeType: 'text/plain', base64: base64('hello') };
    const h = host();

    const detach = await bindSharedDocuments(h);

    expect(h.went).toEqual([]);
    expect(hasIncomingDocument()).toBe(false);
    expect(listeners).toHaveLength(0);
    detach();
  });
});

describe('a document the system shared', () => {
  it('is held and taken to the review destination', async () => {
    handed.value = {
      present: true,
      name: 'handout.md',
      mimeType: 'text/markdown',
      base64: base64('# Abiding\n\nPoint one.'),
    };
    const h = host();

    await expect(collectSharedDocument(h)).resolves.toBe(true);

    expect(h.went).toEqual([SHARE_REVIEW_ROUTE]);
    expect(SHARE_REVIEW_ROUTE).toEqual({ name: 'newEntry', kind: 'sermon' });
    expect(hasIncomingDocument()).toBe(true);
    expect(h.said).toEqual([]);
  });

  it('does nothing at all when none is waiting', async () => {
    handed.value = { present: false };
    const h = host();
    await expect(collectSharedDocument(h)).resolves.toBe(false);
    expect(h.went).toEqual([]);
    expect(h.said).toEqual([]);
    expect(hasIncomingDocument()).toBe(false);
  });
});

describe('every way it can fail leaves the journal alone', () => {
  it('reports what the platform could not read, and holds nothing', async () => {
    handed.value = { present: true, error: 'This app no longer has permission to read that document.' };
    const h = host();

    await expect(collectSharedDocument(h)).resolves.toBe(false);
    expect(h.said).toEqual(['This app no longer has permission to read that document.']);
    expect(h.went).toEqual([]);
    expect(hasIncomingDocument()).toBe(false);
  });

  it('refuses a type the importer cannot read, in the importer’s own words', async () => {
    handed.value = {
      present: true,
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      base64: base64('not a sermon'),
    };
    const h = host();

    await expect(collectSharedDocument(h)).resolves.toBe(false);
    expect(h.said[0]).toMatch(/\.txt, \.md, \.json or text-based \.pdf/);
    expect(hasIncomingDocument()).toBe(false);
  });

  it('refuses an empty document', async () => {
    handed.value = { present: true, name: 'a.txt', mimeType: 'text/plain', base64: '' };
    const h = host();
    await expect(collectSharedDocument(h)).resolves.toBe(false);
    expect(h.said[0]).toMatch(/empty/);
    expect(hasIncomingDocument()).toBe(false);
  });

  it('survives a bridge that is not there', async () => {
    handed.throws = true;
    const h = host();
    await expect(collectSharedDocument(h)).resolves.toBe(false);
    expect(h.said).toEqual([]);
    expect(h.went).toEqual([]);
  });

  it('tells the person to finish the one they are reading', async () => {
    const good = {
      present: true,
      name: 'first.md',
      mimeType: 'text/markdown',
      base64: base64('first'),
    };
    handed.value = good;
    const h = host();
    await collectSharedDocument(h);
    expect(hasIncomingDocument()).toBe(true);

    handed.value = { ...good, name: 'second.md', base64: base64('second') };
    await expect(collectSharedDocument(h)).resolves.toBe(false);
    expect(h.said[0]).toMatch(/already reviewing/i);
    // One navigation, from the first. The second did not move anyone.
    expect(h.went).toHaveLength(1);
  });
});

describe('a share that arrives while the app is running', () => {
  it('is collected when the app comes back to the front', async () => {
    const h = host();
    await bindSharedDocuments(h);
    expect(listeners).toHaveLength(1);

    handed.value = {
      present: true,
      name: 'handout.txt',
      mimeType: 'text/plain',
      base64: base64('Point one.'),
    };
    listeners[0]({ isActive: true });
    await vi.waitFor(() => expect(hasIncomingDocument()).toBe(true));
    expect(h.went).toEqual([SHARE_REVIEW_ROUTE]);
  });

  it('does not ask while the app is going away', async () => {
    const h = host();
    await bindSharedDocuments(h);
    handed.value = { present: true, name: 'a.txt', mimeType: 'text/plain', base64: base64('x') };

    listeners[0]({ isActive: false });
    expect(h.went).toEqual([]);
  });

  it('detaches cleanly', async () => {
    const detach = await bindSharedDocuments(host());
    detach();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
