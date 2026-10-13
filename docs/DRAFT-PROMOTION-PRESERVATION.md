# Completing a draft without dropping opaque data

This is an additive use of the existing `Entry._unmigrated` preservation field.
The journal format stays `journey-export` version 1. Draft promotion itself
needs no schema migration and introduces no publisher-trust claim or executable
metadata. Journal-wide envelope preservation has a separate additive v3 storage
migration, described in `JOURNAL-ENVELOPE-PRESERVATION.md`.

## When it applies

A deliberate Save preserves the last durable source draft if it has:

- Unknown top-level draft fields, including fields retained in their original
  location because `_unmigrated` already contained a different value.
- Existing draft `_unmigrated` data.
- Unknown top-level fields on the editor form.
- Unknown fields on a link row that the ordinary completed-entry mapping would
  omit because the row has no URL or captured title.

Unknown data already carried directly by a completed entry, such as an extension
on a retained link, stays in that field. A known-only draft follows the existing
Save behavior. This does not create a revision archive on every ordinary edit.

## Opening and automatic cleanup

Opening a draft or undoing its visible edits does not discard opaque-only data.
Recovery compares form, link, anchor and provided-source extensions as well as
known fields, and keeps draft-only metadata until an explicit Save or confirmed
Discard. A known-only duplicate still retires automatically; so do duplicate
nested extensions already represented by the saved entry. Empty source-reference
arrays retain the editor's existing equivalence to absent source references.

An opaque-only new draft stays in draft storage and full backups even when its
writable fields are empty. Save still requires ordinary entry content; confirmed Discard remains an
explicit choice. These checks do not create revision snapshots for normal edits.

## Stored representation

After the draft writer settles, the complete durable `EntryDraft` snapshot is
stored under an unoccupied entry `_unmigrated` property:

- `journeyPromotedDraft` first.
- `journeyPromotedDraft:1`, `journeyPromotedDraft:2`, and so on if occupied.

The property value is the draft itself, including its ID, optional parent-entry
ID, creation/update timestamps, exact form and opaque extensions. Existing
properties are never overwritten or assumed to belong to this implementation.
An exactly equal snapshot in a candidate slot is reused without duplication.

The snapshot is the **last durable version at Save**, after its pending flush,
not a history of every keystroke or necessarily the untouched original imported
file. Deliberate edits keep their ordinary meaning. Preserve the source transfer
file if an exact historical copy of the import is needed.

The snapshot commits with the completed entry before the ordinary successful
Save path retires the active draft. A failed canonical write leaves the source
draft available. For existing entries, the receipt appends to the freshest metadata inside the
provider's ordinary atomic update transaction. It never replaces metadata taken
from an earlier editor read. Main's ordered draft writes and route-leave pending
write coordination remain in effect.

Draft writes can require the exact prior record. If another window advanced or
retired it, the editor preserves its own version under a new recovery ID instead
of replacing the other writer. Save and Discard retire only an exact acknowledged
revision; a fenced write that forks while pending is retired by its final ID.
Text accepted during either the canonical Save or delayed draft deletion remains
recoverable. Confirmed entry deletion fences and settles its writer before
removing the entry and attached drafts; a failed deletion restarts protection.
The entire deletion/recovery operation is registered with the existing pending
write barrier, so a backup opened after route leave waits for durable recovery
or fails closed if that recovery cannot be written.

A Save of an existing entry also checks the loaded values of every field it will
replace, including nested data. A concurrent change refuses the Save and leaves
the other writer's canonical entry plus this editor's form/recovery draft intact.
Root preservation metadata is still composed atomically, and timestamp-only
changes do not count as changed writing.

## Export, privacy and recovery

Canonical JSON and full archives preserve the snapshot, including private
fields. Archive Markdown frontmatter already carries `_unmigrated` and therefore
also retains it. Full backups must be stored as private material.

The printable book and one-entry text/Markdown/PDF share representation do not
render opaque metadata. Reflection and prayer still require their existing
explicit sharing choices. No content is logged or transmitted by this feature.

A recovery tool can read the retained draft from canonical JSON and place it in
the `drafts` array of a `journey-export` v1 file for normal validated preview and
import. The current UI has no dedicated “recover promoted draft” button.
`EntryEditor.promotion.test.tsx` exercises that file-based recovery after a full
archive restore in an isolated synthetic journal, and verifies that all source snapshot values remain present. Main's migration
also mirrors unknown form fields into the preserved-data map during recovery. Never use a real journal as a destructive fixture.
