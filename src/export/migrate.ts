/**
 * Forward migration of imported journals.
 *
 * The governing rule: never drop a field silently. This app is meant to be
 * outlived by its data, which means an archive written by some later version —
 * or by a version that predates a schema change — must import without loss.
 * Unrecognised record fields are preserved verbatim in `_unmigrated` and
 * reported. If that location is occupied, both values remain in their original
 * locations. Extensions inside a validated nested object stay beside that
 * object's known fields as inert data, rather than being discarded.
 */

import type {
  EntryDraft,
  DraftForm,
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

/**
 * Extensions remain inert data beside the validated fields they extend.
 * fromEntries/spread creates own properties, including a literal __proto__,
 * without invoking setters. Known fields are always rebuilt below: an unknown
 * extension must never bypass validation of a field the current UI consumes.
 */
function extensionFields(value: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
}

/** Compare opaque JSON values without treating object-key order as content. */
function samePreservedValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && samePreservedValue(left[key], right[key]));
}

/** Defaults may add fields; changing or dropping an existing value needs a copy. */
function losesObjectFields(raw: unknown, migrated: object): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const result = migrated as Record<string, unknown>;
  return Object.entries(raw).some(([key, value]) =>
    !Object.hasOwn(result, key) || !samePreservedValue(value, result[key]));
}

/** Keep both values if an older extension already occupies the migration slot. */
function preserveRecordExtensions(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  unmigrated: Record<string, unknown>,
  label: string,
  warnings: string[],
): Record<string, unknown> {
  const retained: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(extensionFields(value, known))) {
    const occupied = Object.hasOwn(unmigrated, key);
    // Keep a collision in its original location rather than choosing a winner
    // or inventing a reserved namespace. Own properties also keep __proto__ inert.
    Object.defineProperty(occupied ? retained : unmigrated, key, {
      value: item, writable: true, enumerable: true, configurable: true,
    });
    warnings.push(occupied
      ? `${label}: unrecognised field "${key}" retained in its original location because _unmigrated already contains that key; both values are preserved.`
      : `${label}: unrecognised field "${key}" preserved in _unmigrated.`);
  }
  return retained;
}

const SOURCE_FORMATS = new Set(['txt', 'markdown', 'docx', 'pdf']);

const MATERIAL_FORMATS = new Set(['txt', 'markdown', 'pdf', 'sermon-notes-json']);

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
    throw new Error('This journal contains an entry with no valid id, so it cannot be restored safely.');
  }

  // Anything this build does not know about, plus any known value it cannot
  // safely interpret. A malformed known field must not disappear merely
  // because its name is familiar.
  const unmigrated: Record<string, unknown> = {
    ...(value._unmigrated && typeof value._unmigrated === 'object' && !Array.isArray(value._unmigrated)
      ? (value._unmigrated as Record<string, unknown>)
      : {}),
  };
  const preserveKnownField = (key: string, original: unknown) => {
    if (Object.hasOwn(unmigrated, key) && !samePreservedValue(unmigrated[key], original)) {
      // A malformed known field cannot remain active like an inert extension.
      // Refuse before storage changes rather than overwrite older preserved data.
      throw new Error(
        `Entry ${id}: ${key} cannot be preserved because _unmigrated.${key} already contains a different value. Nothing was restored.`,
      );
    }
    Object.defineProperty(unmigrated, key, {
      value: original, writable: true, enumerable: true, configurable: true,
    });
  };
  const preserveMalformed = (key: string, valid: boolean, expected: string) => {
    if (value[key] === undefined || valid) return;
    preserveKnownField(key, value[key]);
    warnings.push(`Entry ${id}: ${key} was not ${expected}; its original value was preserved in _unmigrated.`);
  };

  const anchors: EntryAnchor[] = [];
  const unmappedAnchors: unknown[] = [];
  let changedAnchorFields = false;
  for (const item of Array.isArray(value.anchors) ? value.anchors : []) {
    const { anchor, unmapped } = migrateAnchor(item, context, warnings, id);
    if (anchor) {
      anchors.push(anchor);
      changedAnchorFields ||= losesObjectFields(item, anchor);
    }
    if (unmapped !== undefined) unmappedAnchors.push(unmapped);
  }

  const kind = readKind(value.kind, id, warnings);

  preserveMalformed(
    'kind',
    value.kind === undefined || KINDS.includes(value.kind as EntryKind) || resolveEntryKind(value.kind) !== null,
    'a recognised entry kind',
  );

  const retainedExtensions = preserveRecordExtensions(
    value, KNOWN_FIELDS, unmigrated, `Entry ${id}`, warnings,
  );
  if (changedAnchorFields) {
    preserveKnownField('anchors', value.anchors);
    warnings.push(`Entry ${id}: changed anchor fields were preserved in _unmigrated.`);
  } else if (unmappedAnchors.length > 0) preserveKnownField('anchors', unmappedAnchors);

  const strings = ['title', 'date', 'notes', 'reflection', 'createdAt', 'updatedAt'] as const;
  for (const key of strings) preserveMalformed(key, typeof value[key] === 'string', 'text');
  for (const key of ['place', 'speaker', 'sermonSeries', 'prayer'] as const) {
    preserveMalformed(key, typeof value[key] === 'string', 'text');
  }
  preserveMalformed('anchors', Array.isArray(value.anchors), 'a list');
  preserveMalformed(
    'scriptureRefs',
    Array.isArray(value.scriptureRefs) && value.scriptureRefs.every((item) => typeof item === 'string'),
    'a list of text references',
  );
  preserveMalformed(
    'tags',
    Array.isArray(value.tags) && value.tags.every((item) => typeof item === 'string'),
    'a list of text tags',
  );
  const rawLinks = Array.isArray(value.links) ? value.links : [];
  const migratedLinks = rawLinks.map(migrateLink);
  preserveMalformed(
    'links',
    Array.isArray(value.links) && migratedLinks.every((link, index) =>
      link !== null && !losesObjectFields(rawLinks[index], link)),
    'a list of links',
  );
  preserveMalformed('forDescendants', typeof value.forDescendants === 'boolean', 'true or false');
  preserveMalformed(
    'visibility',
    value.visibility === 'private' || value.visibility === 'shared',
    '"private" or "shared"',
  );
  preserveMalformed(
    '_unmigrated',
    value._unmigrated === undefined ||
      (typeof value._unmigrated === 'object' && value._unmigrated !== null && !Array.isArray(value._unmigrated)),
    'an object',
  );

  const now = new Date().toISOString();
  const entry: Entry = {
    ...retainedExtensions,
    id,
    kind,
    title: str(value.title),
    date: str(value.date),
    anchors,
    scriptureRefs: strArray(value.scriptureRefs),
    notes: str(value.notes),
    reflection: str(value.reflection),
    links: migratedLinks.filter((l): l is EntryLink => l !== null),
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
  if (source) {
    entry.source = source;
    if (losesObjectFields(value.source, source)) {
      preserveKnownField('source', value.source);
      warnings.push(`Entry ${id}: changed import provenance fields were preserved in _unmigrated.`);
    }
  }
  else if (value.source !== undefined) {
    // Present but unreadable: keep it rather than drop it, and say so.
    preserveKnownField('source', value.source);
    warnings.push(`Entry ${id}: import provenance was malformed and is preserved in _unmigrated.`);
  }

  const material = migrateSourceMaterial(value.sourceMaterial);
  if (material) {
    entry.sourceMaterial = material;
    if (losesObjectFields(value.sourceMaterial, material)) {
      preserveKnownField('sourceMaterial', value.sourceMaterial);
      warnings.push(`Entry ${id}: changed provided-material fields were preserved in _unmigrated.`);
    }
  }
  else if (value.sourceMaterial !== undefined) {
    preserveKnownField('sourceMaterial', value.sourceMaterial);
    warnings.push(`Entry ${id}: provided sermon notes were malformed and are preserved in _unmigrated.`);
  }

  if (Object.keys(unmigrated).length > 0) entry._unmigrated = unmigrated;

  return entry;
}

const DRAFT_FORM_FIELDS = new Set([
  'kind',
  'title',
  'date',
  'place',
  'speaker',
  'sermonSeries',
  'notes',
  'reflection',
  'prayer',
  'tagsText',
  'links',
  'anchors',
  'forDescendants',
  'scriptureRefs',
  'sourceMaterial',
]);

const DRAFT_FIELDS = new Set([
  'id',
  'entryId',
  'form',
  'createdAt',
  'updatedAt',
  '_unmigrated',
]);

function validDraftAnchor(raw: unknown): raw is EntryAnchor {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'topic') return typeof value.topicId === 'string';
  if (value.kind === 'book') return typeof value.book === 'string';
  return value.kind === 'scripture' && isScriptureRef(value) &&
    (value.outlineEntryId === undefined || typeof value.outlineEntryId === 'string') &&
    (value.note === undefined || typeof value.note === 'string');
}

function validDraftSourceMaterial(raw: unknown): raw is SourceMaterial {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    MATERIAL_FORMATS.has(str(value.format)) &&
    typeof value.filename === 'string' &&
    typeof value.importedAt === 'string' &&
    typeof value.body === 'string' &&
    value.body.length > 0 &&
    typeof value.parserVersion === 'number' &&
    Number.isFinite(value.parserVersion) &&
    (value.sha256 === undefined || typeof value.sha256 === 'string') &&
    (value.church === undefined || typeof value.church === 'string') &&
    (value.speaker === undefined || typeof value.speaker === 'string') &&
    (value.date === undefined || typeof value.date === 'string') &&
    (value.scripture === undefined ||
      (Array.isArray(value.scripture) && value.scripture.every((item) => typeof item === 'string')))
  );
}

function readDraftForm(raw: unknown, id: string): { form: DraftForm; unknown: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Draft ${id} has no valid form, so this backup was not restored.`);
  }
  const value = raw as Record<string, unknown>;
  const stringFields = [
    'title',
    'date',
    'place',
    'speaker',
    'sermonSeries',
    'notes',
    'reflection',
    'prayer',
    'tagsText',
  ] as const;
  if (!KINDS.includes(value.kind as EntryKind)) {
    throw new Error(`Draft ${id} has an unsupported kind, so this backup was not restored.`);
  }
  for (const key of stringFields) {
    if (typeof value[key] !== 'string') {
      throw new Error(`Draft ${id} has an invalid ${key} field, so this backup was not restored.`);
    }
  }
  if (
    !Array.isArray(value.links) ||
    !value.links.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const link = item as Record<string, unknown>;
      return (
        typeof link.url === 'string' &&
        (!Object.hasOwn(link, 'label') || typeof link.label === 'string') &&
        (!Object.hasOwn(link, 'capturedTitle') || typeof link.capturedTitle === 'string') &&
        (link.capturedAt === undefined || typeof link.capturedAt === 'string')
      );
    })
  ) {
    throw new Error(`Draft ${id} has an invalid links field, so this backup was not restored.`);
  }
  if (!Array.isArray(value.anchors) || !value.anchors.every(validDraftAnchor)) {
    throw new Error(`Draft ${id} has an invalid anchors field, so this backup was not restored.`);
  }
  if (
    !Array.isArray(value.scriptureRefs) ||
    !value.scriptureRefs.every((item) => typeof item === 'string')
  ) {
    throw new Error(`Draft ${id} has an invalid scriptureRefs field, so this backup was not restored.`);
  }
  if (typeof value.forDescendants !== 'boolean') {
    throw new Error(`Draft ${id} has an invalid forDescendants field, so this backup was not restored.`);
  }
  if (value.sourceMaterial !== null && !validDraftSourceMaterial(value.sourceMaterial)) {
    throw new Error(`Draft ${id} has invalid provided material, so this backup was not restored.`);
  }

  const unknown: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (DRAFT_FORM_FIELDS.has(key)) continue;
    Object.defineProperty(unknown, key, {
      value: item,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  // Companion drafts may carry an EntryLink with only its required URL.
  // Supply editor-only empty strings for absent fields, never for a malformed
  // present value. Spreading retains validated nested and extension data safely.
  const links = value.links.map((link) => ({
    ...link,
    label: link.label ?? '',
    capturedTitle: link.capturedTitle ?? '',
  }));
  return { form: { ...value, links } as unknown as DraftForm, unknown };
}

/**
 * Read the drafts an archive carried. Absent is the normal pre-draft format;
 * present-but-malformed is a damaged backup and aborts the import. Silently
 * dropping unfinished writing would make a successful restore claim false.
 */
function readDrafts(raw: unknown, warnings: string[]): EntryDraft[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error('The "drafts" section is not a list, so this backup was not restored.');
  }

  const drafts: EntryDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('A draft in this backup is malformed, so nothing was restored.');
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    if (!id || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
      throw new Error('A draft in this backup has invalid identity or dates, so nothing was restored.');
    }
    if (value.entryId !== undefined && typeof value.entryId !== 'string') {
      throw new Error(`Draft ${id} has an invalid parent entry id, so nothing was restored.`);
    }
    const { form, unknown } = readDraftForm(value.form, id);
    const carried =
      value._unmigrated && typeof value._unmigrated === 'object' && !Array.isArray(value._unmigrated)
        ? (value._unmigrated as Record<string, unknown>)
        : {};
    if (value._unmigrated !== undefined && Object.keys(carried).length === 0 &&
        (typeof value._unmigrated !== 'object' || value._unmigrated === null || Array.isArray(value._unmigrated))) {
      throw new Error(`Draft ${id} has invalid preserved data, so nothing was restored.`);
    }
    const unmigrated = { ...carried };
    const retainedExtensions = preserveRecordExtensions(
      value, DRAFT_FIELDS, unmigrated, `Draft ${id}`, warnings,
    );
    if (Object.keys(unknown).length > 0) {
      // The original form already retains these fields. Mirror into the usual
      // preservation slot only where doing so cannot overwrite older data.
      // A non-object carried form is opaque too, so it stays completely intact.
      const existingForm = unmigrated.form;
      if (!Object.hasOwn(unmigrated, 'form') ||
          (existingForm && typeof existingForm === 'object' && !Array.isArray(existingForm))) {
        const preservedForm = { ...(existingForm as Record<string, unknown> | undefined) };
        preserveRecordExtensions(unknown, new Set(), preservedForm, `Draft ${id} form`, warnings);
        unmigrated.form = preservedForm;
      } else {
        warnings.push(`Draft ${id}: unrecognised form fields retained in their original location because _unmigrated.form already contains preserved data; both values are preserved.`);
      }
    }
    drafts.push({
      ...retainedExtensions,
      id,
      ...(typeof value.entryId === 'string' ? { entryId: value.entryId } : {}),
      form,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      ...(Object.keys(unmigrated).length > 0 ? { _unmigrated: unmigrated } : {}),
    });
  }
  return drafts;
}

/** Migrate a parsed export envelope forward to the current schema. */
export function migrateExport(raw: unknown, context: MigrationContext = {}): MigrationResult {
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('This file does not contain a journal: expected a JSON object.');
  }
  const envelope = raw as Record<string, unknown>;

  // Missing declarations are the supported legacy shape. A present declaration
  // is an identity claim, not an extension that may be ignored: importing a
  // different format as a journal would silently discard what that claim means.
  if (Object.hasOwn(envelope, 'format') && envelope.format !== 'journey-export') {
    throw new Error('This file declares a different or invalid journal format, so nothing was restored.');
  }
  if (Object.hasOwn(envelope, 'version') &&
      (typeof envelope.version !== 'number' || !Number.isSafeInteger(envelope.version) || envelope.version < 1)) {
    throw new Error('This file declares an invalid journal version, so nothing was restored.');
  }

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
  const entryIds = new Set<string>();
  for (const item of envelope.entries) {
    const entry = migrateEntry(item, context, warnings);
    if (!entry) {
      throw new Error('An entry in this backup is malformed, so nothing was restored.');
    }
    if (entryIds.has(entry.id)) {
      throw new Error(`This journal contains the entry id "${entry.id}" more than once.`);
    }
    entryIds.add(entry.id);
    entries.push(entry);
  }

  const drafts = readDrafts(envelope.drafts, warnings);
  const draftIds = new Set<string>();
  for (const draft of drafts) {
    if (draftIds.has(draft.id)) {
      throw new Error(`This journal contains the draft id "${draft.id}" more than once.`);
    }
    draftIds.add(draft.id);
    if (draft.entryId && !entryIds.has(draft.entryId)) {
      throw new Error(
        `Draft ${draft.id} refers to entry ${draft.entryId}, which is not present in this backup.`,
      );
    }
  }

  return {
    entries,
    drafts,
    warnings,
    migratedFrom: version !== undefined && version !== CURRENT_VERSION ? version : undefined,
  };
}
