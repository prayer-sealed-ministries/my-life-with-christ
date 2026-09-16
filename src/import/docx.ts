/**
 * DOCX text extraction.
 *
 * No new dependency: a .docx is a ZIP holding an XML document, and this repo
 * already reads ZIPs (`src/export/zip.ts`, which the native journal import uses)
 * and already has to decompress untrusted-ish bytes. A document framework would
 * bring a megabyte of layout code to recover paragraphs and headings, which is
 * all this needs.
 *
 * WHAT IS READ: `word/document.xml`, and nothing else.
 *
 * That single sentence is most of the security posture. Macros live in
 * `word/vbaProject.bin`; embedded objects in `word/embeddings/`; external
 * links, remote images and linked subdocuments are declared in
 * `word/_rels/document.xml.rels`. None of those paths is opened, no
 * relationship is ever resolved, and nothing is fetched — extraction is pure
 * text and XML over bytes already in memory. A document that references a
 * remote image yields text with no image in it, which is the correct outcome.
 */

import { readZipLimited } from './zip-limits';
import { ImportError, MAX_TEXT_CHARS } from './limits';

/** The only member this parser will open. */
const DOCUMENT_PATH = 'word/document.xml';

/** Paragraph styles Word uses for headings. */
const HEADING_STYLE = /^(Heading|Ttulo|berschrift|Titre|Ttulo)\s*([1-9])$/i;

export interface DocxParagraph {
  text: string;
  /** 1-9 where the paragraph carried a heading style, else undefined. */
  headingLevel?: number;
  /** True for a numbered or bulleted paragraph. */
  listItem: boolean;
}

const decodeEntities = (xml: string): string =>
  xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    // Ampersand last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&');

/** Pull the text out of one `<w:p>`, respecting Word's explicit break elements. */
function paragraphText(xml: string): string {
  let out = '';
  // <w:t> runs carry the words; <w:tab/> and <w:br/> carry the spacing.
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml)) !== null) {
    if (match[1] !== undefined) out += decodeEntities(match[1]);
    else if (match[0].startsWith('<w:tab')) out += '\t';
    else out += '\n';
  }
  return out;
}

/**
 * Parse the paragraphs of a .docx.
 *
 * Regex over XML rather than a DOM parse, deliberately: the shapes wanted here
 * are flat and local (`<w:p>`, `<w:t>`, `<w:pStyle>`), a DOMParser is not
 * available in every context this runs in, and handing untrusted XML to a full
 * parser invites entity expansion. Nothing here resolves an entity it did not
 * write itself, so there is no billion-laughs to run.
 */
export async function parseDocx(data: Uint8Array): Promise<DocxParagraph[]> {
  const entries = await readZipLimited(data, { only: (path) => path === DOCUMENT_PATH });

  const document = entries.find((entry) => entry.path === DOCUMENT_PATH);
  if (!document) {
    throw new ImportError(
      'That file does not look like a Word document — it has no document body inside it.',
    );
  }

  const xml = new TextDecoder().decode(document.bytes);
  if (xml.length > MAX_TEXT_CHARS) {
    throw new ImportError('That Word document is too large to read on this device.');
  }

  const paragraphs: DocxParagraph[] = [];
  const paragraph = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
  let match: RegExpExecArray | null;

  while ((match = paragraph.exec(xml)) !== null) {
    const inner = match[1] ?? '';
    const text = paragraphText(inner).replace(/[ \t]+$/gm, '');

    const style = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(inner)?.[1] ?? '';
    const heading = HEADING_STYLE.exec(style);
    const outlineLevel = /<w:outlineLvl\s[^>]*w:val="(\d)"/.exec(inner)?.[1];

    const headingLevel = heading
      ? Number(heading[2])
      : outlineLevel !== undefined
        ? Number(outlineLevel) + 1
        : undefined;

    paragraphs.push({
      text,
      headingLevel,
      listItem: /<w:numPr\b/.test(inner),
    });
  }

  return paragraphs;
}

/**
 * Flatten parsed paragraphs into Markdown-ish text.
 *
 * Headings become `#` lines and list items become `- ` lines, so the same
 * segmentation that handles a real Markdown file handles a Word file too — one
 * splitter, not two. Emphasis is dropped: bold inside a sermon note is
 * emphasis on a word, not structure, and carrying it would mean carrying
 * Word's run model into the journal.
 */
export function docxToText(paragraphs: DocxParagraph[]): string {
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim();
    if (!text) {
      // One blank line between blocks; never a run of them.
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    if (paragraph.headingLevel !== undefined) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      lines.push(`${'#'.repeat(Math.min(paragraph.headingLevel, 6))} ${text}`);
      lines.push('');
      continue;
    }
    lines.push(paragraph.listItem ? `- ${text}` : text);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
