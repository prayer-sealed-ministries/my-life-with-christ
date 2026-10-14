/**
 * Opaque journal-level data, independent of any entry (including an empty journal).
 *
 * The existing companion v1 carrier is a list of complete source maps. Keeping
 * maps rather than merging their properties preserves conflicting values and
 * literal __proto__/constructor keys without inventing a winning value.
 */
import { stableJson } from './semantics';

export type JournalEnvelopeMetadata = Record<string, unknown>[];

const CURRENT_FIELDS = new Set(['format', 'version', 'exportedAt', 'filter', 'entries', 'drafts']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A deterministic set union; source maps are opaque and are never recursively unpacked. */
export function mergeEnvelopeMetadata(
  ...collections: JournalEnvelopeMetadata[]
): JournalEnvelopeMetadata {
  const maps = new Map<string, Record<string, unknown>>();
  for (const collection of collections) {
    for (const source of collection) {
      if (Object.keys(source).length > 0) {
        const canonical = stableJson(source);
        // Detached, canonical JSON also prevents caller mutation after a write
        // and keeps export bytes deterministic across object-key ordering.
        maps.set(canonical, JSON.parse(canonical) as Record<string, unknown>);
      }
    }
  }
  return [...maps.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, source]) => source);
}

/**
 * Keep original extension paths wherever there is one unambiguous value. When
 * several maps exist, retain those complete originals in the established v1
 * carrier as well; never choose a winner for a conflicting field. Historical
 * source maps may contain current fields, which must not replace this export's
 * format, records, timestamp or filter.
 */
export function exportEnvelopeMetadata(metadata: JournalEnvelopeMetadata = []): Record<string, unknown> {
  const sources = mergeEnvelopeMetadata(metadata);
  if (!sources.length) return {};
  if (sources.length === 1 && Object.keys(sources[0]).every((key) => !CURRENT_FIELDS.has(key))) {
    return sources[0];
  }
  const values = new Map<string, unknown>();
  const conflicts = new Set<string>();
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (CURRENT_FIELDS.has(key) || key === '_unmigrated') continue;
      if (values.has(key) && stableJson(values.get(key)) !== stableJson(value)) conflicts.add(key);
      else values.set(key, value);
    }
  }
  return {
    ...Object.fromEntries([...values].filter(([key]) => !conflicts.has(key))),
    _unmigrated: { companionSourceEnvelopes: sources },
  };
}

/**
 * Recognise only a carrier that this writer can reconstruct exactly. Mixed,
 * malformed, duplicate, empty or noncanonical wrapper-looking data remains an
 * opaque source map. This round-trip check is essential: a name or discriminator
 * alone must never license discarding someone's original field. Contents of a
 * source map are never interpreted as another wrapper.
 */
export function importEnvelopeMetadata(envelope: Record<string, unknown>): JournalEnvelopeMetadata {
  const extras = Object.fromEntries(Object.entries(envelope).filter(([key]) => !CURRENT_FIELDS.has(key)));
  const unmigrated = extras._unmigrated;
  if (isRecord(unmigrated) && Array.isArray(unmigrated.companionSourceEnvelopes) &&
      unmigrated.companionSourceEnvelopes.every(isRecord)) {
    const sources = mergeEnvelopeMetadata(unmigrated.companionSourceEnvelopes);
    if (stableJson(exportEnvelopeMetadata(sources)) === stableJson(extras)) return sources;
  }
  return mergeEnvelopeMetadata([extras]);
}
