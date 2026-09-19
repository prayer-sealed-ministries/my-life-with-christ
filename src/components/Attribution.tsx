/**
 * Where the words came from, shown on the site.
 *
 * Attribution is not required by either source and is given by decision: a book
 * meant to be handed to a grandchild should say where its words came from, and
 * "nobody made us" is a poor reason for a record to be silent.
 *
 * Which is not the same as saying nothing is required of anyone. See
 * src/lib/attribution.ts and src/data/kjv/SOURCE.md for the distinction
 * between crediting a text and having permission to reproduce it.
 */

import { divisionSource } from '../app/data';
import { attributionsFor } from '../lib/attribution';

export function Attribution({ headingId = 'attribution' }: { headingId?: string }) {
  const items = attributionsFor(divisionSource);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="mt-10 border-t border-line pt-6">
      <h2 id={headingId} className="font-serif text-lg font-semibold">
        Where these words came from
      </h2>
      <dl className="mt-3 space-y-4">
        {items.map((item) => (
          <div key={item.what}>
            <dt className="text-sm font-medium text-ink-soft">{item.what}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-ink-soft">{item.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
