# LIFE-WITH-CHRIST-ADVERSARIAL-AUDIT.md

Audit date: 2026-10-09  
Audited commit: `03a2722564af0daf7d1d367acb7a1d38296129e7`  
Disposition: **Not ready for release as a repository people can safely trust with irreplaceable writing.**

## Executive Summary

Life With Christ has a better data-safety foundation than most early-stage local-first applications. Native builds select SQLite and fail closed instead of silently falling back to WebView IndexedDB. Entry replacement and batch import are transactional. SQLite migrations advance their version inside the same transaction as the schema change. The archive has a manifest, canonical JSON, human-readable Markdown/CSV/HTML, and healthy-input round trips preserve entries and drafts. Imported Markdown is rendered as React text rather than raw HTML. Android requests no Internet permission, Capacitor bridge logging is disabled, and the native bundles are local.

Those strengths are not enough to answer the primary question positively. **A user cannot yet safely trust this commit with years of irreplaceable journaling.** Five P1 defects are release blockers:

1. Text typed after Save is pressed but before the write completes is discarded even though the UI announces “Saved.”
2. A full backup silently succeeds without drafts when reading drafts fails, and then resets the backup reminder.
3. Restore silently succeeds when every draft write fails, after journal entries have already been replaced or merged.
4. Browser export treats “download initiated” as “file saved,” reports success, and resets the backup reminder even though the browser exposes no completion result.
5. Android App Lock fails open if its initial native state read fails; a listener-attachment failure can also prevent re-locking on resume.

Thirteen additional defects were established. The most important are non-atomic entry/draft replace semantics, duplicate creation when Home resumes a draft belonging to a saved entry, orphan drafts after deletion, multi-tab lost updates, wall-clock rollback allowing an older archive to overwrite newer words, duplicate-ID collapse during import, unbounded journal ZIP inflation, persistent failure from weakly validated imported drafts, and a browser offline claim contradicted by lazy route loading.

No P0 was established. In particular, healthy single-writer entry writes, SQLite transaction rollback, reopen, schema migration, and representative export/import round trips performed correctly in the environments tested. That is meaningful positive evidence, but it does not make the acknowledged-save and backup/restore defects acceptable.

## Audit Provenance

- **Repository:** `/Users/gmcas/repos/my-life-with-christ`
- **Remote:** `https://github.com/systemslibrarian/my-life-with-christ.git`
- **Branch:** `ios/native-entry-sharing`
- **Commit:** `03a2722564af0daf7d1d367acb7a1d38296129e7`
- **Commit date/title:** `2026-10-06T05:17:11-04:00 feat(debug): add a gated way to clear acceptance leftovers`
- **Audit date/time zone:** 2026-10-09, America/New_York
- **Original worktree:** clean before and after the audit; no tracked application or test file was changed.
- **Isolation:** write-producing builds and temporary audit harnesses ran in `/tmp/lwc-audit.5EJEBa/repo`, a disposable copy. The only retained audit artifact is this report.
- **Host:** macOS 26.6.2, Apple M5 MacBook Air, 10 cores, 16 GB RAM.
- **Tools:** Node 26.9.0, npm 11.19.1, TypeScript 5.9.3, Vitest 5.0.0, Playwright 1.63.0, Xcode 27.0 (27A266a), Swift 6.4, Homebrew OpenJDK 27.
- **Primary platforms examined:** browser/Chromium, Android source/build configuration, iOS source and simulator compilation.
- **Real devices tested by this audit:** none. Historical device-test documentation in the repository was read but was not treated as fresh runtime evidence.

### Existing checks executed

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS with 6 Fast Refresh warnings; no errors |
| `npm test` | **FAIL**: 3 suites fail at import; 122 suites pass, 1,985 tests pass, 4 profile-gated tests skip |
| `npx vitest run scripts/__tests__/` | PASS: 11 files, 153 tests |
| SQLite node adapter suite | PASS: 75 tests, including migrations, reopen, rollback and provider contract |
| Archive round-trip suites | PASS: 4 files, 48 tests |
| Refs-only build, privacy/bundle/startup gates | PASS |
| Public build, privacy/bundle/startup gates | PASS; startup chunk 451,362 bytes; outline chunk about 701 KB |
| Refs-only Playwright sweep | PASS: 175 tests in 10.7 minutes |
| Public Playwright sweep | PASS: 175 tests in 10.4 minutes |
| Native public asset build/sync and copied-asset verification | PASS for Android and iOS outputs |
| iOS `App` simulator compile | PASS |
| iOS `ShareUITests` target compile | PASS; UI tests were not executed |
| Android `test lint assembleDebug` | NOT VERIFIED: OpenJDK 27 failed in the Android JDK-image transform; repository specifies JDK 21 |
| `npm audit --omit=dev` | PASS: zero production advisories |
| Full `npm audit` | 5 development/build-tool advisories: 2 high, 3 moderate; no shipped production dependency path established |

### New adversarial checks executed

Seventeen temporary tests were added only to the disposable copy and then run:

- Ten UI/storage fault-injection tests reproduced save-in-flight loss, draft omission on backup, draft omission on restore, duplicate import IDs, unbounded ZIP inflation, malformed draft acceptance, App Lock fail-open, clock rollback conflict inversion, duplicate draft resume, and orphan drafts after deletion.
- Three storage tests ran a deterministic 180-operation IndexedDB/SQLite differential sequence, reproduced a two-writer lost update, and reproduced Unicode-normalization search failure.
- Two performance tests measured 100, 1,000, 10,000 and 50,000 entry storage/search behavior and archive construction through 10,000 entries.
- One built-browser offline test cut connectivity after Home loaded and reproduced failure to open the uncached journal editor.
- One browser termination test performed repeated acknowledged edits, page termination/reopen, settled-draft recovery, and immediate termination after dispatching a save. The last acknowledged version survived; the interrupted unacknowledged save left the prior complete version, not a partial record.

The temporary fault-injection and differential suites passed their reproduction assertions: 13 tests across the two principal files. The two performance tests, offline reproduction, and termination test also passed their stated assertions.

### Unsupported or unavailable checks

- Android compilation, Android lint, APK inspection, and Android unit tests under the documented JDK 21 toolchain.
- Actual Android/iOS process kill at every SQLite transaction stage, power loss, filesystem I/O failure, full disk, OS low-memory kill, and device reboot.
- Actual device upgrade/downgrade, uninstall/reinstall, Android cloud restore, iCloud device restore, and storage-protection inspection on a physical device.
- VoiceOver and TalkBack sessions, real mobile keyboard/IME composition, rotation, split view, font-size extremes at the OS layer, and biometric/device-credential recovery.
- Safari and Firefox behavior; browser E2E used Chromium.
- Execution of the iOS Share UI test; only its target compiled.
- Independent textual comparison of every KJV verse against a separate authoritative edition. Structural completeness was verified against the bundled versification.
- Native ecosystem vulnerability scanners, full historical secret scanning, and mutation testing.

## Actual Architecture and Data Flow

### Implemented architecture

- React 19 + TypeScript + Vite single-page application with a custom hash router and lazy route chunks.
- Capacitor 8 shell shared by Android and iOS, with `@capacitor/app`, `@capacitor-community/sqlite`, and an in-repository `JourneyDocuments` bridge.
- Browser authority: Dexie over IndexedDB database `journey`; schema v1 has entries/settings and v2 adds drafts.
- Native authority: Capacitor SQLite logical database `journey`, schema version 2, explicitly opened with `encrypted: false` and `mode: 'no-encryption'`.
- Native selection is fail-closed: native requires SQLite; browser requires IndexedDB. No native fallback to IndexedDB was found.
- Entries are canonical records. Drafts are separate whole-form recovery snapshots. SQLite stores canonical entry/draft JSON plus derived query columns/tables.
- Bundled KJV data is lazy-loaded one book per chunk. Topics, section outlines, and versification are also bundled according to the build profile.
- Full export is a ZIP containing canonical JSON, schema, manifest/checksums, CSV, per-entry Markdown, indexes, and a self-contained HTML book.
- Journal restore accepts that ZIP or bare canonical JSON. External note import accepts text, Markdown, DOCX, and text PDFs. Church-note import also accepts its documented JSON shape.
- Native document save/open and single-entry sharing use OS pickers/share sheets. Browser save uses an anchor download.
- Android implements an optional App Lock. iOS and browser accurately hide that unsupported capability.

### Data-flow map

```text
Editor form
  ├─ every meaningful change ──400 ms debounce──> Draft snapshot
  │                                                ├─ browser: IndexedDB.drafts
  │                                                └─ native: SQLite drafts
  └─ explicit Save ──flush draft──> create/update canonical Entry
                                                   ├─ browser: IndexedDB.entries
                                                   └─ native: SQLite entries + anchor index

Storage selection
  Capacitor native? ──yes──> SQLite (fail closed if unavailable)
                    └─no───> Dexie / IndexedDB

Full export
  entries + drafts ──> canonical JSON + Markdown/CSV/indexes/book
                    ──> ZIP + MANIFEST/SHA-256
                    ──> browser download OR native OS document saver

Restore
  picked bytes ──> ZIP read ──> manifest verification ──> schema migration
               ──> preview/confirmation ──> atomic entry replace or batch merge
                                          └─> separate per-draft writes

External/church notes
  file/share bytes ──> bounded text/DOCX/PDF/JSON parser ──> review surface
                   ──> one canonical entry with attributed sourceMaterial

Bible
  local lazy chunk per book ──> reference resolution/read views
  local journal entries ──────> reference/topic/journal search and navigation
```

The critical architectural distinction is real and correctly enforced: browser IndexedDB and native SQLite are different authoritative stores. The defect findings below do not depend on an accidental native IndexedDB fallback; no such fallback was found.

### Implemented, partial, and absent capabilities

- **Implemented:** journal CRUD, recovery drafts, Bible reading, references/topics/section-title and journal search, timeline, settings, full/partial export, archive restore, external note import, church-note import, native document pick/save, entry sharing, Android lock, Android launcher shortcut/widget.
- **Partial:** native printing is deliberately absent; Android App Lock has no iOS counterpart; browser offline installation/caching is not implemented.
- **Absent/not claimed:** account/sync/backend, OCR, QR transfer, a companion browser application, and full-text search over all KJV verse words. Their absence is not reported as a code defect.

## Coverage Matrix

“Fully inspected” means the production path, its tests, and relevant configuration/history were read and at least one applicable executable check was run. It does not mean every physical-device condition was reproduced.

| Subsystem | Coverage | Basis |
|---|---|---|
| Repository/config/dependencies/CI | Fully inspected | Package scripts, configs, workflows, dependency tree/audit, generated-asset gates and relevant history inspected |
| React routing/navigation/shell | Fully inspected | Source review plus both 175-test browser profile sweeps |
| Journal create/edit/delete/drafts | Fully inspected | Source, unit/E2E, fault injection, termination and race tests |
| Storage abstraction | Fully inspected | Interface and every browser/native implementation reviewed |
| Dexie/IndexedDB | Fully inspected in Chromium/Node | Contract, adversarial, differential and termination tests; other browsers not run |
| SQLite/schema/migrations | Fully inspected in source and Node SQLite | 75 adapter tests and differential tests; physical plugin/runtime only partially verified |
| Export/archive | Fully inspected | Source, 48 focused round-trip tests, manifest checks, malformed/oversized input tests |
| Import/restore | Fully inspected | Source, healthy round trip, failure injection, duplicate and malformed record tests |
| External/church note import | Fully inspected | Parser/render/commit paths and security tests reviewed; no live hostile PDF engine fuzzing |
| Bible structure/navigation | Fully inspected structurally | 66 books, 1,189 chapters, 31,102 verses; app tests and custom structural verifier |
| Exact KJV wording | Partially inspected | Bundled content readable and structurally complete; no independent verse-by-verse textual authority used |
| Journal/reference/topic search | Fully inspected | Source/tests plus Unicode adversarial test |
| Browser offline | Fully inspected for Chromium | Cold/offline architecture and post-load lazy-route failure tested |
| Native offline | Partially inspected | Local bundle/no server/Android no-Internet evidence; no fresh airplane-mode real-device run |
| Android | Partially inspected | Java/resources/manifest/Gradle reviewed; build blocked by host JDK; no device run |
| iOS | Partially inspected | Swift/plist/project reviewed; app and UI-test targets compile; no simulator/device runtime run |
| Lifecycle/process death | Partially inspected | Browser termination and Node transaction/reopen tests; native kill/low-memory unavailable |
| Security/privacy | Fully inspected statically, partially dynamically | Import/XSS/network/storage/backup/logging review; no mobile penetration or cloud-restore test |
| Accessibility | Partially inspected | Automated axe, contrast, keyboard and reflow E2E passed; no VoiceOver/TalkBack session |
| Performance/long-term scale | Partially inspected | Node/fake-IndexedDB measurements through 50k and export through 10k; no low-end device profile |
| Relevant Git regression history | Fully inspected | Approximately 40 relevant commits/blames reviewed; resolved issues were not re-reported |
| QR/companion application | Not applicable | No implementation or current claim found in this repository |

## Findings Summary

| ID | Severity | Confidence | Platform | Subsystem | Finding |
|---|---|---|---|---|---|
| LWC-001 | HIGH — P1 | High; CONFIRMED BUG | All | Editor/data integrity | Typing during an in-flight Save is discarded after “Saved” |
| LWC-002 | HIGH — P1 | High; CONFIRMED BUG | All | Backup | Full backup silently omits drafts when the draft read fails |
| LWC-003 | HIGH — P1 | High; CONFIRMED BUG | All | Restore | Restore reports success after every draft write fails |
| LWC-004 | HIGH — P1 | High; CODE-PROVEN DEFECT | Browser | Backup/file save | Download initiation is treated as a verified saved backup |
| LWC-005 | HIGH — P1 | High; CONFIRMED BUG | Android | App Lock/privacy | Native state or listener failure can leave the journal unlocked |
| LWC-006 | MEDIUM — P2 | High; CONFIRMED BUG | Hosted browser | Offline | An uncached editor cannot open after network loss despite in-app offline wording |
| LWC-007 | MEDIUM — P2 | High; CONFIRMED BUG | All | Replace restore | Replace mode keeps all pre-existing drafts while saying everything was deleted |
| LWC-008 | MEDIUM — P2 | High; CONFIRMED BUG | All | Draft recovery | Home resumes a saved-entry draft as a new entry and creates a duplicate |
| LWC-009 | MEDIUM — P2 | High; CONFIRMED BUG | All | Delete/drafts | Deleting an entry leaves its recovery draft and private text behind |
| LWC-010 | MEDIUM — P2 | High; CODE-PROVEN DEFECT | All | Storage/UI | Post-open read errors are silently rendered as empty or stale data |
| LWC-011 | MEDIUM — P2 | High; CONFIRMED BUG | Browser | Concurrency | Two acknowledged writers lose one update |
| LWC-012 | MEDIUM — P2 | High; CONFIRMED BUG | All | Timestamps/merge | Clock rollback lets an older archive overwrite a later edit |
| LWC-013 | MEDIUM — P2 | High; CONFIRMED BUG | All | Import validation | Duplicate entry IDs are counted twice and silently collapse to one record |
| LWC-014 | MEDIUM — P2 | High; CONFIRMED BUG | All | Import/resource limits | Journal archives and generic native/browser picks are unbounded before parsing |
| LWC-015 | MEDIUM — P2 | High; CONFIRMED BUG | All | Import validation | Weak draft validation accepts a persistent render-crashing draft |
| LWC-016 | LOW — P3 | High; CONFIRMED BUG | All | Search/Unicode | Canonically equivalent Unicode text does not match |
| LWC-017 | LOW — P3 | High; CONFIRMED BUG | CI/test tooling | The default unit suite and CI test jobs fail before three suites run |
| LWC-018 | LOW — P3 | High; CODE-PROVEN DEFECT | All | File import UX | Picker/read failures are silently treated as user cancellation |

## Critical and High Findings

No critical/P0 finding was established.

### LWC-001 — Text typed during an in-flight Save is discarded after “Saved”

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** HIGH — P1; browser, Android and iOS shared editor; high confidence.
- **Location and function:** `src/views/EntryEditor.tsx:790-815`, `handleSubmit` at `1280-1382`, editable Notes at `1787-1796` (the same pattern applies to the other enabled fields).
- **Root cause:** `handleSubmit` snapshots `form` before awaiting the draft flush and canonical storage write. The form remains editable while `saving` is true. Later keystrokes queue a newer draft, but successful completion retires the autosaver, deletes the current draft, changes the canonical baseline to the older saved record, announces “Saved,” and navigates/remounts.
- **Preconditions:** A storage write is slow enough for the user to type after pressing Save but before it resolves. Native bridge latency, a busy device, or storage pressure makes this realistic.
- **Reproduction:** In the isolated harness, delay `createEntry`; type `version acknowledged by submit`; press Save; while the button says `Saving…`, change Notes to `newer words typed during save`; release the write.
- **Expected:** Either editing is disabled/frozen until save completion, or the later text remains a durable draft and is not covered by the success acknowledgement.
- **Observed behavior/consequence:** The canonical entry contains the older submit snapshot, the newer text is still momentarily visible, the draft list is empty, and the editor reports success. In the real routed app, the ensuing remount replaces the screen with the older canonical record.
- **Evidence:** The adversarial test asserted all three states: stored old text, visible new text, zero drafts. Lines 1333-1352 explicitly retire/delete the draft, and lines 1369-1382 navigate after announcing success.
- **User impact:** Recent words can disappear immediately after a successful Save, the exact failure state a journaling app must not create.
- **Suggested remediation:** Establish an immutable save generation. Disable fields during save, or compare the current form/generation after the write and preserve/flush any newer generation before deleting the draft or navigating. “Saved” must identify the version actually on screen.
- **Recommended regression test:** Pause each storage operation in create and update flows; type during every await; assert that every version covered by a success acknowledgement is durable and any later version remains as a draft across remount/restart.

### LWC-002 — Full backup silently omits drafts when their read fails

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** HIGH — P1; all platforms; high confidence.
- **Location and function:** `exportEverything`, `src/export/download.ts:63-100`, especially line 78; success UI `src/views/DataView.tsx:232-256`.
- **Root cause:** Full export executes `storage.listDrafts().catch(() => [])`. It converts storage failure into a valid empty draft list, then saves the archive and updates `lastExportAt`.
- **Preconditions:** Entries remain readable but the draft store/query fails because of corruption, bridge failure, disk error, or a transient provider problem.
- **Reproduction:** Use a provider whose entry list succeeds and whose `listDrafts` throws; invoke full export with a successful saver; inspect `data/journey.json` and settings.
- **Expected:** Full backup fails loudly, writes no misleading success state, and leaves the backup reminder unchanged.
- **Observed behavior/consequence:** The archive was saved with its entry but no `drafts`, `saved` was true, and `lastExportAt` was set. The UI would say the backup was saved.
- **Evidence:** Reproduced by the temporary adversarial test. The code comments at lines 70-76 explicitly promise that recent unfinished words ride along, making the catch-to-empty behavior internally contradictory.
- **User impact:** The newest unsaved writing can be absent from the file the user relies on as a complete backup, while the app suppresses the reminder to try again.
- **Suggested remediation:** Do not catch a full-export draft read as empty. Treat entries plus drafts as one required snapshot and fail before calling the saver. Report which part could not be read without exposing content.
- **Recommended regression test:** Fault-inject every entries/drafts/settings read; prove no file, success message, or `lastExportAt` update occurs unless the complete promised snapshot was obtained.

### LWC-003 — Restore reports success after every draft write fails

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** HIGH — P1; all platforms; high confidence.
- **Location and function:** `applyImport`/`restoreDrafts`, `src/export/importer.ts:214-260`; success and preview UI `src/views/DataView.tsx:368-385` and `750-759`.
- **Root cause:** Entries are committed first. Draft restoration then performs independent `putDraft` calls and swallows every rejection. The result object has no failed-draft count and the UI always emits a green success message based only on entries.
- **Preconditions:** A valid archive contains drafts, entry restore succeeds, and draft writes fail (disk full, corrupt draft table, plugin error, or quota).
- **Reproduction:** Apply a replace import containing one entry and one draft to a provider whose `putDraft` always throws.
- **Expected:** The user is told restore was incomplete; ideally entries and drafts stage and commit atomically, or the original logical journal remains intact.
- **Observed behavior/consequence:** The result reports `{ imported: 1, replaced: true }`; the new entry is committed; no incoming draft exists; no error/warning is returned. The UI path announces successful replacement.
- **Evidence:** Reproduced with all draft writes forced to `disk full`. Source lines 257-260 unconditionally catch and discard the failures.
- **User impact:** An archive can contain recoverable recent writing that is silently lost during restore. Replace mode can simultaneously remove the prior entry set.
- **Suggested remediation:** Add a provider-level atomic restore operation covering entries and drafts, or stage/validate all writes before swapping. At minimum, collect draft failures, keep the pending import visible, avoid an unconditional success banner, and give a retry/recovery path.
- **Recommended regression test:** Inject failure at every draft ordinal in merge and replace modes for both providers; assert either complete logical rollback or an explicit incomplete result preserving recoverable source data.

### LWC-004 — Browser download initiation is treated as a verified saved backup

- **Classification:** CODE-PROVEN DEFECT
- **Severity / platform / confidence:** HIGH — P1; hosted browser; high confidence.
- **Location and function:** `webFileSaver.save`, `src/platform/web.ts:37-60`; backup state update `src/export/download.ts:81-98`; success wording `src/views/DataView.tsx:238-250`.
- **Root cause:** After synthetic anchor click, the adapter always returns `{ saved: true }`. Its own comment correctly states that the browser supplies neither completion nor cancellation signal. The caller nevertheless interprets that value as filesystem acceptance, records `lastExportAt`, and says “Saved.”
- **Preconditions:** Browser download is blocked, canceled, fails, targets an unavailable destination, or is otherwise not retained.
- **Reproduction:** Follow the source path after `link.click()`; no subsequent browser event can change the result. Cancellation could not be reliably automated because that missing signal is the defect.
- **Expected:** The app distinguishes “download started” from “backup verified saved” and does not reset a safety reminder on an unverifiable outcome.
- **Observed behavior/consequence:** All browser anchor-download outcomes are mapped to a verified success state.
- **Evidence:** Lines 53-58 explicitly document the limitation, while line 59 returns true. Lines 93-97 then update backup settings on that value.
- **User impact:** A person can be told their only independent copy exists when it does not. Later browser data loss can then become total journal loss.
- **Suggested remediation:** Change the web result contract to `initiated`/`unverified`, use a save API with a completion result where supported, require explicit user confirmation before marking a backup complete, or leave `lastExportAt` unchanged on anchor downloads.
- **Recommended regression test:** Cover blocked/canceled/unverifiable browser downloads and assert no “Saved” wording or backup-reminder reset. Keep separate native tests for genuine picker cancellation/completion.

### LWC-005 — Android App Lock can fail open

- **Classification:** CONFIRMED BUG for initial state failure; CODE-PROVEN DEFECT for listener attachment failure.
- **Severity / platform / confidence:** HIGH — P1; Android; high confidence.
- **Location and function:** `AppLockProvider`, `src/app/app-lock.tsx:107-145` and `147-182`; lifecycle adapter `src/platform/app-state.ts:28-48`; supported native adapter `src/platform/app-lock.ts:103-116`.
- **Root cause:** Any rejection from the initial `getState()` is converted into a synthetic disabled/unlocked state, without considering that the selected Android adapter declares `supported: true`. Separately, failure to import the App plugin or attach the lifecycle listener is swallowed, leaving no event that can re-lock an already unlocked session.
- **Preconditions:** App Lock is supported and enabled, then the native bridge/state call or lifecycle listener fails during startup/resume.
- **Reproduction:** Render the gate with a `supported: true` App Lock whose `getState` rejects. The protected child renders instead of the lock screen.
- **Expected:** A supported lock fails closed: private content stays hidden and the user receives a recoverable platform-error screen. Unsupported platforms should be the only adapters that explicitly resolve disabled.
- **Observed behavior/consequence:** The adversarial test rendered `private journal` and no lock screen. A listener-attachment rejection at `app-state.ts:42` is also silently discarded; because callbacks at `app-lock.tsx:150-181` are the only re-lock trigger, resume may remain unlocked.
- **Evidence:** Direct runtime reproduction plus the unambiguous source path. Android is the only platform to select `nativeAppLock`; iOS/browser use an explicitly unsupported adapter.
- **User impact:** Sensitive journal content may be exposed to whoever opens or resumes the device while the protection the user enabled has failed internally.
- **Suggested remediation:** Branch on capability: when `supported` is true, all state/lifecycle failures must lock and show a retry/recovery state. Make listener setup report readiness/failure and lock on failure. Add telemetry only if it remains local and content-free.
- **Recommended regression test:** Test initial/retry/resume failures for every native call and listener stage. Assert protected descendants and storage never mount until a valid disabled state or successful unlock is obtained.

## Medium and Low Findings

### LWC-006 — Hosted browser cannot open an uncached editor after network loss

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; hosted browser; high confidence.
- **Location/function:** lazy routes `src/App.tsx:19-38`; boundary wording `src/app/SectionsBoundary.tsx:51-67`; in-app claim `src/views/HelpView.tsx:274-281`.
- **Root cause:** Route code is split into network-loaded chunks and there is no service worker or installable manifest. The generic boundary also mislabels any lazy-route chunk failure as Bible-data failure.
- **Preconditions:** Home/startup resources are loaded, connectivity is then disabled, and a not-yet-cached editor route is opened.
- **Reproduction:** Load the public build Home, set the Chromium context offline, then click “Sermon note.”
- **Expected:** If the in-app statement that reading and writing work with no network is retained, the editor opens from a local cache; otherwise the claim must be scoped to installed native editions.
- **Observed/evidence:** The built app showed `This page could not be loaded`, no Notes textbox, and misleading text saying the failure concerned Bible data. README line 169 accurately admits browser offline support is not built, contradicting the in-app Help claim.
- **User impact:** A browser user may be unable to begin or continue writing during an outage after being told they can.
- **Remediation:** Add a version-safe offline cache for all critical journal chunks, or explicitly scope offline promises to installed editions and make chunk errors accurate.
- **Regression:** Cold-cache offline matrix for every critical route, including editor, saved entries, search, Bible and data/export.

### LWC-007 — Replace restore retains pre-existing drafts

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** `replaceEntries` in `src/storage/db.ts:141-147` and `src/storage/sqlite.ts:625-632`; `applyImport`/`restoreDrafts` `src/export/importer.ts:222-260`; wording `src/views/DataView.tsx:375-378`.
- **Root cause:** Replace mode atomically replaces only entries. It never clears drafts; incoming drafts are merely upserted afterward.
- **Preconditions:** Existing drafts are present and the user selects replace restore.
- **Reproduction:** Seed an old entry and old draft; replace with a new archive; list both stores.
- **Expected:** The confirmed replace operation replaces the complete journal state promised by the UI, including recovery drafts, or clearly describes a narrower operation.
- **Observed/evidence:** Old entries were removed, the new entry was written, and the old draft remained. UI says “everything that was here before was deleted.”
- **User impact:** Private writing thought removed remains recoverable/exportable, can point to nonexistent entries, and can later become a duplicate through LWC-008.
- **Remediation:** Define one atomic `replaceJournal(entries, drafts)` operation for both adapters and update wording/contracts together.
- **Regression:** Seed unrelated and colliding drafts; replace; assert exact canonical equality of entries and drafts or full rollback on every injected failure.

### LWC-008 — Home resumes a saved-entry draft as a new entry

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** draft query/link `src/views/HomeView.tsx:271-277` and `382-412`; editor routing `src/views/EntryEditor.tsx:817-818`, `845-867`, `889-925`; create path `1329-1331`.
- **Root cause:** Home ignores `draft.entryId` and always links to `newEntry?draft=<id>`. The new-entry editor intentionally has no canonical target, so Save calls `createEntry`.
- **Preconditions:** A saved entry has a recoverable edit draft and Home offers Continue.
- **Reproduction:** Seed canonical entry `same-id` plus draft `draft-1` with `entryId: same-id`; follow Home’s Continue link and save.
- **Expected:** Resume routes to the saved entry and updates it, retaining its identity and relationships.
- **Observed/evidence:** The link was `#/entry/new?draft=draft-1`; saving kept the original and created a second entry with the draft text.
- **User impact:** The timeline gains divergent duplicates; later edits/export/import cannot know which is authoritative.
- **Remediation:** Route drafts with `entryId` to `{ name: 'entry', id }`; only drafts without one should use `newEntry`. Reject mismatched draft/entry combinations.
- **Regression:** Cover Home resume for new drafts, existing-entry drafts, missing parent entries, and malicious mismatches.

### LWC-009 — Entry deletion leaves its draft and private text behind

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** `handleDelete`, `src/views/EntryEditor.tsx:1428-1445`; irreversible wording `2615-2624`; draft schema without parent constraint `src/storage/sqlite.ts:171-180`.
- **Root cause:** Delete removes only the canonical entry. It neither retires/deletes the active draft nor asks the provider to cascade drafts by `entryId`.
- **Preconditions:** Edit an existing entry enough to create an autosaved draft, then confirm deletion.
- **Reproduction:** Seed an entry, type new Notes, wait for the draft, delete, then list entries and drafts.
- **Expected:** “Delete this entry for good” removes the canonical entry and recovery state belonging to it, atomically.
- **Observed/evidence:** Entry count became zero while one draft remained with the deleted `entryId` and the edited words.
- **User impact:** Supposedly deleted sensitive text remains on-device and in later backups; Home can expose it and LWC-008 can recreate it as a new entry.
- **Remediation:** Add provider-level atomic delete of entry, indexes and associated drafts; explicitly decide whether draft preservation is ever desired and state it in the confirmation.
- **Regression:** Inject failure between entry/draft deletion and prove all-or-nothing behavior on both adapters.

### LWC-010 — Runtime read errors look like empty or stale journals

- **Classification:** CODE-PROVEN DEFECT
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** `useStorageQuery`, `src/app/storage.tsx:155-191`; representative empty initial values `src/views/HomeView.tsx:256-275`.
- **Root cause:** Every post-open query rejection is swallowed. Loading becomes false while `data` remains its initial value or a previous successful value. The comment incorrectly assumes open-time handling already surfaced every read failure.
- **Preconditions:** Storage opens, then a list/query fails due to corruption, I/O error, connection loss, quota/bridge fault, or malformed stored data.
- **Reproduction:** Supply a provider whose `open` succeeds and `listEntries` rejects; render a view using the hook.
- **Expected:** A prominent error state says the journal could not be read and prevents empty-state actions from being mistaken for truth.
- **Observed/evidence:** The code deterministically drops the error and returns `{ data: initial, loading: false }`; Home’s initial entries/drafts are empty arrays.
- **User impact:** Existing writing can appear gone or stale, inducing panic and potentially unsafe recovery choices. The bytes are not necessarily deleted, but the UI cannot distinguish failure from an empty journal.
- **Remediation:** Return an error from the hook, preserve last-known-good data with a stale/error marker, and fail closed on destructive/export decisions that require a complete read.
- **Regression:** Fault-inject every query after successful open and assert explicit, actionable errors rather than empty-state UI.

### LWC-011 — Two acknowledged writers lose one update

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; browser/multiple tabs; high confidence.
- **Location/function:** read-modify-write `src/storage/db.ts:119-124`; analogous SQLite path `src/storage/sqlite.ts:593-598`.
- **Root cause:** `updateEntry` reads the whole record outside a transaction/revision check, merges one patch, then overwrites the whole record. There is no revision, compare-and-swap, or cross-tab coordination.
- **Preconditions:** Two tabs/providers read the same entry version and save disjoint changes before either observes the other.
- **Reproduction:** Open two Dexie providers on one database, pause both after their read, update title in one and Notes in the other, then release both.
- **Expected:** Both disjoint edits survive, or one writer receives an explicit conflict instead of success.
- **Observed/evidence:** Both update promises resolved with their requested field, but the final record lacked one acknowledged update.
- **User impact:** A browser tab left open while another edits can silently erase saved work. Overlapping native calls use the same unsafe pattern, though that scenario was not runtime-reproduced.
- **Remediation:** Add a monotonic record revision and atomic compare-and-swap transaction, surface conflicts, and broadcast invalidations across tabs.
- **Regression:** Property/state-machine tests with two through N writers, disjoint and overlapping patches, randomized interleavings, and reopen verification.

### LWC-012 — Device clock rollback inverts restore conflict resolution

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** `applyPatch`, `src/storage/semantics.ts:207-209`; newest-wins import `src/export/importer.ts:231-240`.
- **Root cause:** Each edit blindly assigns wall-clock `new Date().toISOString()`. Import compares timestamp strings as the sole version order. A later edit after manual/NTP/time-zone device correction may therefore carry an earlier timestamp.
- **Preconditions:** Clock moves backward after an archive was made; entry is edited; the older archive is later merged.
- **Reproduction:** Start with `updatedAt` in 2026, apply a later logical edit using a 2025 clock, then merge the archived 2026 record.
- **Expected:** The later edit is retained or a conflict is shown; wall-clock changes cannot silently establish causality.
- **Observed/evidence:** The later edit received a 2025 timestamp and the archive’s older words overwrote it as “newer.”
- **User impact:** A restore/merge can silently revert an entry after a realistic device clock correction.
- **Remediation:** Add a monotonic per-record revision/version and conflict records. At minimum ensure local `updatedAt` never decreases relative to the existing record, but do not use that alone for multi-device causality.
- **Regression:** Clock rollback/forward, DST, equal timestamps and cross-device merge sequences with explicit expected conflicts.

### LWC-013 — Duplicate imported IDs silently collapse

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** migration list `src/export/migrate.ts:385-416`; preview `src/export/importer.ts:143-175`; merge `219-243`; bulk stores `src/storage/db.ts:137-147` and `src/storage/sqlite.ts:616-632`.
- **Root cause:** Import never validates unique IDs. Preview counts each record independently; batch upsert semantics leave only one row per primary key, with array order deciding the winner.
- **Preconditions:** A malformed, future, or adversarial JSON/ZIP contains two entries with the same ID.
- **Reproduction:** Import `[newer, older]` using one ID into an empty journal.
- **Expected:** Reject before mutation or present a deterministic, explicit duplicate conflict.
- **Observed/evidence:** Preview said two incoming/two new; result said two imported; storage contained one record, and the older record won because it appeared last.
- **User impact:** Input content disappears and reported counts are false; reordered archives can restore different content.
- **Remediation:** Validate uniqueness of entry and draft IDs before preview, report exact duplicate IDs, and make malformed input non-mutating.
- **Regression:** Duplicate IDs in every order, identical/different payloads, entry/draft namespace cases, and both providers.

### LWC-014 — Journal ZIP and generic file reads are unbounded

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** archive parse `src/export/importer.ts:78-103`; unbounded ZIP reader `src/export/zip.ts:232-276`; bounded document counterpart `src/import/zip-limits.ts:109-195`; browser read `src/platform/web.ts:227-228`; Android pick `JourneyDocumentsPlugin.java:154-171`; iOS pick `JourneyDocumentsPlugin.swift:253-265`.
- **Root cause:** Journal import inflates every ZIP member before manifest verification without entry-count, per-entry, aggregate, or compression-ratio limits. Before that, browser and native pickers read the entire selected file into memory; native then base64-duplicates it across the bridge.
- **Preconditions:** User selects a crafted or accidentally huge archive/file.
- **Reproduction:** A ZIP under 32 KiB with a 16 MiB deflated `data/journey.json` member was fully inflated by `readZip`; the existing bounded document reader rejected the same expansion at a 1 MiB budget.
- **Expected:** Size/count/ratio limits are enforced while streaming/before allocation, and malformed input cannot exhaust the app before preview.
- **Observed/evidence:** Full 16 MiB inflation occurred. Source shows no bounds in the journal reader or generic picker paths.
- **User impact:** Memory exhaustion, UI freeze, or process termination. Existing journal data is not directly modified before preview, but an import can make the app unavailable.
- **Remediation:** Reuse/extend the bounded ZIP reader for journal archives; read only required members; validate central-directory bounds; cap picked bytes natively before base64 and in browser before `arrayBuffer`; choose documented limits suitable for large legitimate journals.
- **Regression:** ZIP bombs, high entry counts, oversized stored entries, truncated offsets, declared/actual size mismatches and just-under/over-limit legitimate archives on each platform.

### LWC-015 — Imported draft schema is not validated and can break Home persistently

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** MEDIUM — P2; all; high confidence.
- **Location/function:** `readDrafts`, `src/export/migrate.ts:343-383`; `hasDraftContent`, `src/lib/drafts.ts:41-55`; Home filtering `src/views/HomeView.tsx:271-277`.
- **Root cause:** Import checks only that `id` is a string and `form` is an object, then casts it to `DraftForm`. Runtime consumers unconditionally call `.trim()`, `.length`, `.some()`, and kind-label methods on the alleged fields.
- **Preconditions:** A self-consistent bare JSON or correctly manifested archive contains a structurally invalid draft form.
- **Reproduction:** Parse `{ drafts: [{ id: 'malformed', form: { title: 7 } }], entries: [] }`, then pass the accepted draft to the Home resume predicate.
- **Expected:** Invalid drafts are rejected/dropped with an explicit warning before any storage mutation; existing data stays usable.
- **Observed/evidence:** Parser returned one draft; `isResumable` threw on `title.trim()`. Applying import would persist that object, and Home evaluates this predicate on every launch.
- **User impact:** A selected archive can persistently crash Home’s routed view. The generic boundary then misleadingly says Bible data failed; replace restore currently does not clear the offending old draft (LWC-007).
- **Remediation:** Runtime-validate every `DraftForm` field, enum, array member, timestamp and nested object; stage all validation before apply. Preserve unknown future fields separately rather than casting unknown structure into live UI types.
- **Regression:** Property/fuzz tests for missing, wrong-type, huge, nested and prototype-named fields, proving malformed import never changes storage or breaks any route.

### LWC-016 — Canonically equivalent Unicode text does not match search

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** LOW — P3; all; high confidence.
- **Location/function:** `searchableText`/`matches`, `src/storage/semantics.ts:105-121` and `138-145`.
- **Root cause:** Stored text and query are lowercased but never Unicode-normalized.
- **Preconditions:** Text and query use visually identical composed/decomposed sequences, common with copied names and multilingual keyboards.
- **Reproduction:** Store title `Caf\u00e9`; search for `Cafe\u0301` in both adapters.
- **Expected:** Visually/canonically equivalent input matches.
- **Observed/evidence:** Both Dexie and SQLite searches returned no results.
- **User impact:** False-negative journal search for accented text.
- **Remediation:** Normalize searchable fields and needles consistently (normally NFC, with a deliberate diacritic policy) and rebuild derived indexes on migration.
- **Regression:** NFC/NFD pairs, combining marks, case-folding edge cases, emoji sequences and index migration.

### LWC-017 — Current unit/CI test gate is broken

- **Classification:** CONFIRMED BUG
- **Severity / platform / confidence:** LOW — P3; development/CI; high confidence.
- **Location/function:** global use `src/views/DataView.tsx:106-117`; build define `vite.config.ts:20-28`; missing test define `vitest.config.ts:12-47`; CI invocation `.github/workflows/ci.yml:81-102` and Pages workflow.
- **Root cause:** Commit HEAD added `__DEBUG_TOOLS__` to Vite build configuration but not Vitest configuration.
- **Preconditions:** Run the documented default unit suite or profile test job.
- **Reproduction:** `npm test` on the inspected clean commit.
- **Expected:** All configured suites initialize, or fail on assertions about product behavior.
- **Observed/evidence:** `ReferenceError: __DEBUG_TOOLS__ is not defined` prevents `platform.test.tsx`, `DataView.test.tsx`, and `DataView.cancelled-export.test.tsx` from running. Overall: 3 failed suites, 122 passed, 1,985 tests passed, 4 skipped.
- **User impact:** No direct runtime defect, but release gates are red and important data-transfer/platform tests are absent from current feedback.
- **Remediation:** Define the constant in the Vitest environment with release-safe default false and assert debug code is absent from release assets.
- **Regression:** A smoke test importing every routed view under the exact test config, plus CI verification of both debug flag values.

### LWC-018 — File picker/read errors are silently treated as cancellation

- **Classification:** CODE-PROVEN DEFECT
- **Severity / platform / confidence:** LOW — P3; all; high confidence.
- **Location/function:** `src/components/FileChooser.tsx:60-73`; browser file read `src/platform/web.ts:107-118`.
- **Root cause:** Any picker rejection is converted to `onFile(null)`, the same value as user cancellation. Browser `File.arrayBuffer()` rejection is likewise converted to null.
- **Preconditions:** Permission loss, provider I/O error, bridge/plugin failure, or unreadable selected file.
- **Reproduction:** Make the selected platform picker reject or make `arrayBuffer()` reject.
- **Expected:** Cancellation is quiet; failures show an actionable error and preserve journal state.
- **Observed/evidence:** The promise rejection is swallowed and the UI receives indistinguishable cancellation.
- **User impact:** Import/restore appears to do nothing, leaving the user without recovery guidance during a reliability-critical task.
- **Remediation:** Use a discriminated result (`cancelled`, `picked`, `failed`) and surface content-free platform errors.
- **Regression:** Picker cancellation and each failure class must produce different, accessible UI states.

## Unconfirmed Risks

These are not counted as verified defects:

- **Browser persistence is best-effort.** No `navigator.storage.persist()` request or persistence-status UI was found. The product does warn that browser storage is not a backup. Whether a given browser will evict this origin was not tested.
- **Development dependency advisories.** Full `npm audit` reported `brace-expansion` and `source-map-js` high-severity DoS advisories and moderate advisories through `@capacitor/cli`/`xcode`/`uuid`. `npm audit --omit=dev` reported zero. No path from untrusted journal content into these build tools was established.
- **SQLite retry state after a migration error.** `SqliteStorageProvider.openOnce` assigns `this.plugin` before PRAGMA/migration completes (`src/storage/sqlite.ts:323-360`), so a second `open()` on the same instance can return early after a failed migration. The application shows a fail-closed screen and a process restart constructs a new provider, so concrete user impact was not reproduced.
- **iOS database backup/data protection.** The SQLite plugin defaults to the app Documents directory and no backup-exclusion key is set. This strongly suggests inclusion in normal device backup, but an actual backup/restore and file-protection inspection were not performed.
- **Very large archive export on low-memory devices.** At 10,000 representative entries, in-process archive construction used roughly 160 MiB additional heap in the Node benchmark. A 50,000-entry export was not attempted, and Node memory is not a phone measurement.

## Data Preservation Assessment

### Healthy-path evidence

- A deterministic 180-operation sequence across Dexie and real Node SQLite produced identical canonical entries, drafts and settings. Inputs included Unicode, newlines, quotes, NUL characters, emoji, duplicate bulk IDs, deletes, settings, filters, and 512 KiB fields.
- SQLite adapter tests verified transactional rollback for failed batch/replace operations, schema v1→v2 migration, schema-too-new refusal, repeated open, close/reopen and on-disk persistence.
- Forty-eight focused archive tests verified complete entry round trips, drafts byte-for-byte, Markdown/rich text, source attribution, unknown fields and references.
- The browser termination test saved v1 and v2, closed/reopened after v2 durability, recovered a settled v3 draft, then closed immediately after dispatching another save. The final interrupted-save result retained complete `acknowledged v2`; it was not missing or partial.
- The KJV structural verifier found 66 books, 1,189 chapters, 31,102 verses, zero blank verses, zero missing/extra positions and zero duplicate reference IDs. Structural content digest for that verifier was `e11153dd6ceb156ff04811b5388bf002d0c291a8b0ee68162b0073fdca4dacb5`.

### Scenario verdicts

| Scenario | Verdict | Evidence/limitation |
|---|---|---|
| Normal single-writer use | **Not safe overall** | Ordinary completed writes round-trip, but LWC-001 loses typing during Save and LWC-009 mishandles delete state |
| Application restart | **Partially verified** | Browser acknowledged records and settled drafts survived termination/reopen; native process restart not freshly run |
| Application crash/kill | **Partially verified** | Browser page termination and Node transaction rollback passed; real Android/iOS kill at write stages not verified |
| Device restart | **NOT VERIFIED** | No fresh physical-device restart test |
| Application upgrade | **Partially verified** | Dexie additive schema and SQLite v1→v2 tests pass; store-distributed upgrade not run |
| Database migration | **Verified in Node SQLite; not on device** | Migration and rollback tests pass, schema-too-new fails closed |
| Backup/export | **Fails safety requirement** | Healthy archives are lossless, but LWC-002 and LWC-004 can falsely report incomplete/nonexistent backups |
| Import/restore | **Fails safety requirement** | Healthy entries/drafts round-trip, but LWC-003, 007, 012, 013 and 015 violate completeness/determinism |
| Uninstall/reinstall | **Not independently safe** | Requires a valid user export or successful OS backup; neither is guaranteed by local storage |
| Storage exhaustion/disk failure | **Partially fault-injected only** | Draft failure defects reproduced; no physical disk-full run |

Settings are intentionally outside the archive contract (`docs/A17-MIGRATION.md:218-226`). Export history, theme and first-run state not surviving restore are therefore not defects. The archive promises entries and drafts; those promised fields are where the failures occur.

## Security and Privacy Assessment

### What is protected

- There is no account/backend/analytics implementation and no production `fetch`, XHR, WebSocket or beacon path was found.
- Native assets are packaged locally; Capacitor has no `server.url`. Android requests no Internet permission.
- Native storage selection cannot silently fall back to IndexedDB.
- Capacitor bridge logging is disabled and Android WebView debugging is disabled in config.
- Journal ZIP manifests are verified before canonical JSON is trusted. This provides accidental/copy integrity, not authenticity.
- External DOCX reads only `word/document.xml`; it ignores relationships, macros and embedded objects. PDF flags disable network resources and use a bundled worker. Document ZIPs have size/count bounds.
- Markdown is parsed into React nodes, not HTML. Raw tags remain text; link schemes use an allowlist. Export HTML escapes content, and CSV formula prefixes are neutralized by existing tests.
- Android FileProvider is not exported and shares by explicit temporary grants. Native document selection uses OS-scoped access rather than broad storage permission.

### What is not protected

- **Local storage is not application-level encryption.** Browser IndexedDB and native SQLite contain plaintext logical records. SQLite explicitly uses `no-encryption` (`src/storage/sqlite.ts:323-339`). SQLCipher being present as a plugin dependency does not mean the database is encrypted.
- **App Lock is not encryption.** It is an Android presentation gate around an otherwise readable local database, and LWC-005 weakens that gate under failure. iOS/browser have no App Lock.
- **OS data protection is separate.** This audit did not prove a particular Android/iOS file-protection class against a seized/unlocked device.
- **OS cloud/device backup is separate.** Android has `allowBackup="true"`; rules exclude only `app_lock.xml`, so journal storage can be included in the user’s Android backup. iOS has no explicit database backup exclusion. These copies go through the user’s OS account, not an app server, but they are still off-device copies.
- **Exports are plaintext.** ZIP JSON/Markdown/CSV/HTML and shared PDFs/text are intentionally readable. Anyone with access to the chosen file can read it.
- **User-opened links leave the local trust boundary.** HTTP(S)/mailto links are intentionally clickable. No automatic imported-content request or script execution was demonstrated.

### Security conclusion

No remote-code execution, XSS, local-file read, secret, telemetry leak, or unauthorized remote access path was established. The strongest security defect is Android App Lock’s fail-open behavior. The strongest untrusted-input defect is resource exhaustion/malformed persistent draft state, not code execution. The current privacy posture is accurately described only as local plaintext protected by the device and user-controlled exports—not encrypted storage.

## Android / iOS / Browser Parity

| Capability | Browser | Android | iOS |
|---|---|---|---|
| Authoritative store | Dexie/IndexedDB | SQLite | SQLite |
| Storage failure | Browser shell can remain for non-journal features; journal error banner | Fail-closed unavailable screen | Fail-closed unavailable screen |
| Export destination | Anchor download; completion unverifiable (LWC-004) | Storage Access Framework; explicit result | Document picker export; explicit delegate result |
| Import picker | DOM file; full `arrayBuffer` | Content URI read/base64; generic read unbounded | Security-scoped URL `Data(contentsOf:)`; unbounded |
| Offline | No cold/service-worker support; lazy-route failure reproduced | Local bundle, no Internet permission; no fresh device test | Local bundle by code/config; no fresh device test |
| App Lock | Unsupported | Implemented, but fail-open defect | Unsupported/hidden |
| Printing | Browser print | Not implemented, button absent | Not implemented, button absent |
| Entry sharing | Web Share when available, download/copy fallback | Native share sheet | Native share sheet |
| Build verification | Both profiles build/E2E pass | Asset sync passes; Gradle build unavailable on host JDK | App and ShareUITests compile for simulator |

Functional parity cannot be claimed from compilation alone. Android/iOS picker cancellation, actual SQLite durability under OS kill, keyboard behavior, rotation, safe area, resume, file-provider behavior and OS backup require real-device runs.

## Bible Reading and Search Assessment

- Bundled data is structurally complete against its own KJV versification: 66/1,189/31,102 with no missing, extra, blank or duplicate reference positions.
- Boundary/navigation/reference tests passed across the normal suite and E2E profiles.
- Exact verse wording was not independently certified; this audit distinguishes structural completeness from textual authority.
- The product’s Search covers typed references, topic aliases, book names, journal content and section titles where present. It does **not** implement full-text search over all Bible verse words, and current README wording does not claim that feature; this is not reported as a missing defect.
- Unicode-equivalent journal search failure is LWC-016.

## Accessibility and Human-Factors Assessment

Automated axe, keyboard, contrast and reflow browser checks passed in both data profiles as part of the 175-test sweeps. The source generally uses native controls, labels, live regions, visible destructive confirmation and 44px-class targets. The iOS UI-test target compiles and navigates by accessibility labels.

Important human-factors defects remain:

- LWC-001 says Saved for an older version than the one last visible.
- LWC-002/003/004 give successful backup/restore feedback that is not true.
- LWC-007 says everything was deleted when drafts remain.
- LWC-010 presents read failure as empty/stale state.
- LWC-018 turns operational errors into silence.
- Lazy-route failure text says Bible data failed even when the editor chunk failed.

VoiceOver, TalkBack, IME composition, physical keyboard navigation in native WebViews, and OS dynamic-type behavior remain unverified.

## Performance and Long-Term Reliability

The following are isolated Node/fake-IndexedDB measurements on the audit host, not phone/browser service-level guarantees:

| Entries | Bulk write | Full list | Text search | Approx. heap delta |
|---:|---:|---:|---:|---:|
| 100 | 10 ms | 12 ms | 1 ms | +3 MiB |
| 1,000 | 58 ms | 6 ms | 7 ms | +12 MiB |
| 10,000 | 643 ms | 61 ms | 62 ms | +31 MiB |
| 50,000 | 5,341 ms | 420 ms | 314 ms | +203 MiB |

| Full archive size | Build time | ZIP size | Approx. heap delta | Files |
|---:|---:|---:|---:|---:|
| 100 entries | 29 ms | 0.3 MiB | -2 MiB (GC noise) | 112 |
| 1,000 entries | 126 ms | 2.6 MiB | +15 MiB | 1,012 |
| 10,000 entries | 1,355 ms | 26.2 MiB | +160 MiB | 10,012 |

Both storage providers deliberately load all entries and filter/sort in application code (`src/storage/db.ts:99-110`, `src/storage/sqlite.ts:570-584`). At 50,000 representative rows this remained sub-second for list/search on the audit host, so no performance defect is assigned from that design alone. Import/export memory growth and the unbounded ZIP/picker path are the nearer-term risks. Real low-memory phone measurements remain required.

## Existing Test Suite Assessment

### Strengths

- Storage-provider conformance is unusually substantial and includes real Node SQLite rather than only mocks.
- Archive tests compare full canonical records, drafts, relationships, unknown fields, Unicode, Markdown and source attribution.
- Manifest integrity, native asset privacy, startup budgets and data-profile behavior are treated as gates.
- Browser E2E is run against built assets with build-identity verification, not a dev server.
- Accessibility has automated axe, keyboard, reflow and contrast coverage.
- Prior resolved issues—native save cancellation, archive manifest verification, stale deferred navigation and draft discard races—have targeted regression tests.

### False confidence and gaps

- The current default suite is not green: three data/platform suites never initialize because the new build constant is absent from Vitest.
- Healthy round trips do not fault-inject draft enumeration or draft writes, so they missed LWC-002/003/007.
- Editor tests do not type while the canonical save promise is paused, so they missed LWC-001.
- Draft tests do not route a saved-entry draft from Home, or delete an entry with an active draft.
- Import fixtures do not require unique IDs or fully validate `DraftForm` runtime types.
- Journal ZIP tests verify integrity but not decompression/resource ceilings.
- Storage conformance is single-writer; it does not exercise cross-tab optimistic concurrency.
- Timestamp tests do not model clock rollback and merge.
- Open-time failure is tested, but post-open query failure is largely swallowed and unasserted.
- Browser file-save tests can only assert initiation, yet production wording treats it as confirmed persistence.
- Existing browser draft-reload tests approximate process death; no continuous native kill-stage matrix exists.

## Recommended New Regression Tests

Priority order:

1. **Save generation state machine:** pause before/after draft flush and before/after canonical write; type, navigate, background and kill; verify the exact acknowledged version and preservation of later text.
2. **Atomic logical backup/restore:** fault every entry/draft/settings read/write and every ordinal; require complete success or explicit rollback/incomplete state.
3. **Exact replace:** canonical equality of both entries and drafts after replace; zero pre-existing records survive.
4. **Backup completion contract:** native cancel/failure/success plus browser initiated/unverified outcomes; reminder changes only for verified saves.
5. **App Lock fail-closed matrix:** state, clock, credential, recents-privacy and lifecycle-listener failures before and after unlock.
6. **Multi-writer property test:** randomized interleavings across two browser contexts with revisions/conflict assertions.
7. **Import schema property/fuzz tests:** duplicate IDs, wrong types, unknown versions/fields, malicious nesting and prototype-named fields; malformed input must not mutate storage.
8. **Bounded archive tests:** compression bombs, entry-count bombs, truncation, offset overflow and legitimate maximum-size journals at picker and ZIP layers.
9. **Parented draft lifecycle:** resume/update, discard, delete, replace, missing parent and collision behavior.
10. **Clock and time-zone suite:** backward/forward clock, DST, equal timestamps, device travel and merge conflict handling.
11. **Post-open storage failures:** every view must surface errors and bar destructive actions rather than render empty data.
12. **Unicode search:** NFC/NFD and chosen case/diacritic semantics across adapters and rebuilt indexes.
13. **Real-device kill loop:** automate create/edit/save, kill at instrumented barriers, reboot/relaunch and compare acknowledged revisions on Android and iOS.
14. **Long-lived device scale:** startup, edit, search and export at 10k/50k entries on low-memory supported hardware with heap/latency ceilings.

## Release Blockers

At minimum, public release should stop until:

1. LWC-001 through LWC-005 are fixed and have adversarial regression coverage.
2. Restore is one coherent operation for entries and drafts (LWC-003/007), and duplicate/malformed archive records cannot mutate the journal (LWC-013/015).
3. Draft parent lifecycle is correct for resume and delete (LWC-008/009).
4. Multi-writer conflict and clock-rollback merge cannot silently discard newer words (LWC-011/012), or browser multi-tab editing/merge is explicitly prevented until revisions exist.
5. Journal and picker resource limits are enforced before allocation (LWC-014).
6. Storage read failures are visible and fail safe (LWC-010).
7. The unit/CI gate is green again (LWC-017).
8. The browser offline promise is either implemented or accurately scoped (LWC-006).
9. A documented JDK 21 Android CI/device lane and iOS real-device lane execute the native kill, restore, permission and lifecycle matrix.

## Unverified Areas

- Android Java compilation/lint/APK output at this commit under JDK 21.
- Fresh Android and iOS SQLite conformance inside the actual plugins.
- Physical-device save acknowledgement versus fsync/power loss.
- Android activity recreation, iOS scene restoration, low-memory kill, device restart and app upgrade.
- Actual cloud/device backup contents and restore compatibility.
- Native picker behavior against remote/cloud file providers, revoked grants, full storage and very large files.
- iOS entry-share UI workflow and system share sheets.
- App Lock device-credential recovery, reboot monotonic-clock behavior and real lifecycle bridge failures.
- VoiceOver/TalkBack, IME composition, font scaling, rotation and safe-area behavior on devices.
- Safari/Firefox IndexedDB, download and Web Share behavior.
- Independent KJV textual accuracy and provenance beyond repository documentation.
- A separate companion website/application; none was present to audit.

## Git History and Regression Review

Relevant history showed several good safety fixes that remain present: `ef161e3` added manifest verification, `575f3bb`/`ea2361c` fixed native export cancellation reporting, `a3e5d9a` fenced discarded drafts, and `bfbf8cd` guarded deferred navigation. They were not re-reported.

Current findings trace to still-active assumptions:

- `48dbaf0` introduced crash-safe drafts along with catch-to-empty backup and catch-and-ignore restore behavior.
- `44cc59e` added Home draft resume with an unconditional new-entry route.
- `d751f54` added App Lock with the initial fail-open catch.
- HEAD `03a2722` added `__DEBUG_TOOLS__` to Vite without mirroring it in Vitest.
- `af428fa` changed timeline order, but README line 83 still says oldest first.

README is materially stale at lines 169-171 and 315-318: it says native storage/sharing are unavailable even though SQLite and native sharing are now implemented. This is documentation debt rather than a runtime defect, but it makes release/readiness review less reliable.

## Prioritized Remediation Plan

### 1. Must fix before release

- Introduce save generations and guarantee that success covers the latest visible version or preserves all later changes as durable drafts.
- Redesign backup/restore around a complete entries+drafts snapshot with truthful completion states on every platform.
- Make App Lock fail closed for every supported-native error and listener failure.
- Add strict runtime import validation, duplicate detection and bounded file/ZIP reads before mutation/allocation.
- Make draft parent lifecycle atomic for resume, delete and replace.
- Add revisions/conflict handling and monotonic edit ordering; stop silent last-writer-wins loss.
- Surface storage read errors and restore the green CI gate.
- Correct or implement the browser offline promise.

### 2. Strongly recommended before release

- Run the full native device matrix under pinned supported toolchains, including kill-stage, disk-full, cloud-provider picker, reboot and upgrade tests.
- Decide and document Android/iOS backup participation and OS data-protection behavior; give users a clear encrypted-export/backup story if required by the threat model.
- Distinguish picker cancellation from failure and provide accessible recovery messages.
- Normalize Unicode search and migrate derived indexes.
- Request/report persistent browser storage where supported and continue to emphasize that it is not a backup.
- Resolve development dependency advisories after compatibility review; no automatic upgrade was performed during this audit.

### 3. Post-release improvements

- Add indexed/paginated search if real-device 50k-entry measurements exceed agreed budgets.
- Stream large export/import work and publish memory/latency limits.
- Add iOS App Lock only with equivalent Keychain/Secure Enclave-backed behavior and fail-closed lifecycle testing.
- Add a service worker/installable browser edition only with version-safe cache migration and offline-route tests.
- Keep README/release-status documentation generated or gated against implemented capabilities to prevent architectural drift.

## Final Assessment

The repository shows serious thought about local ownership, transactional entry storage, archive readability, untrusted document rendering and fail-closed native storage. The core healthy paths are credible. The current release boundary is nevertheless unsafe because success is sometimes reported for a different version than the user sees, an incomplete backup, an incomplete restore, or an unverifiable browser download. Those are not cosmetic edge cases: they undermine the application’s central promise.

**Release recommendation: HOLD.** Resolve the P1 findings and the connected draft/restore/conflict defects, restore the test gate, then repeat the native real-device kill and recovery matrix before asking users to entrust irreplaceable journals to the application.
