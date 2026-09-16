/**
 * A small Markdown reader, and the reason it is small.
 *
 * The journal's `notes` and `reflection` fields have been typed as Markdown
 * since the schema was written; until now nothing rendered them, so they came
 * out as plain text with the asterisks showing. This adds the reading half.
 *
 * It parses to a *description* of blocks and spans — never to an HTML string.
 * That is the security design in one sentence: there is no code path in this
 * app that turns imported text into markup, so `dangerouslySetInnerHTML` is not
 * merely avoided, it has nothing to be handed. A script tag in an imported
 * document is a word between angle brackets, and it renders as exactly that.
 *
 * Deliberately absent: raw HTML, images, tables, footnotes, reference links.
 * Each is either a word-processor feature this app has no use for or a way for
 * a document to reach the network, and the format is meant to be readable in
 * 2060 by someone with a text editor.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'rule' };

/**
 * Schemes a link may use.
 *
 * An allowlist, never a blocklist: `javascript:`, `data:` and `vbscript:` are
 * the obvious ones to ban, and the next one is always the one nobody thought
 * of. Anything not on this list renders as plain text — the address is still
 * visible and still copyable, it simply is not clickable.
 */
const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * Control characters and spaces, stripped before a scheme is judged.
 *
 * A payload hides a scheme by breaking it up with them, so "java\tscript:"
 * reads as no scheme at all to a naive check and as one to a browser.
 */
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0020]/g;

export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  // Relative and anchor links stay inside the app and are safe by construction.
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true;
  const collapsed = trimmed.replace(HIDDEN, '');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(collapsed)) return true; // no scheme at all
  return SAFE_SCHEME.test(collapsed);
}

/**
 * Inline markup, matched in one ordered pass.
 *
 * Code and links first, so a `*` inside a URL cannot start emphasis. Bold
 * before italic, so `**x**` is not read as an empty italic.
 *
 * The emphasis forms carry flanking guards — an opening marker may not be
 * followed by a space, and a closing one may not be preceded by one — and they
 * are load-bearing, not pedantry. Without them "Costs $5 * 3 items and 2 * 4"
 * has its two asterisks read as an italic span and comes out as "Costs $5  3
 * items and 2  4", silently eating characters out of a note somebody wrote
 * years before this renderer existed. The underscore forms additionally require
 * a non-word character on each side, so `file_name_2` and `snake_case` survive.
 */
const INLINE =
  /`([^`]+)`|\[([^\]]*)\]\(([^)\s]*)\)|\*\*(?!\s)([\s\S]*?)(?<!\s)\*\*|(?<![A-Za-z0-9])__(?!\s)([\s\S]*?)(?<!\s)__(?![A-Za-z0-9])|\*(?!\s)([^*\n]*?)(?<!\s)\*|(?<![A-Za-z0-9])_(?!\s)([^_\n]*?)(?<!\s)_(?![A-Za-z0-9])/;

/** Parse the spans inside one line of text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) break;

    if (match.index > 0) out.push({ type: 'text', value: rest.slice(0, match.index) });

    const [whole, codeText, linkText, href, boldStar, boldScore, italicStar, italicScore] = match;
    const strongText = boldStar ?? boldScore;
    const emText = italicStar ?? italicScore;

    if (codeText !== undefined) out.push({ type: 'code', value: codeText });
    else if (strongText !== undefined) out.push({ type: 'strong', children: parseInline(strongText) });
    else if (emText !== undefined) out.push({ type: 'em', children: parseInline(emText) });
    else if (href !== undefined) {
      // An unsafe scheme is not dropped and not followed: it becomes the text
      // it always was, so nothing is lost and nothing is clickable.
      if (isSafeHref(href)) {
        out.push({ type: 'link', href: href.trim(), children: parseInline(linkText) });
      } else {
        out.push({ type: 'text', value: whole });
      }
    }

    rest = rest.slice(match.index + whole.length);
  }

  if (rest.length > 0) out.push({ type: 'text', value: rest });
  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.+)$/;
const NUMBERED = /^\s{0,3}\d{1,3}[.)]\s+(.+)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/**
 * Parse a document into blocks.
 *
 * Plain text is valid input and comes out as paragraphs, which is what makes
 * this safe to switch on for a journal full of notes written before it existed.
 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line.trim()) {
      flush();
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      // Three levels only. A journal entry already sits under the page's own
      // h1 and h2, and deeper levels would break the document outline that the
      // accessibility suite checks.
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2].trim()) });
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'quote', blocks: parseMarkdown(quoted.join('\n')) });
      continue;
    }

    const isBullet = BULLET.test(line);
    const isNumbered = NUMBERED.test(line);
    if (isBullet || isNumbered) {
      flush();
      const ordered = isNumbered;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const item = ordered ? NUMBERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (!item) break;
        items.push(parseInline(item[1]));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}

function inlineText(spans: Inline[]): string {
  return spans
    .map((span) => {
      switch (span.type) {
        case 'text':
        case 'code':
          return span.value;
        default:
          return inlineText(span.children);
      }
    })
    .join('');
}

/** The plain words, for search previews and excerpts. */
export function markdownToPlainText(source: string): string {
  return parseMarkdown(source)
    .map(function render(block): string {
      switch (block.type) {
        case 'rule':
          return '';
        case 'list':
          return block.items.map((item) => inlineText(item)).join('\n');
        case 'quote':
          return block.blocks.map(render).join('\n');
        default:
          return inlineText(block.children);
      }
    })
    .filter(Boolean)
    .join('\n\n');
}
