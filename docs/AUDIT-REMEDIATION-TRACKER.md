# October 2026 adversarial audit remediation tracker

The permanent tests named below reproduce the original failure condition and
assert final persisted state. The commit column identifies the focused repair
commit; a second SHA means that the provider correction and its user-facing
path were necessarily completed together.

| ID | Reproduction | Correction | Permanent regression evidence | State | Commit |
| --- | --- | --- | --- | --- | --- |
| LWC-001 | Delayed canonical/draft writes while typing | Generation fencing, durable child draft, background flush | `EntryEditor.drafts.test.tsx` | Verified in unit/storage tests | `111767f` |
| LWC-002 | Required entry/draft/archive read throws | Full export fails; no saver or reminder update | `save-result.test.ts` | Verified in unit tests | `111767f` |
| LWC-003 | Restore write failure and preview race | Atomic provider journal mutation with exact pre-commit snapshot | storage contract; `roundtrip.test.ts` | Verified in IndexedDB and Node SQLite | `31d3416`, `111767f` |
| LWC-004 | Anchor download treated as saved | Four-state save result; verified File System Access path | `file-saver.test.ts`; `DataView.cancelled-export.test.tsx` | Verified in browser adapter tests | `111767f` |
| LWC-005 | Supported App Lock bridge/listener failure | Supported failures keep descendants unmounted and expose retry | `app-lock.gate.test.tsx` | Verified with fault injection | `111767f` |
| LWC-006 | Hosted site described as fully offline | Native/browser contract and route error wording made explicit | `sections-failure.test.tsx`; Help/README | Verified for wording/build; real-device offline remains a release check | `111767f` |
| LWC-007 | Replace retained old drafts | Atomic exact replacement of entries and drafts | storage contract; `roundtrip.test.ts` | Verified in both providers | `31d3416` |
| LWC-008 | Saved-entry draft linked to new-entry route | Home routes by `entryId`; orphan fallback remains recoverable | `HomeView.drafts.test.tsx` | Verified in view tests | `111767f` |
| LWC-009 | Delete left attached private draft | Atomic entry/attached-draft deletion | storage contract | Verified in both providers | `31d3416`, `111767f` |
| LWC-010 | Failed read rendered empty data | Explicit error/stale query state and destructive-action blocking | `storage-query-failure.test.tsx`; `LegacyView.test.tsx` | Verified in view tests | `111767f` |
| LWC-011 | Stale/cross-tab writes overwrote data | Transactional optimistic checks for entries, drafts and restore snapshots | storage contract; `multi-writer.test.ts` | Verified with deterministic/randomized interleavings | `31d3416` |
| LWC-012 | Clock-only import winner | Conflicting content is preserved; clocks never select a winner | `roundtrip.test.ts` | Verified for older/equal/newer timestamps | `31d3416` |
| LWC-013 | Duplicate imported IDs collapsed | Duplicate entry/draft IDs rejected before preview/storage | `drafts-archive.test.ts` | Verified in migration tests | `31d3416` |
| LWC-014 | Unbounded picker and ZIP allocation | Native/browser pre-read caps and bounded ZIP reader | `journal-resource-limits.test.ts`; `security.test.ts`; adapter tests | Verified in shared/adapter tests | `111767f` |
| LWC-015 | Malformed draft persisted | Strict nested draft runtime validation with extension preservation | `drafts-archive.test.ts` | Verified in migration tests | `31d3416` |
| LWC-016 | Canonically equivalent Unicode missed | NFC normalization on query and derived search text | shared storage contract | Verified in IndexedDB and Node SQLite | `31d3416` |
| LWC-017 | Vitest lacked debug constant | Release-safe `__DEBUG_TOOLS__ = false` in Vitest | full default suite; debug asset policy | Verified by test/build gates | `111767f` |
| LWC-018 | Picker errors looked cancelled | Typed picked/cancelled/failed results across adapters/UI | `file-saver.test.ts` | Verified in adapter tests | `111767f` |
| LWC-019 | Android resolved backup success before the document-provider stream closed | Success is emitted only after open, write, flush and close all complete; failures remain content-free | `DocumentSaveOperationTest`; `file-saver.test.ts` end-to-end metadata assertion | Verified in JVM and TypeScript fault-injection tests; physical providers remain a release check | `744a8c6` |

## Native verification limits

The Android unit, lint, and debug-assembly gates pass under JDK 21.0.10. The
close-sensitive save operation has JVM coverage for open, write, flush, close,
null-stream and cancellation outcomes, and its TypeScript path proves that a
native rejection leaves backup-reminder metadata unchanged. These tests do not
establish physical-media durability or document-provider/cloud synchrony.

The iOS app compiles for an iPhone 17 Pro simulator under Xcode 27.0. The
original `ShareUITests` failure was reproduced on the untouched audited commit:
after Title moved the document, the harness did not dismiss the software
keyboard and then tapped the centre of Notes behind it. WebKit still reported
Notes as hittable, but Title retained keyboard focus. The repaired harness
blurs through a safe page gutter and verifies the element that actually owns
keyboard focus before typing. On the simulator, Title, Notes and Reflection now
accept their synthetic markers; the test then reports **skipped**, rather than
passed, because Prayer and the share controls are below the WKWebView viewport
that XCUITest cannot scroll. Text, preview and parsed-PDF privacy tests verify
the three private-content options default off and excluded content is absent,
but the native system share sheets still require the device procedure.

No physical Android or iOS device was available. Process-kill/relaunch,
document-provider behavior, Android App Lock lifecycle behavior, and native
upgrade and iOS system-sharing tests therefore remain release checks rather
than claimed passes. See `docs/PHYSICAL-DEVICE-ACCEPTANCE.md`.
