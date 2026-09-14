/**
 * Extract the section-heading division scheme from USFM.
 *
 * A USFM file marks a section with `\s1 <title>` and then continues with `\v`
 * verse markers. The heading itself carries no reference — the section runs
 * from the first verse that follows it to the verse before the next heading,
 * or to the end of the book. So the spans are derived from position, and a
 * section can cross a chapter boundary exactly as the outline entries can.
 *
 * `\s2` subsections are deliberately NOT included. They sit inside an `\s1`,
 * so taking both would make every subsection overlap its parent and turn a
 * clean partition into a pile of duplicates. They are counted and reported
 * rather than silently dropped.
 */

/** Strip USFM character markup, footnotes and cross-references from a heading. */
export function cleanHeading(raw) {
  return raw
    // Footnotes and cross-references, which are not part of the title.
    .replace(/\\f\s.*?\\f\*/g, '')
    .replace(/\\x\s.*?\\x\*/g, '')
    // \ref Luke 3:23-38|LUK 3:23-38\ref* -> the display text.
    .replace(/\\ref\s+([^|]*)\|[^\\]*\\ref\*/g, '$1')
    // Any remaining character-level marker pair, keeping its content.
    .replace(/\\\+?[a-z]+\d*\s?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse one USFM book into section spans.
 *
 * @param {string} text the file contents
 * @param {string} bookId this project's book id
 * @param {number[]} verseCounts verses per chapter, to close the final section
 * @returns {{sections: object[], subsectionCount: number, issues: object[]}}
 */
export function parseUsfmSections(text, bookId, verseCounts) {
  /** @type {Array<{title: string, chapter: number, verse: number}>} */
  const starts = [];
  const issues = [];
  let subsectionCount = 0;

  let chapter = 0;
  let verse = 0;
  /** A heading seen, still waiting for the verse that begins its section. */
  let pending = null;

  for (const line of text.split('\n')) {
    const chapterMark = /^\\c\s+(\d+)/.exec(line);
    if (chapterMark) {
      chapter = Number(chapterMark[1]);
      verse = 0;
      continue;
    }

    const subsection = /^\\s2\s+(.*)$/.exec(line);
    if (subsection) {
      subsectionCount += 1;
      continue;
    }

    const heading = /^\\s1?\s+(.*)$/.exec(line);
    if (heading) {
      const title = cleanHeading(heading[1]);
      if (!title) {
        issues.push({ type: 'empty-heading', detail: 'a section heading had no text', raw: line.trim() });
        continue;
      }
      pending = title;
      continue;
    }

    // Verses can appear several to a line in poetry, so take the first.
    const verseMark = /\\v\s+(\d+)/.exec(line);
    if (verseMark) {
      verse = Number(verseMark[1]);
      if (pending) {
        starts.push({ title: pending, chapter, verse });
        pending = null;
      }
    }
  }

  if (pending) {
    issues.push({
      type: 'heading-without-verses',
      detail: `"${pending}" was the last heading and no verse followed it`,
      raw: pending,
    });
  }

  // Close each section at the verse before the next one begins.
  const sections = starts.map((start, index) => {
    const next = starts[index + 1];

    let chapterEnd;
    let verseEnd;
    if (next) {
      if (next.verse > 1) {
        chapterEnd = next.chapter;
        verseEnd = next.verse - 1;
      } else {
        // The next section opens a chapter, so this one ends with the previous.
        chapterEnd = next.chapter - 1;
        verseEnd = verseCounts[chapterEnd - 1];
      }
    } else {
      chapterEnd = verseCounts.length;
      verseEnd = verseCounts[chapterEnd - 1];
    }

    return {
      book: bookId,
      title: start.title,
      chapterStart: start.chapter,
      verseStart: start.verse,
      chapterEnd,
      verseEnd,
    };
  });

  return { sections, subsectionCount, issues };
}
