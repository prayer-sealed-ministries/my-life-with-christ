/** Inert forward-compatible draft data, separate from editor lifecycle policy. */
import type { DraftForm, Entry, EntryDraft } from '../types';
import { draftFormsEqual, hasRecoverableChanges } from './drafts';

const linkHasContent = (link: DraftForm['links'][number]): boolean =>
  Boolean(link.url.trim() || link.capturedTitle.trim());

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

const DRAFT_RECORD_FIELDS = new Set(['id', 'entryId', 'form', 'createdAt', 'updatedAt', '_unmigrated']);
const FORM_FIELDS: Record<keyof DraftForm, true> = {
  kind: true, title: true, date: true, place: true, speaker: true, sermonSeries: true,
  notes: true, reflection: true, prayer: true, tagsText: true, links: true, anchors: true,
  forDescendants: true, scriptureRefs: true, sourceMaterial: true,
};
const DRAFT_FORM_FIELDS = new Set(Object.keys(FORM_FIELDS));
const DRAFT_LINK_FIELDS = new Set(['url', 'label', 'capturedTitle', 'capturedAt']);
const SOURCE_MATERIAL_FIELDS = new Set([
  'format', 'filename', 'importedAt', 'sha256', 'church', 'speaker', 'date', 'scripture', 'body', 'parserVersion',
]);
const ANCHOR_FIELDS = {
  topic: new Set(['kind', 'topicId']),
  book: new Set(['kind', 'book']),
  scripture: new Set(['kind', 'book', 'chapterStart', 'verseStart', 'chapterEnd', 'verseEnd', 'outlineEntryId', 'note']),
};

const extensionFields = (record: object, known: ReadonlySet<string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)));

/** Data the deliberate draft-to-entry mapping has no direct place to carry. */
export function draftNeedsPromotion(draft: EntryDraft | null): boolean {
  return Boolean(draft && (draft._unmigrated !== undefined ||
    Object.keys(draft).some((key) => !DRAFT_RECORD_FIELDS.has(key)) ||
    Object.keys(draft.form).some((key) => !DRAFT_FORM_FIELDS.has(key)) ||
    draft.form.links.some((link) => !linkHasContent(link) &&
      Object.keys(link).some((key) => !DRAFT_LINK_FIELDS.has(key)))));
}

/**
 * The normal comparator deliberately understands only this editor's fields.
 * Compare opaque fields separately so its known-only equivalences (including
 * absent versus empty source scripture) still clean up old false drafts.
 */
export function formsEqualForRecovery(a: DraftForm, b: DraftForm): boolean {
  if (!draftFormsEqual(a, b)) return false;
  const extensions = (form: DraftForm) => ({
    form: extensionFields(form, DRAFT_FORM_FIELDS),
    links: form.links.map((link) => extensionFields(link, DRAFT_LINK_FIELDS)),
    anchors: form.anchors.map((anchor) => extensionFields(anchor, ANCHOR_FIELDS[anchor.kind])),
    sourceMaterial: form.sourceMaterial ? extensionFields(form.sourceMaterial, SOURCE_MATERIAL_FIELDS) : {},
  });
  return stableJson(extensions(a)) === stableJson(extensions(b));
}

export function hasRecoverableDraftChanges(form: DraftForm, canonical: DraftForm | null, draft: EntryDraft | null): boolean {
  return hasRecoverableChanges(form, canonical) || draftNeedsPromotion(draft) ||
    Boolean(canonical && !formsEqualForRecovery(form, canonical));
}

/**
 * Older editors cannot author extension fields, but Save must not destroy them
 * when it retires the source draft. Keep that draft as inert canonical metadata
 * only when it carries values the current Entry mapping cannot represent.
 * Ordinary known-only writing does not become an implicit revision history.
 */
export function promotedDraftMetadata(existing: Entry['_unmigrated'], draft: EntryDraft | null): Entry['_unmigrated'] {
  if (!draft || !draftNeedsPromotion(draft)) return existing;

  const result = { ...existing };
  const serialized = stableJson(draft);
  for (let suffix = 0; ; suffix += 1) {
    const key = suffix === 0 ? 'journeyPromotedDraft' : `journeyPromotedDraft:${suffix}`;
    if (Object.hasOwn(result, key)) {
      // A pre-existing property may come from any writer. Identical data needs
      // no duplicate; different data is never overwritten or reinterpreted.
      if (stableJson(result[key]) === serialized) return result;
      continue;
    }
    Object.defineProperty(result, key, {
      value: draft, enumerable: true, configurable: true, writable: true,
    });
    return result;
  }
}
