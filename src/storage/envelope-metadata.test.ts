import { describe, expect, it } from 'vitest';
import vectors from '../export/test-fixtures/envelope-metadata-v1.json';
import { exportEnvelopeMetadata, importEnvelopeMetadata, mergeEnvelopeMetadata } from './envelope-metadata';

const envelope = (extras: Record<string, unknown> = {}) => ({
  format: 'journey-export', version: 1, entries: [], drafts: [],
  exportedAt: '2026-10-13T00:00:00.000Z', filter: {}, ...extras,
});

describe('reversible opaque envelope maps', () => {
  it('does not preserve current envelope fields as unknown data', () => {
    expect(importEnvelopeMetadata(envelope())).toEqual([]);
    expect(exportEnvelopeMetadata([])).toEqual({});
  });

  it('retains every conflicting source and prototype-looking key without a winning value', () => {
    const first = JSON.parse('{"__proto__":{"polluted":true},"constructor":null,"future":1}');
    const second = { future: 2, _unmigrated: { future: 'old value' } };
    const sources = mergeEnvelopeMetadata(importEnvelopeMetadata(envelope(first)), importEnvelopeMetadata(envelope(second)));
    expect(sources).toHaveLength(2);
    expect(sources).toContainEqual(first);
    expect(sources).toContainEqual(second);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(importEnvelopeMetadata(envelope(exportEnvelopeMetadata(sources)))).toEqual(sources);
  });

  it('deduplicates objects with different key ordering, with deterministic merge order', () => {
    const a = { future: { b: 2, a: 1 } };
    const same = { future: { a: 1, b: 2 } };
    const b = { future: { b: 3 } };
    expect(mergeEnvelopeMetadata([a], [same, b])).toEqual(mergeEnvelopeMetadata([b], [a]));
    expect(mergeEnvelopeMetadata([a], [same, b])).toHaveLength(2);
  });

  it.each([
    { _unmigrated: { companionSourceEnvelopes: [] } },
    { _unmigrated: { companionSourceEnvelopes: [{ x: 1 }, { x: 1 }] } },
    { _unmigrated: { companionSourceEnvelopes: [{ z: 1 }, { a: 1 }] } },
    { _unmigrated: { companionSourceEnvelopes: [{ x: 1 }], sibling: 'original' } },
    { _unmigrated: { companionSourceEnvelopes: [null, 'opaque'] } },
    { _unmigrated: { companionSourceEnvelopes: [{ x: 1 }] }, sibling: 'original' },
    { _unmigrated: 'original scalar' },
  ])('retains noncanonical or mixed carrier-looking data verbatim: %j', (original) => {
    const sources = importEnvelopeMetadata(envelope(original));
    expect(sources).toEqual([original]);
    expect(importEnvelopeMetadata(envelope(exportEnvelopeMetadata(sources)))).toEqual([original]);
  });

  it('never recursively unwraps a nested source and keeps legacy known fields inside it', () => {
    const legacy = { format: 'journey-export', version: 1, exportedAt: 'old timestamp',
      _unmigrated: { companionSourceEnvelopes: [{ nested: 'literal original' }] } };
    const carrier = exportEnvelopeMetadata([legacy]);
    expect(importEnvelopeMetadata(envelope(carrier))).toEqual([legacy]);
    for (let cycle = 0; cycle < 5; cycle += 1) {
      expect(exportEnvelopeMetadata(importEnvelopeMetadata(envelope(carrier)))).toEqual(carrier);
    }
  });
});

it('retains original field paths for one map and projects only unambiguous keys across maps', () => {
  const original = { future: { note: 'original location' }, _unmigrated: { old: 'original location' } };
  expect(exportEnvelopeMetadata([original])).toEqual(original);
  const sources = mergeEnvelopeMetadata([{ conflict: 1, common: true, firstOnly: 'keep' }], [{ conflict: 2, common: true, lastOnly: 'also keep' }]);
  const result = exportEnvelopeMetadata(sources);
  expect(result).toEqual({ common: true, firstOnly: 'keep', lastOnly: 'also keep',
    _unmigrated: { companionSourceEnvelopes: sources } });
  expect(Object.hasOwn(result, 'conflict')).toBe(false);
  expect(importEnvelopeMetadata(envelope(result))).toEqual(sources);
});

// Shared, literal golden vectors are consumed by the companion too. Expected
// output is fixture data, never recomputed by the implementation under test.
it.each(vectors)('agrees with the cross-app wire vector: $name', ({ sources, exported }) => {
  expect(exportEnvelopeMetadata(sources)).toEqual(exported);
  expect(importEnvelopeMetadata(envelope(exported))).toEqual(sources);
});
