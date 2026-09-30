# Permanent signing migration — runbook

**PLAN ONLY. NOTHING IN THIS FILE HAS BEEN EXECUTED.**

This is the procedure for moving the Galaxy A17 off the debug signing identity
and onto a permanent one. It is written now, while nothing is at stake, because
the middle of it is irreversible and that is the worst moment to be working
out what should have happened first.

Read with `docs/A17-MIGRATION.md`, which covers the archive bridge in detail
and was rehearsed end to end on an emulator. This document is the wrapper
around it: what must be true *before* that procedure begins, and what the
signing change adds.

| | |
| --- | --- |
| Written | 2026-09-29 |
| Source commit | `d751f54` |
| Status | **Blocked. Do not begin.** |

---

## The blocker, stated once

> **EXTERNAL BACKUP OF CURRENT DEBUG KEY REQUIRED BEFORE SIGNING MIGRATION**

`~/.android/debug.keystore` is the only key that can update the A17 in place
today. A stopgap copy exists at `~/Documents/keystore-stopgap/` with a verified
identical digest, and it is **on the same disk as the original**, so it
protects against deleting the file and against nothing else.

Until an off-machine copy exists, do not start step 1.

---

## The irreversible boundary

There is exactly one destructive act in this procedure, and everything is
arranged around it:

```
        steps 1-8            step 9            steps 10-13
      ─────────────── │ ═══════════════ │ ───────────────
        reversible      UNINSTALL —        recovery from
        preparation     the journal on     the archives,
                        the device is      or not at all
                        gone at this
                        moment
```

**Android refuses an in-place update across certificates.** Measured, with the
real artefacts:

```
Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package
com.myjourneywithchrist.lifewithchrist signatures do not match newer version;
ignoring!]
```

So there is no upgrade path from the debug identity to a permanent one. The
device must be uninstalled and reinstalled, and uninstalling destroys the app's
entire store — every entry, every unfinished draft, the export history, the
theme.

One mercy, also measured: **the refusal itself is non-destructive.** A
cross-signature install that is rejected leaves the installed app and its data
completely untouched. An accidental attempt costs nothing. Only step 9 is
final.

---

## Before step 9 — all of these, in order

### 1. Off-Mac backup of the debug keystore, confirmed

Not a second copy on the same disk. An external drive, a password manager's
secure file storage, or another machine. Verify by comparing SHA-256 of the
original and the copy — the two must match exactly.

Why it still matters after migrating: until the new build is installed and
proved, the debug key remains the only way to update the device.

### 2. Permanent signing identity created and backed up

- Create the upload key deliberately, not in the middle of this procedure.
- Record its certificate SHA-256 alongside the debug one, so the
  before/after comparison in step 10 is against a written-down value rather
  than memory.
- **Back it up off-machine before it is used for anything.** Losing an upload
  key means a Play support process to reset it.
- Never commit a keystore, a password, or `local.properties`.
- **The Android debug key is never the production identity.** It is a shared,
  well-known development certificate; anything signed with it can be replaced
  by anyone holding the same key.

### 3. Play history resolved

Answer, in Play Console, before choosing a `versionCode`:

> Does `com.myjourneywithchrist.lifewithchrist` already exist in any state —
> draft, internal testing, or removed? If so, what is the highest `versionCode`
> ever uploaded, and is the package enrolled in Play App Signing?

See `docs/RELEASE-STATUS.md`. Local evidence shows **no prior upload**, which
is not the same as proof that none occurred.

### 4. Export A

From the app on the device, through the system file picker, to a destination
the user chooses.

### 5. Export B

A **second, independent export** — not a copy of A. A copy inherits whatever
damage A already had.

### 6. Both archives independently verified

On a computer, off the device:

```
npm run verify:archive -- <archive.zip>
```

Expect `PASS` and five `ok` lines from each. This checks the archive against
its own `MANIFEST.txt`.

> **STOP if either fails.** Do not uninstall anything. Export again. Until two
> archives have passed, the phone is still the only complete copy.

The app now performs this same check on import (commit `ef161e3`), so a damaged
archive would also be refused at restore time. Step 6 stays anyway: at the
moment of uninstall the archive becomes the only copy, and "the app said it was
fine" and "the file is fine" should be two separate observations.

### 7. Entry and draft counts recorded

From the verifier output, which prints counts and never prose:

```
  N files · journey-export v1 · <E> entries · <D> drafts
```

Write `E` and `D` down. They are what step 12 checks against.

*As of 2026-09-29 the A17 held 6 entries and 2 drafts, in three verified
archives in `~/Documents/mlwc-backups/`. Re-measure at the time; do not reuse
this number.*

### 8. Archives confirmed outside app-private storage

An archive inside the app's own sandbox dies with the uninstall. Confirm both
are somewhere the uninstall cannot reach — user storage on the device, and at
least one copy off the device entirely.

---

## Step 9 — uninstall (irreversible)

```
adb -s <serial> uninstall com.myjourneywithchrist.lifewithchrist
```

Everything the app holds is gone at this moment. Steps 4–8 are now the journal.

Always name the serial. Check with `adb devices -l` that only the intended
device is attached — an emulator present during this phase is how a mistyped
`-s` becomes an install onto the wrong target.

---

## After step 9

### 10. Install the release-signed build

Verified first, as `docs/RELEASE-ANDROID.md` requires: `aapt2 dump badging`,
permissions unchanged, no `debuggable`, no `testOnly`, and
`apksigner verify --print-certs` showing **the expected new certificate** —
compared against the value written down in step 2.

### 11. Restore a verified archive

Open the app, then **Data & Backup → Bring a journal back in**, and choose the
archive verified in step 6.

The preview reports what it would do before anything is written. On an empty
journal expect `N new`, `0 conflicts`.

### 12. Prove entries and drafts

- Entry count matches `E` from step 7.
- Unfinished drafts match `D`, and appear **as drafts** — the home screen shows
  "DRAFT · Continue…", not extra saved entries.
- Force-stop the app and reopen it; check again. An acknowledged write has
  already committed, and this is where that is confirmed rather than assumed.

### 13. Retain the backups

Do not delete the archives afterwards. Export once more from the new install
and verify that too, so the new identity is established *and* backed up.

---

## What does not survive, and is not a bug

- **Export history.** The archive carries `entries` and `drafts` and no
  settings, so a restored journal reports "never exported" and restarts its
  30-day reminder. Step 13 resolves it in practice.
- **App Lock configuration.** Device-bound by design and excluded from backup;
  it must be turned on again deliberately on the new install.
- **Theme and the first-run flag.** Disposable preferences.
- **Nothing else.** Entries and drafts came back with zero field drift in every
  rehearsal.

---

## Forbidden throughout

- No "clever certificate tricks" — no attempt to re-sign, key-rotate around, or
  otherwise smuggle the old identity into the new one.
- No use of the Android debug key as a production identity.
- No `--no-verify`, no force-push.
- No uninstall before steps 1–8 are all true.
