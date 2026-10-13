# App and companion implementation — 2026-10-13

**Native release: HOLD.** Both components are implemented in manageable changes;
this record distinguishes source, automated checks, public-browser observations,
and hardware evidence. No real journal is a test fixture. No account, telemetry,
AI rewriting, relay, DNS change, or native store release was introduced.

## Authoritative sources and integration

- App: `systemslibrarian/my-life-with-christ`.
- Current owner main at integration start:
  `e65c1b36535a3d9d2b4dd02e81f4c797f0341ff6`, exact tree
  `17c657985f492bf3926e4ac2ae1e2f299087d7bc`.
- Initial audited source: `73ed084fdf877171447d766582a92a5c843f3571`.
  An initial review checkpoint reached remote branch
  `codex/companion-transfer-integrity` at
  `8e38d5185c6e84d2cb34cc8d180787e15799f6c7`.
- Merge preparation established that owner main already includes that audit
  plus four newer commits changing 90 files. The implementation was therefore
  ported onto **current main**, preserving its newer validation, bounded imports,
  ordered writes, snapshot tokens, backup freshness and platform contracts.
  The older, separately tested feature checkout was retained, not overwritten.
- Integration branch: `work/main-companion-integration`. Required E2E checks now
  run before merge on read-only `pull_request` events. There is no privileged
  `pull_request_target`, reduced gate, changed data profile or automatic deploy.
- [Existing repair PR #1](https://github.com/systemslibrarian/my-life-with-christ/pull/1)
  targets `ios/native-entry-sharing`. It is not the integration PR and was not
  merged merely because its audit ancestor is already in main.
- Companion authoritative source: existing Sites project
  `appgprj_6ac621170d0081918c34b68a6fe97f90`, starting source
  `81344cd471a2ec1f8be58b35e4bb2cd0bd92ec82`. It was recovered from the source
  repository, never reconstructed from screenshots.
- Companion source/docs final main: `cb065aead634686566dc1a0b43fc428d9e6050c2`;
  runtime is byte-identical to its deployed parent below.
- Companion version 3 deployed successfully, runtime/source
  `4c1a7bb904c817c277ed8c7790e53ade3aa64e41`, deployment
  `appgdep_6aceb03f9a08819183bc1146464032e8`, archive SHA-256
  `72174ae43f5c3c53e489da19620b6079f9f467a9494867ce917749fae10bb041`.
  Live public URL: <https://my-life-with-christ.systemslibrarian.chatgpt.site>.
  The prior saved version and source history are retained for rollback.
- The user-created ministry GitHub source handoff has a repository-name
  discrepancy (a literal trailing period). Writes are held for the owner's
  naming decision. Moving source does not move the site or browser journals.
- App Pages is not configured. No new app hosting destination was invented.
  `journal.prayersealed.org` is proposed only; no DNS/HTTPS/routing claim.

The owner subsequently authorized commit/push and merge/web deployment. This
supersedes the initial branch-only staging restriction, but not repository
checks or unresolved physical-device/native release holds. A previously denied
PR creation was not bypassed; any retry requires the newer explicit authority.

## Scope matrix: all twelve assignment sections

| Section | Implemented / retained | Remaining evidence or deliberate boundary |
| --- | --- | --- |
| 1 Discovery | Repository instructions, current branches, PRs, audit/release records, format specifications and authoritative companion source inspected. Exact main tree and original commit history recovered and checked. Unrelated work retained. | Final remote integration SHA/PR and CI are recorded below when verified. |
| 2 Principles | Local-first, no required account/backend/telemetry; distinct Notes, Reflection, Prayer and provided material; private sharing opt-ins; existing machine-readable identifiers retained. | Password protection covers transfer files, not local plaintext storage or an untrusted device. |
| 3 Durable plan | This record, format/preservation contracts, evidence files and pilot distinguish implemented, automatically verified, hardware verified, blocked and deferred. | Passing counts do not cover unrun hardware or assistive technology. |
| 4 Integrity first | Main's ordered/pending write barriers, truthful file delivery, freshness tokens, read failures, transactional restore/delete and bounded ZIP checks retained. Nested fidelity, stale cross-window writes and opaque draft promotion defects receive specific regressions. | Physical force-close, populated-device upgrade, Android App Lock, native provider final-close/cancel and real sharing remain unverified; native HOLD. |
| 5 Guided move | Companion selection separates finished entries/drafts; exact-content review, plain JSON/protected .lwc, directions and receipts. App authenticates existing v1 protection locally, previews, fences obsolete selections, preserves conflicts and skips repeats. | Use updated app's own journal file chooser. Native OS Open In/share routes remain church-handout routes. Private QR pairing explicitly deferred; no relay. |
| 6 Pastor/church | Existing sermon-notes v1, structured fields, outline editor, validation, recipient preview, examples/guide, drafts/templates, recoverable copies and public HTTPS URL QR. Received material stays separate. | Stable publisher document IDs/revisions assessed and deferred because trust/update semantics are not defined; no title-based automatic updates or directory/backend. Physical QR scanning unverified. |
| 7 Dashboard | Continue, sermon capture, church import, find, transfer and backup; welcoming empty states, optional details, truthful local-save/recovery status. | Optional revisit prompts deliberately omitted to avoid pressure/inference; not required for the main journeys. |
| 8 Preservation | Existing canonical ZIP/Markdown/manifest/printable book retained. Companion full canonical JSON and selectable readable output have distinct privacy promises. Envelope metadata includes empty journals; draft promotion retains opaque source snapshots. | Readable companion output is not falsely called the app's full archival ZIP/book. Actual destination reopening is still needed before relying on an external backup. |
| 9 Accessibility/offline | Companion labels/status/focus/contrast/local-assets checks, large-journal tests and real desktop cloud-browser smoke. App adds rendered protected-state axe/keyboard/reflow tests to both CI profiles. Existing main hosted cache and native bundled offline behavior preserved. | Real screen readers/voice/switch/phones, 200–400% zoom and 320px companion rendered reflow remain unverified. Companion cold-offline/update lifecycle assessed, not promised; no unsafe new worker added. |
| 10 Hosting | Existing public companion published, portable relative-path source/tests/lock/build/hosting docs and source bundle retained. Export → import → verify process documented for a future origin. | Ministry repo naming decision pending. No DNS, domain transition, paid service or native publication. Old origin retained. |
| 11 Complete Sunday | Fictional pastor → recipient → distinct personal writing → plain/protected move → duplicate/conflict → selected sharing → archive → isolated restore harness and pilot. | Integrated-main 16-stage rerun passed with unchanged source fingerprints. Programmatic DOM/IndexedDB evidence does not establish phone/browser durability or camera QR. |
| 12 Delivery | Focused commits, preserved rollback/source, mandatory local gate, exact remote-tree readback and required CI before merge. Companion live deployment evidence and pilot available. | Integration is not finished until final gates and remote state below are verified; native release remains HOLD afterward. |

## Important compatibility decisions

- `journey-export` remains version 1; stable filenames/IDs are unchanged.
- Local provider schema advances to 3 for opaque envelope metadata in a
  separate durable store. All full snapshots and restore tokens include it;
  merge unions source maps, replace explicitly replaces them, ordinary CRUD
  does not erase them. Filtered exports omit journal-wide private metadata.
- Single source maps preserve original root paths. Colliding maps retain every
  original under the existing companion carrier, with only unambiguous values
  projected. Wrapper-looking ordinary data is inert, not recursively decoded.
- Old native schema-2 readers refuse a schema-3 store. Historical Dexie readers
  may open the database but their old exporter cannot retain new metadata.
  Keep a current full archive and originals before any downgrade.
- Unknown nested fields survive ordinary editing and import. When a malformed
  known field cannot safely coexist with an occupied preservation slot, reject
  the file without storage mutation instead of silently overwriting either.
- The last opaque durable draft can be retained in a collision-safe private
  `_unmigrated` promotion receipt. Readable sharing/book generation does not
  expose it; full canonical backups preserve it.
- Protected files use existing PBKDF2-SHA256/AES-256-GCM and exact UTF-8
  passwords, with a 16MiB encrypted envelope and 11MiB plaintext ceiling.
  Plain/native-picked journals retain main's 64MiB raw cap. Parameters and
  canonical Base64 are checked before password derivation; authenticated
  plaintext is validated before preview. This is not an independent crypto audit.

See [protected format](PROTECTED-TRANSFER-FORMAT.md),
[envelope preservation](JOURNAL-ENVELOPE-PRESERVATION.md),
[draft promotion](DRAFT-PROMOTION-PRESERVATION.md) and
[fictional acceptance pilot](SUNDAY-PILOT-ACCEPTANCE.md).

## Evidence ledger

Intermediate evidence, not a final aggregate claim:

- Old separately preserved feature source `41165e3c...`: typecheck, lint,
  guarded native assets/sync and both-profile suites passed. This does not
  substitute for testing the current-main integration.
- Current-main protected/import/restore focused first run: 75 pass, 4 fail.
  Failures were three changed-wording expectations and one test's asynchronous
  pending-write setup; the restored main-compatible wording and explicit seam
  yielded 53/53 passing DataView/protected/workflow cases.
- Required E2E workflow policy: 25/25 pass. Reintroducing push-only condition
  fails 1 regression; restoration passes. Permissions remain contents:read.
- Current-main migration: complete focused86-case pass; replacing the implementation
  with owner-main baseline fails66 regressions, then84 pure cases pass restored.
  The two provider-integrated cases passed in the preceding86-case run and are
  included again in final aggregate verification.
- Pending confirmation/unmount: removing both barriers fails2 deterministic
  cases, and all13 protected-screen cases pass restored. Combined transfer,
  screen and cancelled-export matrix passes59 cases.
- Production dependency audit: `npm audit --omit=dev --json` reports0 vulnerabilities.
- Picker request fencing: reintroducing late DOM/native ownership fails both
  targeted races; restoring it passes both. These deterministic tests do not
  claim statistical elimination of unrelated focus races.
- Companion final runtime: fresh 76/76 tests pass, no skips/failures. Real cloud
  browser verified dashboard, synthetic autosave/navigation/reload/reopen,
  separate fields, sharing defaults and opt-in, Escape/focus return, transfer
  review/cancel, pastor preview/QR and version-3 same-page feedback corrections.
- Public asset byte hashing is unverified: executor HTTP requests returned403;
  no authentication/header workaround was attempted. Saved-source/archive
  provenance plus actual live execution are the evidence available.
- The local Chromium process cannot open its required Unix socket. The cloud
  browser can inspect the live companion, but cannot reach executor localhost;
  no undocumented tunnel was used. App rendered checks must come from required
  CI or another supported environment, not from these blocked local attempts.

Final frozen-source verification, remote commits, PR and CI results are appended
when completed. An environment interruption preserved work but stopped workers
mid-port; source restoration was checked before verification resumed.

## Acceptance and remaining release gates

1. Use only fictional data in isolated profiles/devices for the linked pilot.
2. Confirm entries and separate drafts transfer, preview, import once, skip
   repeats and preserve changed versions. Compare exact canonical fields.
3. Cancel a backup, exercise failed/final-close saves, then reopen a successful
   destination copy and restore it into an empty isolated journal.
4. On physical Android/iPhone, run [device acceptance](PHYSICAL-DEVICE-ACCEPTANCE.md)
   and [iPhone sharing acceptance](IOS-SHARE-ACCEPTANCE.md) against the exact
   candidate: interrupted writing/relaunch, populated upgrade, App Lock lifecycle,
   document providers, native sharing/cancellation and real church-file QR.
5. Use actual assistive technology and narrow/zoomed browsers; record build,
   browser/OS, observations and synthetic screenshots, not private writing.
6. Keep the native release HOLD until mandatory device evidence and the
   separate signing-key backup/release decisions are satisfied. Historical A17
   or simulator evidence is not acceptance of this candidate.

## Final frozen-source verification — 23:39 UTC

- Runtime source commit: `83c71561f4461a7f2531e6336b5597c912751e6e`.
  An ancestry-only merge `d2be7187d416875f5a129d3754cc1263c84ba4fe`
  preserves the earlier remote checkpoint without changing this tree:
  `44353eb64c2009d7ccad7e68adfe61eb85a14c73`.
- Full typecheck, lint (zero errors; six existing refresh warnings), guarded
  native asset build/sync, both-profile tests, mandatory full-history pre-push
  gate, public and refs-only bundle/startup gates, and diff checks passed.
  The pre-push privacy scan examined 625 files and 147 commit messages.
- Profiles collected 2,335 public and 2,336 refs-only assertions, with no
  assertion failures. All 2,335 distinct names passed under at least one
  profile. The existing summary uses name sets, so its six not-run-or-failed
  count includes two duplicate names as well as four shape skips per profile;
  it is not a report of six failing tests.
- Playwright discovered 182 tests across 26 files. Discovery is **not**
  execution. The six required remote CI jobs still need actual successful
  completion before merge; inaccessible local Chromium is not a browser pass.
- The independent integrated-main Sunday harness passed all 16 stages, with
  zero network calls or unhandled errors. Exact plain/protected transfers,
  entries, drafts, three opaque source maps, duplicate/conflict handling,
  reverse ZIP restore and delivery freshness all passed. All 185 examined app
  and 11 companion files retained their fingerprints. The earlier evidence
  bundle is also preserved unchanged.
- Reintroduced defects failed before restoration: declaration validation,
  unreadable UTF-8, migration preservation, picker ownership, pending/unmount
  barriers, envelope privacy, metadata tokens, SQLite serialization and
  editor promotion/concurrent-write/terminal-action safety. Detailed provider
  mutation counts are in the preservation contracts; final focused run was
  439 tests in 17 files, followed by 78 provider and 5 helper cleanup checks.
- Structured records: [final gates](evidence/2026-10-13-final-gates.json) and
  [integrated Sunday](evidence/2026-10-13-sunday-results.json). Sunday bundle
  SHA-256: `1103fc2e1fd7d7551867de3b1bc51b2978ae166a21a001f172226c85694c13c0`.

These final documentation/evidence additions do not change runtime source.
The mandatory pre-push gate is run again after committing them. GitHub's current
branch-protection read returned403 (integration access); the six documented
required checks remain mandatory, with no admin bypass. Remote integration and
CI results are recorded in the review request and final delivery once verified.
Native release remains **HOLD**.
