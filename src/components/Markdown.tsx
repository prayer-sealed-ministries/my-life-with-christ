/**
 * Rendering a note's Markdown as React elements.
 *
 * There is no HTML string anywhere in this file, and that is the point. React
 * escapes every text node it is given, so imported text carrying a script tag
 * becomes visible characters rather than a tag. `dangerouslySetInnerHTML` is
 * not used, and — more usefully — nothing in the pipeline ever produces markup
 * for it to be handed.
 *
 * Links render as links but are inert until a person clicks one: nothing
 * navigates on its own, `rel` blocks the opener reference, and any scheme the
 * parser did not vouch for arrived here as plain text rather than a link.
 */

import type { ReactNode } from 'react';

import { parseMarkdown, type Block, type Inline } from '../lib/markdown';

const LINK =
  'underline decoration-line-strong underline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2';

function renderInline(spans: Inline[], keyPrefix: string): ReactNode[] {
  return spans.map((span, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (span.type) {
      case 'text':
        // Returned bare rather than wrapped in a span. A wrapper would be one
        // more node between the text and the element carrying its styling, and
        // inherited properties — italics on a reflection, overflow-wrap on a
        // long URL — read better when the text is a direct child of the thing
        // that sets them.
        return span.value;
      case 'strong':
        return <strong key={key}>{renderInline(span.children, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(span.children, key)}</em>;
      case 'code':
        return (
          <code key={key} className="rounded bg-raised px-1 py-0.5 text-[0.9em]">
            {span.value}
          </code>
        );
      case 'link':
        return (
          // target="_blank" deliberately absent: a note's link opens where the
          // reader chooses, and `noreferrer` keeps the new page from reaching
          // back through window.opener if they open it in a tab themselves.
          <a key={key} href={span.href} rel="noreferrer noopener" className={LINK}>
            {renderInline(span.children, key)}
          </a>
        );
    }
  });
}

/**
 * Heading levels, offset to fit the page they sit inside.
 *
 * A note is rendered under the view's own h1 and an h2 section heading, so a
 * `#` in a note is an h3 on the page. Emitting an h1 here would put two on the
 * page and fail the heading-order test the accessibility suite runs.
 */
const HEADING_TAG = { 1: 'h3', 2: 'h4', 3: 'h5' } as const;
const HEADING_CLASS = {
  1: 'mt-4 font-serif text-lg font-semibold',
  2: 'mt-4 font-serif text-base font-semibold',
  3: 'mt-3 font-sans text-sm font-semibold uppercase tracking-wide text-ink-soft',
} as const;

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = HEADING_TAG[block.level];
      return (
        <Tag key={key} className={`${HEADING_CLASS[block.level]} first:mt-0`}>
          {renderInline(block.children, key)}
        </Tag>
      );
    }
    case 'paragraph':
      // whitespace-pre-line keeps a single newline inside a paragraph, which is
      // how people actually write sermon notes — one thought per line, with no
      // blank line between them.
      return (
        <p key={key} className="mt-3 whitespace-pre-line break-words leading-relaxed first:mt-0">
          {renderInline(block.children, key)}
        </p>
      );
    case 'quote':
      return (
        <blockquote
          key={key}
          className="mt-3 border-l-2 border-line-strong pl-4 italic text-ink-soft first:mt-0"
        >
          {block.blocks.map((inner, index) => renderBlock(inner, `${key}-${index}`))}
        </blockquote>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`mt-3 space-y-1 pl-5 first:mt-0 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`} className="break-words leading-relaxed">
              {renderInline(item, `${key}-${index}`)}
            </li>
          ))}
        </Tag>
      );
    }
    case 'rule':
      return <hr key={key} className="mt-4 border-line first:mt-0" />;
  }
}

/**
 * A note's body, rendered.
 *
 * Plain text written before any of this existed parses to paragraphs and looks
 * exactly as it always did, which is what makes it safe to switch on for a
 * journal that is already full.
 */
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return null;
  return (
    <div className={className}>{blocks.map((block, index) => renderBlock(block, `b${index}`))}</div>
  );
}
