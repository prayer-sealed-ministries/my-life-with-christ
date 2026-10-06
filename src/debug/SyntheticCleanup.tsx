/**
 * A way to clear the throwaway content an acceptance run leaves behind.
 *
 * This exists because acceptance runs happen on a real phone, most of them
 * fail part way through while the automation is being built, and the app has
 * no bulk way to discard drafts — so the leftovers accumulate until they
 * change the shape of the home screen.
 *
 * IT IS NOT PART OF THE PRODUCT. It is compiled out of any build that does not
 * set `DEBUG_TOOLS=1`, because a one-tap delete that matches titles is exactly
 * the sort of thing that must not be one tap away from somebody's journal.
 * `scripts/__tests__/debug-tools-gated.test.mjs` holds that line.
 *
 * Two deliberate frictions, neither of which should be smoothed away:
 *
 *  - It names every title it is about to delete, in full, before anything is
 *    deleted. A count alone would be a request for trust; the list is evidence.
 *  - It will not delete without a second, explicit press.
 *
 * What it matches is defined in `./synthetic`, exactly and case-sensitively.
 */

import { useState } from 'react';

import { useStorage, useStorageQuery } from '../app/storage';
import { Button } from '../components/ui';
import { countOf, findSynthetic, SYNTHETIC_MARKERS, type SyntheticFinds } from './synthetic';

const NOTHING: SyntheticFinds = { entries: [], drafts: [] };

export function SyntheticCleanup() {
  const { storage, touch } = useStorage();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const { data: finds, loading } = useStorageQuery<SyntheticFinds>(
    async (provider) => findSynthetic(await provider.listEntries(), await provider.listDrafts()),
    [],
    NOTHING,
  );

  const total = countOf(finds);

  async function remove() {
    setBusy(true);
    try {
      // Only the ids this scan reported. Nothing is matched again at delete
      // time, so what is removed is exactly what was listed on screen.
      for (const draft of finds.drafts) await storage.deleteDraft(draft.id);
      for (const entry of finds.entries) await storage.deleteEntry(entry.id);
      setDone(`Deleted ${total} item${total === 1 ? '' : 's'}.`);
      setConfirming(false);
      touch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="synthetic-cleanup-heading"
      className="mt-10 rounded-card border border-dashed border-line-strong p-4"
    >
      <h2 id="synthetic-cleanup-heading" className="font-serif text-lg font-semibold text-ink">
        Debug: remove test content
      </h2>
      <p className="measure mt-1 text-sm text-ink-soft">
        Not part of the app. Deletes only entries and drafts whose title contains{' '}
        {SYNTHETIC_MARKERS.map((marker) => (
          <code key={marker} className="mx-1 rounded bg-raised px-1">
            {marker}
          </code>
        ))}
        — nothing else is touched.
      </p>

      <p className="mt-3 text-sm font-medium text-ink">
        {loading ? 'Looking…' : total === 0 ? 'Nothing to remove.' : `Found ${total}:`}
      </p>

      {total > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          {finds.entries.map((item) => (
            <li key={`entry-${item.id}`} className="break-words">
              Entry — {item.title}
            </li>
          ))}
          {finds.drafts.map((item) => (
            <li key={`draft-${item.id}`} className="break-words">
              Draft — {item.title}
            </li>
          ))}
        </ul>
      ) : null}

      {done ? (
        <p role="status" className="mt-3 text-sm text-ink">
          {done}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {total > 0 && !confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete these {total}
          </Button>
        ) : null}
        {confirming ? (
          <>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Deleting…' : `Yes, delete ${total}`}
            </Button>
            <Button onClick={() => setConfirming(false)}>Keep them</Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
