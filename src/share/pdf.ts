/**
 * One entry, as a document somebody can keep.
 *
 * The same `SharedEntryDocument` the text rendering uses, so the two can never
 * disagree about what a share contains — the selection is applied once, in
 * `entry-document.ts`, and both renderers are given the result.
 *
 * WHY THE STANDARD PDF FONTS
 *
 * Times and Helvetica are two of the fourteen typefaces every PDF reader has
 * been required to have since 1993. Embedding the application's own serif
 * would look closer to the app and would add a few hundred kilobytes to the
 * bundle for a document whose whole purpose is to be readable by somebody
 * else, on an unknown device, possibly years from now. This project's promise
 * is that a life's writing stays readable; a font nobody has to install is
 * part of keeping it.
 *
 * WHY THE TEXT IS NOT INTERPRETED
 *
 * The body of a section is the reader's own Markdown, and it is drawn as they
 * typed it. Rendering the asterisks as bold would be a guess about what they
 * meant; removing them would be editing their words. Neither is this
 * function's business — it lays out lines and breaks pages.
 *
 * jsPDF is imported dynamically. A reader who never shares an entry never
 * downloads a PDF writer, and `verify:startup` asserts it is not on the path
 * between tapping the widget and typing.
 */

import type { SharedEntryDocument } from './entry-document';

/** US Letter in points, which is jsPDF's natural unit. */
const PAGE = { width: 612, height: 792 };
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

/** Room kept at the foot of every page for the identity line. */
const FOOTER_SPACE = 48;

const SIZES = { mark: 8, title: 20, meta: 10, heading: 10, body: 11, footer: 8 };
const LEADING = { meta: 14, heading: 16, body: 15 };

/**
 * The quiet line at the top.
 *
 * Capitalised and small rather than a logo: this is somebody's journal page,
 * and the application's name belongs on it the way a letterhead does — present,
 * and not the point.
 */
const MARK = 'MY LIFE WITH CHRIST';
const FOOTER = ['My Life With Christ', 'Your walk, remembered.'];

export async function renderSharedEntryPdf(document: SharedEntryDocument): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: [PAGE.width, PAGE.height] });

  let y = MARGIN;

  /** Move down, starting a new page when this line would not fit above the footer. */
  const advance = (by: number): void => {
    if (y + by > PAGE.height - MARGIN - FOOTER_SPACE) {
      pdf.addPage();
      y = MARGIN;
    }
    y += by;
  };

  const write = (
    text: string,
    options: { font: 'times' | 'helvetica'; style: 'normal' | 'bold' | 'italic'; size: number; leading: number },
  ): void => {
    pdf.setFont(options.font, options.style);
    pdf.setFontSize(options.size);
    // Wrapping is jsPDF's, against the real font metrics, so a long line breaks
    // where it would actually run out of page rather than at a guessed column.
    for (const line of pdf.splitTextToSize(text, CONTENT_WIDTH) as string[]) {
      advance(options.leading);
      pdf.text(line, MARGIN, y);
    }
  };

  pdf.setTextColor(120);
  write(MARK, { font: 'helvetica', style: 'bold', size: SIZES.mark, leading: 12 });
  pdf.setTextColor(0);

  advance(10);
  write(document.title, { font: 'times', style: 'bold', size: SIZES.title, leading: 24 });

  pdf.setTextColor(90);
  write(document.date, { font: 'times', style: 'normal', size: SIZES.meta, leading: LEADING.meta });
  if (document.scripture.length > 0) {
    write(document.scripture.join('; '), {
      font: 'times',
      style: 'italic',
      size: SIZES.meta,
      leading: LEADING.meta,
    });
  }
  if (document.details.length > 0) {
    // "Pastor James · First Baptist Church" — the circumstances on one line,
    // because they are one thought.
    write(document.details.map(([, value]) => value).join(' · '), {
      font: 'times',
      style: 'normal',
      size: SIZES.meta,
      leading: LEADING.meta,
    });
  }
  pdf.setTextColor(0);

  for (const section of document.sections) {
    advance(18);
    // The heading is what keeps whose-words-are-whose true on the page. A
    // provided section is labelled exactly as it is everywhere else.
    write(section.heading.toUpperCase(), {
      font: 'helvetica',
      style: 'bold',
      size: SIZES.heading,
      leading: LEADING.heading,
    });
    advance(4);
    for (const paragraph of section.body.split(/\n{2,}/)) {
      const text = paragraph.trim();
      if (!text) continue;
      write(text, { font: 'times', style: 'normal', size: SIZES.body, leading: LEADING.body });
      advance(6);
    }
  }

  if (document.links.length > 0) {
    advance(18);
    write('LINKS', {
      font: 'helvetica',
      style: 'bold',
      size: SIZES.heading,
      leading: LEADING.heading,
    });
    advance(4);
    for (const link of document.links) {
      write(link.label === link.url ? link.url : `${link.label} — ${link.url}`, {
        font: 'times',
        style: 'normal',
        size: SIZES.body,
        leading: LEADING.body,
      });
    }
  }

  // The identity line, on every page, at the foot. No address, no link, no
  // code to scan, nothing that could identify this reader or this device.
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(SIZES.footer);
    pdf.setTextColor(140);
    pdf.text(FOOTER[0], MARGIN, PAGE.height - MARGIN + 6);
    pdf.text(FOOTER[1], MARGIN, PAGE.height - MARGIN + 17);
  }

  return new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer);
}
