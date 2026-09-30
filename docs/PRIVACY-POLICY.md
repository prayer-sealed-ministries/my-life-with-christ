<!--
  MAINTENANCE NOTE — NOT PART OF THE POLICY THE READER SEES.

  Source-review date: 2026-09-29
  Source commit audited: d751f54
  Audited by reading current source, not previous reports. Scope: Android
  manifest and backup rules, Capacitor configuration, the native bridge
  (JourneyDocumentsPlugin, AppLockPlugin, SermonNoteWidget, SharedDocument),
  the full runtime dependency tree, storage layers, import/export, sharing,
  and every network-capable API in src/.

  Findings that shaped this policy:
    - No fetch/XMLHttpRequest/WebSocket/sendBeacon anywhere in src/.
    - No HTTP, socket or URL-opening code in android/app/src/main/java/.
    - No analytics, advertising, crash-reporting, attribution or
      authentication SDK in the dependency tree.
    - No `server` block in capacitor.config.ts; loggingBehavior 'none';
      webContentsDebuggingEnabled false.
    - android:allowBackup="true", with backup_rules.xml and
      data_extraction_rules.xml excluding ONLY the App Lock preferences.
      The journal database is therefore inside Android's own backup. This
      is disclosed below and is the one path where journal data can leave
      the device without an in-app action.
    - Permissions: INTERNET (declared in our manifest, no outbound request
      code exists); USE_BIOMETRIC and USE_FINGERPRINT (added by
      androidx.biometric:1.1.0, pulled in by @capacitor-community/sqlite,
      for an encrypted-database feature this app does not use).

  Open item: the in-app Data & Backup copy says "No copy exists anywhere
  else until you export one." Android Auto Backup makes that not strictly
  true when the device owner has backup switched on. Either the copy or the
  backup rules should change; both are product decisions and neither was
  altered in the lane that wrote this file. See docs/RELEASE-STATUS.md.

  Not published. GitHub Pages is disabled and no live policy URL exists.
-->

# Privacy Policy — My Life With Christ

*Your walk, remembered.*

**Last updated: 29 September 2026**

My Life With Christ is a private journal for sermon notes, reflections and
prayers. This policy explains, in plain terms, what happens to what you write.

The short version: what you write stays on your device unless you choose to
send it somewhere, or unless your phone's own backup is switched on. There is
no account, no server of ours, and nothing is sent to us.

---

## There is no account and no service behind the app

My Life With Christ does not operate an account system, a server, or a
journal-sync service. You do not sign in. There is nothing to sign in to.

The app makes no network requests of its own. It does not send your writing —
or anything else — to us or to anyone else. We do not receive your journal, and
we have no way to read it.

## What the app stores, and where

Everything you write is stored on the device you wrote it on:

- **Journal entries** — sermon notes, reflections, prayers, and the details
  attached to them (date, place, speaker, series, tags, Scripture references,
  links, topics).
- **Unfinished drafts** — writing you have started but not saved is kept so you
  do not lose it.
- **A few settings** — your theme choice, how often you want to be reminded to
  export, and whether you have seen the first-visit notice.

On Android this is kept in the app's own private storage. In a web browser it
is kept in that browser's local storage for the site. In both cases it is
ordinary application data on your own device.

## What the app does not do

- **No advertising.** There are no ads and no advertising software in the app.
- **No analytics or tracking.** The app does not measure how you use it, does
  not build a profile, and contains no analytics software.
- **No crash or diagnostic reporting.** Nothing is sent when something goes
  wrong.
- **No location, contacts, calendar, photos, microphone or camera access.**
- **No selling or sharing of your data.** We do not have it, so there is
  nothing to sell or share.

## When your writing can leave the device

There are three ways, and you are in control of all but one of them.

### 1. When you export your journal

Exporting creates a single `.zip` archive containing your journal in readable
form. You choose where it goes using your device's own file picker — your
phone's storage, a memory card, or a cloud folder such as Google Drive, if you
pick one.

That copy is yours. Once it leaves the app, it is governed by wherever you put
it: if you save it to a cloud service, that service's terms and privacy policy
apply to the copy you placed there. The app does not upload it anywhere and
does not choose the destination for you.

Exporting is strongly encouraged, because the copy on your device is not a
backup. If you lose the device, or the app's data is cleared, the journal goes
with it.

### 2. When you share a single entry

"Share this entry" prepares one entry — as a PDF or as plain text — and hands it
to your device's share sheet, so you can send it in a message, an email, or to
another app of your choosing.

You choose what goes into it. Your reflection, your prayer, and any material
your church provided are **switched off by default** and are only included if
you deliberately tick them. Nothing else from your journal is included, and no
other entry is sent.

To do this the app writes a temporary file into its own private cache and gives
the app you chose permission to read that one file. The temporary file stays in
the app's private storage; it is not placed in your public files.

Once you have sent it, what happens to it is between you and whoever you sent it
to. The app is not told what you chose and receives nothing back.

### 3. Your device's own backup

This is the one that does not involve a choice inside the app.

Android has a system backup feature that copies app data to your Google
account. If that feature is switched on for your device, **your journal is
included in it**. That backup belongs to you and goes to your own Google
account, not to us — but it does mean a copy can exist off the device without
you doing anything in the app.

Your App Lock PIN is deliberately **excluded** from that backup and never
travels with it.

If you would rather your journal were not included, Android's own Settings let
you turn off backup for individual apps, or for the device.

## Receiving a document from another app

You can send a document into My Life With Christ — a handout your church shared,
for example — using "Share" or "Open in" from another app.

When you do, the app shows you what it read and asks you to confirm before
anything is added to your journal. Material from a handout is kept separate from
your own writing and is labelled as provided material, so the two are never
confused.

## App Lock, and what it does and does not protect

App Lock is optional and switched off unless you turn it on. When it is on, the
app asks for a PIN before your journal is shown.

Two honest limits:

- **App Lock controls access through this app. It does not encrypt the journal
  database.** The underlying data is exactly as readable as it was before, to
  anything that can read the app's private storage. It does not replace your
  device's own screen lock, which is the thing that actually protects the device.
- Your PIN is never stored. What is stored is a verification value that cannot
  be turned back into your PIN, kept using Android's own secure key storage so
  that it is useless on any other device.

If you forget your PIN, you can reset it by confirming your device's screen
lock. There is no other way in, and nobody — including us — can recover it for
you.

## Permissions the app requests

| Permission | Why |
| --- | --- |
| Internet | Declared by the app's framework. The app makes no network requests; nothing about your journal is transmitted. |
| Use biometric / Use fingerprint | Comes from a database component the app includes. The app does not offer fingerprint or face unlock and does not use these. |

The app does not request access to your location, contacts, calendar, photos,
microphone, camera, or your files at large.

## Keeping and deleting your writing

Your journal stays until you remove it. You can delete any entry from within the
app, and deleting it is permanent.

Uninstalling the app, or clearing its data in Android's Settings, destroys
everything it holds on that device — every entry, every unfinished draft, and
your App Lock settings. There is no copy for us to restore, because we never had
one. Any archives you exported are unaffected, because they are yours and live
wherever you put them.

## Children

My Life With Christ is a personal journal intended for a general audience. It
does not knowingly collect information from anyone, of any age, because it does
not collect information at all.

## Changes to this policy

If the app's behaviour changes in a way that affects this policy, the policy
will be updated and the date at the top will change.

## Contact

[PRIVACY CONTACT TO BE PROVIDED]

Website: mylifewithchrist.com
