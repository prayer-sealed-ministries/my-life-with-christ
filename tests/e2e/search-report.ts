/**
 * What the search page is actually showing, and why.
 *
 * Written because a failure here once said only that "Nothing matches" was not
 * visible. That is the least useful half of the answer: the question a stale
 * result raises is *which* entry came back and *what* matched in it, and
 * neither was recoverable without rerunning under instrumentation — which is
 * exactly the rerun where an intermittent fails to appear.
 *
 * So the assertion reads the page and the store together and reports both. It
 * costs one DOM read and one IndexedDB read per assertion, and it prints
 * nothing at all unless something is wrong.
 */

import { expect, type Page } from '@playwright/test';

/** One journal result, named the way the reader sees it named. */
export interface ResultReport {
  /** From the link target, so it is the entry's real id and not a guess. */
  id: string;
  title: string;
  /** The result's own provenance lines: which field matched, and the snippet. */
  why: string[];
}

/** Where a term still is, field by field, in what the store actually holds. */
export interface StoredTermReport {
  id: string;
  fields: string[];
}

export interface SearchReport {
  query: string;
  hash: string;
  /**
   * Four of these are not "the wrong results", and saying so is the point.
   *
   * `elsewhere` means the app was not on the search route at all — which is
   * what an intermittent here turned out to be, and which `toBeVisible()` on
   * the empty state reports as "element(s) not found", indistinguishable from
   * a search that returned the wrong thing. `searching` means it had not
   * settled yet.
   */
  state: 'nothing-matches' | 'results' | 'searching' | 'no-query' | 'elsewhere';
  /** The live region's own count line, so the page's claim is on the record. */
  announced: string;
  journal: ResultReport[];
  /** Headings of every other results section, with their counts as shown. */
  otherSections: string[];
  /** Entries in IndexedDB whose searchable fields still carry the query term. */
  entriesHoldingTerm: StoredTermReport[];
  /** Drafts likewise, because a draft holding it would explain a stale match. */
  draftsHoldingTerm: StoredTermReport[];
}

/**
 * Read the page and the store, without waiting for either.
 *
 * Deliberately a snapshot: the caller decides what to wait for, because "still
 * searching" is itself a finding worth reporting rather than something to be
 * quietly slept through.
 */
export async function readSearchPage(page: Page, query: string): Promise<SearchReport> {
  const hash = await page.evaluate(() => window.location.hash);

  const nothing = await page.getByText(/Nothing matches/).count();
  const journalSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Your journal/ }) });
  const hasJournalSection = (await journalSection.count()) > 0;

  const journal: ResultReport[] = [];
  if (hasJournalSection) {
    const items = journalSection.getByRole('listitem');
    for (const item of await items.all()) {
      const link = item.getByRole('link').first();
      const href = (await link.getAttribute('href')) ?? '';
      /*
       * Every line of the result except its own title: the meta line and the
       * provenance lines are what say why it came back.
       *
       * Read span by span rather than as one `innerText`, because the field
       * label and its snippet are sibling inline spans — flattened, they come
       * back as "NotesReplaced entirely: …", which is the one part of this
       * report somebody has to squint at.
       */
      const lines = (
        await item.evaluate((node) =>
          [...node.querySelectorAll(':scope > a > span')].map((span) =>
            [...span.childNodes]
              .map((child) => child.textContent?.trim() ?? '')
              .filter(Boolean)
              .join(' — '),
          ),
        )
      )
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      journal.push({
        id: href.split('/').pop() ?? href,
        title: lines[0] ?? '',
        why: lines.slice(1),
      });
    }
  }

  const otherSections = await page
    .locator('section h2')
    .filter({ hasNotText: /Your journal/ })
    .allInnerTexts();

  const announced = (await page.locator('[role="status"], [aria-live]').allInnerTexts())
    .map((text) => text.trim())
    .filter(Boolean)
    .join(' | ');

  // Asked first, because every other answer is meaningless when the search
  // page is not the page being looked at.
  const state: SearchReport['state'] = !hash.startsWith('#/search')
    ? 'elsewhere'
    : !query
      ? 'no-query'
      : nothing > 0
        ? 'nothing-matches'
        : hasJournalSection
          ? 'results'
          : 'searching';

  const stored = await readStore(page, query);

  return {
    query,
    hash,
    state,
    announced,
    journal,
    otherSections: otherSections.map((text) => text.trim()),
    ...stored,
  };
}

/**
 * Which stored records still carry the term, field by field.
 *
 * Reads IndexedDB directly rather than the app's own modules, which are not
 * reachable from here — the same constraint, and the same duplication, as
 * `seed.ts`. A plain substring test on purpose: the question is "is the word
 * still anywhere in this record", not "would the ranker match it".
 */
async function readStore(
  page: Page,
  query: string,
): Promise<Pick<SearchReport, 'entriesHoldingTerm' | 'draftsHoldingTerm'>> {
  return page.evaluate(async (needle) => {
    const term = needle.toLowerCase();

    const readAll = (db: IDBDatabase, store: string): Promise<Record<string, unknown>[]> =>
      new Promise((resolve) => {
        if (!db.objectStoreNames.contains(store)) return resolve([]);
        const request = db.transaction(store, 'readonly').objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => resolve([]);
      });

    /** Every string anywhere in the record, addressed by its path. */
    const fieldsHolding = (record: unknown, path = ''): string[] => {
      if (typeof record === 'string') return record.toLowerCase().includes(term) ? [path] : [];
      if (Array.isArray(record)) {
        return record.flatMap((value, index) => fieldsHolding(value, `${path}[${index}]`));
      }
      if (record && typeof record === 'object') {
        return Object.entries(record).flatMap(([key, value]) =>
          fieldsHolding(value, path ? `${path}.${key}` : key),
        );
      }
      return [];
    };

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('journey');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });

    const describe = (rows: Record<string, unknown>[]) =>
      rows
        .map((row) => ({ id: String(row.id ?? '?'), fields: fieldsHolding(row) }))
        .filter((row) => row.fields.length > 0);

    const entriesHoldingTerm = describe(await readAll(db, 'entries'));
    const draftsHoldingTerm = describe(await readAll(db, 'drafts'));
    db.close();
    return { entriesHoldingTerm, draftsHoldingTerm };
  }, query);
}

/** Legible enough to act on without rerunning anything. */
export const formatReport = (report: SearchReport): string =>
  [
    `query: ${JSON.stringify(report.query)}`,
    `hash: ${report.hash}`,
    `page state: ${report.state}`,
    `announced: ${report.announced || '(nothing announced)'}`,
    `journal results (${report.journal.length}):`,
    ...report.journal.map(
      (result) => `  - ${result.id} "${result.title}" — ${result.why.join(' / ') || '(no reason shown)'}`,
    ),
    `other sections: ${report.otherSections.join(', ') || '(none)'}`,
    `entries still holding ${JSON.stringify(report.query)}:`,
    ...(report.entriesHoldingTerm.length
      ? report.entriesHoldingTerm.map((row) => `  - ${row.id}: ${row.fields.join(', ')}`)
      : ['  (none)']),
    `drafts still holding ${JSON.stringify(report.query)}:`,
    ...(report.draftsHoldingTerm.length
      ? report.draftsHoldingTerm.map((row) => `  - ${row.id}: ${row.fields.join(', ')}`)
      : ['  (none)']),
  ].join('\n');

/**
 * Assert the page settles on a given state, and say exactly what it showed if
 * it settles on another.
 *
 * Polls rather than asserting once, so it waits like any other Playwright
 * assertion — and reports the LAST thing it saw rather than a bare timeout,
 * which is the whole reason this file exists.
 */
export async function expectSearchState(
  page: Page,
  query: string,
  want: SearchReport['state'],
): Promise<SearchReport> {
  let last: SearchReport | null = null;
  try {
    await expect
      .poll(async () => (last = await readSearchPage(page, query)).state, {
        message: `search for ${JSON.stringify(query)} should show ${want}`,
      })
      .toBe(want);
  } catch (failure) {
    const detail = last ? formatReport(last) : '(the page could not be read at all)';
    throw new Error(`${(failure as Error).message}\n\nWhat the page and the store held:\n${detail}`);
  }
  return last as unknown as SearchReport;
}
