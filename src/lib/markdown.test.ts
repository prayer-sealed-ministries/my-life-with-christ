/**
 * The Markdown reader, tested for two things above all.
 *
 * First, that it never produces markup. The journal now holds text people
 * pasted out of Word documents and PDFs, and the only reason that is safe is
 * that nothing here turns a string into HTML.
 *
 * Second, that a note written before any of this existed still reads exactly as
 * it did. Plain text is valid Markdown; a journal full of it must not change
 * shape because a renderer appeared.
 */

import { describe, expect, it } from 'vitest';

import { examinedAtLeast } from '../testing/floor';
import { isSafeHref, markdownToPlainText, parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown — the formats the toolbar can write', () => {
  it('reads headings, and never deeper than three levels', () => {
    const blocks = parseMarkdown('# One\n\n## Two\n\n###### Six');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'heading', 'heading']);
    // Clamped: a note sits under the page's own h1 and h2, so a sixth-level
    // heading inside one would skip levels in the document outline.
    expect(blocks.map((b) => (b.type === 'heading' ? b.level : 0))).toEqual([1, 2, 3]);
  });

  it('reads bulleted and numbered lists', () => {
    const bullets = parseMarkdown('- one\n- two\n- three');
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toMatchObject({ type: 'list', ordered: false });

    const numbered = parseMarkdown('1. one\n2. two');
    expect(numbered[0]).toMatchObject({ type: 'list', ordered: true });
  });

  it('reads block quotes, including formatting inside them', () => {
    const blocks = parseMarkdown('> He said **grace**.\n> Then he sat down.');
    expect(blocks[0].type).toBe('quote');
    expect(markdownToPlainText('> He said **grace**.')).toBe('He said grace.');
  });

  it('reads bold and italic, including nested', () => {
    expect(parseInline('**bold**')[0]).toMatchObject({ type: 'strong' });
    expect(parseInline('*italic*')[0]).toMatchObject({ type: 'em' });
    expect(parseInline('__bold__')[0]).toMatchObject({ type: 'strong' });
    expect(markdownToPlainText('**bold *and* italic**')).toBe('bold and italic');
  });

  it('keeps a single newline inside a paragraph as part of that paragraph', () => {
    // People write sermon notes in ragged lines and mean them to stay ragged.
    const blocks = parseMarkdown('one line\nnext line');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
  });

  it('separates paragraphs on a blank line', () => {
    expect(parseMarkdown('first\n\nsecond')).toHaveLength(2);
  });
});

describe('plain text written before any of this still reads the same', () => {
  const PLAIN = [
    'A single sentence of notes.',
    'Two lines\nwith a break between them.',
    'A paragraph.\n\nAnd a second paragraph.',
    'Costs $5 * 3 items and 2 * 4 = 8.',
    'An address: 1 Smith Street, apartment 3.',
    'A note ending in a number 5',
  ];

  for (const text of PLAIN) {
    it(`round-trips ${JSON.stringify(text.slice(0, 32))} with every word intact`, () => {
      const out = markdownToPlainText(text);
      for (const word of text.split(/\s+/).filter(Boolean)) {
        expect(out, `lost ${JSON.stringify(word)} from ${JSON.stringify(text)}`).toContain(word);
      }
    });
  }

  it('does not turn a lone asterisk into formatting', () => {
    expect(markdownToPlainText('2 * 3 = 6')).toBe('2 * 3 = 6');
  });

  /** Floor: a parser returning nothing would satisfy every "contains" above. */
  it('actually produces blocks', () => {
    examinedAtLeast(parseMarkdown(PLAIN.join('\n\n')).length, PLAIN.length, 'blocks parsed');
  });
});

describe('links are never a way to run something', () => {
  const UNSAFE = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ];

  for (const href of UNSAFE) {
    it(`refuses ${JSON.stringify(href)}`, () => {
      expect(isSafeHref(href)).toBe(false);
    });
  }

  it('allows the schemes a journal actually needs', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('mailto:someone@example.com')).toBe(true);
    expect(isSafeHref('#anchor')).toBe(true);
    expect(isSafeHref('/browse')).toBe(true);
  });

  it('keeps an unsafe link as visible text rather than dropping it', () => {
    // Nothing is lost and nothing is clickable: the address is still readable.
    const spans = parseInline('[click](javascript:alert(1))');
    expect(spans.some((span) => span.type === 'link')).toBe(false);
    // Every character survives, across however many text spans it took. (The
    // link pattern stops at the first ")", so the trailing one is its own span
    // — which is why this asserts the reassembled text rather than a count.)
    expect(spans.map((span) => (span.type === 'text' ? span.value : '')).join('')).toBe(
      '[click](javascript:alert(1))',
    );
  });
});

describe('markup in the source is text, never structure', () => {
  const HOSTILE = [
    '<script>window.x = 1</script>',
    '<img src=x onerror="window.x = 1">',
    '<iframe src="https://example.invalid"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    '<style>body{display:none}</style>',
  ];

  for (const source of HOSTILE) {
    it(`treats ${JSON.stringify(source.slice(0, 28))} as words`, () => {
      const blocks = parseMarkdown(source);
      // It parses to a paragraph of text — the one shape that cannot execute.
      expect(blocks.every((block) => block.type === 'paragraph')).toBe(true);
      expect(markdownToPlainText(source)).toContain('<');
    });
  }

  it('produces no node type that could carry markup', () => {
    const blocks = parseMarkdown(HOSTILE.join('\n\n'));
    const KNOWN = new Set(['heading', 'paragraph', 'quote', 'list', 'rule']);
    examinedAtLeast(blocks.length, HOSTILE.length, 'blocks parsed from hostile input');
    for (const block of blocks) expect(KNOWN.has(block.type)).toBe(true);
  });
});
