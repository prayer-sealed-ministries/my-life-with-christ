import { describe, expect, it } from 'vitest';

import { ATTRIBUTIONS, attributionsFor, attributionText } from './attribution';
import { examinedAtLeast } from '../testing/floor';

describe('attribution', () => {
  it('has something to attribute', () => {
    examinedAtLeast(ATTRIBUTIONS.length, 3, 'attribution entries');
  });

  it('always credits the KJV and this project’s own writing', () => {
    for (const source of ['sections', 'none'] as const) {
      const what = attributionsFor(source).map((item) => item.what);
      expect(what, source).toContain('Scripture text');
      expect(what, source).toContain('Book introductions and topics');
    }
  });

  it('credits the BSB only when its sections actually ship', () => {
    expect(attributionsFor('sections').map((i) => i.what)).toContain('Passage divisions and titles');
    expect(attributionsFor('none').map((i) => i.what)).not.toContain('Passage divisions and titles');
  });

  it('names the UK Crown patent wherever the KJV is credited', () => {
    // Under every profile, not just the one that happens to ship divisions:
    // the verse text is the KJV in all of them, so the caveat travels with it.
    for (const source of ['sections', 'none'] as const) {
      expect(attributionText(source), source).toMatch(/Crown letters patent/);
      expect(attributionText(source), source).toMatch(/public domain in the United States/);
    }
  });

  it('never credits the BSB for the verse text', () => {
    // The distinction this whole file exists to keep: the KJV supplies the
    // words, the BSB supplies only where the headings fall. A reader of the
    // exported archive must not come away thinking otherwise.
    const scripture = ATTRIBUTIONS.find((item) => item.what === 'Scripture text');
    expect(scripture?.text).toMatch(/King James Version/);
    expect(scripture?.text, 'the BSB is named in the verse-text credit').not.toMatch(/Berean/);

    const divisions = ATTRIBUTIONS.find((item) => item.what === 'Passage divisions and titles');
    expect(divisions?.text).toMatch(/Berean Standard Bible/);
    expect(divisions?.what, 'the divisions credit claims the verse text').not.toMatch(/Scripture text/);
  });

  it('carries the publisher’s own suggested BSB notice', () => {
    expect(attributionText('sections')).toMatch(/Berean Standard Bible, BSB is produced in cooperation/);
    expect(attributionText('sections')).toMatch(/dedicated to the public domain/);
  });
});
