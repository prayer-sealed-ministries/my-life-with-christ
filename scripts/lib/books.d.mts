/** Types for the ingest's canon table, so the app's sync test can import it. */

export interface BookRecord {
  id: string;
  name: string;
  testament: 'OT' | 'NT';
  order: number;
  aliases?: string[];
}

export declare const BOOKS: BookRecord[];
export declare const CHAPTER_COUNTS: Record<string, number>;
export declare const BOOKS_BY_ID: Map<string, BookRecord>;
export declare function matchBookPrefix(
  text: string,
): { book: BookRecord; matched: string; rest: string; canonical: boolean } | null;
export declare function matchBookExact(text: string): { book: BookRecord; canonical: boolean } | null;
