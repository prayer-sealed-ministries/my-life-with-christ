# Saving, backup and recovery

My Life With Christ keeps the working journal on the device. It does not need
an account or a server, and it does not upload journal content.

## What “saved” means

Pressing **Save** writes a complete entry to the active storage engine:
IndexedDB in the hosted browser edition and SQLite in the installed Android and
iOS editions. The app does not announce success until that write completes.

If more words are typed while Save is still running, Save applies only to the
version submitted by the button. The newer visible version is kept as a
recovery draft attached to the saved entry before the app reports the outcome.
Reopening that entry restores the newer draft.

Two editors cannot silently overwrite the same entry or recovery draft. A
stale entry save is refused. If two editors advance the same draft, both
versions are retained under separate draft identifiers.

## Recovery drafts

The editor stores unfinished writing separately from finished entries after a
short settle window. Backgrounding the app asks the writer to flush immediately
when the operating system supplies that signal. Operating systems can still
terminate a process without warning, so text typed inside the current short
window is not described as durably saved until its draft write completes.

Deleting a finished entry also deletes recovery drafts attached to that entry
in the same storage transaction. Loose drafts and drafts for other entries are
not removed.

## What counts as a verified backup

A full export includes finished entries and every recovery draft. If any
required read or archive-building step fails, no complete-backup success is
reported and the backup reminder is not reset.

- Android and iOS report success only after the system document picker confirms
  that the file was saved.
- Browsers with the File System Access API report success only after the file
  stream is written and closed.
- Other browsers can only start a download. The app labels that result
  **unverified**, asks the reader to check Downloads, and does not reset the
  backup reminder.

Exports are ordinary unencrypted ZIP files. Anyone who obtains a file can read
it. Store it somewhere protected and separate from the device holding the
working journal.

## Restore and merge

**Replace** atomically replaces all finished entries and all recovery drafts
with exactly what is in the archive. If validation, a write, or the pre-commit
state check fails, the previous journal remains in place.

**Merge** keeps records already present. When the same identifier has different
content, the app does not use device clock timestamps to guess which writing is
newer. It preserves the imported version as a separate conflict entry or draft.
Importing the same conflict again does not make another copy.

Older supported JSON and ZIP exports remain readable. A file from a newer
format keeps unknown extension fields where the current format permits them;
an unsupported or malformed structure is rejected before storage changes.

## Import limits

Journal imports are limited to 256 MiB of input, 512 MiB expanded, 256 MiB for
one archive member, and the ZIP format's bounded member inventory. The reader
also rejects unsafe offsets, duplicate member paths, encrypted/unsupported ZIP
methods and implausible compression metadata. Android, iOS and browser pickers
apply the input limit before transferring or allocating the complete file.

These ceilings are intended to accommodate long-lived journals, including the
50,000-entry audit fixture, while refusing files designed to exhaust memory.

## Offline and privacy limits

Installed Android and iOS apps bundle their application code and Scripture and
can read and write without a network. The hosted browser edition keeps journal
data locally but has no service worker; a route or code chunk that has not been
loaded on that device may require a connection.

Native journal SQLite files are not encrypted by this application. They rely on
the operating-system sandbox and device protection. Android App Lock hides the
journal UI when enabled and fails closed if its state or required lifecycle
monitor cannot be verified. App Lock is not implemented on iOS and is not a
substitute for device encryption or a protected export.
