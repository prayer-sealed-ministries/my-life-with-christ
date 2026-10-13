import { describe, expect, it } from 'vitest';
import { migrateExport } from './migrate';
import { READING } from './fixtures';

describe('journal envelope identity declarations', () => {
  it.each(['other', 'lwc-companion-protected', '', null, false, 1, {}, []])(
    'refuses an explicitly foreign or malformed format: %j', (format) => {
      const raw = { format, version: 1, entries: [READING] };
      const original = JSON.stringify(raw);
      expect(() => migrateExport(raw)).toThrow(/declares.*different.*format/i);
      expect(JSON.stringify(raw)).toBe(original);
    },
  );

  it.each(['1', '', null, false, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, []])(
    'refuses a malformed declared version rather than treating it as legacy: %j', (version) => {
      expect(() => migrateExport({ format: 'journey-export', version, entries: [READING] }))
        .toThrow(/invalid.*version/i);
    },
  );

  it.each([
    {}, { format: 'journey-export' }, { version: 1 }, { format: 'journey-export', version: 1 },
  ])('keeps legacy missing declarations and current v1 readable: %j', (declarations) => {
    const result = migrateExport({ ...declarations, entries: [READING] });
    expect(result.entries).toEqual([READING]);
    expect(result.drafts).toEqual([]);
    expect(result.migratedFrom).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it.each([2, 99, Number.MAX_SAFE_INTEGER])('accepts future integer version %s without discarding unknown writing', (version) => {
    const future = { opaque: ['Fictional future content', 0, false] };
    const result = migrateExport({ format: 'journey-export', version,
      entries: [{ ...READING, future }],
    });
    expect(result.migratedFrom).toBe(version);
    expect(result.warnings.join(' ')).toContain('newer version');
    expect(result.entries[0]._unmigrated?.future).toEqual(future);
    expect(migrateExport({ entries: result.entries }).entries).toEqual(result.entries);
  });
});
