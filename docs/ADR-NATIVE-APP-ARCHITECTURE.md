# ADR: Native application architecture

**Status:** Accepted. **Phase 0 complete** — the seams exist and the web
edition runs through them. No native code, no native dependencies, no `ios/` or
`android/`. Implementation continues at Phase 1.

**Date:** 2026-09-16
**Supersedes:** nothing
**Applies to:** My Life With Christ (web, iOS, Android)

---

## Context

My Life With Christ is a React + TypeScript + Vite application that runs as a
static site with no backend. It is shipped publicly from GitHub Pages under the
`public` data profile. The intent is now to ship it as a paid iOS and Android
application without maintaining three implementations of the same product.

The governing principle applies to this decision as much as to the file formats:

> We are not building a place to store notes. We are building a record of a life
> with Christ that can outlive the software that created it.

A native architecture that makes the journal *less* durable than the web edition
would fail that test regardless of how pleasant it was to build.

---

## Product invariants this decision must not break

These are existing, enforced behaviours — not aspirations.

1. **No account, no backend, no runtime network calls.** Verified: production
   code contains zero `fetch`, zero `XMLHttpRequest`, zero `serviceWorker`, zero
   `navigator.*`.
2. **Notes and reflection are separate fields** and are never merged.
3. **Entries are private by default**; prayers and reflections are never shared
   implicitly.
4. **The archive is the durable artefact.** `CLAUDE.md`: browser storage is the
   working copy, the export is what survives.
5. **The canonical archive layout is fixed** — `README.txt`, `MANIFEST.txt`,
   `data/journey.json`, `data/schema.json`, `data/entries.csv`, `indexes/*.md`,
   `book/my-journey-with-christ.html`.
6. **No licensed third-party material may reach a distributed artefact.**
   Enforced by `scripts/verify-bundle.mjs` against built files, not flags.
7. **WCAG 2.1 AA is checked in CI**, against the built site.

---

## What the inspection found

The decision rests on this, not on framework preference.

### The shareable core is already pure

| Module | DOM/browser coupling | Verdict |
| --- | --- | --- |
| `src/types/` | none | shared unchanged |
| `src/lib/` (canon, passages, search, markdown, bible, dates, book-aliases) | none — the only matches are the word "document" in comments | shared unchanged |
| `src/export/` except `download.ts` | none — pure string and byte generation | shared unchanged |
| `src/import/` | none — the `document` identifiers are a local variable holding a parsed file | shared unchanged |
| `src/storage/StorageProvider.ts` | none — an interface of 15 methods | the native seam |
| `src/storage/db.ts` | IndexedDB via Dexie | web implementation; native needs its own |

The archive generator — the thing that produces *My Journey With Christ* — takes
entries and returns strings and bytes. It touches no DOM at all. That is the
single most important finding in this document: the part of the product that
must be identical across editions is already platform-free.

### The browser-coupled surface is small and localised

Counted across production code (tests excluded):

| API | Count | Where | Classification |
| --- | --- | --- | --- |
| `fetch` | **0** | — | nothing to adapt |
| `serviceWorker` | **0** | — | nothing to adapt |
| `navigator.*` | **0** | — | nothing to adapt |
| `indexedDB` (direct) | **0** | Dexie encapsulates it | adapter at `StorageProvider` |
| `localStorage` | 4 | `app/theme.tsx`, `components/FirstVisitNotice.tsx` | works unchanged; already `try`/`catch` guarded |
| `matchMedia` | 3 | `app/theme.tsx` | works unchanged; already `typeof` guarded |
| `window.print()` | 1 | `views/LegacyView.tsx` | **needs a native adapter** |
| `beforeunload` | 2 | `views/EntryEditor.tsx` | **needs a native adapter** (no such event in an app) |
| Blob + `createObjectURL` + anchor click | 5 | **`src/export/download.ts` only** | **needs a native adapter** |
| `<input type="file">` | 2 | `views/DataView.tsx`, `views/ImportView.tsx` | works in a webview; better replaced by a native picker |
| `location.hash` / `hashchange` | 1 file | `app/router.tsx` | works unchanged; Android back needs a binding |
| `CompressionStream` / `DecompressionStream` | 4 | `export/zip.ts`, `import/zip-limits.ts` | **risky — see below** |

**The whole of file export is one file, `src/export/download.ts`, four lines of
DOM.** Every other part of producing an archive is platform-free.

### The one genuinely awkward finding

`src/export/zip.ts` degrades gracefully when `CompressionStream` is missing — it
stores instead of deflating, so an archive is still produced. But `inflate()`
**throws** when `DecompressionStream` is missing, and `src/import/zip-limits.ts`
does the same.

The asymmetry matters: on a webview without Compression Streams, a user could
export a journal and then never import one. Compression Streams reached
WKWebView in iOS 16.4. This sets a floor on the supportable iOS version, or
requires a bundled inflate. It is recorded as **Spike 1**.

---

## Options considered

### A. Existing React/Vite application + Capacitor shells — **chosen**

Keeps one product implementation. The web assets Capacitor packages are the same
assets Playwright already tests.

### B. React Native / Expo rewrite — rejected

Would discard the entire view layer and, with it, the accessibility investment:
42 Playwright tests including axe at WCAG 2.1 AA over 12 views × 2 themes × 2
widths, computed-contrast sampling, keyboard traversal, and 1.4.10/1.4.4/1.4.12
reflow. None of that transfers to React Native, where the equivalent guarantees
must be rebuilt against a different accessibility model. It would also fork the
web edition permanently, which is the exact burden this decision exists to avoid.
The domain core would survive, but the domain core is already the easy part.

### C. Flutter rewrite — rejected

Everything in (B), plus the loss of the TypeScript domain model, the ~918-test
unit suite, and the Markdown renderer whose security property is that it never
produces markup. A Dart reimplementation of `migrate.ts`, `verify-bundle`'s
probe model, and the archive generator would be a second chance to get the
licensing gate wrong.

### D. PWA / store wrapper — rejected

Fails App Store Review Guideline 4.2 (minimum functionality) if it is a thin
wrapper, and fails the product on its own terms: a wrapper around a hosted site
would make the journal depend on `myjourneywithchrist.com` being up, which
contradicts invariant 1. A locally-bundled PWA without a native shell also
cannot reach the Files app or the Storage Access Framework, so the user could
never possess their archive as an ordinary file.

### E. Separate Swift and Kotlin applications — rejected

Three implementations of the archive format, three implementations of reference
parsing, three chances for the data gate to be wrong. The product's whole claim
is that the record outlives the software; three codebases means three
divergence surfaces on the one thing that must never diverge.

---

## Decision

**Keep React + TypeScript + Vite as the single product implementation. Add
Capacitor as a thin native shell for iOS and Android, with narrowly scoped
native services behind adapters that already have seams in the codebase.**

**Native editions replace IndexedDB with SQLite behind the existing
`StorageProvider` interface.** This is a deliberate divergence in one module, and
the reasoning is below.

### Why Capacitor won

Not "cross-platform development". Specifically:

1. **The shareable core is already platform-free.** `src/export`, `src/import`,
   `src/lib` and `src/types` contain no DOM access. They move to native with no
   change at all.
2. **The offline requirement is already met.** Zero `fetch` and zero
   `serviceWorker` in production code means a packaged bundle is already a
   complete, self-contained application. Most webview ports fail here; this one
   starts finished.
3. **The adapter surface is four things**: file save, file open, print, and
   unsaved-work warning. Three of the four are single call sites.
4. **The accessibility investment transfers intact** because the UI is the same
   DOM being tested today.
5. **The licensing gate transfers with no new tooling.** `verify-bundle.mjs`
   already accepts `--dist <path>`, so it can be pointed at
   `ios/App/App/public` and `android/app/src/main/assets/public` and prove the
   packaged native assets carry no purchased material.
6. **Hash routing suits a webview origin.** `location.hash` needs no server
   rewrite rules and behaves identically under `capacitor://localhost`.

### The strongest argument against Capacitor, stated fairly

**A webview is somebody else's runtime, and storage is the part they can take
away.** WKWebView's IndexedDB is managed by WebKit, not by us: its durability
guarantees are weaker than a file we place ourselves, and we cannot hand it to
the user. For a paid application whose entire promise is preservation, "the
journal lives in a store the platform may evict and we cannot copy" is not an
acceptable foundation.

This argument does not defeat Capacitor. It defeats *IndexedDB inside*
Capacitor — which is why the storage decision below exists, and why no native
build may ship on IndexedDB.

A second fair objection: text input in a webview is not native text input. The
software keyboard, text scaling, and selection behave close to but not exactly
like a native field. This is an acceptance-testing burden (§ device matrix), not
an architectural defect, because the editor is a `<textarea>` rather than a
custom editing surface.

---

## Shared-core boundary

**Shared, unchanged, one implementation:**

- domain model (`src/types/`) — including `Entry`, `EntrySource`, the archive
  envelope
- Scripture data and lazy per-book loading (`import.meta.glob` over
  `src/data/kjv/*.json`)
- topics, sections, data-profile selection (`virtual:journey-data`)
- entry editor behaviour, Markdown editor and renderer
- search, timeline, browse, passage, topic views
- import: `.txt`, `.md`, `.docx`, text `.pdf`, and the native archive
- export: archive assembly, manifest, indexes, CSV, schema, and the
  *My Journey With Christ* book
- forward migration and `_unmigrated` preservation
- product rules and accessibility semantics
- the entire unit suite (~918 tests) and the Playwright suite

**Diverges by edition, behind an existing or new seam:**

| Concern | Web | Native | Seam |
| --- | --- | --- | --- |
| Persistence | Dexie / IndexedDB | SQLite | `StorageProvider` (exists) |
| Save an archive | anchor + object URL | Files / SAF via share sheet | `FileExporter` (**new**) |
| Open an archive | `<input type="file">` | native document picker | `FilePicker` (**new**) |
| Print the book | `window.print()` | native print / PDF | `Printer` (**new**) |
| Unsaved-work warning | `beforeunload` | app-pause + back-button | `LifecycleGuard` (**new**) |
| Hardware back | n/a | Capacitor `App` back button → router | router binding (**new**) |
| Preferences | `localStorage` | `localStorage` (unchanged) | none needed |

Four new seams. Three of them have exactly one call site today.

### Code too coupled to the browser — **done in Phase 0**

All four are now behind ports in `src/platform/`:

1. `src/export/download.ts` — `exportEverything` takes a `FileSaver` and calls
   `files.save(outgoingArchive(archive))`. `buildArchive` is untouched.
2. `views/LegacyView.tsx` — `window.print()` became `printer.print()`.
3. `views/EntryEditor.tsx` — `beforeunload` became `unsavedWork.protect()`.
4. `views/DataView.tsx` and `views/ImportView.tsx` — both handlers now take a
   `PickedFile` (a name and bytes) rather than a DOM `File`. The visible
   `<input type="file">` stays, because it is keyboard reachable, screen-reader
   labelled and covered by the accessibility suite; it is now a *binding* that
   converts, not an assumption the view is built on.

Phase 0 also added what the ADR asked for but had not specified:
`selectStorageProvider` with the fail-closed rule, the
`StorageProvider` conformance suite, a centralised compression capability, and
`decideBack` as a pure function.

---

## Storage decision

### The question, correctly framed

Not "what do native apps use". The question is: **where does the working copy of
a lifelong journal live, such that we can honestly tell someone it will still be
there?**

### Options weighed

**A. Keep IndexedDB/Dexie in the Capacitor webview.**

- *Reliability:* the store is owned by WebKit/Chromium, not by us. On iOS it
  lives under the app's WebKit data directory. It survives app upgrades and is
  included in device backup, but it is subject to the platform's storage
  management and we have no supported way to copy, checksum, or relocate it.
- *Migration:* zero — it is what exists.
- *iOS:* the weakest case. WKWebView storage durability is a platform policy we
  do not control and cannot test exhaustively.
- *Android:* stronger; WebView data sits in the app data directory and behaves
  predictably.
- *Backup:* included in device backup, cleared on uninstall, cleared by "Clear
  data" on Android.
- *Portability:* **none.** We cannot hand the user their working database.
- *Divergence risk:* zero.
- *Verdict:* rejected as a shipping foundation. It is acceptable only as a
  development milestone.

**B. SQLite behind `StorageProvider` for native editions. — chosen**

- *Reliability:* a file at a path we choose, in a location we choose, with
  transactional durability we can test.
- *Migration:* bounded. `StorageProvider` is 15 methods over plain serializable
  objects; there is no ORM and no live-query API to reimplement. A migration
  from an IndexedDB build is a read-all/write-all through the same interface.
- *iOS:* the database file goes in `Library/Application Support`, excluded from
  nothing, included in device backup. Not `Caches`, which the system may purge.
- *Android:* app-private storage; `allowBackup` set deliberately rather than by
  default.
- *Backup:* included in device backup *as a file*, and — the point — copyable
  into the archive by us, on demand.
- *Testing:* a **conformance suite** runs the same assertions against both
  implementations. This is how divergence is prevented rather than hoped about.
- *Portability:* a real file. It can be checksummed into `MANIFEST.txt`.
- *Divergence risk:* real but managed. Two implementations of one interface, one
  shared test suite, no domain logic in either.

**C. Another native persistence layer** (Realm, MMKV, a bespoke append-only log)
— rejected. Each adds a dependency whose file format we would then owe the
user's grandchildren an explanation for. SQLite's format is documented, stable,
and readable by tools that will exist in 2060.

**D. Staged: ship native v1 on IndexedDB, migrate later** — rejected *as
stated*, accepted *in a narrower form*. Shipping a paid preservation product on
a store we cannot copy, and then asking people to migrate, puts the risk on the
earliest and most trusting users. The staging that is accepted is: Phase 1
(shell) may run on IndexedDB as a development milestone, and **no store build
may be produced until Phase 2 has replaced it**.

### Decision

**SQLite behind `StorageProvider` for iOS and Android. Dexie/IndexedDB remains
the web implementation. Both must pass a shared conformance suite. No native
store build ships on IndexedDB.**

The deciding argument is not performance and not convention. It is that a
SQLite file is **a thing the user can be given**, and an IndexedDB store is not.
A product that promises inheritance should be able to hand over the working copy
as well as the archive.

### Honest statements this commits us to

These wordings are the product's, and must appear in-app where relevant:

- **Uninstalling the app deletes the journal.** The archive you exported does
  not live in the app and is unaffected.
- **Your device backup includes the journal** (iCloud Backup on iOS, Auto Backup
  on Android) if you have those enabled. That is device backup, not our sync —
  we have no server and no account.
- **We do not use iCloud Drive or Google Drive.** Nothing syncs.

---

## Filesystem and export decision

The archive format is a product invariant and native editions produce the
**identical bytes**. No proprietary "mobile backup" format is introduced; the
existing archive already serves the purpose and is already round-trip tested.

### The abstraction

```
  entries ──► buildArchive()  ──► { filename, bytes, paths }   [shared, pure]
                                        │
                                        ▼
                               FileExporter.save()             [per edition]
                    ┌───────────────────┴───────────────────┐
              web: Blob + objectURL             native: write to a temp
              + anchor click                    app path, then hand to the
              (today's download.ts)             OS share/save sheet
```

`buildArchive` does not change. It already returns bytes and a filename and
knows nothing about how they are delivered.

- **iOS:** write to the app's temporary directory, then present the system share
  sheet / document picker so the user saves into Files — iCloud Drive, On My
  iPhone, or any provider they choose. The resulting file is outside our sandbox
  and ours no longer.
- **Android:** the Storage Access Framework `CREATE_DOCUMENT` intent, so the user
  picks the destination, or the share sheet. Same outcome: an ordinary file the
  user owns.

Import is the mirror: a native document picker returns bytes, and those bytes go
into the **existing, unchanged** `parseImport` → `previewImport` → `applyImport`
path. The importer already takes a `Uint8Array`.

**What stays shared:** archive assembly, the manifest and its SHA-256s, index
generation, the book, schema, CSV, validation, forward migration, duplicate
detection, and every test covering them.

**What the native bridge provides:** exactly two operations — *give these bytes
to the OS with this filename*, and *get me the bytes of a file the user chose*.

---

## Offline model

The proposed architecture makes the native editions fully offline by
construction, because the bundle is local and the code already makes no network
calls.

**Guaranteed in airplane mode, from a cold launch:**

| Capability | Offline |
| --- | --- |
| Launch the app | yes |
| Read Scripture (KJV, all 66 books) | yes — vendored, lazy-loaded from the bundle |
| Browse books, sections, topics | yes |
| Create, edit, delete entries | yes |
| Search | yes — index built in memory from bundled data |
| Timeline | yes |
| Generate *My Journey With Christ* | yes — pure string generation |
| Export an archive | yes — bytes built locally, handed to the OS |
| Import an archive or document | yes |

**No runtime dependency on** `myjourneywithchrist.com`, GitHub Pages, any API,
any CDN, analytics, or authentication.

**Exceptions, stated honestly:**

1. **Fonts.** The app uses `ui-serif`/`ui-sans-serif` system stacks — no web
   fonts, no network. Confirmed in `src/index.css`.
2. **The PDF import path** dynamically imports `pdfjs-dist` and its worker.
   Both are bundled assets, not network fetches, but the worker must resolve
   under a webview origin. Recorded as **Spike 3**.
3. **Links inside a user's own notes** are, of course, external if tapped. They
   are never auto-opened and never fetched.

---

## DATA_PROFILE policy for store builds

**Native production builds use `public`.** Verified against the repository
rather than assumed: `.github/workflows/pages.yml` deploys `DATA_PROFILE:
public`, and `scripts/__tests__/workflow-policy.test.mjs` pins that exact value.
`public` ships BSB section headings — public domain since 2023-04-30 per
`src/data/sections/SOURCE.md` — plus introductions written for this project.

`refs-only` remains the fallback and is publishable but offers no section
titles, which would make a paid app materially poorer. There is no profile that
carries licensed third-party data: none is in this repository.

### The build-time gate

Reuse the existing philosophy: **prove it from the packaged artefact, never from
a flag.** `scripts/verify-bundle.mjs` already accepts `--dist <path>`, which is
the whole mechanism needed.

Required before either store artefact may be produced:

1. The native web assets are built with `DATA_PROFILE=public`.
2. Capacitor copies them to `ios/App/App/public` and
   `android/app/src/main/assets/public`.
3. **`verify-bundle.mjs --profile public --dist <that path>` runs against the
   copied assets** and must report PASS on all seven assertions, including
   `BUNDLE_WAS_READ` so it cannot pass having read nothing.
4. A workflow-policy test — the native analogue of the existing one — asserts
   that no packaging step sets `DATA_PROFILE=full`, that no step omits it
   (which would default to `full`), and that verification precedes archiving.
5. **A post-archive check**: the assembled `.ipa` and `.aab` are opened as the
   zip archives they are, the web assets extracted, and the verifier run once
   more against what is actually inside the shipped container. The existing gate
   proves what is in `dist/`; only this proves what is in the store artefact.

Step 5 is new and is the native equivalent of "verify against the deployed
artefact, not the local build" (`CLAUDE.md`).

---

## Native capabilities

### REQUIRED FOR V1

| Capability | Why |
| --- | --- |
| Filesystem write + share/save sheet | the archive must become a file the user owns; this is the product promise |
| Document picker (open) | restore an archive; import documents |
| Native SQLite | the storage decision above |
| Hardware back binding (Android) | the app is unusable without it; maps to the hash router's history |
| App lifecycle events (pause/resume) | replaces `beforeunload`; flush unsaved work on background |
| Safe-area insets | correctness on notched devices |
| Native print / PDF | *My Journey With Christ* is meant to be printed; `window.print()` in a webview is unreliable across platforms |

### USEFUL LATER

- Biometric app lock (Face ID / Touch ID / BiometricPrompt) — a lock over local
  data, **not** encryption. Deferred so the v1 privacy claim stays truthful.
- Local notifications — a gentle export reminder, mirroring the existing 30-day
  in-app notice. Opt-in only.
- Deep links / universal links — sensible once there is a website to link from.
- Crash reporting — only if it can be shown never to transmit journal content,
  and only with disclosure. Off by default.
- StoreKit / Play Billing — see the purchase seam.

### DO NOT ADD YET

Cloud backup/sync, iCloud, Google Drive, accounts, sharing, push notifications,
analytics, camera, microphone, background jobs, secure keychain storage of
journal content.

Each of these would either introduce a server dependency the product has
promised not to have, or create a second copy of the journal somewhere the user
did not put it. **Native APIs existing is not a reason to use them.**

---

## Privacy and security boundary

The current application is local-first and does **not** encrypt the journal at
rest or offer a passcode. The native edition must not silently upgrade that
claim. For v1, these are four different statements and only the true ones may be
made:

| Claim | v1 status |
| --- | --- |
| Private from our servers | **True, absolutely** — there are no servers |
| Private from analytics and data mining | **True** — none present, none planned |
| Protected by normal device security | **True** — device passcode, OS sandboxing |
| Encrypted by the OS at rest | **True on iOS** (Data Protection, device locked); **true on Android** where file-based encryption is enabled. Stated as the platform's guarantee, not ours |
| Application-level encryption | **None.** Do not claim it |
| Biometric app lock | **None in v1.** Deferred |

### On encryption, and why it is deferred rather than designed

Any application-level encryption must answer one question before it is worth
writing:

> Someone inherits this archive in 2060. What do they need in order to read it?

An encrypted journal whose key is in a keychain on a phone that no longer exists
is not an inheritance; it is a lost record with extra steps. Encryption here is
therefore not a cryptography problem, it is a **key-custody and key-inheritance**
problem, and that is a product design question that has not been answered.

Until it is: the exported archive stays plain, readable, and checksummed. A
biometric lock over the *application* (not the data) is the correct first step
when the time comes, because it adds a barrier without adding a way to lose the
record.

**No custom cryptography is to be designed for this product.**

---

## Purchase seam

No StoreKit, no Play Billing, no purchase code in this phase. Only the shape:

```
  Entitlement (a capability flag)  ──►  what the app will DO
       ▲
       │  never flows into
       ✗
  Entry / JourneyExport / archive  ──►  what the user OWNS
```

**Rules this seam must enforce:**

1. **The journal data model must not encode entitlement.** `Entry`,
   `JourneyExport`, `MANIFEST.txt` and the archive schema gain no licence field,
   no receipt, no signature, no expiry. An archive must be indistinguishable
   whether it came from a paid or unpaid install.
2. **A purchase unlocks capability, never ownership.** If the purchase SDK were
   deleted tomorrow, every existing archive must remain an ordinary archive that
   the existing importer reads.
3. **Loss of entitlement may never lock the journal.** If a future optional
   subscription lapses, reading, editing and — above all — **exporting** must
   continue to work. Whatever has been written stays readable and exportable,
   always.
4. Entitlement state lives in its own store, separate from the journal database,
   so that restoring an archive never restores a purchase and vice versa.

Pricing is a product decision and is deliberately not recorded in an engineering
document. The philosophy on record is a one-time unlock rather than a
subscription that holds a journal hostage.

---

## Testing strategy

**Unchanged and still authoritative:** the ~918-test unit suite across three data
profiles, and the Playwright suite (42 tests) covering axe at WCAG 2.1 AA,
computed contrast, keyboard traversal, reflow at 320px / 200% text / text
spacing, layout geometry, and import driven against real files. These run against
the web build, which is the same bundle Capacitor packages.

**New, required by this architecture:**

1. **A `StorageProvider` conformance suite.** One set of assertions, run against
   both Dexie and SQLite. This is the mechanism that keeps the editions from
   diverging; without it, two implementations is a liability rather than a seam.
2. **Adapter contract tests** for `FileExporter`, `FilePicker`, `Printer` and
   `LifecycleGuard`, with a fake implementation for unit tests and the web
   implementation asserted against the current behaviour.
3. **A packaged-artefact data gate** (step 5 of the store policy) — the verifier
   run against the web assets extracted from the `.ipa` and `.aab`.
4. **A device acceptance matrix**, below. Not automatable in CI initially; run
   by hand and recorded.

### Native acceptance requirements (device matrix)

Every item is a known webview-on-mobile risk, not a hypothetical:

- safe areas — notch, Dynamic Island, home indicator, Android gesture bar
- status and navigation bar colour in both themes
- software keyboard: does it cover the notes field; does the caret stay visible
- text scaling — iOS Dynamic Type and Android font scale, to the largest setting
- 200% text, matching the existing `reflow.spec.ts` criterion
- VoiceOver and TalkBack over: the entry editor, the formatting toolbar, the
  import review list, and the passage picker
- touch targets at 44px, already enforced in the web suite
- orientation changes mid-edit, with unsaved text
- small phones (iPhone SE class) and tablets (iPad, Android tablets)
- Android hardware/gesture back at every route, including mid-edit
- focus returned correctly after a native file picker or share sheet dismisses
- dark mode following the system, including mid-session changes
- reduced motion

---

## Migration strategy

1. **Web → native, for an existing web user:** via the archive. Export on the
   web, import on the phone. No special path, no sync — the archive already does
   this and is already round-trip tested.
2. **Within native, IndexedDB → SQLite:** only relevant if a Phase 1 development
   build ever held real data. It will not ship, so this is a developer
   convenience: read all through `StorageProvider`, write all through the new
   one.
3. **SQLite schema evolution:** a `user_version` pragma and forward-only
   migrations. The domain model's existing `_unmigrated` discipline — never drop
   an unknown field — extends to the SQLite rows.
4. **Archive format evolution:** already solved. `migrateExport` handles
   forward migration and preserves unrecognised fields verbatim.

---

## Known risks

1. **WKWebView storage durability** — the reason for the SQLite decision.
   Mitigated by not depending on it.
2. **`DecompressionStream` availability** sets an iOS floor (16.4+). Import
   fails hard without it while export degrades gracefully. **Spike 1.**
   Phase 0 centralised the check in `src/platform/compression.ts` and gave it
   neutral wording, which makes the risk visible and testable — it does **not**
   remove it. No ZIP library was added; that decision waits on the spike.
3. **Webview text editing fidelity** — keyboard, selection, scroll-into-view in
   a long `<textarea>`. Acceptance-tested, not architecturally solved.
4. **App Store Guideline 4.2** — mitigated by genuine offline function, a local
   database, and native file integration. This app is not a wrapper, and the
   architecture is what makes that true rather than a claim.
5. **Two storage implementations** — mitigated by the conformance suite, and
   only acceptable *because* of it.
6. **pdfjs worker under a webview origin. Spike 3.**
7. **Android back and a hash router** — no binding exists today. **Spike 4.**

---

## Open questions

- Which iOS minimum version? Still open. Spike 1 passed on iOS 26.5 and
  Android 15 (Phase 1), which rules nothing out but confirms nothing about
  the floor. Needs an old runtime and an old device before it is answered.
- Should the SQLite file be copied into the archive as a `data/journey.sqlite`
  alongside `data/journey.json`? It would make the working copy portable too.
  Deferred: it changes a fixed archive layout and needs its own decision.
- Tablet layout: the web UI is a single column capped at 48rem. Acceptable on
  iPad, or does it warrant a wider reading layout? A design question, not an
  architectural one.
- Does the 30-day export reminder become a local notification, and is that
  welcome or intrusive in a devotional app?

---

## Spikes

Each is small, has a pass/fail criterion, and **is not performed in this task.**

### Spike 1 — Compression Streams in the target webviews

- **Question:** On the lowest iOS and Android versions we intend to support, do
  `CompressionStream` and `DecompressionStream` exist in the Capacitor webview?
- **Experiment:** A page in a Capacitor shell that deflates and re-inflates a
  1 MB buffer and reports both `typeof` checks. Run on the oldest available
  simulator/emulator and one old physical device.
- **Pass:** both present and round-trip correct → keep `zip.ts` unchanged and set
  the minimum OS accordingly.
- **Fail:** bundle a small inflate implementation behind the existing
  `DecompressionStream`-missing branch, or raise the minimum OS.

> **Measured in Phase 1 (2026-09-16) — partial pass.**
>
> Run as a real round trip inside the shipped shells, not a `typeof` check: a
> 2,752-byte buffer compressed and re-inflated, and the output compared to the
> input. A presence check would have proved nothing about correctness, and it is
> the inflate path that fails hard.
>
> | Where | Engine | gzip | deflate | deflate-raw |
> | --- | --- | --- | --- | --- |
> | iOS 26.5 simulator, WKWebView | AppleWebKit 605.1.15 | ok, 2752 → 86 | ok, → 74 | ok, → 68 |
> | Android 15 emulator, System WebView 153 | Chromium 153.0.8010.27 | ok, 2752 → 88 | ok, → 76 | ok, → 70 |
>
> Both `CompressionStream` and `DecompressionStream` were present and correct on
> both platforms, for all three formats.
>
> **This does not yet answer the minimum-OS question, and must not be read as
> if it did.** Two modern OS versions passing says nothing about the oldest one
> we intend to support. Only the iOS 26.5 runtime is installed on the build
> machine, so no older iOS was measured; the figure usually quoted for WebKit is
> Safari 16.4 (2023-03), i.e. iOS 16.4, but that is a vendor support table and
> not something this project has observed. Android is the easier case because
> the System WebView updates through Play independently of the OS, so the
> Chromium floor is reached on far older Android versions — again, not measured.
>
> **Still to do before the minimum OS is set:** run this same probe on an iOS
> 16.x simulator runtime (a multi-GB download) and on one old physical device.
> Until then `zip.ts` stays unchanged and the minimum OS stays undecided.

### Spike 2 — Dexie survival across a Capacitor app upgrade

- **Question:** Does webview IndexedDB survive an app version upgrade and an
  iOS storage-pressure event?
- **Experiment:** Write 500 entries, upgrade the app build, relaunch, count.
  Then fill the device and repeat.
- **Pass/Fail:** informational only. It cannot change the SQLite decision — it
  can only tell us how urgent Phase 2 is, and whether a Phase 1 build may safely
  be given to a human tester.

### Spike 3 — pdfjs worker under a webview origin

- **Question:** Does the bundled `pdf.worker.min.mjs` resolve and run under
  `capacitor://localhost` and `https://localhost`, with no network request?
- **Experiment:** Import a two-page text PDF in each shell with a network proxy
  recording all requests.
- **Pass:** text extracted, zero off-origin requests.
- **Fail:** ship PDF import as web-only in v1 and say so, or inline the worker.

### Spike 4 — Android back against the hash router

- **Question:** Can Capacitor's `App.backButton` drive `router.tsx`'s history
  without trapping the user or exiting mid-edit?
- **Experiment:** Bind back to history, then traverse browse → book → passage →
  new entry, pressing back at each step and from inside the entry editor with
  unsaved text.
- **Pass:** back retreats one route at a time, the unsaved-work guard fires
  before leaving an edited entry, and back at the root exits the app.
- **Fail:** the router needs an explicit stack rather than relying on
  `location.hash` history.

### Spike 5 — Native file save round trip

- **Question:** Does an archive saved through the iOS share sheet and Android
  SAF come back byte-identical through the document picker?
- **Experiment:** Export, save to Files/Drive, reopen through the picker,
  compare SHA-256 against `MANIFEST.txt`.
- **Pass:** checksums match and `applyImport` restores losslessly.

---

## Phased implementation

Each phase has a **stop gate**. A phase is finished when its gate passes; work
does not begin on the next until it does. No phase opens another lane.

### Phase 0 — Seams, before any native code — **COMPLETE**

Delivered: `src/platform/` with `FileSaver`, `FilePicker`, `Printer` and
`UnsavedWorkGuard`; `selectStorageProvider` with the fail-closed rule;
`src/storage/conformance.ts` run against Dexie; a centralised compression
capability; `decideBack`; and platform-neutral wording for every runtime error
reachable inside an app.

Naming note: the ADR drafted these as `FileExporter` and `LifecycleGuard`. They
shipped as `FileSaver` and `UnsavedWorkGuard` — the second rename is the
meaningful one, because "lifecycle guard" implied a reliable shutdown callback
that no native platform actually provides, and the port must not promise it.

> **Stop gate — met:** the web edition behaves as before; 984 unit tests across
> three data profiles, 42 e2e tests, and the data gate all pass; no adapter has
> a native implementation.

### Phase 1 — Minimal shells (development only, never shipped)

Add Capacitor, generate `ios/` and `android/`, package the `public`-profile web
assets. Bind Android back (Spike 4). Run Spikes 1, 2, 3.

> **Stop gate:** the app launches offline on both platforms, Scripture reads,
> an entry can be written and survives a relaunch, and all spike results are
> recorded. **This build is explicitly not shippable** — it still runs on
> IndexedDB.

### Phase 2 — Native SQLite storage

Implement `StorageProvider` over SQLite. It must pass the same conformance suite
as Dexie, unmodified.

> **Stop gate:** conformance suite green on both implementations; a journal
> survives app upgrade, force-quit, and background/foreground cycling on real
> devices.

### Phase 3 — Native file export and import

Implement `FileExporter` and `FilePicker`. The archive bytes must be identical to
the web edition's.

> **Stop gate:** Spike 5 passes on both platforms — a saved archive reopens with
> matching checksums and restores losslessly.

### Phase 4 — Offline and lifecycle hardening

Airplane-mode verification of every capability in the offline table. Unsaved-work
handling on background, interruption, and back.

> **Stop gate:** the offline table is verified item by item on both platforms,
> with no network request observed by a proxy across a full session.

### Phase 5 — Accessibility and device matrix

Work the acceptance matrix on real devices with VoiceOver and TalkBack.

> **Stop gate:** every matrix row passes or has a recorded, accepted defect.
> The existing web a11y suite still passes unchanged.

### Phase 6 — Purchase unlock

Implement the entitlement seam and one platform's billing.

> **Stop gate:** with the purchase SDK stubbed out entirely, the journal still
> opens, edits and exports; archives from paid and unpaid installs are
> byte-identical.

### Phase 7 — Store readiness

Packaged-artefact data gate (store policy step 5), privacy declarations matched
to observed network behaviour, reviewer notes explaining that no account exists.

> **Stop gate:** the verifier passes against assets extracted from the `.ipa`
> and `.aab`; the privacy declaration says "no data collected" and a proxy
> confirms it.

---

## Phase 1 — what was actually measured

Phase 1 built the two shells and ran them. Recorded here because the next phase
will otherwise re-derive it, and because two of these findings contradict what a
reasonable person would assume.

### Both shells run the product from bundled assets

Compiled **and launched**, which are different claims and are kept apart on
purpose:

| | iOS | Android |
| --- | --- | --- |
| Compiled | `xcodebuild` (SPM, no CocoaPods workspace) | `./gradlew assembleDebug` |
| Launched | iPhone 17 simulator, iOS 26.5 | emulator, Android 15 (API 35) |
| Asset origin | bundled `App.app/public` | `https://localhost/assets/...`, served from the APK by `WebViewAssetLoader` |
| Data gate over the shipped artefact | PASS (`public`, 100 files) | PASS (`public`, 100 files) |

The gate was run over the bytes *inside* the built `.app` and the built `.apk`,
not over `dist/` and not over the source tree — the same reasoning as
`verify:deployed` for the web build. A source tree that verifies clean and an
artefact that ships something else is precisely the failure this repository
keeps rediscovering.

Build environment, stated as observed rather than generalised:

| JDK | Gradle | Result |
| --- | --- | --- |
| Android Studio JBR, OpenJDK **21.0.10** | 8.14.3 | `BUILD SUCCESSFUL` |
| Homebrew OpenJDK **26.0.2** | 8.14.3 | fails: `Unsupported class file major version 70` |

JDK 21 is therefore the tested and recommended environment for this repository
today. The 26.0.2 result is one pairing against one Gradle version — it is not
evidence that JDK 26 is unsupported in general, nor that Capacitor cannot run on
it. A newer Gradle may accept it; that was not tested.

### The storage rule held under the only conditions that could break it

Both shells reached `StorageUnavailable` and stopped. `isNativePlatform()`
returned true, `requiredStorageKind()` asked for `sqlite`, no factory was
registered, and `selectStorageProvider` threw rather than substituting the
webview's IndexedDB, which was sitting right there and would have made the app
look finished.

That screen is the Phase 1 deliverable. It is not a defect to be worked around
in Phase 2 by relaxing the selection; it is the evidence that the selection
cannot be relaxed by accident.

### The Android back binding was observed end to end

Not inferred from a working exit — an unbound back button exits too, so the
visible result is identical either way. The log shows the whole chain:

```
Capacitor/AppPlugin: Notifying listeners for event backButton
Capacitor/Plugin:    To native: pluginId: App, methodName: exitApp
```

`exitApp` was called *from JavaScript*, which only happens if `decideBack`
returned `exit`. At the root with `history.length === 1` that is the correct
decision, and the app returned to the launcher.

**Not tested, and honestly not testable in Phase 1:** the nested-page and
unsaved-work branches. With storage unavailable the router never mounts, so
there is no second screen to go back from. `decideBack` is exercised as a pure
predicate in unit tests, and the binding is now known to be attached and to
reach it — but Spike 4's full traversal has to wait for Phase 2.

### Lifecycle event ordering differs between the platforms — and is reversed

Measured by logging every event with a timestamp and then backgrounding and
foregrounding each app:

| | Android 15 | iOS 26.5 |
| --- | --- | --- |
| Backgrounding | `pause` → `appStateChange{isActive:false}` → `visibilitychange:hidden` | `appStateChange{isActive:false}` → `pause` → `visibilitychange:hidden` |
| Foregrounding | `appStateChange{isActive:true}` → `resume` → `visibilitychange:visible` | `visibilitychange:visible` → `resume` → `appStateChange{isActive:true}` |

The orderings are near mirror images. Any Phase 2 "flush unsaved work when we
lose the foreground" that picks one of these three signals and assumes the
others follow it will behave differently on each platform, and the difference
will show up as lost text on exactly one of them.

**`pagehide` and `beforeunload` never fired at all** — not on backgrounding, and
not when the back button exited the app. A web habit that does not transfer: the
webview is not unloaded, it is suspended. Save-on-termination cannot be built on
unload events here.

*(Observation only. No save-on-background behaviour was designed or added in
Phase 1; this is the input to that decision, not the decision.)*

### The permission surface is empty, and stayed empty

Android declares only `android.permission.INTERNET`. iOS has no entitlements
file and no privacy usage keys. No plugin beyond `@capacitor/app` was installed.

`INTERNET` is worth a note: the assets load from `https://localhost` through
`WebViewAssetLoader`, so it is not obviously required, and removing it would be
a strong OS-level proof of the no-network claim. **This was not tested** — it is
a change with a real chance of breaking the loader in a way that is confusing
later, and it belongs in its own small experiment rather than bundled into this
phase.

---

## Phase 2 — native SQLite persistence, as measured

### The bridge, and why this one

**`@capacitor-community/sqlite` 8.1.1** (MIT, published 2026-08-06), peer
`@capacitor/core >=8.0.0` against our 8.5.2.

Chosen after ruling the alternatives out on evidence rather than popularity:

| Candidate | Why not |
| --- | --- |
| `capacitor-sqlite` | last published 2022, Capacitor 2 era |
| `capacitor-data-storage-sqlite` | key/value only, peer `@capacitor/core ^5` |
| `cordova-sqlite-storage` | maintained, but needs the Cordova compatibility layer and a callback API |
| `@capawesome-team/capacitor-sqlite` | not public (404 on npm); a paid licence |
| `@microbit/capacitor-sqlite-vanilla` | 0.1.0, and its own README says it "has had no real world use outside of one app" and points at capacitor-community instead |

It brings a transitive dependency on `jeep-sqlite` (browser wasm SQLite), which
we do not want and do not use. Measured rather than assumed: **no wasm, no
sql.js and no jeep-sqlite code reaches `dist/`.** The plugin's web
implementation is a 9.5 KB lazy chunk referenced only from Capacitor's plugin
loader, never from the entry bundle, and it looks for a `<jeep-sqlite>` DOM
element we never add. It is emitted but never executed on the web.

Encryption is available in this plugin and is **off**: `mode: 'no-encryption'`.
Turning it on means owning a key, which means Keychain and Keystore, which is a
product decision Phase 2 did not make. The journal is protected by the OS
sandbox and device encryption, and the app must not claim more.

### Schema v1

`data` holds the canonical `Entry` JSON and is the authority on read; the
columns beside it are derived on write, for ordering, identity and so a human
with a SQLite browser can read the file. The entry is stored as JSON because the
domain object is the export format — it carries optional fields, nested anchors,
and `_unmigrated`, which is *fields written by a future version that this build
must preserve without knowing their names*. A column-per-field schema cannot
round-trip a field it has no column for.

```sql
schema_meta(id, version)
entries(id PK, kind, title, date, created_at, updated_at, data)
  entries_order(date, created_at), entries_updated_at(updated_at)
entry_anchor_keys(entry_id -> entries.id ON DELETE CASCADE, anchor_key)
  entry_anchor_keys_key(anchor_key)
settings(key PK, data)
```

`entry_anchor_keys` is the SQL form of Dexie's multi-entry index, and is what
`findEntriesForAnchor` joins against rather than scanning.

**PRAGMA:** only `foreign_keys = ON`, per connection, because SQLite enforces
foreign keys only when asked and without it a deleted entry would leave its
anchor rows behind to match future lookups. `journal_mode` and `synchronous` are
left at the plugin's defaults: this is a single-user journal writing a few
hundred bytes a few times an hour, and changing durability knobs without a
measured reason is cargo cult. No claim is made about power loss beyond what
SQLite and the OS provide.

### Migrations exist before users do

An explicit ordered ledger, with the version recorded **inside the same
transaction as the step**. A failed step rolls back and the database still
reports the version it genuinely has. A database numbered beyond what the build
understands is refused with `SchemaTooNewError` rather than opened.

The machinery is proven on a synthetic two-step ledger, because "a fresh install
reaches v1" is the one case that says nothing about upgrading: v1 -> v2 applies
in order and keeps v1 data; a broken v2 leaves v1 authoritative with its
half-applied column rolled back; a v1-only build refuses a v2 file.

### Durability does not depend on lifecycle callbacks

Every acknowledged write has committed by the time its promise resolves. Nothing
is queued for `pause`, `appStateChange`, `pagehide` or `beforeunload` — Phase 1
measured that the last two never fire at all on either platform, so anything
held in memory until "app closing" would simply be lost.

### Conformance: one contract, three runners

The contract moved out of Vitest into `src/storage/contract.ts` as 47 plain
cases, because it has to run where Vitest cannot. `conformance.ts` is now a thin
adapter. There is one description of what persistence means, not two.

| Runner | Engine | Result |
| --- | --- | --- |
| Vitest | Dexie / IndexedDB | **47/47** |
| Vitest, `node:sqlite` | real SQLite, *not a native proof* | **47/47** + schema, migration and rollback cases |
| **iOS 26.5 simulator (iPhone 17)** | `@capacitor-community/sqlite`, SQLite **3.53.4** | **47/47**, 0 floors tripped |
| **Android 15 emulator (API 35)** | `@capacitor-community/sqlite`, SQLite **3.53.3** | **47/47**, 0 floors tripped |

The native harness refuses to report a pass unless it is on a native platform,
the plugin is available, the provider answers `engine === 'sqlite'`, the schema
is at the expected version, the engine identifies its own SQLite version, a
closed-and-reopened database returns its data, and the number of cases it ran
equals the number that exist.

**Two bugs were found only by running on devices**, and neither Node nor the
other platform could have caught them:

1. **Capacitor's plugin object is a Proxy that answers every property access
   with a callable, `then` included.** Returning it from an `async` function
   makes the runtime treat it as a thenable and call `.then()`, which the bridge
   rejects: `"CapacitorSQLite.then()" is not implemented on android`. The loader
   now hands back a plain delegating object.
2. **iOS prepends a column-descriptor row to every query result** —
   `[{ios_columns:['data']}, {data:'…'}]` where Android returns only the data
   rows. Taken at face value, every iOS read would have had a phantom row at the
   front: `getEntry` would `JSON.parse(undefined)` and a list would carry a junk
   entry. `select()` now filters the descriptor. iOS also rejects a query with
   no `values` array, which Android tolerates.

A third instrument flaw was found the same way: the harness identified the
provider by `constructor.name`, which a production build mangles to `"er"` — a
floor that could not identify anything, and so could never have caught a Dexie
substitution. Both providers now carry an `engine` property, which the minifier
leaves alone.

### Database identity and location

Logical name **`journey`** — boring, brand-independent, no version number, for
the same reason as every other machine identifier in this project. The plugin
appends its own suffix, so the file is **`journeySQLite.db`**, observed at:

| Platform | Observed path |
| --- | --- |
| Android | `/data/user/0/com.myjourneywithchrist.lifewithchrist/databases/journeySQLite.db` |
| iOS | `<app data container>/Documents/journeySQLite.db` |

iOS lands in `Documents`, not `Library/Application Support` as this ADR
originally anticipated — that is the plugin's default and it is recorded here as
observed rather than as intended. `Documents` is included in device backup and
is not purged like `Caches`, so the durability property holds; whether to move
it (and thereby whether it appears in the Files app) is a Phase 3 question.

**Uninstall deletes it.** Device backup may include it if the person has iCloud
Backup or Android Auto Backup enabled — that is *device* backup, not our sync;
there is no server and no account. None of this makes SQLite the user's backup:
the canonical archive is, and it is still the thing they own.

### Evidence from the product, not from the tests

A journal entry was written through the **real UI** on both platforms — notes,
reflection, a Scripture anchor chosen from the BSB section list, and on Android
also prayer, speaker and tags — then the process was killed and the app
relaunched.

| | iOS | Android |
| --- | --- | --- |
| Process death induced by | `xcrun simctl terminate` (pid 86153 gone) | `adb shell am force-stop` (pid 8316 -> 8828) |
| Entry after relaunch | present, fields intact | present, fields intact |
| Independent file check | `sqlite3` on a copy: `integrity_check ok`, `schema_meta.version = 1`, notes/reflection/anchors match what was typed | same, plus prayer, speaker, tags, and the three derived anchor rows `book:john`, `outline:john-4-1-26`, `ref:john:4:1:4:26` |

### IndexedDB was not used — checked after real journal use

Not "the code selected sqlite", and not an overbroad "the directory must not
exist":

- **Android:** no `IndexedDB` directory at all in the app sandbox, and the only
  file matching *journey* anywhere under it is `databases/journeySQLite.db`.
- **iOS:** an `IndexedDB` directory does exist under WebKit's `WebsiteData` — and
  it is **empty, 0 entries**: scaffolding the engine creates, with no database
  inside. WebKit `LocalStorage` holds exactly one key, `journey:welcomed = 1`,
  the first-visit flag CLAUDE.md permits, and zero rows containing journal text.

### Offline

Measured on Android with the radios actually off (`airplane_mode_on = 1`,
`ping` reports *Network is unreachable*): cold launch, all 66 books, a topic with
its passages, full KJV text for Genesis 2:1-3 under its BSB heading, search
finding the journal entry, and **a new entry created, saved, force-stopped and
re-read** — all with no network.

**iOS offline was not tested**, and is not claimed. The simulator shares the
Mac's network stack and the only way to disable it would be to turn off the
machine's networking, which was not an acceptable thing to do to someone else's
computer unattended. What is known for iOS is narrower: every asset is served
from the bundle, and no network call exists in the product. A real iOS offline
test belongs with the Phase 4 offline work.

### Wording that is now wrong on native

Found while driving the real UI, recorded rather than fixed here because
CLAUDE.md already calls it a Phase 4 decision rather than a find-and-replace:

- the first-visit notice says *"Your notes live in this browser"* and *"Clearing
  your browser data will destroy them permanently"*
- the export reminder says *"Browser storage is not a backup — clearing your
  browser data would erase all of it"*
- the footer repeats the same line

On native there is no browser, the store is SQLite, and the equivalent risk is
uninstalling the app. Three strings, one decision.

### Also observed, for Phase 5

On iOS a `<select>` renders as a modal picker that swallows Tab and Escape, and
it sits early in the tab order — reaching the page content by keyboard past the
theme selector was not possible. That is a real keyboard-navigation defect on
the native shell and belongs in the Phase 5 accessibility work.

---

## Documentation defect found during inspection

Not corrected here, because this task is architecture-only. Reported for a
separate decision:

**`src/export/zip.ts` line 276** tells the user "This browser cannot decompress
the archive" — wording that will be wrong inside a native app, where there is no
browser from the user's point of view. It is a message a person may actually see
if Spike 1 fails. One line, user-facing, not urgent, but it should not ship in a
native build unchanged.
