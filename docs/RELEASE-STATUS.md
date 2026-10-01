# Release status — internal

**Not for publication.** A factual picture of what is finished, what is waiting
on a person, and what must not be started yet.

| | |
| --- | --- |
| Source-review date | 2026-09-29, re-audited 2026-09-30 |
| Source commit audited | `d751f54`, re-audited at `fa35995` |
| Package | `com.myjourneywithchrist.lifewithchrist` |
| Version | versionCode **1**, versionName **1.0** (template default; never uploaded) |
| Target / min SDK | targetSdk **36**, minSdk **24** — verified in the packaged artefact |
| Release artefact | `app-release-unsigned.apk` — **unsigned**, because no `signingConfig` exists |

> **The release is not ready, and the reason is one line:**
> **EXTERNAL BACKUP OF CURRENT DEBUG KEY REQUIRED BEFORE SIGNING MIGRATION.**
> Nothing below changes that.

---

## What changed since the 2026-09-29 audit

Feature work completed and frozen since `d751f54`, each verified present in
`fa35995` by reading the source rather than the commit message:

| Commit | Lane |
| --- | --- |
| `af428fa` | Timeline shows the newest entries first |
| `9975bb2` | Contextual church-note import by entry kind |
| `50f7464` | `service` entry kind removed |
| `bf24aaa` | Focus-session test race removed |
| `faf2e9d` | Exact verse / verse range / passage selection |
| `94d6b02` | Picker-selected Scripture references now share |
| `fa35995` | App Lock gate test race removed |

Nothing in that list changes the permission set, the signing position or the
blockers below. The release artefact was rebuilt and re-verified at `fa35995`.

## Google Play requirements, checked against Google's own documentation

Read 2026-09-30, not from memory, because two of these move with policy:

| Requirement | Google's current position | Where we stand |
| --- | --- | --- |
| Target API level | New apps and updates must target **API 36** as of the 31 August 2026 deadline, which has passed. | **PASS.** targetSdk 36 in the packaged artefact. |
| Privacy policy | "All apps must post a privacy policy link in the designated field within Play Console, and a privacy policy link or text within the app itself." Apps collecting no personal data **still must submit one**. The URL must be "active, publicly accessible and non-geofenced", and must carry developer contact information. | **BLOCKED twice.** No public URL exists, and the policy's contact line is still a placeholder. The in-app half is met in substance: Settings and Help both carry privacy text. |
| Data safety section | "Apps that are active on internal testing tracks are exempt from inclusion in Google Play's Data safety section." | Worksheet complete regardless (`docs/GOOGLE-PLAY-DATA-SAFETY.md`); **not a blocker for internal testing**. |
| Internal testing | Up to 100 testers by email list. "You can start an internal test before completing app setup." Internal tests "might not be subject to standard Play policy or security reviews". | Store listing, screenshots and content rating are **not** gating for this track. |

The practical consequence: for the *internal testing* track specifically, the
remaining gates are the signing identity, the Play history question, and the
privacy policy URL and contact — not the full store listing.

---

## Blocker matrix

### PASS — done and evidenced

| Item | Evidence |
| --- | --- |
| Archive migration bridge | Rehearsed end to end on emulator; existing export/restore proved sufficient, no transitional build needed. `docs/A17-MIGRATION.md`. |
| Archive integrity enforcement | `parseImport` verifies MANIFEST.txt before parsing; refuses on mismatch and leaves the journal untouched. 13 damage kinds covered; 8 mutation proofs. Commit `ef161e3`. |
| Android App Lock | Optional, off by default; Keystore-backed HMAC verifier; attempt penalty; device-credential recovery. Commit `d751f54`. |
| A17 in-place debug-signed update | `install -r`, no uninstall, no clear. `firstInstallTime` unchanged → genuine update. Signer unchanged `ac3d886c…`. |
| Real A17 data preservation | 6 entries and 2 drafts **byte-identical** before vs after the update, and again after all acceptance work. Drafts remained drafts. |
| logcat privacy fix | Capacitor bridge payload logging disabled (`loggingBehavior: 'none'`). Confirmed on the physical A17: **zero** synthetic markers and zero payload lines across 13,253 log lines. Commit `1c251eb`. |
| Release artefact re-verified at `fa35995` | `assembleRelease` produces `app-release-unsigned.apk`. `aapt2 dump badging`: targetSdk 36, versionCode 1, versionName 1.0, **no `application-debuggable`**, no `testOnly`. `npm run verify:apk` PASS on 13 assertions. Packaged permissions exactly three, INTERNET absent. Only native library is `libsqlcipher.so` from the SQLite plugin; no GMS, Firebase, analytics or ads SDK in the tree. No OCR dependency, no hardcoded or master PIN. `verify:startup` PASS with the startup chunk at 451,385 bytes against a 700,000 ceiling. |
| Existing entries/drafts preservation | Three verified archives in `~/Documents/mlwc-backups/`, all PASS, all 6 entries / 2 drafts. |

### NON-BLOCKING KNOWN ISSUE

| Item | Status |
| --- | --- |
| Suite-wide 1-second Testing Library `findBy` timeout under extreme CPU contention | Not tied to any feature. Measured during the focus-session lane: 5 failures in 59 runs of the *pristine* file and 6 in 60 of the *fixed* one, at identical load — the same rate on both sides, which is what rules the code out. It appears as `Unable to find a label with the text of: Notes` in whichever test happens to be running. **Not a product-release blocker.** Deliberately not "fixed" by raising timeouts globally, which would hide real failures everywhere. |

### DEFERRED — human physical interaction required

Neither is a failure, and neither was faked by automation.

| Item | Why it is deferred |
| --- | --- |
| Samsung launcher widget visual acceptance | Placing a widget is a launcher gesture (long-press → Widgets → add). There is no safe adb equivalent, and driving the launcher to fake it would not be the thing being tested. The widget's provider, intent and non-exported status are proved by `scripts/verify-apk.mjs` and unit tests; what remains unverified is only how it *looks and behaves on the real Samsung launcher*. |
| Genuine external-app Share/Open In gesture | Requires a real sending app. `am start -a SEND` cannot grant another app read access to a file — measured on the emulator, where the app correctly received nothing and a `SecurityException` was logged by MediaProvider. The inbound path is covered by unit tests (`app-lock.bypass.test.tsx`, shared-import tests); the untested part is the real OS handover. |

### BLOCKED / requires human action

| Item | Status |
| --- | --- |
| Off-Mac backup of `~/.android/debug.keystore` | **STILL REQUIRED.** A local stopgap exists at `~/Documents/keystore-stopgap/` with a verified identical digest, but it is on the same disk as the original and therefore is not a backup against losing this machine. |
| Permanent Android signing identity | Not started, deliberately. Gated on the line above. See `docs/SIGNING-MIGRATION-RUNBOOK.md`. |
| Play Console prior package/version history | Unresolved locally; see below. Only the Console can settle it. |
| Privacy-policy contact information | `[PRIVACY CONTACT TO BE PROVIDED]` in `docs/PRIVACY-POLICY.md`. |
| Play Console entry / submission | Not started. Nothing has been uploaded. |

---

## Privacy policy — the publishing gap

Play requires a privacy policy at a URL that is "active, publicly accessible and
non-geofenced", and the policy must name developer contact information. We have
the policy (`docs/PRIVACY-POLICY.md`) and no URL, and the contact line is still
`[PRIVACY CONTACT TO BE PROVIDED]`. Both are human decisions; neither is
invented here.

Checked on 2026-09-30: `mylifewithchrist.com` resolves (3.33.130.190,
15.197.148.33) and answers HTTPS 200. The app already carries that wordmark in
its footer and About page. Whether the owner controls the DNS is not something
this repository can establish.

The options, smallest blast radius first:

| Option | What it costs | What it entangles |
| --- | --- | --- |
| A static page on `mylifewithchrist.com` | One HTML file, rendered from the Markdown. | Nothing in this repository. The app has **no runtime dependency** on that domain and must keep none — see `docs/ADR-NATIVE-APP-ARCHITECTURE.md`. |
| A separate minimal repository published to GitHub Pages | A second repo, one page, a stable URL. | Nothing here either. Keeps the policy's availability independent of this repo's publication decision. |
| GitHub Pages on **this** repository | Appears free, and is not. | `pages.yml` deploy is `workflow_dispatch`-gated precisely because publishing is a decision the owner makes, and it would publish **the whole application**, not a page. That is a data-licensing decision under `DATA-LICENSE.md`, not a hosting convenience. |

The third is listed to be ruled out rather than to be chosen. Publication of the
app is still deferred, and attaching the privacy policy to it would couple a
Play requirement to a decision nobody has taken.

---

## Android permissions — effective set

Read from the packaged candidate with `aapt2 dump permissions`, and traced to
origin in `android/app/build/outputs/logs/manifest-merger-debug-report.txt`.
Three remain after the INTERNET removal below.

| Permission | Introduced by | Why present | App uses it directly? | User-facing disclosure | Removable? |
| --- | --- | --- | --- | --- | --- |
| ~~`INTERNET`~~ | ~~our own manifest~~ | **REMOVED.** Was Capacitor template boilerplate; Capacitor's own library manifest declares no permissions, so it was ours alone. | No | n/a | **Removed and proved.** See below. |
| `USE_BIOMETRIC` | `androidx.biometric:1.1.0` | Pulled in by `@capacitor-community/sqlite`, which offers biometric-protected encrypted databases. | **No.** App Lock uses `KeyguardManager.createConfirmDeviceCredentialIntent`, not `BiometricPrompt`, precisely because minSdk is 24. | Yes — disclosed as unused, and why. | Only by removing or shading the SQLite plugin's dependency. Not worth destabilising the storage layer for a normal-level permission. |
| `USE_FINGERPRINT` | `androidx.biometric:1.1.0` | Same dependency, legacy counterpart. | **No.** | Yes, same row. | Same as above. |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core:1.17.0` (also `androidx.emoji2:1.3.0`) | A signature-level permission AndroidX defines for its own internal non-exported receivers. Not a user-visible capability. | No | No — it is not a user-facing permission. | No, and should not be. |

**Concerning or unnecessary?** None is dangerous-level; none touches location,
contacts, storage, camera or microphone.

`USE_BIOMETRIC` / `USE_FINGERPRINT` are **dependency-derived and pre-existing**
— verified, not assumed: they are identical in the APK currently installed on
the phone and in the current candidate, so App Lock introduced neither. Removing
them would mean dependency surgery on the SQLite plugin, which is not worth
destabilising the storage layer for two normal-level permissions. Recorded as a
future cleanup opportunity, not this lane's work.

### INTERNET removal — the evidence

It was removed only after proving the packaged app does not need it, on an
API 35 emulator:

| Check | Result without INTERNET |
| --- | --- |
| App launches | Yes — `Status: ok`, 1832 ms |
| WebView serves `https://localhost` from assets | Yes, no `net::ERR_*` of any kind |
| 700 KB lazily imported Scripture chunk | **Fetched** — the case most likely to fail |
| Scripture renders (all 66 books, outline counts) | Yes |
| Editor | Yes |
| Fast Capture via the canonical native action | Yes — `Status: ok`, 1236 ms, Notes focused |
| App Lock bridge (`getState`) | Yes — the gate only renders children once it resolves |
| `npm run verify:apk` | PASS |
| WebView / chunk-load / fatal errors in logcat | **Zero** |

External links are unaffected: a note's link is a plain `<a href>` that
Capacitor's `shouldOverrideUrlLoading` hands to the OS browser, which has its
own network access. Nothing is ever loaded into this app's WebView from the
network.

> **Residual risk, stated plainly.** This was verified on an API 35 emulator.
> It was **not** verified on the physical phone, which was out of scope for
> that lane and currently runs the older build that still declares INTERNET.
> Re-verify at the first install of a no-INTERNET build onto real hardware —
> this is now a step in `docs/SIGNING-MIGRATION-RUNBOOK.md`.

### Related: FileProvider scope

`android/app/src/main/res/xml/file_paths.xml` declares
`<external-path name="my_images" path="." />` and
`<cache-path name="my_cache_images" path="." />` — both inherited from the
Capacitor template — alongside the `shared_entries` path this project added.

The provider is `android:exported="false"`, and **no code anywhere constructs a
URI under external storage** (no `getExternalFilesDir`, no
`Environment.DIRECTORY*`), so nothing under the broad path is grantable. It is
unnecessary declared scope rather than an exposure. Narrowing it is a product
change and was not made here.

---

## Google Play version history — preparation

### What the repository shows

| Question | Local evidence |
| --- | --- |
| applicationId | `com.myjourneywithchrist.lifewithchrist` |
| versionCode / versionName | `1` / `1.0` |
| Version history in git | The pair was introduced in `70696ee` ("feat(native): add verified Capacitor iOS and Android shells") and **has never been changed since**. |
| Local AAB history | One exists: `android/app/build/outputs/bundle/release/app-release.aab`, built 2026-09-28, 10,408,696 bytes. It is **gitignored build output** and is **unsigned** (zero signature blocks) — consistent with no release signing config existing in `android/app/build.gradle`. |
| Local APK history | Debug APKs only, all signed with the debug certificate `ac3d886c…`. |
| Evidence of a Play upload | **None found.** No signing config, no upload credentials, no service-account key, no Play publisher configuration, no fastlane or CI publishing step. |

### What that does and does not establish

**NO LOCAL EVIDENCE OF PRIOR PLAY UPLOAD.** That is the honest finding and it
must not be restated as "never uploaded". An upload could have been made from
another machine, or by another person, and would leave no trace in this
repository. Only the Console knows.

### The exact question to answer in Play Console

> In Google Play Console, does the application ID
> `com.myjourneywithchrist.lifewithchrist` already exist —
> in any state, including draft, internal testing, or a removed app?
>
> If yes: **what is the highest `versionCode` ever uploaded for it?**
>
> And: is the package already enrolled in Play App Signing?

**Do not choose the production `versionCode` until that is answered.** Play
refuses a repeated code, and a code cannot be reused even if the release that
carried it was never published. Picking `1` on the assumption that nothing
exists is exactly the guess that costs a version number.

---

## Open product decisions raised by this audit

Neither was acted on, because both change behaviour or user-facing copy.

### 1. Android Auto Backup includes the journal — RESOLVED

`android:allowBackup="true"`, and the backup rules exclude only the App Lock
preferences. The journal database is therefore inside Android's system backup
and can reach the device owner's Google account backup with no action in the
app.

**Decision taken: keep Auto Backup, correct the copy.** Silently removing a
real recovery path for a lost or replaced phone, purely to preserve a sentence,
would have been the wrong trade. Every absolute "nowhere else" claim in the
product has been revised to describe Auto Backup conditionally, without
implying this app arranges it or that a backup definitely exists. The App Lock
PIN is stated as excluded.

### 2. `INTERNET` permission — RESOLVED

Removed, with the evidence above.
