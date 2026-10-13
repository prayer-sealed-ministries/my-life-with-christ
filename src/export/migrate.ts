/**
 * Forward migration of imported journals.
 *
 * The governing rule: never drop a field silently. This app is meant to be
 * outlived by its data, which means an archive written by some later version —
 * or by a version that predates a schema change — must import without loss.
 * Unrecognised record fields are preserved verbatim in `_unmigrated` and
 * reported. Extensions inside a validated nested object stay beside that
 * object's known fields as inert data, rather than being discarded.
 */

import type {
  EntryDraft,
  Entry,
  EntryAnchor,
  EntryKind,
  EntryLink,
  EntrySource,
  ScriptureRef,
  SourceMaterial,
  Visibility,
} from '../types';

import { ENTRY_KINDS, resolveEntryKind } from '../lib/entry-kinds';

export const CURRENT_VERSION = 1;

const KNOWN_FIELDS = new Set([
  'id', 'kind', 'title', 'date', 'place', 'speaker', 'sermonSeries', 'anchors',
  'scriptureRefs', 'notes', 'reflection', 'prayer', 'links', 'tags',
  'forDescendants', 'visibility', 'createdAt', 'updatedAt', 'source', 'sourceMaterial',
  '_unmigrated',
]);

const SOURCE_FIELDS = new Set(['format', 'importedAt', 'filename', 'itemIndex', 'parserVersion', 'page']);
const MATERIAL_FIELDS = new Set([
  'format', 'filename', 'importedAt', 'body', 'parserVersion',
  'sha256', 'church', 'speaker', 'date', 'scripture',
]);
const LINK_FIELDS = new Set(['url', 'label', 'capturedTitle', 'capturedAt']);
const TOPIC_FIELDS = new Set(['kind', 'topicId']);
const BOOK_FIELDS = new Set(['kind', 'book']);
const SCRIPTURE_FIELDS = new Set([
  'kind', 'book', 'chapterStart', 'verseStart', 'chapterEnd', 'verseEnd', 'outlineEntryId', 'note',
]);
const DRAFT_FIELDS = new Set(['id', 'entryId', 'form', 'createdAt', 'updatedAt', '_unmigrated']);

/**
 * Extensions remain inert data beside the validated fields they extend.
 * fromEntries/spread creates own properties, including a literal __proto__,
 * without invoking setters. Known fields are always rebuilt below: an unknown
 * extension must never bypass validation of a field the current UI consumes.
 */
function extensionFields(value: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
}

const SOURCE_FORMATS = new Set(['txt', 'markdown', 'docx', 'pdf']);

const MATERIAL_FORMATS = new Set(['txt', 'markdown', 'pdf', 'sermon-notes-json']);

const MAX_ID_CHARS = 512;
const MAX_DRAFT_TEXT_CHARS = 16 * 1024 * 1024;
const MAX_DRAFT_LIST_ITEMS = 100_000;

/**
 * Read a block of provided material, or nothing.
 *
 * Validated field by field for the same reason as the provenance below, and
 * with one field that matters more than the rest: `body` holds words somebody
 * other than the journal's owner wrote. It must arrive as a string and land in
 * `sourceMaterial`, never anywhere near `notes` — an archive is exactly where
 * a careless spread would blur the two, years after anyone remembers why they
 * were separate.
 *
 * `body` is required. A provided-material block with no material is not a
 * partial record to salvage; it falls through to `_unmigrated` whole, so
 * nothing is lost and nothing half-formed reaches the journal.
 */
function migrateSourceMaterial(raw: unknown): SourceMaterial | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;

  const format = str(value.format);
  if (!MATERIAL_FORMATS.has(format)) return undefined;
  if (typeof value.filename !== 'string' || typeof value.importedAt !== 'string') return undefined;
  if (typeof value.body !== 'string' || value.body.length === 0) return undefined;

  const material: SourceMaterial = {
    ...extensionFields(value, MATERIAL_FIELDS),
    format: format as SourceMaterial['format'],
    filename: value.filename,
    importedAt: value.importedAt,
    body: value.body,
    parserVersion:
      typeof value.parserVersion === 'number' && Number.isFinite(value.parserVersion)
        ? value.parserVersion
        : 0,
  };
  if (typeof value.sha256 === 'string') material.sha256 = value.sha256;
  if (typeof value.church === 'string') material.church = value.church;
  if (typeof value.speaker === 'string') material.speaker = value.speaker;
  if (typeof value.date === 'string') material.date = value.date;
  const scripture = strArray(value.scripture);
  if (Array.isArray(value.scripture)) material.scripture = scripture;
  return material;
}

/**
 * Read an import-provenance block, or nothing.
 *
 * Known fields are validated field by field; extension fields are retained as
 * inert data and never interpreted as provenance by this build. Anything
 * malformed yields undefined, and the whole block then falls through to
 * `_unmigrated` like any other unrecognised value would.
 */
function migrateSource(raw: unknown): EntrySource | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;

  const format = str(value.format);
  if (!SOURCE_FORMATS.has(format)) return undefined;
  if (typeof value.importedAt !== 'string' || typeof value.filename !== 'string') return undefined;

  const source: EntrySource = {
    ...extensionFields(value, SOURCE_FIELDS),
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

/** The kinds this build understands. One list, in src/lib/entry-kinds.ts. */
const KINDS: readonly EntryKind[] = ENTRY_KINDS;

/**
 * What kind is this, given a build that may not have written it?
 *
 * Three answers, and each one says so. A kind this build knows is kept. A kind
 * this app retired becomes the kind that carries the same meaning — see
 * RETIRED_ENTRY_KINDS, which the editor reads too, so a restored archive and a
 * reopened row cannot disagree. Anything else is writing of an unknown type,
 * which is what `reflection` has always meant here.
 *
 * Every coercion warns. An archive that quietly changed on the way in is the
 * thing the round-trip tests exist to prevent.
 */
function readKind(raw: unknown, id: string, warnings: string[]): EntryKind {
  if (KINDS.includes(raw as EntryKind)) return raw as EntryKind;
  if (raw === undefined) return 'reflection';

  const retired = resolveEntryKind(raw);
  if (retired) {
    warnings.push(
      `Entry ${id}: kind ${JSON.stringify(raw)} is no longer offered, read as "${retired}".`,
    );
    return retired;
  }

  warnings.push(`Entry ${id}: unknown kind ${JSON.stringify(raw)} read as "reflection".`);
  return 'reflection';
}

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
  /**
   * Unfinished writing carried by the archive, if it had any.
   *
   * Always an array, empty for the archives written before drafts existed —
   * which is most of them, and all of the ones written by version 1 of this
   * app. An absent key is the v1 reading and is not an error.
   */
  drafts: EntryDraft[];
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
      return { anchor: { ...extensionFields(value, TOPIC_FIELDS), kind: 'topic', topicId: value.topicId } };
    }
    if (value.kind === 'book' && typeof value.book === 'string') {
      return { anchor: { ...extensionFields(value, BOOK_FIELDS), kind: 'book', book: value.book } };
    }
    if (isScriptureRef(value)) {
      const anchor: EntryAnchor = {
        ...extensionFields(value, SCRIPTURE_FIELDS),
        kind: 'scripture',
        book: value.book,
        chapterStart: value.chapterStart,
        verseStart: value.verseStart,
        chapterEnd: value.chapterEnd,
        verseEnd: value.verseEnd,
      };
      if (typeof value.outlineEntryId === 'string') anchor.outlineEntryId = value.outlineEntryId;
      if (typeof value.note === 'string') anchor.note = value.note;
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

  const link: EntryLink = { ...extensionFields(value, LINK_FIELDS), url: value.url };
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

  const kind = readKind(value.kind, id, warnings);

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

  const material = migrateSourceMaterial(value.sourceMaterial);
  if (material) entry.sourceMaterial = material;
  else if (value.sourceMaterial !== undefined) {
    unmigrated.sourceMaterial = value.sourceMaterial;
    warnings.push(`Entry ${id}: provided sermon notes were malformed and are preserved in _unmigrated.`);
  }

  if (Object.keys(unmigrated).length > 0) entry._unmigrated = unmigrated;

  return entry;
}

/**
 * Read the drafts an archive carried, defensively.
 *
 * Absent is the normal case and is silent: every archive written before this
 * existed has no such key. Anything present is validated as strictly as an
 * entry because persisting a draft the editor cannot render can break the
 * recovery route and hide otherwise-valid writing.
 */
function requiredDraftString(
  value: unknown,
  field: string,
  max = MAX_DRAFT_TEXT_CHARS,
): string {
  if (typeof value !== 'string') throw new Error(`A draft has an invalid ${field} field.`);
  if (value.length > max) throw new Error(`A draft's ${field} field is too large to restore safely.`);
  return value;
}

function draftStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_LIST_ITEMS) {
    throw new Error(`A draft has an invalid ${field} list.`);
  }
  return value.map((item) => requiredDraftString(item, field));
}

function validDraftAnchor(value: unknown): value is EntryAnchor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const anchor = value as Record<string, unknown>;
  if (anchor.kind === 'topic') {
    return typeof anchor.topicId === 'string' && anchor.topicId.length <= MAX_ID_CHARS;
  }
  if (anchor.kind === 'book') {
    return typeof anchor.book === 'string' && anchor.book.length <= MAX_ID_CHARS;
  }
  const coordinate = (candidate: unknown) =>
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0;
  return (
    anchor.kind === 'scripture' &&
    typeof anchor.book === 'string' && anchor.book.length <= MAX_ID_CHARS &&
    coordinate(anchor.chapterStart) &&
    coordinate(anchor.verseStart) &&
    coordinate(anchor.chapterEnd) &&
    coordinate(anchor.verseEnd) &&
    (anchor.outlineEntryId === undefined || typeof anchor.outlineEntryId === 'string') &&
    (anchor.note === undefined || (typeof anchor.note === 'string' && anchor.note.length <= MAX_DRAFT_TEXT_CHARS))
  );
}

function readDraftForm(raw: unknown): EntryDraft['form'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('A draft in this archive has no valid form.');
  }
  const value = raw as Record<string, unknown>;
  if (!KINDS.includes(value.kind as EntryKind)) throw new Error('A draft has an invalid kind.');
  if (typeof value.forDescendants !== 'boolean') {
    throw new Error('A draft has an invalid forDescendants field.');
  }
  if (!Array.isArray(value.links) || value.links.length > MAX_DRAFT_LIST_ITEMS) {
    throw new Error('A draft has an invalid links list.');
  }
  const links = value.links.map((rawLink) => {
    if (!rawLink || typeof rawLink !== 'object' || Array.isArray(rawLink)) {
      throw new Error('A draft has an invalid link.');
    }
    const link = rawLink as Record<string, unknown>;
    return {
      ...extensionFields(link, LINK_FIELDS),
      url: requiredDraftString(link.url, 'link URL'),
      label: requiredDraftString(link.label, 'link label'),
      capturedTitle: requiredDraftString(link.capturedTitle, 'link title'),
      ...(link.capturedAt === undefined
        ? {}
        : { capturedAt: requiredDraftString(link.capturedAt, 'link timestamp', 128) }),
    };
  });
  if (!Array.isArray(value.anchors) || value.anchors.length > MAX_DRAFT_LIST_ITEMS ||
      !value.anchors.every(validDraftAnchor)) {
    throw new Error('A draft has an invalid anchors list.');
  }
  // Drafts written before provided notes existed have no sourceMaterial key;
  // that supported older shape means the same thing as null.
  const sourceMaterial = value.sourceMaterial ?? null;
  const migratedMaterial = sourceMaterial === null ? null : migrateSourceMaterial(sourceMaterial);
  if (sourceMaterial !== null && migratedMaterial === undefined) {
    throw new Error('A draft has invalid provided notes.');
  }
  if (migratedMaterial && migratedMaterial.body.length > MAX_DRAFT_TEXT_CHARS) {
    throw new Error("A draft's provided notes are too large to restore safely.");
  }

  const date = requiredDraftString(value.date, 'date', 128);
  if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('A draft has an invalid date.');
  }

  // Preserve unknown extension fields on the form verbatim after every field
  // used by the current UI has passed runtime validation.
  return {
    ...value,
    kind: value.kind as EntryKind,
    title: requiredDraftString(value.title, 'title'),
    date,
    place: requiredDraftString(value.place, 'place'),
    speaker: requiredDraftString(value.speaker, 'speaker'),
    sermonSeries: requiredDraftString(value.sermonSeries, 'sermon series'),
    notes: requiredDraftString(value.notes, 'notes'),
    reflection: requiredDraftString(value.reflection, 'reflection'),
    prayer: requiredDraftString(value.prayer, 'prayer'),
    tagsText: requiredDraftString(value.tagsText, 'tags'),
    links,
    anchors: value.anchors,
    forDescendants: value.forDescendants,
    scriptureRefs: draftStringArray(value.scriptureRefs, 'scripture references'),
    sourceMaterial: migratedMaterial,
  } as EntryDraft['form'];
}

function readDrafts(raw: unknown, warnings: string[]): EntryDraft[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error('This journal has an invalid "drafts" section. Nothing was restored.');
  }

  const drafts: EntryDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('A draft in this archive is malformed. Nothing was restored.');
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    if (!id || id.length > MAX_ID_CHARS) throw new Error('A draft has an invalid id. Nothing was restored.');
    if (value.entryId !== undefined &&
        (typeof value.entryId !== 'string' || value.entryId.length === 0 || value.entryId.length > MAX_ID_CHARS)) {
      throw new Error(`Draft ${id} has an invalid entry id. Nothing was restored.`);
    }
    const createdAt = requiredDraftString(value.createdAt, 'created timestamp', 128);
    const updatedAt = requiredDraftString(value.updatedAt, 'updated timestamp', 128);
    if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
      throw new Error(`Draft ${id} has an invalid timestamp. Nothing was restored.`);
    }
    const extensions = extensionFields(value, DRAFT_FIELDS);
    const existingUnmigrated = value._unmigrated && typeof value._unmigrated === 'object' && !Array.isArray(value._unmigrated)
      ? value._unmigrated as Record<string, unknown>
      : undefined;
    const unmigrated = {
      ...existingUnmigrated,
      ...extensions,
    };
    for (const key of Object.keys(extensions)) {
      warnings.push(`Draft ${id}: unrecognised field "${key}" preserved in _unmigrated.`);
    }
    drafts.push({
      id,
      ...(typeof value.entryId === 'string' ? { entryId: value.entryId } : {}),
      form: readDraftForm(value.form),
      createdAt,
      updatedAt,
      ...(existingUnmigrated || Object.keys(unmigrated).length > 0 ? { _unmigrated: unmigrated } : {}),
    });
  }
  return drafts;
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
    if (!entry) throw new Error('This journal contains an entry without a valid id. Nothing was restored.');
    entries.push(entry);
  }

  const duplicateEntry = firstDuplicate(entries.map((entry) => entry.id));
  if (duplicateEntry) {
    throw new Error(`This journal contains duplicate entry id "${duplicateEntry}". Nothing was restored.`);
  }
  const drafts = readDrafts(envelope.drafts, warnings);
  const duplicateDraft = firstDuplicate(drafts.map((draft) => draft.id));
  if (duplicateDraft) {
    throw new Error(`This journal contains duplicate draft id "${duplicateDraft}". Nothing was restored.`);
  }

  return {
    entries,
    drafts,
    warnings,
    migratedFrom: version !== undefined && version !== CURRENT_VERSION ? version : undefined,
  };
}

function firstDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}
