# Cohesive journal and companion implementation — 2026-10-13

**Native release decision: HOLD.** This is a staged implementation record, not a
release sign-off. A passing browser test, mock, Node SQLite test or native build
never establishes physical-phone behavior. No merge, deployment, DNS change or
native release is part of this work.

## Provenance and starting state

| Component | Authoritative starting point | Work branch / ending state |
| --- | --- | --- |
| App, `systemslibrarian/my-life-with-christ` | Audited source `73ed084fdf877171447d766582a92a5c843f3571`, from `codex/remediate-adversarial-audit` | `work/companion-transfer-2026-10-13`; verified implementation source `428cfde94a19846aef316757fcfcdb84258cd950`; documentation-only commit follows |
| Local app reconstruction | All 590 source files were byte-verified before editing. Snapshot baseline `912b961401eddf075e6f9342b0600dc696b6f3a6`; tree `7dd4ff1c6e3177854d7a80a9326ce37d5845eafe` also matched the upstream commit tree through the GitHub API | This local snapshot commit is not the upstream audited commit; do not conflate their histories. |
| Companion, Sites project `appgprj_6ac621170d0081918c34b68a6fe97f90` | Existing authoritative source starting commit `81344cd471a2ec1f8be58b35e4bb2cd0bd92ec82` | `improve/companion-integrity-transfer`; ending source/delivery commit `454bf37af6460597e5eeb3cff59c4d27180ac296` |

App `main` was `e65c1b36535a3d9d2b4dd02e81f4c797f0341ff6` at discovery.
[Repair PR #1](https://github.com/systemslibrarian/my-life-with-christ/pull/1)
remains open against `ios/native-entry-sharing` at
`03a2722564af0daf7d1d367acb7a1d38296129e7`; its head is the audited source above.
On 2026-10-13, the connector returned no submitted reviews or inline review
threads. [CI run 37986066324](https://github.com/systemslibrarian/my-life-with-christ/actions/runs/37986066324)
is successful: data gate, all-profile typecheck/lint/tests, and public/refs-only
accessibility jobs passed. The full E2E job was **skipped**, not passed.
Those checks cover the previous head, not the new implementation below.

A new stacked draft is prepared for remote branch
`codex/companion-transfer-integrity`, based on
`codex/remediate-adversarial-audit` at `73ed084`. At this record's commit,
the full-history pre-push gate and remote PR verification are still subsequent
steps; no new PR URL, remote CI pass, merge or publication is claimed here.
The original 130 upstream Git commit objects were recovered SHA-exact for that
gate rather than substituting a history-free scan. The final delivery/follow-up
record must identify the verified remote head and PR when available.

The existing companion address is
<https://my-life-with-christ.systemslibrarian.chatgpt.site>. Changes in this
record are not evidence that this address serves the new work.
`journal.prayersealed.org` remains a proposed destination; no DNS, HTTPS or
routing claim is made.

## Evidence vocabulary

- **Implemented**: source changes exist, without implying verification.
- **Verified automatically**: named executable checks passed on the stated code.
- **Verified on hardware**: a named physical device, build and captured result.
- **Blocked**: required access, decision or evidence is missing.
- **Deferred**: intentionally outside this staged milestone.

## Staged work ledger

| Item / component | Current evidence and intended behavior | Dependencies | Status, verification and limitations |
| --- | --- | --- | --- |
| Existing integrity repairs / app | LWC-001–019 in [audit tracker](AUDIT-REMEDIATION-TRACKER.md) already implement save fencing, recoverable drafts, transactional restore/delete, stale-write checks, explicit read failures, bounded imports and truthful provider-close acknowledgement. Preserve them. | Existing provider contracts and fault-injection suites | Implemented before this work; prior CI verified automatically. Hardware checks below remain blocked. Do not rebuild these features as though absent. |
| Nested import fidelity / app | Confirmed migration rebuilt source/provided material, links and anchors while discarding extensions and `ScriptureRef.note`; draft record extensions were also discarded. Preserve nested extensions as inert own data, and unknown draft fields in `_unmigrated`. | Existing archive/provider representation; no storage-schema change | Implemented in `71f0a5ec6fe1db3025dc09f06496d6d5087cbdc4` and verified automatically: new regression suite grew from 11 to 18 cases; final combined archive matrix has 81 passing tests. Reintroducing original migration causes 8 failures in the initial 11 cases. Empty provided Scripture arrays also remain intact. Known field validation still applies. |
| Colliding unknown fields / app | Confirmed a top-level unknown field could overwrite a different older value in `_unmigrated`. Retain the original top-level field when its migration destination is occupied, with an explicit warning. | Existing opaque record storage; no new namespace | Implemented in `c8e811e`; 7 new cases fail on the pre-fix implementation and pass with the fix, including prototype-looking keys and persisted archive restore. |
| Ordinary editor metadata / app | Confirmed link hydration/save rebuilt known fields only, and draft autosave rebuilt record metadata. Preserve inert extensions on ordinary Save, autosave, conflict fork and orphan recovery. | Existing editor and provider snapshots | Implemented in `428cfde`; 4 new UI regressions fail on original code; fixed editor/draft/migration matrix passes 89 tests. Draft-to-completed-entry promotion semantics remain unchanged; see limitation below. |
| Incoming conflict IDs / app | A generated conflict ID could collide with a later incoming record and lose that record; prior `journeyImportConflict` metadata could be overwritten. Reserve incoming IDs and preserve both provenance values. | Existing deterministic conflict-copy importer | Implemented in `2b8ceeb`; independently verified with both input orders, repeat import and existing metadata. Reimporting an already preserved conflict is classified unchanged in preview/receipt. |
| Reviewed restore snapshot / app | Newly confirmed: Replace re-read the journal at confirmation, so writing created after preview could be deleted. Pass the exact reviewed entry/draft snapshot into the provider's existing atomic comparison. | Existing transactional journal compare-and-swap | Implemented and verified automatically in the 4-case DataView transfer suite. Reintroducing both selection/preview defects causes both targeted regressions to fail. A stale preview must fail safely and preserve intervening writing. |
| File selection race / app | Newly confirmed: generation fencing began after `File.arrayBuffer`, and a pending native picker could finish after a newer choice. Fence before the picker/read and retain generation ownership through parsing. | Existing import selection lifecycle | Implemented and verified automatically. Initial preview/read mutations fail 2 cases; later native-picker/conflict mutations fail 3 targeted cases, then restored fixes pass. Latest selection owns password and preview state. |
| Protected `.lwc` receiving / app | Previously companion-only encrypted format. Authenticate its existing v1 envelope before parsing, then use ordinary preview/conflict/import path. | Web Crypto, compatible file picker and existing canonical importer | Implemented with exact v1 parameters, canonical Base64, a 16 MiB encrypted-envelope ceiling and 11 MiB plaintext ceiling. Password bytes are not trimmed/normalized. Shared synthetic OpenSSL fixture, wrong-password, tamper, parameter and size-limit cases pass; final aggregate commands/results recorded below. Physical Open In, Files and Android provider routes remain unverified. |
| Guided move / companion | Separate entry and unfinished-draft selection, explicit review and portable file option; receipt must describe receiving storage operations rather than browser download initiation. | App-compatible JSON/protected importer and conflict behavior | Implemented and automatically verified in the companion's 44-test suite; exact record in its `docs/IMPLEMENTATION-2026-10-13.md`. No private QR pairing, relay or cloud sync. |
| Pastor workflow / companion + app | Reuse `my-life-with-christ-sermon-notes` v1; title/church/speaker/date/Scripture, preview, actionable validation, saved drafts/templates, examples and public HTTPS QR. Received material stays separate from personal fields. | [Authoritative sermon format](SERMON-NOTES-FORMAT.md); existing parser | Companion recipient preview, templates, recovery copies, errors and guide links are implemented and automatically verified. QR generation does not upload a file, verify a church identity or prove the URL is reachable. Document-ID/revision update semantics remain deferred; opaque metadata is not an automatic-update feature. |
| Dashboard and local-save truth / companion | Continue writing, fast capture, church import, search, move and backup; failed save keeps visible writing and gives a recovery action. | Existing browser persistence | Implemented and automatically verified in companion core/storage/DOM tests; actual browser/device behavior remains unverified. Do not treat an autosave label as evidence until its write completes. |
| Preservation / both | Keep completed entries and drafts distinct; canonical `journey-export` v1; app archive and printable My Journey With Christ remain authoritative. Selected sharing must not be described as a complete backup. | Existing app archive generator; compatibility tests | Existing app functionality retained. Companion canonical JSON and readable output do not claim to be the app's full ZIP/book. Envelope metadata gap below prevents an unlimited lossless claim. |
| Accessibility / companion | Keyboard, focus, labels/statuses, contrast, enlargement/reflow, touch targets and reduced motion need evidence. | Rendered browser and assistive technology | See companion `docs/manual-acceptance.md`. Automated or jsdom results alone are not WCAG 2.2 AA certification or screen-reader acceptance. |
| Offline / both | Native bundled journaling remains offline-capable; hosted browser is a separate cache-dependent contract. | Existing native package; browser cache | Native current-candidate hardware checks blocked. Service worker and safe active-session update protocol deferred; no guaranteed offline cold start for companion. |
| Domain transition / companion | Portable static build, old-origin export → new-origin import, source retained until receipt and backup comparison. | Approved hosting, DNS, HTTPS and deployment | Preparation only; changes to origins do not move browser storage. No destination published or DNS changed. |
| Complete Sunday journey / both | Fictional publisher → congregant → transfer → dedupe/conflict → private sharing → isolated backup restore. | Integrated code, test host, physical phones for last-mile checks | [Short pilot](SUNDAY-PILOT-ACCEPTANCE.md) prepared. No completed hardware pilot or participant contact claimed. |

## Checks performed during this stage

| Command / observation | Result | Scope |
| --- | --- | --- |
| `npx vitest run src/export/migration-fidelity.test.ts` | PASS: 18 tests | Nested extension fidelity, Scripture note, draft metadata, hostile property names, validation and import/IndexedDB reopen/archive/isolated restore/identical re-export |
| Same command with original audited `migrate.ts` restored temporarily | Expected FAIL: 8 failed, 3 passed in the original 11-case suite; fix then restored | Mutation proof required by `CLAUDE.md`; regression is actually detected |
| `npx vitest run src/export/migration-fidelity.test.ts src/export/downgrade.test.ts src/export/drafts-archive.test.ts src/export/provided-notes.test.ts src/export/roundtrip.test.ts` | PASS: 5 files, 81 tests | Current migration fix plus existing import/export compatibility; run again after final migration cleanup |
| `npx eslint src/export/migrate.ts src/export/migration-fidelity.test.ts src/views/EntryEditor.tsx src/views/EntryEditor.fidelity.test.tsx` | PASS: no errors or warnings | Changed migration/editor production and regression files |
| `npx vitest run src/views/DataView.protected-transfer.test.tsx` (integration-owner report) | PASS: 4 tests; both targeted regressions fail when their defects are reintroduced | Password/preview flow, stale destructive-preview protection and earlier slow file selection |
| `npx vitest run src/export/migration-fidelity.test.ts` with pre-collision migration temporarily restored | Expected FAIL: 7 failed, 11 passed; restored fix PASS: 18/18 | Both values survive occupied migration slots, including inert prototype-looking keys |
| `npx vitest run src/views/EntryEditor.fidelity.test.tsx` | PASS: 4/4; original editor fails all 4 | Ordinary link Save, draft autosave, concurrent recovery copy and orphan metadata |
| `npx vitest run src/views/EntryEditor.fidelity.test.tsx src/views/EntryEditor.drafts.test.tsx src/export/migration-fidelity.test.ts` | PASS: 3 files, 89 tests | Existing draft lifecycle coverage plus final focused fidelity changes |
| Protected importer/DataView regression matrix | PASS: 30 focused tests (integration-owner report) | Authentication, limits, preview/receipts, repeat conflicts, ID collision/provenance preservation and picker fencing |
| Intermediate `npm run test:profiles` before the final metadata/editor changes | PASS: public 2,143/2,147; refs-only 2,144/2,148; 2,149 distinct cases pass in an applicable profile | Retained as intermediate evidence only; final rerun required below |
| Final `npm run typecheck` at `428cfde` | PASS | TypeScript build check |
| Final `npm run lint` at `428cfde` | PASS: 0 errors, 6 pre-existing Fast Refresh warnings | Warnings remain in router/storage/theme component-export files |
| Final `npm run native:assets` | PASS: public-profile web build and bundle gate; 121 files, 8,155 kB searched, all 3 sentinels found | Code/assets built for native packaging; build identity starts `f6734eb696be`. Build warnings concern large lazy chunks and existing mixed static/dynamic Capacitor imports; no native compiler or hardware assertion |
| Final `npm run native:sync` | PASS: copied Android and iOS public assets each verified, 124 files per package | Packaged web assets only; not an Android Gradle or iOS Xcode build |
| Final `npm run test:profiles` at `428cfde` | PASS: public 2,154/2,158; refs-only 2,155/2,159; 2,160 distinct cases pass in at least one applicable profile | Four cases not run in each individual profile; profile-coverage verifies every distinct case under an applicable shape. No failing case hidden by a test count |
| `npm audit --omit=dev` (integration-owner report, unchanged dependency lock) | PASS: 0 vulnerabilities | Production dependency advisory check, not an independent security audit |
| Companion `npm test` | PASS: 44/44, no skips (companion-owner report) | Core/storage/DOM compatibility, import atomicity and counts, repeat/conflict handling, drafts/templates, selected readable copies and storage persistence states; no rendered-browser proof |

No new physical-device, native-build, QR-camera, real document-provider,
VoiceOver/NVDA/TalkBack, or deployment verification was performed in this stage.
Native asset build/sync verification does not establish a native compilation or
physical-device pass.

## Compatibility boundaries and remaining integrity limitation

The app and book names do not change any machine-readable identifier. Journal
`journey-export` v1, `data/journey.json`, SQLite identity and the browser database
name remain unchanged. Existing v1 archives still import; nested extension
values remain data and are not executed, rendered as HTML or interpreted as
verified publisher identity. A draft stays a draft and never enters the finished
book just because it crossed devices.

**Envelope-level unknown metadata is not persisted by the app.** The companion
can retain such metadata; the app's current storage contract only carries
entries/drafts, and canonical export reconstructs the envelope. The import path
now warns before confirmation and tells the user to retain the original file.
No full-envelope losslessness claim is justified. A future repair needs an
explicit persistent opaque-envelope metadata contract, including empty journals,
merge/replace semantics and export behavior. Hiding it on an arbitrary entry
would be an unreliable substitute and was not implemented.

Preserved unknown fields are verified across import/storage/re-export; ordinary
entry editing and draft autosave also retain their opaque metadata in the new
UI tests. **Promoting an imported draft to a completed entry is a separate
boundary:** unknown draft-only metadata has no defined equivalent on the entry,
and the current Save path retires the draft. No new provenance format or
promotion policy was invented here. Keep the original transfer/backup if that
metadata matters; this is not an unlimited future-schema fidelity guarantee.

Protected transfer uses the existing Web Crypto-based format. No independent
security review was performed. Password protection covers the transferred file,
not the local database, already unlocked copies or an untrusted device.

## Browser verification limitation

Rendered staged-source QA remains blocked. A local Chromium launch was denied
its required Unix socket, including the reviewed retry. The supported cloud
browser was available but could not reach the executor's loopback preview; no
supported forwarder was exposed. Neither failure is an accessibility pass.
No staged screenshots, rendered contrast/reflow, axe browser run or real
screen-reader session is claimed. Companion DOM assertions and static local-asset/
CSP checks are useful, narrower evidence. Use the companion's prepared
`tests/browser-qa.mjs` and manual checklist on a reachable authorized preview.

## Native release gates remain unresolved

Execute [physical-device acceptance](PHYSICAL-DEVICE-ACCEPTANCE.md) and
[iPhone sharing acceptance](IOS-SHARE-ACCEPTANCE.md) on the actual candidate:

- Interrupted writing, background/force-close/relaunch and draft recovery.
- Populated-version upgrade with unchanged journal accessibility.
- Local/cloud document providers: cancel, open/write/flush/final-close failure
  and reopened archive validation. Provider acceptance is not physical-media
  durability or completed cloud synchronization.
- Android App Lock background/resume, force-stop, credential cancellation and
  activity recreation; content must never flash before authorization.
- Native text/PDF sharing with reflection, prayer and provided notes OFF by
  default; cancellation must preserve the entry.
- Real inbound external-app Share/Open In, physical QR scanning and native
  protected-file password/preview/import routes.

September A17 evidence in `RELEASE-STATUS.md` is historical evidence for its
named build, not sign-off for the October repairs or this candidate. The audit
tracker records an iOS simulator share test as **skipped** below the reachable
viewport; it is not a system share-sheet pass. Its Android connected-test attempt
was blocked by an unresponsive emulator; it is not an instrumentation pass.

The signing-migration hold also remains: an off-machine backup of the current
Android debug signing key must be confirmed before changing signing identity.
Prior Play package/version history and publication decisions require their own
verified evidence; no credentials, signing changes or store action were attempted.

**Next decision:** review the staged diff and fresh aggregate results; then run
this fictional pilot on isolated supported Android/iPhone test devices. Keep the
native release on HOLD until all mandatory device evidence is recorded.
