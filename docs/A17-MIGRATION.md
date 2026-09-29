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
| Archive B after all of that | exact recovery again, zero drift |

Drafts survived **byte-identical**, kept their parent entries and their original
start times, and came back as drafts — the app showed "DRAFT · Continue sermon
· 3 more unfinished", not four extra entries.

### The one gap found, and why step 3 exists

**The app does not verify MANIFEST.txt when it imports.** It reads
`data/journey.json` and nothing else. A zip that will not open is rejected; an
archive whose *contents* were damaged after it was written still parses, and
still imports, silently.

This was not assumed. An archive was altered inside a still-valid zip, its
manifest left alone, and fed to the app on an empty journal — which is the state
a migrating device is always in. It imported the damaged content without a word,
and the original text was gone.

In ordinary use this hardly matters: an export is written and read back by the
same app minutes apart. It matters enormously here, where the archive is the
only copy and a phone is about to be wiped. Hence:

```
npm run verify:archive -- <archive.zip>
```

which checks the archive against its own manifest, on the computer, before
anything is uninstalled. It is proved to fail on every kind of damage it claims
to catch — see `scripts/__tests__/verify-archive.test.mjs`.

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

> **Note the preview counts entries only.** It does not mention drafts, though
> drafts are restored too. "3 entries" on a file holding 3 entries and 4 drafts
> is not an error.

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
