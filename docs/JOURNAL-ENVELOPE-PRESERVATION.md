# Durable opaque journal-envelope metadata

Status: staged implementation, 2026-10-13. Native release remains on HOLD.
This adds no account, network operation, telemetry, synchronization or AI.

## Persistence contract

Journal-level extension data belongs to the journal, including a journal with
zero entries and zero drafts. It must not live on an arbitrary entry or inside
device settings. `JournalEnvelopeMetadata` is a deterministic set of complete
opaque original field maps. Different maps may contain the same key with
different values; both maps survive. Values are inert JSON, never executable
code, verified publisher claims, UI markup or instructions.

IndexedDB schema 3 adds the `envelopeMetadata` singleton store. SQLite schema 3
adds `journal_envelope_metadata`. Both migrations are additive: the database
identity remains `journey`, and existing entries, drafts, indexes and settings
are untouched. Populated v2 upgrades, subsequent metadata writes and reopen are
automatically tested for both providers. An older native schema-2 binary refuses the schema-3 SQLite database rather
than editing a schema it does not understand. Do not replace or delete a database
to work around that refusal. Dexie, in contrast, permits an older browser schema
declaration to reopen the newer IndexedDB database: the old reader still sees
entries/drafts and leaves the added metadata store intact, but its exporter does
not know how to carry that metadata. Historical browser binaries cannot acquire
a refusal retroactively. Keep a current full v1 archive before any downgrade;
older importers may not preserve unknown envelope fields, so retain the original
archive even if an older reader can display its entries.

`readJournalSnapshot()` reads entries, drafts and metadata together and returns
one content token plus its acquisition time (`capturedAt`). IndexedDB uses one
read transaction. SQLite uses the existing explicit transaction behind a
database-scoped operation queue shared across provider instances. A read on a
shared native connection must not see another operation's partial writes.
Forced interleavings hold a write and prove a concurrent snapshot waits for
commit or rollback.

Import computes its merged records and complete source-map union from the
reviewed snapshot. `replaceJournal(entries, drafts, expectedToken?, metadata?)`
commits all three collections atomically. Omitted metadata means empty, never
"keep whatever appeared later". `journalMatches(token)` and replacement's
conditional token check include the metadata collection. A metadata-only
concurrent change invalidates the review just like a new entry or draft.
Serialization or persistence failure rolls back all three collections.

Entry/draft CRUD, `clearEntries` and `replaceEntries` leave journal-wide metadata
alone. Settings stay device-local and are not exported by this feature.

The editor retains main's ordered draft writer and route-leave pending-write
coordination. Narrow additional transaction guards protect concurrent windows:
`putDraft` can require an absent ID or an exact prior draft, and `deleteDraft`
can require the exact revision being retired. Stale draft writes fork to a new
recovery identity, preserving both originals. Retirement follows the completed
writer's actual identity, including a fork created while its write was pending.
An editor Save checks every field it would replace against its loaded entry,
including complete nested links, anchors and provided-source data. A differing
concurrent value refuses Save without mutating the canonical entry; the local
form and recovery draft remain. Root `_unmigrated` metadata is composed from the
fresh durable entry inside the transaction, not from the stale editor read.
Timestamp-only changes do not invent a writing conflict. These narrow options
do not replace the existing journal snapshot/import concurrency mechanism.

## Additive journey-export v1 representation

The machine identifier and format version remain `journey-export`, version 1;
the canonical archive path remains `data/journey.json`. No metadata means no
new key, preserving the existing empty/full v1 envelope shape. The schema now
allows unknown root fields and documents the existing companion preservation
carrier. This is semantic JSON preservation, not preservation of whitespace,
object-key ordering or the original entire envelope's byte layout.

A newly imported envelope's six current keys (`format`, `version`, `exportedAt`,
`filter`, `entries`, `drafts`) are interpreted by their established contracts.
Every other own property becomes an opaque source map, including `_unmigrated`
and literal `__proto__`, `constructor` and `toString` keys. Known timestamps and
filters describe the current export rather than accumulating on each cycle.
Historical source maps *already inside* a preservation carrier may contain
those keys; they remain verbatim as inert historical data and cannot overwrite
the current export's identity, timestamp, filter or records.

One original map containing only extension fields exports at its original
root locations. When several maps exist, every nonconflicting extension is
also projected at its original root location. A key with different original
values gets no arbitrary winner. All complete source maps are retained in the
established `_unmigrated.companionSourceEnvelopes` array. If `_unmigrated` itself
had an original value, that original remains inside its complete source map;
its root location may be occupied by the collision carrier. Nothing is silently
overwritten. Thus conflicting field paths may change, but every original map
is still recoverable in ordinary JSON.

A reader unpacks a candidate carrier only if exporting its normalized source
set reconstructs the complete unknown envelope map exactly. Names and shapes
alone are insufficient. Empty, duplicate, reordered, malformed, mixed or legacy
carrier-looking data that fails that check stays one opaque map and re-exports
unchanged. Source-map contents are never recursively unpacked. This right-inverse
check prevents wrapper growth without treating arbitrary similarly named data
as disposable. Shared literal fixture vectors and repeated import/export tests
hold the app and companion to the same representation.

## Full backup and selected-copy privacy

The user-facing full exporter reads the complete snapshot once and includes
its metadata, even when there are no entries or drafts. Canonical JSON and the
archive manifest preserve and verify that data; the book, CSV and Markdown note
renderers do not interpret it. Backup → isolated restore → re-export is tested.

A filtered/selected export omits journal-wide opaque metadata: its contents
could describe private writing outside the selection. Both `exportEverything`
and the lower-level archive/context boundary enforce this. A selected copy
remains a partial copy, never a complete backup. Per-entry unknown fields keep
their existing preservation and sharing rules.

## Evidence and limits

Provider conformance covers empty journals, conflicting maps, idempotence,
reopen, replacement/clearing, stale metadata-only snapshots, late-failure
rollback and independent record deletion. Archive tests exercise the actual
user-facing exporter, manifest-checked importer and isolated restore.

Fake IndexedDB and Node SQLite prove these code paths and SQL transactions;
they do not prove native bridge behavior, device filesystem durability,
physical sharing/document-provider routes or a populated phone upgrade. Those
remain mandatory physical-device release gates. No release, deployment, domain
change or synchronization claim follows from these tests.

### Verification record

`src/storage/contract.ts` is the single conformance contract used by both the
fake IndexedDB runner and the real Node SQLite runner, and by the separate
on-device harness. `src/export/envelope-fidelity.test.ts` checks the actual
snapshot-backed exporter, isolated recovery and backup freshness when metadata
changes during delivery. `EntryEditor.promotion.test.tsx` pins concurrent Save,
Discard and draft-write interleavings; related fidelity tests cover preservation
of opaque draft and nested entry fields.

The current integration preserves main's delivery results (`committed`,
`cancelled`, `initiated`) and its separate `current`/`recorded` backup states.
An archive that omitted a later metadata write cannot advance the full-backup
reminder. A browser-initiated download does not become a confirmed file save.

The integration record contains the exact final commands and counts. Historical
feature-branch test totals are not evidence for this main-based implementation.


The main-based preservation integration passed a stable focused run of 439 tests
in 17 files, plus TypeScript and scoped ESLint checks. This is not the aggregate
all-profile/browser pipeline, which is recorded separately by the lead.

Each regression mutation was restored before its selected checks passed again:

- Removing transaction-local entry/draft guards and atomic promotion: 10 failures.
- Restoring instance-only SQLite operation queues: 2 forced-interleaving failures.
- Dropping durable envelope metadata writes: 10 failures.
- Reverting delayed Save/Delete/navigation fixes: 3 failures.
- Retiring the pre-fork draft instead of the fenced writer's result: 2 failures.
- Unwiring the editor's stale-write guards: 2 failures.
- Removing deletion/recovery from the pending-write barrier: 2 failures.
- Unwiring new-entry draft promotion and link-extension mapping: 2 failures.
- Allowing opaque-only draft cleanup: 2 failures.
- Omitting root metadata from canonical export: 3 failures.
- Allowing root metadata into partial archives: 1 failure.
- Recognizing preservation carriers only by their shape: 8 failures.
- Ignoring metadata in journal snapshot tokens: 3 failures.

These are selected-case mutation counts, not a sum of distinct regressions.
Unselected tests in those runs are not claimed as executed. All complete focused
files ran together afterward against the restored implementation.
