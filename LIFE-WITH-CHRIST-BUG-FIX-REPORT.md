# My Life With Christ — audited bug remediation report

Remediation date: 2026-10-11–12  
Repository: /Users/gmcas/repos/my-life-with-christ  
Scope: repair of every actionable finding in LIFE-WITH-CHRIST-BUG-AUDIT.md

## Outcome

All 19 audited defects—6 High, 11 Medium, and 2 Low—have been repaired in the working tree and have targeted regression coverage. Related defects discovered while exercising the repairs were fixed under the same root findings. No finding is being closed merely because a test passed: the changes alter the real application, browser adapter, IndexedDB provider, SQLite provider, Android/iOS bridge, or release boundary identified by the audit.

This is not a claim that arbitrary software is bug-free. The working tree resolves the known audited defects. Physical-device durability, remote document-provider behavior, and signed-store artifact checks remain release-verification gaps and are listed below.

No commit, push, deployment, production-data access, or third-party-system action was performed.

## Authorization, provenance, and preservation

The repository AGENTS.md was read before the audit and remediation. It authorizes the requested DAYBREAK defensive work, including local source review, dependency analysis, static analysis, and controlled synthetic-data reproduction. The audit alone did not authorize source changes; production-code work began only after the owner explicitly said “ok fix all bugs.”

| Item | Recorded value |
|---|---|
| Starting commit | 03a2722564af0daf7d1d367acb7a1d38296129e7 |
| Current HEAD | 03a2722564af0daf7d1d367acb7a1d38296129e7 |
| Branch | ios/native-entry-sharing |
| Original working tree | ?? AGENTS.md; ?? LIFE-WITH-CHRIST-ADVERSARIAL-AUDIT.md |
| Audit-created report | ?? LIFE-WITH-CHRIST-BUG-AUDIT.md |
| Commit/push/deploy | None |

The original untracked files remain present. Their current SHA-256 values are:

- AGENTS.md: cb48e3d861e91979b42c9187c1c8658025eb088d03274fd7a6c7f423fa094a91
- LIFE-WITH-CHRIST-ADVERSARIAL-AUDIT.md: 3b4cea3a6b0f23e405ae90e4bf8c51cb6e89261d97bf38dd4d1468e11b26eed2
- LIFE-WITH-CHRIST-BUG-AUDIT.md: 337acf43c74524ff127a3053fd89bb45f99ac341bb98190a16a35aa9df18baed

The tracked remediation diff currently spans 70 files with 2,538 insertions and 532 deletions, plus new source and regression-test files. Generated web/native artifacts are ignored and were rebuilt through the repository’s release pipeline.

## Verified product identity and architecture

The product is My Life With Christ. The checkout is my-life-with-christ; “mylifewithcrist” is not an identifier in the current source. Historical internal names remain: npm package journey, database journey, and native bundle/application ID com.myjourneywithchrist.lifewithchrist.

| Layer | Current implementation |
|---|---|
| UI | React 19.3, TypeScript 5.9, Vite 8.3, hash routing and lazy views |
| Hosted web storage | Dexie 4.4 over IndexedDB, schema v2 |
| iOS/Android storage | @capacitor-community/sqlite 8.1.1, unencrypted SQLite, schema v2 |
| Native shell | Capacitor 8.5; iOS 15+; Android min SDK 24 and target/compile SDK 36 |
| Export | Versioned ZIP containing canonical JSON plus Markdown, readable HTML, CSV, checksums, and metadata |
| Import | Browser/native picker, bounded byte/ZIP parsing, validation/migration, preview, atomic merge or replace |
| Offline content | Bundled KJV/topics/sections on native; versioned complete precache on hosted web |

Provider selection remains fail-closed: hosted web requires IndexedDB; native requires SQLite. A native open failure does not redirect journal writes into WebView IndexedDB.

## Finding status

| ID | Severity | Status | Principal repair |
|---|---:|---|---|
| LWC-001 | High | Fixed and executed | Generation-aware Save and ordered recovery drafts |
| LWC-002 | High | Fixed and executed | Full export uses one fail-closed journal snapshot |
| LWC-003 | High | Fixed and executed | Atomic entry+draft restore with optimistic token |
| LWC-004 | Medium | Fixed and executed | Draft parent preservation and atomic parent deletion |
| LWC-005 | High | Fixed and executed in React/unit paths; native compiled | App Lock failures now fail closed |
| LWC-006 | Medium | Fixed and executed | Provider-level atomic RMW and SQLite operation queue |
| LWC-007 | Medium | Fixed and executed | Content-aware conflicts preserve both records |
| LWC-008 | Medium | Fixed and executed | Strict identities/known fields/drafts with future-field preservation |
| LWC-009 | Medium | Fixed and executed | Bounded picked files and streaming ZIP inflation |
| LWC-010 | Medium | Fixed and executed in Chromium | Versioned all-asset hosted-web service worker |
| LWC-011 | Medium | Fixed and artifact-verified | Release-mode marker, byte digest, and debug sentinels |
| LWC-012 | Low | Fixed and executed | Deterministic test configuration and Android tint repair |
| LWC-013 | Medium | Fixed and executed | Explicit loading/error/complete storage-read state |
| LWC-014 | High | Fixed and executed/source-verified | Committed/cancelled/initiated delivery contract |
| LWC-015 | Low | Fixed and executed | Cancellation separated from picker/read failure |
| LWC-016 | Medium | Fixed and executed at unit/source boundary | Bounded Android EXTRA_TEXT ingestion |
| LWC-017 | Medium | Fixed and source-reviewed | iOS/Android OS-backup disclosure |
| LWC-018 | High | Fixed and executed | Atomic export snapshot plus freshness checks |
| LWC-019 | Medium | Fixed and executed at lifecycle abstraction | Immediate background/route-leave draft flush |

## Detailed remediation

### LWC-001 — Editing during Save silently lost newer text

- Severity / affected platforms: High; web, iOS, Android.
- Original trigger and impact: type while an explicit canonical Save is unresolved. The old snapshot committed, the newer visible text was discarded, the draft was deleted, and “Saved” was announced.
- Repair: Autosaver now orders snapshots by generation, exposes whether newer work remains, serializes writes, rejects failed explicit durability boundaries, and fences retired writers (src/lib/autosave.ts:30-186). EntryEditor binds Save to the submitted form, then compares it with the latest rendered form; any newer accepted edit is written as a parented recovery draft before navigation (src/views/EntryEditor.tsx:1397-1586). Canonical-save success and later draft-bookkeeping failure now produce distinct, truthful UI states.
- Expected/actual now: the submitted generation becomes canonical; edits accepted during that write remain recoverable and are explicitly reported as a draft. A failed canonical write keeps the editor and its text.
- Regression evidence: src/lib/autosave.test.ts and src/views/EntryEditor.drafts.test.ts cover pending generations, deferred writes, typing during Save, draft-write failure, and positive controls. The full Vitest suite passes.
- Remaining uncertainty: physical-device process termination at individual bridge callbacks was not injected.

### LWC-002 — Full backup suppressed a draft-read failure

- Severity / affected platforms: High; all.
- Original trigger and impact: listDrafts failed, export substituted an empty list, saved a plausible incomplete archive, and reset the backup reminder.
- Repair: exportEverything obtains entries and drafts from one required readJournalSnapshot call; any read rejection aborts before file creation (src/export/download.ts:71-122; src/storage/StorageProvider.ts:94-101). There is no failed-read-to-empty conversion.
- Expected/actual now: an intentionally empty draft list exports normally; an incomplete read fails the full export and does not advance lastExportAt.
- Regression evidence: src/export/save-result.test.ts independently fails snapshot, save, freshness, and metadata phases; zero-draft and healthy-draft controls pass.
- Remaining uncertainty: the concrete OS causes of read failure were injected, not induced with a corrupt personal database.

### LWC-003 — Restore was not atomic or faithful for drafts

- Severity / affected platforms: High; all.
- Original trigger and impact: entries committed before best-effort drafts; replace left old drafts; older colliding drafts overwrote current work.
- Repair: StorageProvider now exposes replaceJournal(entries, drafts, expectedToken). Dexie uses one transaction over both stores (src/storage/db.ts:176-193); SQLite uses one queued transaction over both tables (src/storage/sqlite.ts:729-750). applyImport constructs the complete final state first and commits it once (src/export/importer.ts:232-315). Replace truly replaces entries and drafts. Preview tokens abort a stale confirmation.
- Expected/actual now: restore either commits the selected complete journal or retains the pre-import journal. No best-effort second phase remains.
- Regression evidence: src/export/drafts-archive.test.ts, src/export/roundtrip.test.ts, src/storage/contract.ts, and DataView tests cover rollback, replace, merge, stale preview, and healthy round trips.
- Remaining uncertainty: process kill during a real native SQLite restore and remote-provider input were not exercised on physical devices.

### LWC-004 — Saved-entry drafts could duplicate or outlive entries

- Severity / affected platforms: Medium; all.
- Original trigger and impact: resuming a draft could lose entryId, save as a duplicate, or leave an orphan after entry deletion.
- Repair: parent identity is retained across editor load/save and newer-during-save drafts are explicitly parented (src/views/EntryEditor.tsx:1471-1499). Home resumes a parented draft at its canonical entry route (src/views/HomeView.tsx:388-392). Entry deletion atomically removes drafts with that entryId in Dexie and SQLite (src/storage/db.ts:130-134; src/storage/sqlite.ts:659-669). Slow deletion disables the editor fieldset and avoids stale-route redirects. Explicit discard waits for in-flight writes and does not erase edits accepted after confirmation.
- Expected/actual now: a parented draft resumes the original entry; deliberate deletion removes its recovery copies atomically; unrelated/orphan archive drafts are not guessed away.
- Regression evidence: src/views/EntryEditor.drafts.test.ts and provider contract tests cover parent resume, delete, in-flight write/discard, and unrelated-draft controls.
- Remaining uncertainty: legacy backups may intentionally contain an orphan; import validation now rejects dangling parents rather than inventing ownership.

### LWC-005 — Android App Lock failed open

- Severity / affected platforms: High; Android.
- Original trigger and impact: a rejected native state read was treated like “lock unsupported/disabled,” mounting the private journal.
- Repair: supported-platform state-read, clock, and lifecycle-listener failures set the gate to locked with an explicit error (src/app/app-lock.tsx:114-200). Unsupported platforms still use a definite disabled state. Android security writes use synchronous SharedPreferences commit and reject failure, including PIN, timeout, failure counters, and clear (android/.../AppLockStore.java:83-185). Plugin calls propagate those failures (android/.../AppLockPlugin.java:59-150).
- Expected/actual now: uncertainty in a supported lock service hides the journal; it never becomes an unlock decision.
- Regression evidence: src/app/app-lock.gate.test.tsx includes getState, time, and lifecycle rejection cases and disabled-platform positive controls. Android unit/build/lint tasks pass.
- Remaining uncertainty: no post-fix physical-device biometric/credential recovery or injected SharedPreferences disk failure.

### LWC-006 — Storage read-modify-write races lost updates

- Severity / affected platforms: Medium; all.
- Original trigger and impact: concurrent patches read the same old record and overwrote distinct changes; overlapping SQLite transactions also conflicted.
- Repair: Dexie updateEntry performs get/patch/put inside one read-write transaction (src/storage/db.ts:120-127). SQLite serializes every public operation through a FIFO tail and performs RMW/settings work inside committed transactions (src/storage/sqlite.ts:507-535, 647-656, 798-810). Journal-wide mutations use revision tokens.
- Expected/actual now: accepted operations have a deterministic order and distinct patches are composed rather than silently discarded.
- Regression evidence: shared provider contract tests exercise concurrent updates, settings, rollback, snapshots, and stale-token refusal against Dexie and the SQLite bridge.
- Remaining uncertainty: native bridge latency differs from the test bridge, but the single-connection queue and transaction boundaries are in the production provider.

### LWC-007 — Wall-clock rollback lost import conflicts

- Severity / affected platforms: Medium; all.
- Original trigger and impact: a later record with an earlier wall clock could lose solely because updatedAt compared lower.
- Repair: merge no longer chooses one differing same-ID entry by clock. It preserves the local identity and imports the differing archive record under a collision-free new ID, reparenting its draft when necessary (src/export/importer.ts:259-314). Exact duplicates remain idempotent.
- Expected/actual now: neither body is silently discarded, irrespective of clock direction.
- Regression evidence: src/export/roundtrip.test.ts covers both conflict directions, exact duplicate controls, ID uniqueness, and reparenting.
- Remaining uncertainty: the UI identifies the preserved conflict by import counts rather than offering an interactive semantic merge.

### LWC-008 — Import accepted malformed records and duplicate IDs

- Severity / affected platforms: Medium; all.
- Original trigger and impact: missing/duplicate IDs, malformed known fields, invalid drafts, and dangling parents could be silently normalized or overwrite content.
- Repair: migration requires non-empty entry/draft IDs, rejects duplicates, validates the full supported draft form, rejects dangling parents, and preserves unknown/future fields in _unmigrated (src/export/migrate.ts:256-396, 399-646). Malformed known entry fields are preserved with warnings instead of disappearing. Special keys such as __proto__ are defined as own data properties.
- Expected/actual now: unsafe ambiguity aborts before mutation; forward-compatible material is retained rather than silently lost.
- Regression evidence: src/export/import-validation.test.ts and round-trip/draft suites cover malformed fields, duplicates, future fields, special keys, and no-mutation controls.
- Remaining uncertainty: newer schemas with changed semantics can be preserved but not interpreted by an older build.

### LWC-009 — Import lacked resource limits

- Severity / affected platforms: Medium; all.
- Original trigger and impact: a small compressed archive or unknown-size provider could allocate unbounded memory.
- Repair: picked journal files are capped at 64 MiB before/while crossing platform bridges (src/platform/file-limits.ts:1-12; src/platform/web.ts:136-195; Android JourneyDocumentsPlugin.java:57-58, 175-195; iOS JourneyDocumentsPlugin.swift:25-65). ZIP parsing streams inflation with limits of 2,000 members, 50 MiB per member, and 120 MiB total (src/import/limits.ts:31-49; src/import/zip-limits.ts:94-165).
- Expected/actual now: over-limit input rejects before journal mutation and unknown metadata does not bypass the streaming count.
- Regression evidence: src/export/import-resource-limits.test.ts and ZIP/native policy tests cover member count, single/aggregate inflation, advertised/unknown file size, and normal archive controls.
- Remaining uncertainty: device-specific memory pressure below the explicit ceiling was not benchmarked.

### LWC-010 — Hosted web offline failed on uncached lazy routes

- Severity / affected platforms: Medium; hosted web.
- Original trigger and impact: after an online visit, a cold offline navigation to an unvisited lazy route required a missing chunk.
- Repair: the Vite build emits a content-versioned service worker that precaches every emitted asset and serves same-origin cached chunks/navigations (scripts/vite-plugin-offline.mjs:1-80). Hosted production registers it after load; native shells do not (src/platform/offline.ts:1-10; src/main.tsx:28-35). Cache matching handles static-host Vary headers. Activation claims a first, already-open page without skipWaiting, so first-session lazy routes do not require a manual reload and an update does not mix old HTML with new hashed chunks.
- Expected/actual now: once installation completes, all shipped journal, Bible, search, and lazy-view assets are available without network in the current first session.
- Regression evidence: tests/e2e/offline.spec.ts requires an already-open first page—without reloading—to become controlled, then cold-loads unvisited routes offline. The strengthened test passed against final public build 55c5dff3f347 in an isolated native-ARM Alpine Chromium 152 container. Policy/startup tests verify clients.claim, absence of skipWaiting, and that the worker names every shipped chunk.
- Remaining uncertainty: Safari and Firefox were not run; first-ever load still necessarily needs the host.

### LWC-011 — Release artifacts could contain destructive debug cleanup

- Severity / affected platforms: Medium; web, iOS, Android release artifacts.
- Original trigger and impact: ambient DEBUG_TOOLS enabled SyntheticCleanup while artifacts still carried a “public” marker.
- Repair: native-assets forces DEBUG_TOOLS=0 and writes debugTools:false plus a SHA-256 over every path/content byte (scripts/native-assets.mjs:57-103). native-sync rejects a wrong profile, debug policy, byte count, or digest (scripts/native-sync.mjs:61-99). The final bundle verifier scans for debug sentinels (scripts/verify-bundle.mjs:79-93). Tests mutate same-length content to prove the digest, not size, is authoritative.
- Expected/actual now: modified, stale, or debug-bearing dist cannot be copied into either native shell.
- Regression evidence: 155 script policy tests pass; fresh public/native build, bundle/startup verification, and both native copies agree on build ID 55c5dff3f347 and contain no debug/private sentinels.
- Remaining uncertainty: no store-signed IPA/AAB was supplied; the verified local artifacts are not a claim about previously distributed builds.

### LWC-012 — Release/test gates were red and nondeterministic

- Severity / affected platforms: Low; development/release process.
- Original trigger and impact: default tests lacked the production debug define, excessive jsdom concurrency caused variable timeouts, and Android lint failed on android:tint.
- Repair: Vitest now defines __DEBUG_TOOLS__:false, limits workers to two, and has explicit bounded timeouts (vitest.config.ts:12-63); Testing Library has a consistent async timeout. The widget uses app:tint. A profile-matrix test proves every collected test executes successfully in at least one supported data profile.
- Expected/actual now: default, profile, script, lint, type, web build, iOS build, and Android build gates are deterministic on this host.
- Regression evidence: 131 Vitest files pass with 2,076 passed and 4 intentional skips; profile union contains 2,082 distinct tests, all passing in at least one profile. Android lint/test/assembly and the release gate pass.
- Remaining uncertainty: six existing React Fast Refresh warnings remain warnings, not correctness failures.

### LWC-013 — Read failures masqueraded as empty/missing data

- Severity / affected platforms: Medium; all.
- Original trigger and impact: post-open read rejection left initial []/undefined values, producing empty-state or missing-entry claims and allowing destructive decisions on incomplete data.
- Repair: useStorageQuery exposes data, loading, error, and complete separately and retains last known data while marking a failed read incomplete (src/app/storage.tsx:183-241). Shell surfaces a global alert. Search and EntryEditor have explicit local failure paths; EntryEditor distinguishes a successful not-found result from a failed read (src/views/EntryEditor.tsx:917-1051, 1708-1719).
- Expected/actual now: failed reads never become “your journal is empty” or “entry deleted,” and mutation UI does not mount on an unreadable target.
- Regression evidence: src/app/storage.read-failure.test.tsx, src/views/EntryEditor.read-failure.test.tsx, SearchView tests, and native-open failure tests cover rejection and genuine-empty controls.
- Remaining uncertainty: disk corruption/quota failure was injected at the provider boundary, not induced against a real user store.

### LWC-014 — Export could claim success before a durable file existed

- Severity / affected platforms: High; web and Android chiefly, common UI.
- Original trigger and impact: save returned void; Android resolved before stream close; anchor downloads gave no completion evidence.
- Repair: FileSaver returns committed, cancelled, or initiated (src/platform/ports.ts:37-58). File System Access awaits writable close and propagates write/close AbortError; only picker dismissal is cancellation (src/platform/web.ts:38-117). Android resolves after try-with-resources closes the provider stream (JourneyDocumentsPlugin.java:93-130). DataView only uses committed/current for definitive backup wording and reminder updates.
- Expected/actual now: “saved” requires an API-observable commit; the legacy anchor fallback says the download was started and leaves the backup reminder intact.
- Regression evidence: src/platform/file-saver.test.ts, src/export/save-result.test.ts, and DataView cancellation tests cover close failure, abort, cancel, initiated fallback, metadata failure, and committed controls.
- Remaining uncertainty: no slow/revoked real Android SAF or iCloud provider was exercised.

### LWC-015 — Picker/read errors were hidden

- Severity / affected platforms: Low; all import picker paths.
- Original trigger and impact: rejected providers/readers were treated as cancellation or became unhandled promises, leaving no actionable message.
- Repair: picker cancellation remains null while rejection flows through required FileChooser onError (src/components/FileChooser.tsx:25-95). DataView, ImportView, and SermonNotesImport surface “could not be opened or read; nothing changed.” Browser inputs clear immediately so retrying the same file fires change again (src/views/ImportView.tsx:207-231).
- Expected/actual now: cancellation stays quiet; failure is visible and retryable; existing journal data is untouched.
- Regression evidence: FileChooser paths are exercised through src/views/SermonNotesImport.wiring.test.tsx; ImportView same-file read-failure/retry and DataView native picker failures pass.
- Remaining uncertainty: provider-specific localized OS errors are intentionally normalized rather than exposed verbatim.

### LWC-016 — Android ignored standard EXTRA_TEXT shares

- Severity / affected platforms: Medium; Android.
- Original trigger and impact: the manifest accepted text/plain ACTION_SEND, but only EXTRA_STREAM was consumed.
- Repair: SharedDocument reads EXTRA_TEXT when no stream is present, caps it at 1,000,000 characters, and places it in the same synchronized take-once channel (android/.../SharedDocument.java:40-104). Custom-scheme launcher intents remain excluded.
- Expected/actual now: standard text shares reach review once; oversize text yields a visible safe error.
- Regression evidence: src/platform/android-share.test.ts inspects the actual Java path and covers take-once/bounds; Android build and APK verifier pass.
- Remaining uncertainty: a post-fix tap-through from a third-party physical Android app was not run.

### LWC-017 — iOS backup eligibility was absent from disclosures

- Severity / affected platforms: Medium; iOS disclosure, with aligned Android wording.
- Original trigger and impact: the SQLite file lives in backup-eligible Documents, while product copy implied only explicit exports leave the device.
- Repair: onboarding, About, Settings, and Help now state that device/OS backups may include the journal and that provider/account protection applies (src/components/FirstVisitNotice.tsx; src/views/AboutView.tsx; src/views/SettingsView.tsx; src/views/HelpView.tsx). App Lock remains accurately described as a screen lock, not encryption.
- Expected/actual now: the product’s privacy statement matches the platform storage path and Android backup rules.
- Regression evidence: source/UI tests pass and the iOS native project compiles.
- Remaining uncertainty: no real iCloud/Finder or Android cloud backup/restore was performed.

### LWC-018 — Full export was not one consistent journal snapshot

- Severity / affected platforms: High; all.
- Original trigger and impact: entries and drafts were read at different times; a newer accepted write could be absent while the export still became “current.”
- Repair: JournalSnapshot contains entries, drafts, capturedAt, and a deterministic content token (src/storage/journal.ts). Dexie and SQLite read both sets atomically (src/storage/db.ts:156-168; src/storage/sqlite.ts:704-716). exportEverything checks journalMatches after delivery and advances metadata only for a committed, still-current full snapshot (src/export/download.ts:74-122). Route-leave recovery writes are registered outside React and DataView waits or fails closed before import/export (src/storage/pending.ts:1-42; src/views/DataView.tsx:225-266, 352-405). Import preview uses the same optimistic token.
- Expected/actual now: the archive is internally consistent. If accepted journal content changes before delivery finishes, the file remains a valid older backup but is explicitly not current and does not silence the reminder.
- Regression evidence: storage contract, save-result, round-trip, pending-write, and DataView tests deterministically interleave writes with snapshot/export/import and cover the unchanged positive control.
- Remaining uncertainty: no remote-provider multi-minute save was driven on a physical device.

### LWC-019 — Backgrounding could strand the newest debounce window

- Severity / affected platforms: Medium; iOS/Android primarily, abrupt hosted-web termination secondarily.
- Original trigger and impact: background/termination inside the 400 ms debounce left newest text only in JavaScript memory.
- Repair: EntryEditor subscribes to the real Capacitor app-state abstraction, captures the latest rendered form, queues it again to close the render/effect gap, and immediately flushes the ordered writer on inactive/background (src/views/EntryEditor.tsx:859-891). Route unmount starts and globally tracks the same durability boundary (lines 893-909). Lifecycle listener failure does not mark work durable.
- Expected/actual now: a delivered background or in-app route-leave signal starts persistence immediately; backup/import waits for that write.
- Regression evidence: src/views/EntryEditor.lifecycle.test.tsx and src/storage/pending.test.ts inject background, failure, route leave, and normal foreground controls.
- Remaining uncertainty: no physical-device force-kill at 0/100/399 ms after typing. An OS can always kill before delivering or completing a lifecycle callback; device testing remains mandatory.

## Related defects found and fixed during remediation

These are not inflated into new finding counts because they share the audited root causes:

| Related defect | Consolidated under | Repair |
|---|---|---|
| Extracted showSaveFilePicker lost its Window receiver | LWC-014/LWC-015 | Invoke with window; regression test asserts receiver |
| AbortError during write was mistaken for picker cancellation | LWC-014 | Cancellation handled only around picker selection |
| Successful file plus failed lastExportAt write was reported as total export failure | LWC-014/LWC-018 | Separate delivery, current, recorded, and recordingError |
| Import preview could become stale before confirmation | LWC-003/LWC-018 | Expected journal token checked atomically |
| Explicit draft discard could race an in-flight put and resurrect the draft | LWC-001/LWC-004 | Retire, settle, delete; preserve post-confirmation edits |
| Route-leave draft could land after backup snapshot | LWC-018/LWC-019 | Global pending-write coordinator; DataView waits/fails closed |
| Slow delete accepted edits and later redirected another route | LWC-004 | Disable editor during delete and guard route identity |
| Unknown future draft fields were discarded | LWC-008 | Preserve at draft/form level in _unmigrated |
| Same failed file could not be selected again | LWC-015 | Clear input before asynchronous read |
| Android export success preceded OutputStream.close | LWC-014 | Resolve after scoped close |

## Verification commands and outcomes

Unless identified as a source-only check, commands used the actual application modules and disposable synthetic data. No personal journal was opened.

| Command / operation | Final outcome |
|---|---|
| npm run typecheck | PASS |
| npm run lint | PASS: 0 errors; 6 existing react-refresh warnings |
| npm test -- --reporter=dot | PASS: 131 files; 2,076 passed; 4 intentional skips |
| npm run test:profiles | PASS: public 2,076/2,080, refs-only 2,077/2,081; 2,082 distinct tests and every test passes in at least one supported profile |
| Focused final picker/import set | PASS: 4 files; 66 tests |
| npm run gate | PASS: no-private-data, 155 script tests, refs-only build, bundle and startup verification |
| npm run native:assets; npm run native:sync; public startup verifier | PASS: build ID 55c5dff3f347; 122 build files / 8,156 kB; 125 files copied to each native shell; no debug/private data |
| Xcode generic iOS simulator build | Earlier post-fix build SUCCEEDED. Final asset-only revision was synced and verified; immediate rerun aborted before compilation because macOS could not resolve its current user/cache directory |
| Gradle testDebugUnitTest lintDebug assembleDebug | BUILD SUCCESSFUL; 235 tasks |
| npm run verify:apk -- android/app/build/outputs/apk/debug/app-debug.apk | PASS: 15.7 MB and only the three expected permissions |
| npm audit --audit-level=low | Last successful run against the current package-lock: 0 vulnerabilities; final repeat was blocked by registry DNS |
| npm audit --omit=dev --audit-level=low | Last successful run against the current package-lock: 0 vulnerabilities; final repeat was blocked by registry DNS |
| npm ls @capacitor/cli source-map-js brace-expansion uuid --all | PASS: patched paths listed below |
| git diff --check | PASS |
| Playwright browser coverage | Earlier working-tree suite PASS: 176/176. Exact final build: every one of 176 cases passed across two complete isolated ARM Chromium 152 runs plus focused retries; strengthened offline test PASS 3/3. No application assertion failed; a single uninterrupted exact-tree sweep remains host-blocked |

Playwright note: the post-remediation host run completed the first 133 browser cases before macOS returned ENOSPC while writing a trace. The first affected diagnostic is ENOSPC, and the subsequent zero-duration failures are browser-launch fallout, not application assertions. An earlier full working-tree run passed 176/176, and the final FileChooser/import set passed its 66 focused tests. During the exact-tree retry, macOS also stopped resolving its launch-services domain and aborted Chromium before test code ran.

The exact public bundle (build `55c5dff3f347`) was therefore exercised in disposable native-ARM Alpine Chromium 152 containers. The strengthened first-visit/no-reload offline case passed once in isolation and in both complete runs. The first complete run recorded 167 passes, six expected read-only screenshot-output failures, and three 30-second IndexedDB setup timeouts after sustained service-worker precaching. With screenshot output moved to an isolated writable volume and the container-only timeout raised to 60 seconds, the second complete run recorded 174 passes and two late IndexedDB setup timeouts. Every first-run timeout passed in the second run; both second-run timeouts passed in a fresh 12-case retry. That retry later timed out in a different setup at 120 seconds, and that case had passed in both complete runs. Thus every one of the 176 cases passed against the exact final bundle at least once, all screenshot cases passed with the correct mount, and no application assertion failed. The rotating `indexedDB.open` stalls are recorded as container resource behavior, not as a clean single-run pass.

### Dependency state

The audited tool-only advisory paths were updated without adding runtime journal exposure:

- @capacitor/cli resolves to 8.5.3.
- source-map-js resolves to 1.2.2.
- brace-expansion resolves to 1.1.21 and 5.0.12.
- xcode’s uuid is overridden to 11.1.1.
- The most recent successful all-dependency and production-only npm audit runs against this unchanged package-lock both reported zero vulnerabilities. A later confirmation request could not resolve registry.npmjs.org and therefore is recorded as blocked, not as a passing query.

## Coverage after remediation

| Area | Inspected | Executed after fixes | Remaining gap |
|---|---|---|---|
| Entry create/edit/save/delete/draft/discard | Complete | React tests with real Dexie and deferred writes | Physical force-kill timing |
| IndexedDB transactions/snapshots/restore | Complete | Shared provider contract and import/export suites | Real quota eviction/disk full |
| SQLite queue/transactions/migrations | Complete | Real-SQLite contract bridge; Android/iOS compile | Post-fix physical-device runtime and kill injection |
| Export/import/backup/recovery | Complete | Round trips, malformed/truncated/bounded input, interleavings | Remote SAF/iCloud providers |
| Hosted offline/lazy routes | Complete | Final no-reload test PASS 3/3 in ARM Chromium; policy/build/startup verification | Safari/Firefox |
| Android integrations | Complete | Java tests/source checks, Gradle test/lint/APK, verifier | Physical share, App Lock, SAF |
| iOS integrations | Complete | Post-fix Swift/Xcode build; final web assets synced and verified | Final asset-only compile retry host-blocked; physical picker, iCloud, lifecycle |
| Privacy/network/build assets | Complete | Static search, bundle/native digest and APK permission verification | Packet capture/store-signed artifacts |
| Dependencies | Complete for installed graph | npm ls and successful zero-advisory audits | Registry was unavailable for the final repeat |
| Browser functions/accessibility | Complete in source/tests | Earlier 176/176 pass; every final-build case passed across two complete ARM Chromium runs and focused retries; no application assertion failure | Single uninterrupted exact-tree macOS sweep remains blocked by host launch services; Safari/Firefox |

## Release disposition and prioritized remaining verification

The source-level release blockers identified by the audit are repaired in this working tree. The prior audit’s HOLD disposition remains historically correct for commit 03a2722; this report supersedes it only for the uncommitted remediation tree.

For a preservation-focused journal, release should still wait for these verification steps:

1. On physical iOS and Android devices, type in every supported field, background at 0/100/399 ms, force-stop, and verify exact recovery.
2. Exercise explicit Save, draft writes, delete, migration, restore, and export while injecting native I/O failure and process termination.
3. Save to and read from slow, remote, revoked, and full Android SAF/iCloud providers; verify close failure and temporary-file cleanup.
4. Exercise Android App Lock enable/replace/recovery/failure and app-switcher privacy on hardware.
5. Perform real iCloud/Finder and Android cloud backup/restore and compare exact journal content.
6. Run hosted offline/download flows in current Safari and Firefox.
7. Build and verify the actual signed AAB/IPA/deployed site with the final-artifact verifier.

The app’s local-first architecture remains genuine: native editions require SQLite, hosted web uses IndexedDB, essential content is bundled/cached, and no account, telemetry, crash-reporting, or automatic journal-upload client was found. App Lock is still a screen privacy gate, not journal encryption, and the UI now says so alongside OS-backup disclosure.

## Handoff

All repairs are uncommitted for owner review. The historical audit is LIFE-WITH-CHRIST-BUG-AUDIT.md; this file records the corresponding remediation. Production code should not be committed or released until the owner reviews the diff and the remaining physical-device checks above are completed or explicitly accepted.
