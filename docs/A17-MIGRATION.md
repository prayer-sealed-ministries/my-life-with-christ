# Moving the Galaxy A17 onto a permanent signing identity

A one-time procedure for one device. It is written down because getting it
wrong destroys a real journal, and because the order of the steps is the whole
of the safety.

`docs/RELEASE-ANDROID.md` covers releasing in general. This covers the specific
problem that the phone already in use is running a build signed with a key that
was never meant to be permanent.

---

## The situation

The A17 runs a **debug-signed** build. Its certificate is this machine's
`~/.android/debug.keystore`:

| | |
| --- | --- |
| Certificate DN | `C=US, O=Android, CN=Android Debug` |
| SHA-256 | `ac3d886ceabc4099543e9b383574009f99d7bc8e451fd890f7fffb24a72a7cf2` |
| SHA-1 | `22dce8998e5c5741331bb3f25bca1ef8322a8e70` |

Two consequences follow, and they pull in opposite directions.

**That keystore is currently load-bearing.** While the A17 runs a debug-signed
build, `~/.android/debug.keystore` is the only key that can update it in place.
It is not backed up, and a debug keystore is not something anyone treats as
precious — which is exactly why this should not stay the arrangement.

**Establishing a permanent identity means a different certificate.** Android
refuses an in-place update across certificates. Measured on the emulator with
the real artifacts:

```
Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package
com.myjourneywithchrist.lifewithchrist signatures do not match newer version;
ignoring!]
```

So there is no upgrade path. The device must be uninstalled and reinstalled,
and **uninstalling destroys the app's entire store** — every entry, every
unfinished draft, the export history, the theme.

The bridge across that gap is the archive. There is no other one.

### The refusal is not destructive

Worth knowing before anyone panics mid-procedure: a rejected cross-signature
install leaves the installed app and its data completely untouched. It was
tried on the emulator and the old build was still there, still on its own
certificate, afterwards. **An accidental attempt costs nothing.** Only the
uninstall is irreversible.

---

## What was proved before this was written

Rehearsed end to end on `emulator-5554`, never on the A17, with a throwaway
test signer standing in for the future permanent key (created, used, destroyed;
never committed, never called a production key).

| Step | Result |
| --- | --- |
| Export twice to user storage through the system picker | two independent archives, 3 entries + 4 drafts each |
| Validate both off-device | structure, manifest and every checksum PASS |
| Uninstall | app-private SQLite gone; both archives untouched |
| Install a **differently signed** clean build | succeeds; journal empty; first-run dialog returns |
| Restore archive A | 3 entries and 4 drafts back, **zero field drift** — nothing dropped, added or altered |
| Force-stop and relaunch | identical; an acknowledged write had already committed |
| Restore the second archive on top | 0 new / 3 unchanged — idempotent, no duplication |
| Truncated archive | rejected: "could not be read … Nothing was changed." |
| Archive altered inside a valid zip, manifest untouched | **imported silently — the defect this rehearsal found, since fixed** |
| Archive B after all of that | exact recovery again, zero drift |

Drafts survived **byte-identical**, kept their parent entries and their original
start times, and came back as drafts — the app showed "DRAFT · Continue sermon
· 3 more unfinished", not four extra entries.

### The gap this rehearsal found, and what was done about it

**The app did not verify MANIFEST.txt when it imported.** It read
`data/journey.json` and nothing else. A zip that would not open was rejected;
an archive whose *contents* were damaged after it was written still parsed, and
still imported, silently.

This was not assumed. An archive was altered inside a still-valid zip, its
manifest left alone, and fed to the app on an empty journal — which is the state
a migrating device is always in. It imported the damaged content without a word,
and the original text was gone.

**That is now fixed.** `parseImport` checks an archive against its own manifest
before a single entry is read out of it: before the preview, before any
conflict count, before storage. A mismatch refuses the restore and the journal
is left exactly as it was. See `src/export/restore-integrity.test.ts`, which
holds that line over thirteen kinds of damage, against both an empty and a
populated journal.

**Step 3 below still stands anyway**, and is not redundant:

```
npm run verify:archive -- <archive.zip>
```

It asks the same question from outside the app, on the computer, before
anything is uninstalled. Both now share one implementation of the manifest
grammar and the hashing (`src/export/manifest.mjs`) and use different ZIP
readers, so a bug in either decoder cannot hide from both; parity over the same
fixtures is asserted in `scripts/__tests__/verify-archive.test.mjs`.

The reason to run it anyway is simple: at the moment you uninstall, the archive
becomes the only copy of the journal, and "the app said it was fine" and "the
file is fine" should be two separate observations. Defence in depth here is
deliberate — do not drop step 3 because the app now checks too.

---

## The procedure

Do not begin until every step has been read. Steps 1–4 are reversible; step 5
is not.

### 1. Decide that this is worth doing today

Nothing forces this. The A17 works. The reason to do it is that the current
arrangement depends on one unbacked-up debug keystore, and the longer the
journal on that phone grows, the more expensive this migration gets.

If the answer is not today, the interim safety measure is smaller and should be
done anyway: **back up `~/.android/debug.keystore`** somewhere off this machine.
That alone removes the worst outcome, which is losing the ability to update the
phone at all.

### 2. Export twice, to somewhere that is not the phone

In the app: **Data & Backup → Export everything**, and save through the system
picker to a location you choose. Do it **twice**, to two different places — one
of them not on the device.

Two independent exports, not one copied twice. A copy inherits any damage the
original already had.

### 3. Validate both archives on the computer

Copy them off the phone, then:

```
npm run verify:archive -- ~/path/journey-export-YYYY-MM-DD.zip
npm run verify:archive -- ~/path/journey-export-YYYY-MM-DD\ \(1\).zip
```

Expect `PASS` and five `ok` lines from both, and confirm the entry and draft
counts match what the phone says it holds.

> **STOP if either fails, or if the counts are wrong.** Do not uninstall
> anything. Export again and re-validate. The phone is still the only complete
> copy of the journal until two archives have passed this step.

### 4. Confirm what is actually installed

```
adb -s <serial> shell dumpsys package com.myjourneywithchrist.lifewithchrist | grep -E "versionName|lastUpdateTime"
```

Always name the serial. Never issue a bare `adb` command with more than one
device attached — and check with `adb devices -l` that only the intended one is.

### 5. Uninstall — the irreversible step

```
adb -s <serial> uninstall com.myjourneywithchrist.lifewithchrist
```

Everything the app holds is gone at this moment. The archives from step 2 are
now the journal.

### 6. Install the permanently signed build

Built and signed with the new long-lived key, verified as
`docs/RELEASE-ANDROID.md` requires — `aapt2 dump badging`, permissions,
no `debuggable`, and `apksigner verify --print-certs` showing the expected
certificate.

```
adb -s <serial> install <release.apk>
```

### 7. Restore, and check it

Open the app, dismiss the first-run notice, then **Data & Backup → Bring a
journal back in → Choose a journal file**, and pick the archive validated in
step 3.

The preview reports what it would do before anything is written. Expect
`N new`, `0 conflicts` on an empty journal.

The preview now names unfinished drafts alongside entries, so a file holding 3
entries and 4 drafts says so rather than reporting "3 entries" and leaving the
drafts to appear unannounced after the restore.

After committing, check against what the phone held before:

- the entry count in **My journey**
- unfinished drafts on the home screen ("DRAFT · Continue… / N more unfinished")
- a few entries opened and read

Then **force-stop the app and reopen it**, and check again. On the emulator this
changed nothing, which is the point: an acknowledged write has already
committed.

### 8. Export once more, from the new install

The restored journal on a newly signed app is a new arrangement. Export it, and
validate that archive too. Then the new identity is established *and* backed up.

---

## What does not survive, and is not a bug

- **Export history.** The archive carries `entries` and `drafts`; it carries no
  settings. A restored journal reports "never exported" and starts its 30-day
  reminder from zero. Step 8 resolves this in practice.
- **Theme and the first-run flag.** Disposable UI preferences in
  `localStorage`, deliberately not journal data.
- **Nothing else.** Entries and drafts came back with zero field drift across
  every rehearsal.

---

## Afterwards

The new key becomes a long-lived product identity. Back it up somewhere that is
neither this machine nor this repository, before it is used for anything the
owner depends on. Losing it puts the phone right back into the position this
document exists to get it out of.
