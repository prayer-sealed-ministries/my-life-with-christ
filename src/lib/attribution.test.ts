import { describe, expect, it } from 'vitest';

import { ATTRIBUTIONS, attributionsFor, attributionText } from './attribution';
import { examinedAtLeast } from '../testing/floor';

describe('attribution', () => {
  it('has something to attribute', () => {
    examinedAtLeast(ATTRIBUTIONS.length, 3, 'attribution entries');
  });

  it('always credits the KJV and this project’s own writing', () => {
    for (const source of ['outlines', 'sections', 'none'] as const) {
      const what = attributionsFor(source).map((item) => item.what);
      expect(what, source).toContain('Scripture text');
      expect(what, source).toContain('Book introductions and topics');
    }
  });

  it('credits the BSB only when its sections actually ship', () => {
    expect(attributionsFor('sections').map((i) => i.what)).toContain('Passage divisions and titles');
    expect(attributionsFor('none').map((i) => i.what)).not.toContain('Passage divisions and titles');
    // The purchased outlines are not attributed on a public surface, because
    // they never reach one.
    expect(attributionsFor('outlines').map((i) => i.what)).not.toContain('Passage divisions and titles');
  });

  it('names the UK Crown patent wherever the KJV is credited', () => {
    expect(attributionText('sections')).toMatch(/Crown letters patent/);
  });

  it('carries the publisher’s own suggested BSB notice', () => {
    expect(attributionText('sections')).toMatch(/Berean Standard Bible, BSB is produced in cooperation/);
    expect(attributionText('sections')).toMatch(/dedicated to the public domain/);
  });
});
