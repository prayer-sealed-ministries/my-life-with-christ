/**
 * Forward migration of imported journals.
 *
 * The governing rule: never drop a field silently. This app is meant to be
 * outlived by its data, which means an archive written by some later version —
 * or by a version that predates a schema change — must import without loss.
 * Anything this build does not recognise is preserved verbatim in `_unmigrated`
 * and reported, rather than discarded.
 */

import type {
  Entry,
  EntryAnchor,
  EntryKind,
  EntryLink,
  EntrySource,
  ScriptureRef,
  Visibility,
} from '../types';

export const CURRENT_VERSION = 1;

const KNOWN_FIELDS = new Set([
  'id', 'kind', 'title', 'date', 'place', 'speaker', 'sermonSeries', 'anchors',
  'scriptureRefs', 'notes', 'reflection', 'prayer', 'links', 'tags',
  'forDescendants', 'visibility', 'createdAt', 'updatedAt', 'source', '_unmigrated',
]);

const SOURCE_FORMATS = new Set(['txt', 'markdown', 'docx', 'pdf']);

/**
 * Read an import-provenance block, or nothing.
 *
 * Validated field by field rather than spread: this arrives from a file, and an
 * entry's provenance must not become a place to smuggle arbitrary keys into the
 * journal. Anything malformed yields undefined, and the whole block then falls
 * through to `_unmigrated` like any other unrecognised value would.
 */
function migrateSource(raw: unknown): EntrySource | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;

  const format = str(value.format);
  if (!SOURCE_FORMATS.has(format)) return undefined;
  if (typeof value.importedAt !== 'string' || typeof value.filename !== 'string') return undefined;

  const source: EntrySource = {
    importedAt: value.importedAt,
    filename: value.filename,
    format: format as EntrySource['format'],
    itemIndex: typeof value.itemIndex === 'number' && Number.isFinite(value.itemIndex) ? value.itemIndex : 0,
    parserVersion:
      typeof value.parserVersion === 'number' && Number.isFinite(value.parserVersion)
        ? value.parserVersion
        : 0,
  };
  if (typeof value.page === 'number' && Number.isFinite(value.page)) source.page = value.page;
  return source;
}

const KINDS: EntryKind[] = ['sermon', 'reading', 'service', 'prayer', 'reflection', 'letter'];

export interface MigrationContext {
  /**
   * Resolve a bare outline-entry id to its scripture range.
   *
   * Older journals stored anchors as plain id strings. Turning one into a proper
   * scripture anchor needs the outline data, which is absent under `refs-only`.
   * When it cannot be resolved, the raw value is preserved rather than guessed.
   */
  resolveOutlineId?: (id: string) => ScriptureRef | undefined;
  /** Is this id a known topic? */
  isTopicId?: (id: string) => boolean;
  /** Is this id a known book? */
  isBookId?: (id: string) => boolean;
}

export interface MigrationResult {
  entries: Entry[];
  /** Human-readable notes on everything the migration changed or could not map. */
  warnings: string[];
  migratedFrom?: number;
}

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;
const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const isScriptureRef = (value: unknown): value is ScriptureRef => {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.book === 'string' &&
    typeof ref.chapterStart === 'number' &&
    typeof ref.verseStart === 'number' &&
    typeof ref.chapterEnd === 'number' &&
    typeof ref.verseEnd === 'number'
  );
};

/** Normalize one anchor, which may arrive as a bare string from an old journal. */
function migrateAnchor(
  raw: unknown,
  context: MigrationContext,
  warnings: string[],
  entryId: string,
): { anchor?: EntryAnchor; unmapped?: unknown } {
  // Already structured.
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;

    if (value.kind === 'topic' && typeof value.topicId === 'string') {
      return { anchor: { kind: 'topic', topicId: value.topicId } };
    }
    if (value.kind === 'book' && typeof value.book === 'string') {
      return { anchor: { kind: 'book', book: value.book } };
    }
    if (isScriptureRef(value)) {
      const anchor: EntryAnchor = {
        kind: 'scripture',
        book: value.book,
        chapterStart: value.chapterStart,
        verseStart: value.verseStart,
        chapterEnd: value.chapterEnd,
        verseEnd: value.verseEnd,
      };
      if (typeof value.outlineEntryId === 'string') anchor.outlineEntryId = value.outlineEntryId;
      return { anchor };
    }
    return { unmapped: raw };
  }

  // A bare id string, from a journal written before anchors were structured.
  if (typeof raw === 'string') {
    if (context.isTopicId?.(raw)) return { anchor: { kind: 'topic', topicId: raw } };
    if (context.isBookId?.(raw)) return { anchor: { kind: 'book', book: raw } };

    const ref = context.resolveOutlineId?.(raw);
    if (ref) {
      return { anchor: { kind: 'scripture', ...ref, outlineEntryId: raw } };
    }

    // Cannot be resolved in this build — typically an outline id under
    // `refs-only`. Preserve it rather than invent a reference for it.
    warnings.push(
      `Entry ${entryId}: anchor "${raw}" could not be resolved to a scripture reference in this build; preserved in _unmigrated.`,
    );
    return { unmapped: raw };
  }

  return { unmapped: raw };
}

function migrateLink(raw: unknown): EntryLink | null {
  if (typeof raw === 'string') return { url: raw };
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.url !== 'string') return null;

  const link: EntryLink = { url: value.url };
  if (typeof value.label === 'string') link.label = value.label;
  if (typeof value.capturedTitle === 'string') link.capturedTitle = value.capturedTitle;
  if (typeof value.capturedAt === 'string') link.capturedAt = value.capturedAt;
  return link;
}

/** Migrate one raw record into a current-schema Entry. */
export function migrateEntry(raw: unknown, context: MigrationContext, warnings: string[]): Entry | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const id = str(value.id);
  if (!id) {
    warnings.push('Skipped a record with no id — it cannot be merged or de-duplicated.');
    return null;
  }

  const anchors: EntryAnchor[] = [];
  const unmappedAnchors: unknown[] = [];
  for (const item of Array.isArray(value.anchors) ? value.anchors : []) {
    const { anchor, unmapped } = migrateAnchor(item, context, warnings, id);
    if (anchor) anchors.push(anchor);
    if (unmapped !== undefined) unmappedAnchors.push(unmapped);
  }

  const kind = KINDS.includes(value.kind as EntryKind) ? (value.kind as EntryKind) : 'reflection';
  if (value.kind !== undefined && kind !== value.kind) {
    warnings.push(`Entry ${id}: unknown kind ${JSON.stringify(value.kind)} read as "reflection".`);
  }

  // Anything this build does not know about, kept verbatim.
  const unmigrated: Record<string, unknown> = {
    ...(value._unmigrated && typeof value._unmigrated === 'object'
      ? (value._unmigrated as Record<string, unknown>)
      : {}),
  };
  for (const [key, item] of Object.entries(value)) {
    if (KNOWN_FIELDS.has(key)) continue;
    // `JSON.parse` makes "__proto__" an OWN property, and `unmigrated[key] = item`
    // on a plain object then runs the __proto__ setter: it re-points this
    // object's prototype and stores nothing. The field would be dropped in
    // silence, which is precisely what this module exists not to do. (It cannot
    // reach Object.prototype — the target is a fresh literal — so this is a
    // loss-of-data bug rather than a privilege one, but it is still a bug.)
    Object.defineProperty(unmigrated, key, {
      value: item,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    warnings.push(`Entry ${id}: unrecognised field "${key}" preserved in _unmigrated.`);
  }
  if (unmappedAnchors.length > 0) unmigrated.anchors = unmappedAnchors;

  const now = new Date().toISOString();
  const entry: Entry = {
    id,
    kind,
    title: str(value.title),
    date: str(value.date),
    anchors,
    scriptureRefs: strArray(value.scriptureRefs),
    notes: str(value.notes),
    reflection: str(value.reflection),
    links: (Array.isArray(value.links) ? value.links : []).map(migrateLink).filter((l): l is EntryLink => l !== null),
    tags: strArray(value.tags),
    forDescendants: bool(value.forDescendants),
    visibility: value.visibility === 'shared' ? ('shared' as Visibility) : ('private' as Visibility),
    createdAt: str(value.createdAt, now),
    updatedAt: str(value.updatedAt, str(value.createdAt, now)),
  };

  if (typeof value.place === 'string') entry.place = value.place;
  if (typeof value.speaker === 'string') entry.speaker = value.speaker;
  if (typeof value.sermonSeries === 'string') entry.sermonSeries = value.sermonSeries;
  if (typeof value.prayer === 'string') entry.prayer = value.prayer;

  const source = migrateSource(value.source);
  if (source) entry.source = source;
  else if (value.source !== undefined) {
    // Present but unreadable: keep it rather than drop it, and say so.
    unmigrated.source = value.source;
    warnings.push(`Entry ${id}: import provenance was malformed and is preserved in _unmigrated.`);
  }

  if (Object.keys(unmigrated).length > 0) entry._unmigrated = unmigrated;

  return entry;
}

/** Migrate a parsed export envelope forward to the current schema. */
export function migrateExport(raw: unknown, context: MigrationContext = {}): MigrationResult {
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object') {
    throw new Error('This file does not contain a journal: expected a JSON object.');
  }
  const envelope = raw as Record<string, unknown>;

  if (!Array.isArray(envelope.entries)) {
    throw new Error('This file does not contain a journal: no "entries" list found.');
  }

  const version = typeof envelope.version === 'number' ? envelope.version : undefined;
  if (version !== undefined && version > CURRENT_VERSION) {
    warnings.push(
      `This archive was written by a newer version (format v${version}; this build understands v${CURRENT_VERSION}). Unrecognised fields are preserved, not discarded.`,
    );
  }

  const entries: Entry[] = [];
  for (const item of envelope.entries) {
    const entry = migrateEntry(item, context, warnings);
    if (entry) entries.push(entry);
  }

  return {
    entries,
    warnings,
    migratedFrom: version !== undefined && version !== CURRENT_VERSION ? version : undefined,
  };
}
