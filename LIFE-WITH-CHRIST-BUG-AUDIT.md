# My Life With Christ — evidence-based bug audit

Audit date: 2026-10-11  
Repository: `/Users/gmcas/repos/my-life-with-christ`  
Disposition: **HOLD release** until the High findings and the release-artifact leak are repaired and regression-tested.

## Executive summary

The repository's current product name is **My Life With Christ**. The checkout and repository directory are `my-life-with-christ`; the npm package is still named `journey`, the SQLite database is `journey`, and the native application identifier is `com.myjourneywithchrist.lifewithchrist`. “mylifewithcrist” is not the identifier used by the checked-out source.

I found **19 actionable defects: 6 High, 11 Medium, and 2 Low**. Fifteen have execution or built-artifact evidence for at least one affected path. Four are source-confirmed but were not driven end to end because doing so requires an OS-level failure, process termination, or cloud-backup environment. No item below is merely a style preference or a generic hardening suggestion.

The most serious demonstrated outcomes are:

- text typed while an explicit Save is in flight can be discarded after the UI says “Saved”;
- a full backup can silently omit every recovery draft and still reset `lastExportAt`;
- restore can silently skip drafts, and “replace everything” leaves old drafts behind;
- a full backup can capture an older journal revision while a newer accepted write exists, then record the backup as current;
- an Android App Lock state-read failure renders the private journal unlocked;
- web and Android export paths can report a saved backup before a usable durable file is established.

The current ignored `dist`, Android, iOS, and debug-APK artifacts also contain the destructive `SyntheticCleanup` debug panel even though they carry a verified `public` marker. A fresh default public build does not contain it; the release tooling is allowing environment state to opt it in without rejecting the result.

No personal journal was read or used. Reproductions used synthetic records and disposable IndexedDB databases, SQLite files, an iOS simulator, and a fresh Android emulator userdata image.

## Audit provenance and preservation

| Item | Starting value |
|---|---|
| Commit | `03a2722564af0daf7d1d367acb7a1d38296129e7` |
| Branch | `ios/native-entry-sharing` |
| Upstream divergence | 0 ahead / 0 behind at audit start |
| Existing working-tree state | `?? AGENTS.md`; `?? LIFE-WITH-CHRIST-ADVERSARIAL-AUDIT.md` |

The project `AGENTS.md` DAYBREAK authorization was read before audit actions. Both pre-existing untracked files were preserved unchanged. Temporary reproduction tests were removed after use. No production source, commit, branch, remote, or deployment was changed. This report is the only repository file created by the audit.

One existing `emulator-5554` was detected. During initial Android tooling the debug APK was installed over its existing application with `adb install -r`, which preserves app data; that app was not launched, cleared, or inspected. All Android runtime inspection then used isolated `emulator-5560` with fresh disposable userdata. That emulator was stopped after the run. A pre-existing booted iPhone 17 Pro simulator (`31FE64EA-BFF5-4F31-B26A-982B68221EF7`, last-used metadata predating the audit) was left running and its application data was not inspected; the separate disposable iOS simulator used by the audit was deleted.

## Evidence vocabulary

- **Confirmed by execution** — reproduced against application code, a real provider, a built artifact, or an OS simulator/emulator.
- **Source-confirmed defect, not executed** — complete reachable execution path established in source, but the triggering OS/failure condition was not induced.
- **Suspected; additional evidence needed** — plausible but not established. No issue at this level is counted as a finding.
- **Not reproduced or ruled out** — investigated and either not observed or invalidated by an existing guard; listed separately near the end.

Where a finding has different evidence by platform, the finding says so explicitly.

## Verified architecture and supported platforms

### Application architecture

| Layer | Current implementation |
|---|---|
| UI | React 19.3, TypeScript 5.9, Vite 8.3, hash-routed lazy views |
| Web persistence | Dexie 4.4 over IndexedDB, database `journey`, schema v2 |
| Native persistence | `@capacitor-community/sqlite` 8.1, database `journey`, SQLite schema v2, explicitly `encrypted: false` / `no-encryption` |
| iOS shell | Capacitor 8.5, deployment target iOS 15, local bundled web assets |
| Android shell | Capacitor 8.5, min SDK 24, target/compile SDK 36, local bundled web assets |
| Export | Canonical ZIP with `journey.json`, manifest/checksums, Markdown, readable HTML, CSV, and supporting metadata |
| Import | Browser/native picker -> bytes -> ZIP/JSON parse -> migration -> preview -> merge/replace |
| Included content | Vendored public-profile KJV, divisions/sections, and topics; no runtime Bible fetch |

The decisive provider selection is `requiredStorageKind()` in `src/platform/runtime.ts:58-74`: web requires IndexedDB, native requires SQLite. `selectStorageProvider()` in `src/platform/storage.ts:77-115` returns only that provider or throws. `src/app/storage.tsx:48-68,96-115` also fails native open errors closed. There is no SQLite-to-IndexedDB fallback.

SQLite connection creation is at `src/storage/sqlite.ts:323-359`. It requests an unencrypted read/write connection, enables foreign keys per connection, and then migrates. Migrations are an ordered ledger (`src/storage/sqlite.ts:122-181`) and each step plus schema-version update runs in one transaction (`src/storage/sqlite.ts:428-450`). Dexie declares v1 entries/settings and additive v2 drafts at `src/storage/db.ts:43-64`.

### Platform feature matrix

| Capability | Hosted web | iOS native | Android native |
|---|---|---|---|
| Journal store | IndexedDB | SQLite | SQLite |
| Installed assets work without network | N/A; no service worker | Yes, local bundle | Yes, local bundle |
| App Lock | No | No | Yes; PIN/device recovery, not encryption |
| Incoming document share | No native bridge | Not implemented | Implemented for URI-backed SEND/VIEW documents |
| Outgoing share | Web Share API when available | Native share sheet | Native share sheet |
| Printing | Browser print | Hidden/unsupported | Hidden/unsupported |
| OS backup | Browser-dependent | SQLite defaults to Documents and is backup-eligible | Explicitly enabled; journal included, App Lock preferences excluded |

`capacitor.config.ts:25-71` has no `server` block, disables Capacitor bridge logging, and disables Android WebView debugging. APK inspection found no `INTERNET` permission. Source searches found no production `fetch`, XHR, WebSocket, beacon, analytics, telemetry, or crash-reporting client. User-initiated external links and user-chosen cloud export destinations remain normal network boundaries.

## Coverage

| Area | Source inspection | Execution evidence | Limit or blocked evidence |
|---|---|---|---|
| Repository identity, configuration, assets | Complete | Git state and artifact inventory | None |
| Entry create/edit/save/delete/drafts | Complete | React + real Dexie deferred-write harness; autosave timing tests | No physical-device force-kill inside the 400 ms settle window |
| IndexedDB schema and semantics | Complete | Real fake-indexeddb/Dexie tests and focused suite | Browser quota/disk exhaustion not safely induced |
| SQLite schema, migrations, transactions | Complete | Node `DatabaseSync` bridge; fresh iOS SQLite v2; focused tests | v1 upgrade not repeated on an actual phone; covered by real-SQLite test harness instead |
| Interrupted/bad migration | Complete | Existing real-SQLite rollback and schema-too-new tests passed | OS-level process kill during native migration not executed |
| Export/readable formats/round trip | Complete | Focused export suite; synthetic failure and concurrent-snapshot harnesses | Native picker save to remote SAF/iCloud providers not executed |
| Import merge/replace/integrity | Complete | Real Dexie import harness; checksum/truncation tests | Large-journal physical-device timings not measured |
| ZIP abuse | Complete | Actual app ZIP reader expanded a 24 MiB member | Maximum crash threshold varies by device |
| Browser offline | Complete | Chromium online positive control and offline cold-route failure | Safari/Firefox offline behavior not separately run |
| iOS | Complete for app code/plugin/config | Xcode simulator build, launch, relaunch, DB path/schema | No physical iPhone, iCloud/USB restore, memory pressure, or picker-provider run |
| Android | Complete for app code/manifest/resources | API 35 emulator launch, SQLite initialization, standard text share, APK verifier | No physical Android, biometric flow, process force-stop matrix, or remote SAF provider |
| Search, filters, sorting, dates, rich text | Complete | Focused unit tests and most Playwright flows | Exhaustive locale/DST device matrix not run |
| Navigation, keyboard, contrast, reflow | Complete | 173 Playwright tests passed | Two E2E checks failed; screen-reader hardware not run |
| Privacy/network/logging/deep links | Complete | Manifest/APK inspection and static call search | Packet capture on physical devices not run |
| Dependencies | Complete | `npm audit`, production-only audit, dependency paths | Advisory status is time-sensitive; re-run before release |
| Build/release integrity | Complete | fresh web build, Xcode build, Gradle build/APK, current bundle hashes | Store-signed archives and deployed URL were not available |

## Finding summary

| ID | Severity | Evidence | Title |
|---|---:|---|---|
| LWC-001 | High | Confirmed by execution | Editing during Save silently loses the newer text |
| LWC-002 | High | Confirmed by execution | Full backup suppresses draft-read failure and records success |
| LWC-003 | High | Confirmed by execution | Restore is not atomic or faithful for drafts |
| LWC-004 | Medium | Confirmed by execution | Saved-entry drafts lose their parent and can duplicate or outlive entries |
| LWC-005 | High | Confirmed by execution | Android App Lock fails open when state cannot be read |
| LWC-006 | Medium | Confirmed on web; native path source-confirmed/limited execution | Read-modify-write races lose updates or fail concurrent SQLite operations |
| LWC-007 | Medium | Confirmed by execution | Wall-clock rollback makes later journal content lose import conflicts |
| LWC-008 | Medium | Confirmed by execution | Import validation accepts malformed records and duplicate IDs |
| LWC-009 | Medium | Confirmed by execution | Journal import has no archive or inflation resource limits |
| LWC-010 | Medium | Confirmed by execution | Hosted web app's offline claim fails for uncached lazy routes |
| LWC-011 | Medium | Confirmed by execution/artifact inspection | Verified current artifacts contain destructive debug cleanup |
| LWC-012 | Low | Confirmed by execution | Default release/test gates are red and partly nondeterministic |
| LWC-013 | Medium | Confirmed by execution and source | Post-open read failures masquerade as empty, missing, or stale data |
| LWC-014 | High | Source-confirmed defect, not executed | Export can claim success before a durable file exists |
| LWC-015 | Low | Source-confirmed defect, not executed | Picker/read errors are hidden as cancellation or unhandled rejection |
| LWC-016 | Medium | Confirmed by execution and source | Android advertises text sharing but ignores standard `EXTRA_TEXT` |
| LWC-017 | Medium | Source-confirmed with simulator path evidence | iOS backup eligibility is absent from privacy disclosures |
| LWC-018 | High | Confirmed by execution on IndexedDB; native path source-confirmed | Full export is not a consistent snapshot of the journal |
| LWC-019 | Medium | Source-confirmed defect, not executed end to end | Backgrounding can strand the newest 400 ms of typing before it is durable |

## Detailed findings

### LWC-001 — Editing during Save silently loses the newer text

- **Severity / evidence:** High; Confirmed by execution.
- **Affected:** Web, iOS, Android; app 0.1.0/source at the audited commit.
- **Relevant code:** `handleSubmit` in `src/views/EntryEditor.tsx:1280-1382`; autosave result handling at `src/views/EntryEditor.tsx:712-724`; editor Save control at `src/views/EntryEditor.tsx:2501-2520`; `Autosaver.run` in `src/lib/autosave.ts:127-173`.

**Trigger and reproduction.** In an isolated React test backed by the real `DexieStorageProvider`, I entered “before save,” clicked Save, held the canonical storage write unresolved, then typed “after click” before allowing Save to finish. The stored entry contained only the click-time snapshot, the editor had shown the later words, the recovery-draft list was empty, and the app emitted “Saved” and navigated. As a positive control, text completed before clicking Save was stored and reopened correctly.

There is a second source-confirmed loss window in autosave. If generation 1 is already writing and generation 2 is queued, generation 1 can call `onResult({status:'saved'})` at `src/lib/autosave.ts:153-159`. The callback unconditionally clears `notYetDurable` even though generation 2 remains pending. The navigation/close guard at `src/views/EntryEditor.tsx:1055-1058` is therefore removed during a real unsaved window.

**Expected.** Text accepted by an enabled editor during Save must either join the save, remain as a recovery draft, or keep the user on the editor with an explicit unsaved state.

**Actual and impact.** The submit handler captures `patch` before awaiting draft flush and the canonical write. Fields remain enabled. After the old snapshot commits, the handler retires the current autosaver, clears its draft identity, deletes the draft, announces success, and navigates. Newer writing is silently discarded—direct loss of journal content.

**Root cause.** The Save operation does not bind its snapshot to an editor generation. Draft retirement is unconditional and operates on the same mutable writer/draft identity that can receive post-click changes. Autosave acknowledgements also lack generation information.

**Recommended repair.** Assign each form mutation a monotonic generation. Save a specific generation and retire/delete only the draft for that generation if no newer generation exists. If newer input exists, retain it as a new draft and stay in the editor (or complete a second canonical save) before announcing final success. Make autosave results carry their generation and clear `notYetDurable` only when `persisted >= latest`.

**Regression test.** Use a deferred real-provider write: click Save, mutate every supported field while the write is blocked, release it, remount, and assert the newest generation is either canonical or recoverable. Include navigation/background attempts during both canonical and draft writes.

**Remaining uncertainty.** The exact loss timing will differ across IndexedDB and native bridge latency, but the ordering defect is platform-independent and was reproduced against application code.

### LWC-002 — Full backup suppresses draft-read failure and records success

- **Severity / evidence:** High; Confirmed by execution.
- **Affected:** Web, iOS, Android.
- **Relevant code:** `exportEverything` in `src/export/download.ts:63-100`, especially the swallowed read at line 78 and `lastExportAt` write at lines 93-97.

**Trigger and reproduction.** With one saved entry and one unfinished draft, I used the real export builder and a storage facade whose `listDrafts()` rejects while entry reads and file save succeed. The resulting valid ZIP contained the entry but no draft, `saved` was true, and `lastExportAt` was updated. Positive control: with a working `listDrafts`, the same full export contained the draft byte-for-byte.

**Expected.** “Export everything” must fail closed if any class of journal data cannot be read, must not produce a file described as a full backup, and must not silence the reminder.

**Actual and impact.** `listDrafts().catch(() => [])` deliberately converts an incomplete read into “there are no drafts.” The app then writes and reports a successful full backup. A user can discard or lose the device believing recent unfinished writing is protected when it is not.

**Root cause.** Empty data and failed data are represented by the same `[]`, violating the product's required distinction between intentional emptiness and incomplete reads.

**Recommended repair.** Let a full export draft-read failure abort before file creation. Preserve a separate explicitly partial diagnostic export only if the UI labels it incomplete and never updates `lastExportAt`.

**Regression test.** Inject failures independently into entry, draft, settings, archive-build, and file-save phases. Assert no “Saved,” no `lastExportAt`, and no full-backup artifact for every incomplete read. Keep a zero-draft positive control.

**Remaining uncertainty.** None about the application behavior; OS-level causes of a draft-only read failure vary.

### LWC-003 — Restore is not atomic or faithful for drafts

- **Severity / evidence:** High; Confirmed by execution.
- **Affected:** Web, iOS, Android.
- **Relevant code:** `applyImport` / `restoreDrafts` in `src/export/importer.ts:214-260`; entry-only replacement in `src/storage/db.ts:141-147` and `src/storage/sqlite.ts:625-633`; success copy in `src/views/DataView.tsx:368-379`.

**Trigger and reproduction.** Three minimal real-Dexie cases were run:

1. Import an archive with one entry and one draft through a provider whose `putDraft` rejects. `applyImport` resolved with `imported: 1`; the entry was present and the draft was absent.
2. Start with a local draft, then replace from an archive containing entries and no drafts. The imported entry replaced the old entries, but the old local draft remained even though the UI says “everything that was here before was deleted.”
3. Start with a local draft updated at 13:00, then merge an older archived draft with the same ID updated at 12:05. The older archived words silently replaced the newer local words. A healthy archive with no colliding draft ID left unrelated local work intact.

The healthy control restored both entries and drafts, including whitespace, through the existing archive round-trip suite.

**Expected.** Restore should either commit the entire selected journal state or report an explicit partial failure while retaining the pre-import state. Replace should replace drafts as well as entries after clear user disclosure.

**Actual and impact.** Entries commit first. Every draft error is swallowed. Replace operates only on the entries table/store, so old unfinished private text survives and incoming unfinished text can disappear. Merge blindly `put`s every archived draft, so an older backup can roll current unfinished writing backward. The success count excludes drafts and gives no warning. Backup recovery is therefore neither atomic nor full fidelity.

**Root cause.** The storage contract exposes atomic entry batches but no transaction spanning entries and drafts. Draft restoration was appended as best-effort work after the irreversible entry commit and has no timestamp/content conflict rule.

**Recommended repair.** Add a provider-level restore transaction that validates all records first and atomically applies both entries and drafts. Dexie should include both stores in one transaction; SQLite should use one explicit transaction. Define and display draft merge/replace semantics, treat differing same-ID drafts as conflicts rather than blind overwrites, and report draft counts.

**Regression test.** Fail each draft write after N successful writes in merge and replace modes, on both providers. Assert byte-equivalent pre-import state after failure. Test older, newer, equal-time/different-content, and unrelated draft IDs; require an explicit conflict for ambiguity. Verify that replace removes stale drafts and that a successful restore round-trips all draft fields.

**Remaining uncertainty.** None for Dexie. Native bridge-specific rollback behavior should be exercised after the cross-store transaction is implemented.

### LWC-004 — Saved-entry drafts lose their parent and can duplicate or outlive entries

- **Severity / evidence:** Medium; Confirmed by execution.
- **Affected:** Web, iOS, Android.
- **Relevant code:** Home draft link in `src/views/HomeView.tsx:271-277,382-413`; new-entry draft load and target selection in `src/views/EntryEditor.tsx:817-867`; deletion in `src/views/EntryEditor.tsx:1428-1445`.

**Trigger and reproduction.** Edit a saved entry, wait for its draft autosave, leave, and use Home's “Continue” card. The card always routes to `newEntry` with only the draft ID. Saving calls `createEntry`, producing a second ID while the original saved entry remains unchanged. In a second case, deleting a saved entry after its draft was written deleted only the entry; the private draft remained and was offered later. Positive control: opening the original entry route directly finds `getDraftForEntry(entryId)` and updates the correct ID.

**Expected.** A draft with `entryId` must resume against that entry. Deleting that entry should explicitly delete or retain-and-label its draft according to one documented recovery policy.

**Actual and impact.** Parent identity is discarded at the Home navigation boundary. The journal can acquire duplicate versions, and deleted writing can reappear as an unexplained orphan. This undermines deletion intent and chronological integrity, though the demonstrated path does not itself lose text.

**Root cause.** The UI treats all drafts as new-entry drafts even though the persistence model records `entryId`; entry deletion is not a transaction with associated draft cleanup.

**Recommended repair.** Route parented drafts to the existing entry (which already loads its draft), reserve `newEntry?draft=` for unparented drafts, and make deletion handle associated drafts atomically after an explicit policy decision.

**Regression test.** Cover new and saved-entry drafts from Home, Timeline, cold start, save, discard, and delete. Assert exactly one canonical ID and no unexplained draft after each action.

**Remaining uncertainty.** Product policy must decide whether deletion also deletes unsaved edits or offers a separate recovery choice; the current accidental behavior is not an acceptable policy.

### LWC-005 — Android App Lock fails open when state cannot be read

- **Severity / evidence:** High; Confirmed by execution.
- **Affected:** Android when App Lock is supported/enabled. Web and iOS currently expose no App Lock.
- **Relevant code:** initial gate in `src/app/app-lock.tsx:107-145`; lifecycle subscription in `src/platform/app-state.ts:28-48`; ignored writes in `android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/AppLockStore.java:140-151,173-180`.

**Trigger and reproduction.** In the real `AppLockGate`, make the native `getState()` promise reject. The private child journal rendered in the `unlocked` phase. Positive control: returning `{enabled:true}` rendered the lock screen and never mounted the private child.

Other reachable variants are source-confirmed: failure to attach the Capacitor lifecycle listener is silently ignored, so an already-unlocked journal need not re-lock on resume; `SharedPreferences.Editor.commit()` results are ignored, so `setPin` can report success even when persistent storage reports failure. Android documents that [`commit()` returns whether the new values were successfully written to persistent storage](https://developer.android.com/reference/android/content/SharedPreferences.Editor#commit()).

**Expected.** On an edition that implements App Lock, inability to determine lock state must hide journal content behind a locked/error screen. Enabling/disabling the lock must not report success unless the state write succeeds.

**Actual and impact.** Any initial bridge/plugin/state-read failure is interpreted as “feature absent” and the journal is mounted unlocked. This is a direct privacy-control bypass during a failure—the moment conservative behavior matters most.

**Root cause.** The gate cannot distinguish unsupported web/iOS capability from a failed Android security capability. Native persistence success and lifecycle-listener readiness are not part of the enforced state contract.

**Recommended repair.** Select unsupported vs supported capability before mounting the gate. On Android, fail closed on state/read/listener errors with a recoverable error screen; check every synchronous `commit()` result and reject the bridge call on false. Consider an immediate foreground state check independent of listener registration.

**Regression test.** Exercise initial read rejection, malformed state, listener attachment rejection, background timestamp failure, `commit() == false`, process recreation, and device-credential recovery. In every unresolved Android state assert the private subtree never mounts.

**Remaining uncertainty.** Biometric/device-credential flows were not run on physical hardware. The initial fail-open itself is established without that hardware.

### LWC-006 — Read-modify-write races lose updates or fail concurrent SQLite operations

- **Severity / evidence:** Medium; Confirmed by execution for IndexedDB. SQLite is source-confirmed with a real-SQLite bridge reproduction, but not reproduced through the Capacitor bridge on a device.
- **Affected:** Hosted web definitely; iOS/Android whenever entry operations overlap on one provider connection.
- **Relevant code:** `DexieStorageProvider.updateEntry` at `src/storage/db.ts:119-124`; `SqliteStorageProvider.updateEntry` at `src/storage/sqlite.ts:593-598`; unqueued native transaction helper at `src/storage/sqlite.ts:511-520`.

**Trigger and reproduction.** Starting from one real Dexie entry, I synchronized two concurrent `updateEntry` calls so both read the same original row and then applied different non-overlapping patches. Only one patch survived: the later whole-row `put` overwrote the other. Running the same updates sequentially preserved both fields. Using the actual `SqliteStorageProvider` over Node's real SQLite engine, overlapping `createEntry` transactions on the same connection caused at least one call to reject; sequential creates stored both.

**Expected.** Independent accepted operations should serialize or conflict explicitly. A success must never erase another successful field change.

**Actual and impact.** Both providers read outside the write transaction, build a complete replacement object, and then overwrite the row. SQLite also allows multiple callers to issue `BEGIN` on one connection without a provider mutex. Overlapping import/editor, lifecycle, multiple-tab, or repeated-action work can lose fields or surface sporadic transaction errors.

**Root cause.** The provider contract has no concurrency/version rule. Transactions protect an individual write batch but not the read that determined its contents, and native transactions are not queued.

**Recommended repair.** Serialize provider mutations. For Dexie, read and update inside one `rw` transaction and add an expected revision/generation when cross-tab writers matter. For SQLite, add a FIFO transaction mutex and perform read-plus-write inside it. Reject stale expected revisions rather than silently taking last writer wins.

**Regression test.** Barrier-synchronize two non-overlapping patches and two imports against each real provider; require either a merged result or one explicit conflict, never two successes with one field lost. Run the native version through the real Capacitor plugin.

**Remaining uncertainty.** Capacitor may serialize individual bridge messages, but that does not make the provider's multi-message read/transaction/write sequence atomic. A native-device barrier test is still required.

### LWC-007 — Wall-clock rollback makes later journal content lose import conflicts

- **Severity / evidence:** Medium; Confirmed by execution.
- **Affected:** Web, iOS, Android import/merge.
- **Relevant code:** timestamp comparison in `src/export/importer.ts:143-174,231-238`; edit timestamp generation in `src/storage/semantics.ts:207-210`.

**Trigger and reproduction.** I stored an entry, moved the simulated wall clock backward, made a later edit, exported it, then merged it into a copy carrying the earlier words but a lexically later `updatedAt`. The real `applyImport`/Dexie path returned `imported: 0` and retained the earlier words. Positive control: with a monotonically later timestamp, the later words imported.

Equal timestamps with different content are also counted as unchanged at `src/export/importer.ts:162-164` without comparing payloads.

**Expected.** A clock adjustment must not silently decide which human-authored version survives. Differing content with the same ID should at least be surfaced as a conflict.

**Actual and impact.** ISO wall-clock order is the sole winner rule. Manual clock changes, restored device time, or skew between devices can make chronologically later writing look older and be silently ignored.

**Root cause.** `updatedAt` is being used as both display metadata and a causal revision identifier, although wall clocks are not monotonic or globally ordered.

**Recommended repair.** Add a durable per-entry revision/content hash and treat any same-ID/different-content import as a conflict unless ancestry proves a winner. At minimum, compare payloads when timestamps match and let the user choose when the incoming payload differs but has an older timestamp.

**Regression test.** Cover backward clocks, equal timestamps with different payloads, timezone/offset variants, repeated exports, and genuinely unchanged records. Assert no differing content is silently classified unchanged.

**Remaining uncertainty.** The right automatic merge policy is a product decision; the silent current policy is demonstrably unsafe.

### LWC-008 — Import validation accepts malformed records and duplicate IDs

- **Severity / evidence:** Medium; Confirmed by execution.
- **Affected:** Web, iOS, Android.
- **Relevant code:** coercive known-field migration in `src/export/migrate.ts:255-340`; draft migration in `src/export/migrate.ts:343-383`; entry collection without uniqueness enforcement at `src/export/migrate.ts:385-416`; preview counts at `src/export/importer.ts:156-202`; draft consumption in `src/lib/drafts.ts:41-55,96` and `src/views/HomeView.tsx:271-277`.

**Trigger and reproduction.** Three cases were executed against the real migration/import/UI code. A valid envelope containing a draft whose `form` was only `{notes: "..."}` passed migration and import; the next Home render called `form.title.trim()` and threw. Two incoming entries sharing one ID made preview report two incoming/imported while Dexie stored one row (the later `bulkPut` value). Finally, an entry with a known `notes` field shaped as `{irreplaceable: "words"}` migrated successfully to `notes: ""`; the original value was absent from `_unmigrated` and no warning named `notes`. A string-valued `notes` field survived as the positive control.

**Expected.** Validation should prove every required field and collection invariant before preview or mutation. A malformed or newer representation of a known field must be rejected or preserved with a warning, never silently coerced to empty. Counts should describe what storage will contain.

**Actual and impact.** Any object is cast to `DraftForm` verbatim. Duplicate entry/draft IDs are neither rejected nor normalized. Several known entry fields use permissive empty-value coercion, while only unknown field names are preserved. Malformed backups can crash recovery surfaces, duplicate archives overstate restored content and silently choose a winner, and damaged/future known-field values can be erased during a supposedly forward-preserving migration.

**Root cause.** Migration validates the envelope shape but treats draft form types and ID uniqueness as trusted TypeScript values even though the input is untrusted JSON. For entries, a field name being “known” suppresses `_unmigrated` preservation even when its value has the wrong runtime type.

**Recommended repair.** Validate the complete runtime schema for entries and drafts, including required strings/arrays/enums, date syntax, unique IDs, and valid parent references. Preserve any present-but-unreadable value—including values under known field names—in `_unmigrated` with a warning, or reject the entire archive before mutation. Provide a precise non-destructive repair preview rather than silent coercion.

**Regression test.** Property/fuzz tests should delete or change the type of every required/known field, duplicate each identifier class, and introduce dangling `entryId` values. Assert either parse failure with byte-identical existing storage or explicit lossless preservation plus a warning.

**Remaining uncertainty.** Other malformed nested combinations may exist; the three executed classes prove the validation boundary is incomplete rather than exhaustively enumerate it.

### LWC-009 — Journal import has no archive or inflation resource limits

- **Severity / evidence:** Medium; Confirmed by execution.
- **Affected:** Web, iOS, Android; memory impact is device-dependent.
- **Relevant code:** unbounded journal ZIP reader at `src/export/zip.ts:232-276`; web whole-file read at `src/platform/web.ts:217-228`; Android picker buffering at `android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/JourneyDocumentsPlugin.java:154-171`; iOS whole-file `Data(contentsOf:)` at `ios/App/App/JourneyDocumentsPlugin.swift:253-267`. A bounded implementation already exists at `src/import/zip-limits.ts:108-195` but is not used for journal archives.

**Trigger and reproduction.** Using the application's real `createZip`/`readZip`, a highly compressible archive inflated one member to 24 MiB with no rejection in about 616 ms. The reader trusts member count and sizes, inflates every member, and only afterward can the importer inspect its manifest. Native and web pickers first copy the entire compressed file into memory/base64.

**Expected.** Before allocating or inflating, enforce compressed-file, entry-count, per-member, cumulative-expanded, compression-ratio, and canonical-member limits. Oversize input should leave the journal untouched with a clear error.

**Actual and impact.** An accidental or hostile archive can exhaust the WebView/browser process, force an OS termination, or cause a long unresponsive import. Repeated ZIP paths are checked later for integrity, but that does not bound resource use.

**Root cause.** The journal reader predates or bypasses the bounded ZIP reader used by the document importer, and picker bridges expose only all-at-once byte payloads.

**Recommended repair.** Reuse a streaming/bounded ZIP reader for journal import, whitelist only expected canonical paths before inflation, and add native picker/file-size gates before base64 conversion. Preserve manifest/checksum validation inside those limits.

**Regression test.** Cover too many entries, huge declared/stored members, high compression ratios, cumulative overflow, truncated headers, overlapping offsets, and a normal large journal immediately below each limit.

**Remaining uncertainty.** No fixed crash size applies to every device. The absence of any bound and successful large inflation are established. Archive path traversal was ruled out because this importer never extracts member paths to the filesystem.

### LWC-010 — Hosted web app's offline claim fails for uncached lazy routes

- **Severity / evidence:** Medium; Confirmed by execution.
- **Affected:** Hosted web. Native iOS/Android use local bundled assets and are not affected by this trigger.
- **Relevant code:** every view is a lazy chunk at `src/App.tsx:19-38`; offline claim at `src/views/AboutView.tsx:52-65` and `src/views/SettingsView.tsx:207-219`; misleading generic boundary copy at `src/app/SectionsBoundary.tsx:51-67`. No service worker or PWA cache exists in the repository.

**Trigger and reproduction.** In Chromium against the current built app, loading Home online and then opening Sermon Note online loaded the editor (positive control). In a fresh context, I loaded only Home, switched the browser context genuinely offline, and opened the same never-before-loaded route. Its chunk could not load; the app showed “This page could not be loaded” and incorrectly said the failure concerned Bible data.

**Expected.** A product that says the journal and Scripture “work offline” should make every essential route available after the initial installation/load, or clearly qualify that only previously cached pages work.

**Actual and impact.** Vite code splitting requires a network fetch the first time each route is visited. Someone offline may be unable to write, search, export, restore, open help, or read an uncached Bible chunk even though the shell is open and promises offline operation.

**Root cause.** Lazy chunks are deployed as independent network resources without an install/precache layer or offline shell manifest.

**Recommended repair.** Either add a versioned, atomic service-worker precache for all essential app/data chunks and an update strategy that cannot mix versions, or stop advertising full hosted-web offline support and eagerly bundle the critical journal/editor/recovery paths.

**Regression test.** In a fresh browser profile, load only `/`, sever all network, then traverse every route and representative Bible book. Repeat after a version upgrade with old caches present. Native local-bundle tests should remain separate.

**Remaining uncertainty.** Browser HTTP caches may make previously visited routes work, but they are not a reliable offline installation contract. No service-worker stale-cache defect exists today because there is no service worker.

### LWC-011 — Verified current artifacts contain destructive debug cleanup

- **Severity / evidence:** Medium; Confirmed by execution and artifact inspection.
- **Affected:** The current local web `dist`, synced iOS/Android assets, and built Android debug APK. A fresh default public build is not affected. No claim is made that these ignored artifacts were published to a store/site.
- **Relevant code:** guarded import/render at `src/views/DataView.tsx:106-117,877-881`; deletion loop at `src/debug/SyntheticCleanup.tsx:31-57,103-117`; marker matching at `src/debug/synthetic.ts:20-32`; build define at `vite.config.ts:20-28`; environment inheritance and marker in `scripts/native-assets.mjs:41-46,75-94`; count/byte-only sync check in `scripts/native-sync.mjs:49-66,95-102`.

**Trigger and reproduction.** The current browser bundle visibly rendered “Debug: remove test content” on Data & Backup. `dist`, `ios/App/App/public`, and `android/app/src/main/assets/public` all contained `SyntheticCleanup-CNmT0wuh.js` with identical SHA-256 `659f4077fb55bf0b53db5d2f801ad3266ad9417fd2fb391dceea87dc3a127f32`; the APK packaged it too. The current marker says `profile: public`, and the normal bundle verifier passed. A clean public build to a temporary directory contained no cleanup chunk (positive control).

The tool is mitigated: it matches only exact case-sensitive title substrings `ZZSHARE` and `zzios-sermon`, lists matches, and requires a second confirmation. It is still production-forbidden code that can delete entries and drafts.

**Expected.** A supported public/native build and verifier must make debug tooling impossible to include, regardless of ambient shell variables.

**Actual and impact.** `native-assets.mjs` inherits all of `process.env`; `DEBUG_TOOLS=1` therefore creates a build that is still marked and verified as public. The verifier does not reject the module/UI strings. `native-sync` later compares only file count and total bytes, so even same-size post-verification changes can pass its fingerprint. Shipping the current assets would expose a data-deletion control.

**Root cause.** Data profile and debug-tool profile are independent, but the release marker/verifier authenticates only the former. The handoff fingerprint is not content-addressed.

**Recommended repair.** Force `DEBUG_TOOLS=0` (not merely unset) in every release/native script; include it in signed build metadata; make verification fail on debug chunks, source strings, and feature flags; and have sync recompute the existing build-ID digest over exact paths/bytes. Verify the final APK/IPA/site payload, not only the staging directory.

**Regression test.** Run release scripts from a parent environment with `DEBUG_TOOLS=1` and require failure or proven absence. Mutate one asset without changing its byte length and require native sync to reject it.

**Remaining uncertainty.** Deployment history was unavailable, so exposure is proven for current local release candidates, not a public endpoint.

### LWC-012 — Default release/test gates are red and partly nondeterministic

- **Severity / evidence:** Low; Confirmed by execution.
- **Affected:** Development/CI/release assurance; one Android resource lint issue is in shipped source.
- **Relevant code:** missing build constant in `vitest.config.ts:12-47`; production definition at `vite.config.ts:20-28`; Android lint error at `android/app/src/main/res/layout/widget_sermon_note.xml:23-29`.

**Observed outcomes.** Two full unit runs produced different timeout/state-contamination failures. One run had 10 failed tests plus three suite-load failures while 1,975 passed and four skipped; a rerun had nine failed tests. The three deterministic load failures (`platform.test`, `DataView.cancelled-export`, and `DataView.test`) are `ReferenceError: __DEBUG_TOOLS__ is not defined` because Vitest does not define the production compile-time constant. The profile matrix reported 58 failures, largely five-second timeouts. Running four formerly failing UI files alone passed all 56 tests, demonstrating contention/order sensitivity.

Playwright passed 173 tests and failed two (backup-reminder navigation and light-theme contrast could not find the expected Home heading). Android unit tests and APK assembly completed, but the combined Gradle command exited 1 because lint rejects framework `android:tint` in favor of `app:tint`. Typecheck passed; lint otherwise passed with six React-refresh warnings.

**Expected.** The default test/build commands should be deterministic and green, and should exercise the same constants as production.

**Actual and impact.** A release cannot distinguish regressions from infrastructure noise, and the deterministic suite-load error prevents relevant Data/Platform tests from running in the default command. This directly weakens detection of LWC-011 and export regressions.

**Root cause.** Test configuration diverges from Vite defines; several UI tests share timing/global-state assumptions under full-suite load; Android lint is not currently a clean gate.

**Recommended repair.** Define `__DEBUG_TOOLS__: false` in Vitest, isolate/reset shared modules and timers, identify tests that exceed timeouts only under contention, and make the exact release matrix a required green CI job. Change widget tint to the compatible attribute after visual verification.

**Regression test.** Require multiple clean consecutive runs of default, both data profiles, Playwright, Android lint/unit/assemble, Xcode build, and final-artifact verification.

**Remaining uncertainty.** The two E2E failures may be test timing rather than product defects; they are recorded as gate failures, not separately claimed as user-facing bugs.

### LWC-013 — Post-open read failures masquerade as empty, missing, or stale data

- **Severity / evidence:** Medium; Confirmed by execution for the shared query path; other suppression sites source-confirmed.
- **Affected:** Web, iOS, Android after storage has opened successfully.
- **Relevant code:** generic query hook at `src/app/storage.tsx:155-191`; new/existing draft read suppression at `src/views/EntryEditor.tsx:845-867,889-930`; missing-entry UI at `src/views/EntryEditor.tsx:1450-1463`.

**Trigger and reproduction.** I opened a real `DexieStorageProvider`, inserted one entry, and mounted the real `StorageContextProvider` plus `useStorageQuery` through a thin provider proxy that rejected only `listEntries()` after open. The query settled as `count:0` with no error state or message, even though the underlying database held the entry. Normal real-provider list/query coverage in the focused suite is the positive control. The same catch policy applies to any later rejection—for example a transient IndexedDB transaction abort, malformed JSON row, SQLite bridge disconnect, or I/O error.

**Expected.** Failed, empty, and not-found must be separate states. The UI should keep the last known data only with a visible stale/error state and must not enable decisions that assume a complete read.

**Actual and impact.** `useStorageQuery` catches every read error, leaves its initial or previous value, and clears loading. The executed initial failure made a nonempty journal look empty; on a later failure it would look silently stale. EntryEditor converts draft-read failure to “no draft,” and any combined entry-load failure to the same missing screen used for a deleted ID (“It may have been deleted”). The database is not recreated and no automatic destructive write was found, but users can be falsely told their writing is gone or make export/import/delete decisions from incomplete state.

**Root cause.** The open-time storage error is assumed to cover all future reads; query return types carry no error/completeness state. Several local catches intentionally collapse operational failure into absence.

**Recommended repair.** Return `{data, loading, error, complete}` from storage queries. Treat only a successful `undefined` as not-found, surface post-open provider failures centrally, and disable backup/replace/destructive decisions whenever the required read set is incomplete.

**Regression test.** Use a provider that opens, returns real data once, then rejects each read method independently. Assert explicit error/stale UI, no empty/deleted claim, and no mutation whose preview depended on the failed read.

**Remaining uncertainty.** The exact errors produced by full disk, corrupt SQLite JSON, and a disconnected native bridge were not induced on devices. The generic UI response to a rejection is executed; the editor-specific variants remain source-confirmed.

### LWC-014 — Export can claim success before a durable file exists

- **Severity / evidence:** High; Source-confirmed defect, not executed end to end.
- **Affected:** Hosted web and Android. The inspected iOS delegate resolves only after the export picker reports completion and does not have the Android close-order defect.
- **Relevant code:** web saver at `src/platform/web.ts:29-60`; Android saver at `android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/JourneyDocumentsPlugin.java:90-120`; success/reminder handling at `src/export/download.ts:81-100` and `src/views/DataView.tsx:223-251`.

**Trigger.** On web, cancel/block/fail the browser download after the synthetic anchor click. The page has no completion signal but returns `{saved:true}`. On Android, use a document provider whose output stream accepts `write`/`flush` but fails during `close`; `call.resolve({saved:true})` runs inside the try body before try-with-resources performs `close()`.

**Expected.** “Saved” and `lastExportAt` should mean the destination accepted a complete usable file. When the platform cannot know, the UI must say “download started; verify the file” rather than record a durable backup.

**Actual and impact.** Both paths can announce `Saved <archive>` and reset the full-backup reminder without a confirmed usable file. On Android, a close exception reaches `call.reject` only after the call has already resolved and is therefore too late. This can leave the device as the sole copy while the app asserts otherwise.

**Root cause.** One boolean contract conflates “delivery initiated” with “destination successfully closed.” The browser implementation documents the limitation internally but consumers still treat `true` as durable success; the Android resolve is ordered before resource close.

**Recommended repair.** Make the result explicit (`cancelled`, `initiated-unverified`, `committed`). On Android, close successfully before resolving and test close failure. On supporting browsers, use the File System Access API and await writable close; on anchor fallback, use unverified wording and do not update the durable-backup timestamp without an explicit confirmation policy.

**Regression test.** Provide streams that fail on open, write, flush, and close; each must reject and leave `lastExportAt` unchanged. Browser tests should simulate a no-verification fallback and assert it never renders the durable “Saved” state.

**Remaining uncertainty.** Browser vendors intentionally expose no reliable completion event for anchor downloads, so the exact UX requires a product decision. The current success claim exceeds what the API can establish.

### LWC-015 — Picker/read errors are hidden as cancellation or unhandled rejection

- **Severity / evidence:** Low; Source-confirmed defect, not executed.
- **Affected:** Web, iOS, Android import UI.
- **Relevant code:** native picker handler in `src/views/DataView.tsx:693-707`; web file handler at `src/views/DataView.tsx:713-724`; DOM file read at `src/platform/web.ts:217-228`.

**Trigger.** Make the native picker reject because it cannot open/read the provider, or make browser `File.arrayBuffer()` reject after a file was selected.

**Expected.** User cancellation should remain quiet; operational failures should be shown as “could not open/read” and leave storage untouched.

**Actual and impact.** Native `.catch(() => onFileChosen(null))` treats every failure as a cancel. The browser `pickedFromDomFile(...).then(onFileChosen)` has no rejection handler, leaving an unhandled promise and no feedback. A user cannot distinguish changing their mind from a broken provider/file read and may believe the backup itself is invalid or the control did nothing.

**Root cause.** Cancellation and failure are not discriminated in the picker port/view boundary.

**Recommended repair.** Return a tagged picker result and reserve `cancelled` for actual OS/user cancellation. Surface all read errors in `importError`, without parsing or writing anything.

**Regression test.** Cover cancel, permission loss, provider disconnect, zero-byte read, and `arrayBuffer` rejection on every platform adapter.

**Remaining uncertainty.** OS picker failure messages vary; no journal mutation occurs before this point, so this is usability/recovery observability rather than data corruption.

### LWC-016 — Android advertises text sharing but ignores standard `EXTRA_TEXT`

- **Severity / evidence:** Medium; Confirmed by execution and source.
- **Affected:** Android incoming `ACTION_SEND` with MIME `text/plain` and a standard text payload.
- **Relevant code:** advertised filter at `android/app/src/main/AndroidManifest.xml:60-67`; cold/warm capture at `android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/MainActivity.java:8-24,52-56`; payload extraction at `android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/SharedDocument.java:31-68`.

**Trigger and reproduction.** On the disposable API 35 emulator I launched the packaged app with `ACTION_SEND`, `text/plain`, and `android.intent.extra.TEXT=DAYBREAK_shared_text`. Android resolved and opened `MainActivity`; after the slow cold WebView load the app showed its ordinary Home/onboarding flow and no shared-document review or text. Source confirms `remember()` asks only for `Intent.EXTRA_STREAM`, gets no URI, and returns.

Android's primary receiving-shares guidance specifies [`Intent.EXTRA_TEXT` for text/plain content](https://developer.android.com/develop/ui/compose/sharing/receive#receiving-content). The existing URI-backed shared-document tests are a positive control for the downstream TypeScript accept/review path, but a live content-provider `EXTRA_STREAM` positive control was not provisioned on the emulator.

**Expected.** Either accept standard shared text into the review flow with clear provenance, or do not advertise `text/plain` SEND handling for payloads the app cannot consume.

**Actual and impact.** The app appears as a share target, opens, and silently drops the shared sermon text. Users can reasonably assume the note arrived when nothing was staged or saved.

**Root cause.** The manifest declares a content type, while the activity bridge implements only the document-URI variant of that action.

**Recommended repair.** Read `EXTRA_TEXT` for `text/plain`, enforce a conservative character/byte limit before crossing the bridge, and feed it into the same explicit review/import screen. Alternatively narrow the filter to URI-backed document types that the implementation supports.

**Regression test.** Instrumented tests should send cold and warm `EXTRA_TEXT`, URI `EXTRA_STREAM`, VIEW content URIs, oversized text, malformed types, repeated delivery, and cancellation while App Lock is engaged.

**Remaining uncertainty.** A physical-app-to-app share was not run. The standard emulator intent and exact missing extraction path establish the defect.

### LWC-017 — iOS backup eligibility is absent from privacy disclosures

- **Severity / evidence:** Medium; Source-confirmed defect with simulator path evidence.
- **Affected:** iOS native; app 0.1.0 / SQLite plugin 8.1.1.
- **Relevant code:** no database-location override in `capacitor.config.ts:25-64`; plugin default Documents location at `node_modules/@capacitor-community/sqlite/ios/Plugin/CapacitorSQLite.swift:12,84-100`; Android-only copy at `src/components/FirstVisitNotice.tsx:78-95`, `src/views/AboutView.tsx:52-65`, `src/views/SettingsView.tsx:207-220`, and `src/views/HelpView.tsx:214-223`.

**Trigger and evidence.** A fresh iOS simulator launch created `journeySQLite.db` under the application's `Documents` directory and initialized schema v2. The plugin source defaults there when `iosDatabaseLocation` is absent. Apple's file-system guidance says Documents/Application Support user data is included in iCloud and computer backups unless excluded; see [Using the File System Effectively](https://developer.apple.com/documentation/foundation/using-the-file-system-effectively) and [Optimizing Your App's Data for iCloud Backup](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup).

**Expected.** Privacy/onboarding copy should explain every supported platform's OS-backup behavior, especially when the journal is unencrypted at the application database layer, or the app should intentionally exclude the database and disclose the recovery tradeoff.

**Actual and impact.** iOS users repeatedly see only an Android backup caveat alongside “notes live on this device” / “this app uploads nothing.” The app itself makes no network call, but the default location is eligible for an Apple-managed off-device backup. A privacy-sensitive user may make a storage decision based on an incomplete disclosure.

**Root cause.** Backup copy and backup-rule work were implemented for Android without an equivalent iOS policy/disclosure decision; the third-party plugin's default location silently determines behavior.

**Recommended repair.** Make an explicit product decision: retain OS backup for recoverability and disclose it accurately, or set the backup-exclusion resource value and accept/document the increased loss risk. Keep “app upload” distinct from “OS backup to your account.” Verify protection class and restore behavior on a device.

**Regression test.** On a physical iOS device, inspect backup inclusion/exclusion, perform encrypted-computer and iCloud restore tests where available, and assert platform-correct onboarding/help copy. Do not put App Lock credentials in the journal backup.

**Remaining uncertainty.** No real iCloud or Finder backup/restore was executed, and user/device backup settings can disable backup. The default eligibility and incomplete copy are established; actual upload for a particular user is not claimed.

### LWC-018 — Full export is not a consistent snapshot of the journal

- **Severity / evidence:** High; Confirmed by execution against real IndexedDB application code. The shared native orchestration is source-confirmed, but native overlap was not executed.
- **Affected:** Hosted web when another tab or an in-flight write overlaps export; iOS/Android when an autosave or other mutation overlaps the sequential export reads.
- **Relevant code:** independent reads and success timestamp in `src/export/download.ts:63-100`; export invocation in `src/views/DataView.tsx:216-251`; provider list operations in `src/storage/db.ts` and `src/storage/sqlite.ts`; editor autosave at `src/views/EntryEditor.tsx:726-815`.

**Trigger and reproduction.** I stored an entry in a real `DexieStorageProvider`, then ran the actual `exportEverything` and archive parser through a timing proxy that allowed `listEntriesChronological()` to return its snapshot and committed a newer `updateEntry()` before export continued. The ZIP contained the older words, the database contained the newer accepted words, the file saver reported success, and `lastExportAt` was set. A second export with no overlapping mutation contained the newer words as the positive control. The proxy controlled only the interleaving; storage, mutation, export construction, import parsing, and settings update were real application code.

**Expected.** A successful full backup should represent one coherent committed journal revision. If the journal changes while its snapshot is being acquired, export should include the change, retry, or clearly report that the result is not a current full backup and leave the reminder active.

**Actual and impact.** Entries and drafts are read in separate operations with no encompassing transaction or revision check. Any entry accepted after the first read is omitted; a draft changed after the second read can likewise be omitted. The app still calls the file a full export and records the current time as `lastExportAt`. A user can move or erase the device believing all writing through that timestamp is protected when the archive predates an accepted write.

**Root cause.** The export layer snapshots ordinary arrays one after another, while the storage contract exposes neither an atomic entries-plus-drafts snapshot nor a durable revision token. `lastExportAt` records delivery time, not the revision actually captured.

**Recommended repair.** Add a provider operation that atomically reads entries and drafts and returns a revision/content digest. In Dexie, acquire both stores in one read transaction; in SQLite, use one read transaction behind the provider's transaction queue. Build/save outside that transaction, then verify the revision has not advanced before recording backup freshness; retry or report “journal changed during export” if it has. Flush or explicitly include any active editor snapshot before beginning.

**Regression test.** Barrier-synchronize create, update, delete, and draft writes before/between/after the snapshot reads for both providers. Require every successful “current full backup” to match one complete committed revision and require `lastExportAt` to stay unchanged on a revision mismatch. Keep the no-overlap positive control.

**Remaining uncertainty.** The deterministic interleaving was executed on IndexedDB, not through either native bridge. Native has the same sequential orchestration, but the practical overlap window and bridge scheduling need device tests.

### LWC-019 — Backgrounding can strand the newest 400 ms of typing before it is durable

- **Severity / evidence:** Medium; Source-confirmed defect, not executed end to end with native process termination. Existing executed autosave tests establish the deferred-write design and its healthy post-delay control.
- **Affected:** iOS and Android most directly; hosted web on crash/forced tab termination. An ordinary web tab close has a warning while `notYetDurable` is true, but that is not a durable write.
- **Relevant code:** the 400 ms window in `src/lib/drafts.ts:12-24`; timer-only queue in `src/lib/autosave.ts:62-76`; editor queue/guard wiring in `src/views/EntryEditor.tsx:726-815,1033-1058`; no-op native guard in `src/platform/native.ts:109-123`; available but editor-unused lifecycle source in `src/platform/app-state.ts:14-49`.

**Trigger.** Type a meaningful change and background the app before `DRAFT_DEBOUNCE_MS` elapses, then have the OS suspend/terminate or the user force-stop the process before the timer callback and storage promise complete. `Autosaver.queue()` holds the only copy in JavaScript memory during that interval. The editor does not subscribe to `appStateChange` or flush on background; the native unsaved-work guard is intentionally a no-op.

Capacitor 8 exposes [`appStateChange`](https://capacitorjs.com/docs/apis/app) on iOS and Android. Apple tells apps to save user data when leaving the foreground and may suspend/terminate background apps ([Preparing your UI to run in the background](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background)); Android documents that stopped processes are eligible for killing and specifically uses saving a draft note during `onStop` as its example ([The activity lifecycle](https://developer.android.com/guide/components/activities/activity-lifecycle#onstop)).

**Expected.** When the platform delivers a background transition, the newest form snapshot should be submitted to durable local storage immediately, and the app should not claim crash-safe recovery until that commit resolves.

**Actual and impact.** The regular timer is the only mechanism that starts the write. If execution ends first, reopening can restore only the previous draft generation—or nothing for a first sentence. The bounded loss is the newest field changes inside the settle window, not the entire journal, but it is still silent loss of accepted writing under the exact background/force-stop scenario this audit was asked to cover.

**Root cause.** Debouncing is treated as the durability boundary, while lifecycle signals already used by App Lock and incoming shares are not connected to the editor/autosaver. The comments accurately acknowledge the loss window, but acknowledgement does not preserve the words.

**Recommended repair.** On a native inactive/background signal, synchronously capture the current form generation and begin an immediate autosaver flush through a lifecycle-aware persistence coordinator; use the platform's appropriate short background execution allowance where needed and surface a recovery warning on the next launch if completion was not confirmed. Keep the normal debounce for foreground typing, and do not rely on `beforeunload` as the save mechanism.

**Regression test.** On physical iOS and Android devices, type into every supported field and background at 0/100/399 ms, then terminate the process before the ordinary timer can run and relaunch. Require exact recovery. Include positive controls after a completed draft write and normal foreground/resume without termination, plus storage-write failure while backgrounding.

**Remaining uncertainty.** A physical-device scheduler/process-kill reproduction was not performed, so this finding does not claim every background transition loses text. Loss requires termination or suspension before the delayed write commits; the reachable undurable interval and absence of a lifecycle flush are established in source.

## Commands and outcomes

Toolchain used: Node `v26.9.0`, npm `11.19.1`, Xcode `27.0 (27A266a)`, Android Studio JBR/OpenJDK `21.0.10`, Android SDK/API 35 emulator with target/compile SDK 36 project configuration.

| Command or operation | Outcome |
|---|---|
| `git rev-parse HEAD`; `git branch --show-current`; `git status --short`; upstream counts | Recorded the commit/branch/state above; original untracked files remained present and unchanged |
| `rg --files`, targeted `rg -n`, `nl`, `plutil`, manifest/resource inspection | Mapped all application, storage, export/import, native integration, test, configuration, and asset paths |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS**, six React-refresh warnings |
| `npm test -- --reporter=dot` (twice) | **FAIL**; deterministic three `__DEBUG_TOOLS__` suite-load errors plus variable UI timeout/state failures; one run had 1,975 passing / 10 failing / 4 skipped |
| Isolated rerun of four UI files that had failed in the full run | **PASS**, 56/56; evidence of contention/order sensitivity, not proof those features are correct |
| `npm run test:profiles` | **FAIL**; public: 1,954 passing of 1,989 collected; refs-only: 1,959 passing of 1,990 collected; 58 reported failures, mostly timeouts |
| Focused storage/export/search Vitest run | **PASS**, 18 files / 627 tests |
| Focused autosave and editor-draft Vitest run | **PASS**, 2 files / 74 tests; healthy delayed persistence, recovery, failure, and ordering controls |
| `npx vitest run scripts/__tests__/ --reporter=dot` | **PASS**, 11 files / 153 tests |
| Temporary `src/audit-repros.test.tsx` | **PASS**, 12/12; exercised save race, draft lifecycle, backup/restore failures, malformed/duplicate imports, Dexie concurrency, and App Lock failure. File removed afterward |
| Temporary `src/__daybreak-node.test.ts` | **PASS**, 2/2; real SQLite concurrent transaction behavior and actual ZIP inflation. File removed afterward |
| Temporary `src/__daybreak-clock.test.ts` | **PASS**, 2/2; real Dexie clock-rollback failure and monotonic positive control. File removed afterward |
| Temporary `src/__daybreak-continuation.test.tsx` | **PASS**, 4/4; real Dexie/application paths for older-draft overwrite, non-atomic export snapshot, malformed known-field loss, and post-open read suppression, with healthy controls. File removed afterward |
| `npm run test:e2e` | **FAIL**, 173 passing / 2 failing after about 14.7 minutes; failures described in LWC-012 |
| Fresh `DATA_PROFILE=public` build to a temporary output plus bundle verifier | **PASS**; public profile verified and debug cleanup absent |
| Current `dist`/native assets build-ID, marker, SHA-256, and APK ZIP inspection | All three current asset trees shared build digest `59fb9e…`; all contained identical `SyntheticCleanup` chunk; APK contained it too |
| Browser serve + Chromium online/offline navigation | Online uncached Notes route passed; offline uncached Notes route failed as LWC-010 describes; current Data page rendered debug cleanup |
| Xcode `App` scheme build for iPhone 17 Pro simulator (iOS 26.5 runtime) | **BUILD SUCCEEDED** |
| Fresh disposable iOS simulator install/launch/terminate/relaunch | **PASS**; app rendered, cold relaunch returned a PID, SQLite file appeared in Documents with schema v2 and expected empty tables/indexes |
| Gradle `testDebugUnitTest lintDebug assembleDebug` under JDK 21 | Unit/assembly produced the APK; overall **FAIL** from one lint error (`android:tint`) and 25 warnings |
| Same Android build attempt under OpenJDK 27 | **FAIL** in JDK image transform; treated as toolchain incompatibility, not a repository product finding |
| `npm run verify:apk -- android/app/build/outputs/apk/debug/app-debug.apk` | **PASS**; 15.7 MB, app ID/routes/widget/scheme and three expected permissions verified |
| APK permission dump | `USE_BIOMETRIC`, `USE_FINGERPRINT`, dynamic-receiver signature permission; no `INTERNET` permission |
| Fresh API 35 emulator install/launch | **PASS with very slow software rendering**; app rendered onboarding/Home and native SQLite initialized at app database path |
| Standard Android `ACTION_SEND text/plain` with `EXTRA_TEXT` | Activity resolved/opened; ordinary app flow appeared, shared text did not reach review/import |
| `npm audit --json` | Five dependency-package findings: 2 high, 3 moderate; applicability analyzed below |
| `npm audit --omit=dev --json` | **PASS**, zero production dependency advisories |
| `npm ls source-map-js brace-expansion uuid --all` | Located exact build/test/CLI-only dependency paths described below |

The temporary reproduction harnesses imported and drove the real application modules/providers; they were not replacement models. The Node SQLite bridge substituted only the Capacitor transport around real SQLite and is labeled as limited native evidence where used.

## Dependency and security advisory review

The current npm advisory result is not counted as a shipped runtime vulnerability. `npm audit --omit=dev` reports zero, and source/bundle inspection did not establish a route from journal content to these tooling APIs. They should still be updated because CI/build inputs can be untrusted and because advisory status changes.

| Package/path | Advisory and installed exposure | Applicability at audited commit |
|---|---|---|
| `source-map-js@1.2.1` via Tailwind/Vite/PostCSS and jsdom | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), High; event-loop DoS from crafted indexed source-map offsets; fixed in 1.2.2 | Build/test dependency. No runtime package path or processing of user journal source maps found |
| `brace-expansion@1.1.18` via ESLint JSX a11y; `5.0.9` via TypeScript-ESLint | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p); quadratic/recursive DoS | Lint/type tooling. No application runtime glob expansion. A separate `5.0.12` path is already patched |
| `uuid@7.0.3` through `xcode@3.0.1` -> `@capacitor/cli@8.5.2` | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), Moderate; supplied-buffer bounds issue in UUID v3/v5/v6 | Native project-generation CLI. No route for untrusted user buffers and no packaged runtime use established |

Recommended disposition: update/override to patched transitive versions where compatible, rerun native project generation/build verification, and keep the production-only audit at zero. Do not describe the current five as journal-data remote exploits.

## Safeguards verified and hypotheses ruled out

The following checks produced useful negative evidence and are not findings:

- **No native fallback store.** SQLite selection/open failure renders `StorageUnavailable`; it does not redirect writes to WebView IndexedDB or recreate the database.
- **Entry replacement itself is atomic.** Dexie wraps clear + bulk put in one transaction; SQLite wraps delete + all entry writes. LWC-003 is the missing cross-store draft atomicity, not a failure of those entry transactions.
- **Migration structure is sound in the exercised cases.** Fresh schema, v1-to-v2 preservation, broken-step rollback, reopen, and schema-too-new refusal passed against real SQLite. Fresh iOS schema v2 was observed.
- **Foreign keys and indexes are declared correctly.** Native open enables `PRAGMA foreign_keys=ON` per app connection. Fresh iOS tables/indexes matched the ledger. An external inspection connection reporting foreign keys off does not invalidate the app connection setting.
- **Import parses before mutation.** Bad JSON, truncated ZIPs, checksum mismatch, manifest mismatch, and duplicate ZIP member paths are rejected before storage mutation in existing tests. LWC-008 concerns records the parser accepts as valid.
- **No archive path traversal extraction.** Journal ZIP members stay in memory; no member pathname is written to disk. Resource exhaustion remains LWC-009.
- **Healthy static archive fidelity passed.** With no overlapping mutation, entries, drafts, whitespace, Unicode, rich formatting, source material/provenance, scripture references, tags, dates, Markdown, readable HTML, and CSV round trips passed focused tests. Attachments are not a supported domain field in this version. LWC-018 is the distinct concurrent-snapshot failure.
- **Output injection defenses exist.** Markdown is rendered through React nodes without raw HTML execution, unsafe URL schemes are filtered, HTML output escapes content, and spreadsheet cells receive formula-injection protection.
- **Search's old Unicode hypothesis is not a current user-facing defect.** The existing untracked adversarial report noted storage-provider text matching, but current `SearchView` reads entries and uses `src/lib/journal-search.ts`, including NFKD/accent normalization. Focused search tests passed. The unused provider query API remains semantically inconsistent but no production trigger was found.
- **Dates are preserved as local journal dates in exercised exports.** Invalid dates are rejected or shown as undated rather than shifted. Leap/timezone-oriented tests passed. The distinct clock-causality issue is LWC-007.
- **No runtime tracking or automatic journal transmission found.** No analytics/crash SDK or production network client was found; native assets are local, bridge logging is disabled, and Android lacks Internet permission. User-opened links, outgoing shares, exports, and OS backups are explicit boundaries.
- **Android backup rules are intentional.** Backup is enabled for journal recovery while App Lock preferences are excluded. App Lock is explicitly presented as a screen lock, not database encryption.
- **Share defaults minimize disclosure.** Existing single-entry outgoing share defaults omit reflection/prayer unless selected. This does not cure the incoming text-share defect.
- **Current native launch paths are real SQLite.** iOS simulator inspection and Android emulator logs located `journeySQLite.db`; neither runtime claim is inferred from browser behavior.
- **Existing reports were not trusted as proof.** `LIFE-WITH-CHRIST-ADVERSARIAL-AUDIT.md` was reviewed only after independent mapping/reproduction. Its applicable conclusions were rechecked, and its older “Android build unavailable” limitation was superseded by the JDK 21 build/emulator run.

## Prioritized repair order

1. **Prevent direct writing loss (LWC-001, LWC-019).** Add generation-aware Save/draft retirement and lifecycle-triggered durability before any release or broader refactor.
2. **Make backup and recovery truthful (LWC-002, LWC-003, LWC-014, LWC-018).** A journal cannot be passed on if “full” omits drafts, captures a mixed/old revision, restore is partial, or “Saved” has no committed file. Implement atomic snapshot/restore contracts and a three-state delivery result.
3. **Fail App Lock closed on Android (LWC-005).** Separate unsupported capability from security-service failure and honor native persistence return values.
4. **Block debug artifacts at the final release boundary (LWC-011).** Rebuild every target cleanly, verify final APK/IPA/site bytes, and discard the currently marked artifacts as release candidates.
5. **Give storage operations concurrency and error semantics (LWC-006, LWC-013).** Serialize transactions, add revision/conflict handling, and expose read failure rather than empty data.
6. **Harden import before mutation (LWC-007, LWC-008, LWC-009).** Add content-aware conflicts, complete runtime schema/uniqueness validation, and bounded streaming reads.
7. **Repair draft ownership/deletion (LWC-004).** Preserve `entryId` through resume and define atomic deletion semantics.
8. **Align product promises with platforms (LWC-010, LWC-016, LWC-017).** Make hosted offline real or qualify it, consume/remove Android text shares, and disclose/choose iOS backup behavior.
9. **Restore trustworthy gates and diagnostics (LWC-012, LWC-015).** Make all required matrices deterministic/green and distinguish picker cancellation from failure.

## Unresolved release risks and verification gaps

- No physical iPhone or Android device was available. Simulator/emulator results do not prove flash-storage durability, real lifecycle kill timing, biometric recovery, hardware-backed keystore behavior, or OEM WebView behavior.
- Force-stop/process-kill was not injected at every SQLite transaction, migration, explicit Save, draft write, export close, and restore statement. Transaction structure is favorable, but LWC-001 proves an application-level loss without a kill and LWC-019 identifies the unexecuted native settle-window risk.
- Real disk-full, IndexedDB quota eviction, storage corruption, and OS-level database I/O failures were not safely induced. LWC-013 describes the confirmed application response to the resulting rejection, not the probability of those causes.
- Android SAF and iOS document pickers were not exercised against slow, remote, revoked, or failing providers. Export-close and picker-error findings therefore remain source-confirmed.
- No real iCloud, Finder, or Android cloud backup/restore was performed. Backup inclusion rules and iOS default eligibility were inspected; end-to-end recoverability and disclosure still need device evidence.
- Hosted web was run in Chromium, not Safari or Firefox. The absence of a service worker makes the uncached-route failure architectural, but browser-specific download behavior remains to test.
- Very large real journals, hours-long entries, extreme tag/reference counts, and low-memory physical devices were not benchmarked. Existing unit/E2E coverage and the 24 MiB inflation probe are not performance certification.
- Native incoming-share positive control with a real content provider was not run, nor were Android widget/shortcut actions exercised by touch on hardware. Their source/unit checks and APK declarations passed.
- Native printing is intentionally unavailable and was not counted as broken. Browser readable/print HTML was tested in code, not sent to a physical printer.
- VoiceOver, TalkBack, hardware keyboard, IME composition, and mobile split-screen were not manually exercised. Automated accessibility/reflow coverage was broad but had the two gate failures recorded in LWC-012.
- No deployed website, store-signed APK/AAB, IPA, TestFlight build, or store listing was supplied. The debug-tool conclusion applies to the current local artifacts; public exposure history is unknown.
- Dependency results are a 2026-10-11 snapshot. Re-run authoritative audits and review release notes immediately before shipping.

## Release assessment

The core local-first architecture is genuine: native builds require SQLite, browser builds use IndexedDB, essential native assets are bundled, and no hidden account/telemetry service was found. The migration and archive-integrity foundations are stronger than a superficial audit would suggest.

The current build is nevertheless **not release-ready for a preservation-focused journal**. LWC-001 can silently discard newly typed words during an ordinary Save, and LWC-019 leaves the newest debounce-window changes exposed to background termination. LWC-002/LWC-003/LWC-014/LWC-018 allow incomplete, inconsistent, or uncommitted backups to be presented as successful. LWC-005 defeats the Android privacy gate precisely when its state service fails. Those must be fixed and tested on real platform providers. The current debug-bearing assets must also be invalidated and rebuilt behind a final-artifact gate before any distribution.




