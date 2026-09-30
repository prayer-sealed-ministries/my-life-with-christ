# Release status — internal

**Not for publication.** A factual picture of what is finished, what is waiting
on a person, and what must not be started yet.

| | |
| --- | --- |
| Source-review date | 2026-09-29 |
| Source commit audited | `d751f54` |
| Package | `com.myjourneywithchrist.lifewithchrist` |
| Version | versionCode **1**, versionName **1.0** |

> **The release is not ready, and the reason is one line:**
> **EXTERNAL BACKUP OF CURRENT DEBUG KEY REQUIRED BEFORE SIGNING MIGRATION.**
> Nothing below changes that.

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
| Existing entries/drafts preservation | Three verified archives in `~/Documents/mlwc-backups/`, all PASS, all 6 entries / 2 drafts. |

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

## Android permissions — effective set

Read from the packaged candidate with `aapt2 dump permissions`, and traced to
origin in `android/app/build/outputs/logs/manifest-merger-debug-report.txt`.
These four are the whole set.

| Permission | Introduced by | Why present | App uses it directly? | User-facing disclosure | Removable? |
| --- | --- | --- | --- | --- | --- |
| `INTERNET` | **Our own manifest**, line 124 | Part of the Capacitor Android template. Capacitor's own library manifest declares no permissions, so this is ours alone. | **No.** There is no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` in `src/`, and no HTTP or socket code in the native sources. | Yes — listed in the privacy policy, stating plainly that no network requests are made. | **Possibly, but do not do it casually.** Capacitor serves the app over a local scheme handler; whether removal breaks the WebView needs a build-and-device test. That is a runtime change, not a docs change. Raised, not actioned. |
| `USE_BIOMETRIC` | `androidx.biometric:1.1.0` | Pulled in by `@capacitor-community/sqlite`, which offers biometric-protected encrypted databases. | **No.** App Lock uses `KeyguardManager.createConfirmDeviceCredentialIntent`, not `BiometricPrompt`, precisely because minSdk is 24. | Yes — disclosed as unused, and why. | Only by removing or shading the SQLite plugin's dependency. Not worth destabilising the storage layer for a normal-level permission. |
| `USE_FINGERPRINT` | `androidx.biometric:1.1.0` | Same dependency, legacy counterpart. | **No.** | Yes, same row. | Same as above. |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core:1.17.0` (also `androidx.emoji2:1.3.0`) | A signature-level permission AndroidX defines for its own internal non-exported receivers. Not a user-visible capability. | No | No — it is not a user-facing permission. | No, and should not be. |

**Concerning or unnecessary?** None is dangerous-level; none touches location,
contacts, storage, camera or microphone. Two observations worth recording:

1. `USE_BIOMETRIC` / `USE_FINGERPRINT` are **dependency-derived and
   pre-existing** — verified, not assumed: they are identical in the APK
   currently installed on the A17 and in the current candidate, so App Lock
   introduced neither.
2. `INTERNET` is declared by us for a feature we do not have. It is the one
   permission worth a deliberate decision before release.

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

### 1. Android Auto Backup includes the journal

`android:allowBackup="true"`, and the backup rules exclude only the App Lock
preferences. The journal database is therefore inside Android's system backup
and can reach the device owner's Google account backup with no action in the
app.

This sits awkwardly beside the in-app Data & Backup copy:

> "Everything you have written lives on this device and nowhere else… No copy
> exists anywhere else until you export one."

With device backup switched on, that is not strictly true. Two coherent
resolutions, both the owner's call:

- **Exclude the database from backup too.** Makes the copy true. Costs the
  reader a silent restore onto a replacement phone.
- **Keep backup and correct the copy.** Keeps the safety net; requires saying
  so plainly.

The privacy policy as written describes the behaviour as it actually is.

### 2. `INTERNET` permission for an app that makes no requests

See the permission table. Worth a decision; needs a device test either way.
