# Google Play Data Safety — internal completion worksheet

**Not marketing copy. Not for publication.** This exists so that whoever fills
in the Play Console form does it from evidence rather than memory.

| | |
| --- | --- |
| Source-review date | 2026-09-29 |
| Source commit audited | `d751f54` |
| Package | `com.myjourneywithchrist.lifewithchrist` |
| Nothing submitted | No Play Console entry has been made from this document |

---

## The definitions this worksheet is written against

Taken from Google's own documentation on 2026-09-29, quoted rather than
paraphrased, because the whole worksheet turns on them:

> **Collect** — "transmitting data from your app off a user's device."

> **Sharing** — "transferring user data collected from your app to a third
> party."

> **Processing ephemerally** — "accessing and using it while the data is only
> stored in memory and retained for no longer than necessary to service the
> specific request in real-time."

Exemptions Google lists, of which three matter here:

> "User data accessed by your app that is only processed locally on the user's
> device and not sent off device does **not** need to be disclosed."

> "Transferring user data to a third party based on a specific user-initiated
> action, where the user reasonably expects the data to be shared, or based on
> a prominent in-app disclosure and consent" — exempt.

> "Transferring user data for specific legal purposes…" — exempt (not
> applicable here).

Source: <https://support.google.com/googleplay/android-developer/answer/10787469>

**The distinction that governs this app.** Google's "collect" is about *the app
transmitting data off the device*. It is not about the user picking a file and
sending it somewhere themselves. This app never transmits anything; everything
that leaves is either the user's own deliberate act (export, share) or the
operating system's backup feature. That is why almost every row below is
"No".

---

## Evidence behind the answers

Each of these was checked in source at `d751f54`, not assumed:

| Question | Finding |
| --- | --- |
| Any `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` in `src/`? | **None.** |
| Any HTTP, socket or `openConnection` in `android/app/src/main/java/`? | **None.** |
| Analytics / advertising / attribution SDK? | **None** in the dependency tree. |
| Crash or telemetry reporting SDK? | **None.** |
| Accounts, auth, or backend SDK? | **None.** |
| `server` block in `capacitor.config.ts`? | **Absent**, and a policy test forbids one. |
| Bridge logging of plugin payloads? | Disabled (`loggingBehavior: 'none'`). |
| Absolute URLs in shipped source? | Four, all inert: two test fixtures representing user-typed links, one `$schema` identifier written into the archive, and DOCX XML namespaces used for parsing. None is requested. |

---

## Data types

"Collected" and "Shared" below use Google's definitions above.

| Play data type | Collected | Shared | Notes |
| --- | --- | --- | --- |
| Location (approximate, precise) | No | No | No location permission, no location API used. |
| Personal info (name, email, user IDs, address, phone) | No | No | No account, no sign-in, no identifiers created. |
| Financial info | No | No | No payments, no purchases. |
| Health and fitness | No | No | Not applicable. |
| Messages (emails, SMS, in-app messages) | No | No | The app sends no messages. |
| Photos and videos | No | No | No camera or gallery access. |
| Audio (voice, sound recordings, music files) | No | No | No microphone access. |
| Files and docs | No | No | The journal and any imported handout are **processed locally only** and are never transmitted by the app. See "Paths where data can leave" below. |
| Calendar | No | No | No calendar access. |
| Contacts | No | No | No contacts access. |
| App activity (interactions, search history, installed apps, other actions) | No | No | No analytics of any kind. In-app search runs entirely on device and is not recorded or transmitted. |
| Web browsing history | No | No | Not applicable. |
| App info and performance (crash logs, diagnostics, performance) | No | No | No crash reporting; bridge logging disabled. |
| Device or other IDs | No | No | No advertising ID, no device ID collected. |

**Every row is "No" for collection because the app transmits nothing off the
device.** That is the criterion Google states, and it is met literally.

---

## Paths where data can leave the device, and how each is classified

These are the cases to be able to answer for confidently if Play review asks.

### 1. Export (user-initiated)

The user taps Export, Android's own file picker opens, and the user chooses a
destination — which may be local storage or a cloud folder such as Drive.

- **Classification:** not collection. The app does not transmit; the user
  writes a file to a place they selected.
- If it is treated as a transfer at all, Google's **user-initiated action**
  exemption applies: the person chose the destination in the system picker and
  plainly expects the file to go there.
- The app never uploads and never chooses the destination.

### 2. Share this entry (user-initiated)

One entry is rendered as a PDF or plain text and handed to the Android share
sheet.

- **Classification:** not collection, and exempt as a **user-initiated action**
  for the same reason.
- Reflection, prayer and church-provided material are **off by default** and
  only included if deliberately ticked.
- The temporary file is written to the app's private cache and offered through
  a FileProvider grant scoped to that one file. It never enters public storage.
- The app is not told what the user chose and receives nothing back.

### 3. Receiving a shared document (inbound)

Another app sends a document in; the app reads it, shows the user what it read,
and imports nothing until confirmed.

- **Classification:** inbound only. Nothing leaves the device.

### 4. Android Auto Backup — **the one to check with Play**

`android:allowBackup="true"`. `backup_rules.xml` and
`data_extraction_rules.xml` exclude **only** the App Lock preferences, so the
journal database is inside Android's system backup and can reach the device
owner's Google account backup **without any action in the app**.

- It goes to the *user's own* Google account, not to the developer, and the
  developer cannot read it.
- The app does not perform the transmission — the platform does.
- Google's documentation, as fetched on 2026-09-29, **does not address Android
  Auto Backup** in its collection/sharing definitions.

> **VERIFY IN PLAY CONSOLE.** Whether Auto Backup must be declared is not
> settled by the documentation quoted above. The defensible reading is that it
> is not developer collection — the developer never receives the data — but
> this should be confirmed against the Console's own wording at submission
> time rather than assumed from this worksheet.

Two product options exist if the answer is unwelcome, and both are decisions
for the owner, not defaults to be quietly applied:

1. Exclude the journal database from backup as well. This removes the path, and
   makes the in-app copy ("no copy exists anywhere else until you export one")
   true — at the cost of a restored phone arriving with an empty journal.
2. Leave backup as it is and correct the in-app copy to mention it.

See `docs/RELEASE-STATUS.md`.

---

## Security practices section

| Question | Answer | Basis |
| --- | --- | --- |
| Is data encrypted in transit? | **No data is transmitted**, so the question does not arise. | No network code exists. |
| Can users request data deletion? | Yes — entries are deletable in-app; uninstalling or clearing app data destroys everything on the device. | There is no server copy to request deletion from. |
| Committed to Play Families Policy? | Not applicable unless the app targets children. | Target audience is a Console declaration, not a source fact. |
| Independent security review? | No. | None has been performed. |

**Do not claim the journal is encrypted.** App Lock is access control over the
app's own screens; it does not encrypt the database, and the in-app copy says
so. A Data Safety answer implying encryption at rest would be false.

---

## Still to resolve before the form is filled in

- Android Auto Backup classification — **verify in Play Console** (above).
- Target audience / Families declaration — a Console choice.
- Whether any answer changes once a permanent signing identity and a Play
  listing exist.
