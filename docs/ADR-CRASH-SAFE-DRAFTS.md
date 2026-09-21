# ADR: crash-safe local drafts

Status: accepted, 2026-09-20.

## What this has to be true of

A person types sermon notes for an hour. The phone locks, a call comes in,
Android reclaims the process. Their words are still there when they come back.
That is the whole requirement. Autosave here means *persist exactly what was
typed* — not summarise it, not tidy it, not rewrite it.

## What exists today

- `Entry` is the canonical journal record. It is also the export format: it
  carries `_unmigrated` so fields written by a future version survive a trip
  through this one.
- `EntryEditor` holds all in-progress work in one `FormState` value. Nothing
  outside component state exists until the reader presses Save, which builds a
  `Partial<Entry>` and calls `createEntry`/`updateEntry`.
- Dexie is at schema version 1 (`entries`, `settings`). SQLite is at
  `SCHEMA_VERSION = 1` with an ordered `MIGRATIONS` ledger, built to be extended.
- Timeline, Search, Home's "Recently written", the CSV index and
  *My Journey With Christ* all read `listEntries()`.

So: everything typed before Save exists only in React state, and one process
death loses all of it.

## Options considered

### A. A `draft` flag on `Entry`, written into the `entries` store

Rejected. Every surface that reads `listEntries()` would have to learn to
exclude drafts — timeline, search, Home, the CSV index, the book generator,
`putEntries`, `replaceEntries`, the anchor lookup. Miss one and a half-finished
sentence appears in the lifelong book handed to a grandchild. The failure is
silent, permanent and exactly the thing this project exists to prevent. Safety
here should come from the data model, not from remembering to filter in nine
places.

### B. Drafts in `Settings`

Rejected outright. Settings is a small singleton for preferences. Putting
arbitrarily large journal text in it makes it a second, untyped journal with no
identity, no ordering and no per-draft lifecycle.

### C. `localStorage`

Rejected. CLAUDE.md already forbids journal content there, and the reason
applies exactly: losing it costs the reader words they wrote.

### D. A dedicated `drafts` collection — **chosen**

A new store beside `entries`, with its own provider operations.

Why it wins:

- **Contamination is impossible by construction.** Timeline, search and the book
  read `entries`. A draft is not an entry, so it cannot leak into them by
  forgetting a filter. The only surfaces that see drafts are the ones that ask
  for them.
- **Identity is native.** One row per draft means two unfinished pieces of work
  cannot overwrite each other, which a single blob could not promise.
- **Atomicity is native.** One row holds the whole snapshot, so there is no
  interleaving that yields a title from one keystroke and notes from another.
- **It fits the seam.** `StorageProvider` grows four methods; Dexie and SQLite
  implement them the same way they implement everything else, and no view learns
  what it is running on.

It costs a schema migration on both engines. That is the right price: choosing a
worse model to dodge a migration is how the ledger stops being trustworthy.

## The model

A draft is a snapshot of the editor, not a partial entry:

```
EntryDraft {
  id          stable, survives relaunch
  entryId?    set when editing a saved entry; absent for a new one
  form        the editor state verbatim — exactly what was typed
  createdAt
  updatedAt
}
```

`form` is stored verbatim rather than converted to an `Entry`. Converting means
trimming, dropping empty link rows and parsing tags — all correct for a
*deliberate* save and all wrong for a recovery snapshot, which must restore the
half-typed state the reader actually had.

### Identity

- Editing a saved entry: the draft is found by `entryId`, so reopening the entry
  finds the same draft and two entries never collide.
- A new entry: an id is minted on the first meaningful edit and carried in the
  route as `#/entry/new?draft=<id>`, following the existing precedent that
  `newEntry` takes optional query parameters (`anchor`, `kind`).

### Meaningful content

A blank editor must not litter the store. On a page nothing has ever been saved
under, a draft exists once any user-authored field carries something: title,
notes, reflection, prayer, place, speaker, series, tags, an anchor, a link with
a URL, the descendants flag, or imported source material. Date and kind alone do
not count — every blank editor has them.

### Recoverable change, not merely content

That rule is the right one for a blank page and the wrong one for a saved entry,
and applying it to both was a shipped defect: opening an entry hydrates the
editor with everything the entry holds, which satisfies "is there content" for
every entry ever written. So *reading* a note minted a recovery draft, and the
home page then offered to "continue writing" something nobody had touched.

A draft holds what the journal does not have yet. Where there is a saved entry
behind the form, the question is therefore whether the editor differs from it —
`hasRecoverableChanges(form, canonical)`, where `canonical` is that entry
expressed as editor state, which is exactly what reopening the editor would
show. When they are the same, a process death costs nothing.

Three consequences, all of them load-bearing:

- The baseline moves when the journal does. A successful Save makes what was
  just written the new canonical state, so an edit-and-undo after a save leaves
  nothing behind either.
- A difference that goes away takes the draft with it. Undo the edit and the
  record is retired, because a recovery offer for work that no longer differs
  from the record is a meaningless thing to put in front of someone.
- Retiring is fence, *wait*, delete. A write already awaiting storage is past
  the fence; deleting without waiting for it lets it land afterwards and
  recreate the record. `Autosaver.settled()` is that wait.

Comparison is exact and field by field — no trimming, no normalisation. A
snapshot exists to give back what was on the screen, and deciding that a
paragraph someone deliberately ended with a blank line is "the same as" one they
did not would defeat that. `SAME_FIELD` in `src/lib/drafts.ts` carries one
comparator per field and is typed `Record<keyof DraftForm, …>`, so a new field
added to the form fails to compile until somebody decides how it compares.

### Write policy

Change-driven and coalesced, not timer-driven. Each queued snapshot carries a
monotonically increasing generation; a write whose generation is older than what
has already been persisted is dropped rather than applied. That is what stops a
slow earlier write landing on top of newer text, and it is a rule about
ordering rather than about timing, so it does not depend on any timer winning a
race.

Explicit Save flushes the pending snapshot first, writes the canonical entry,
then retires the draft behind a fence so a late autosave cannot resurrect it.

### Lifecycle events

Not load-bearing. `pagehide` and `beforeunload` were measured in this project as
never firing on either platform. The design is safe with no lifecycle callback
at all; any flush on background is a bonus that narrows the loss window, never
the mechanism.

## Consequences

- Drafts are recoverable and resumable, and are **not** part of the finished
  book until explicitly saved. An unfinished half-sentence is not a journal
  entry.
- The canonical archive carries drafts, because "Export everything" that
  knowingly omitted the reader's most recent words would be a lie. They travel
  as a separate, optional `drafts` key on the envelope — not as entries — so a
  v1 archive without them still imports and the book still contains only
  finished entries. No format version bump: the key is additive and optional.
- Worst case loss is bounded by the debounce window, and is measured rather
  than asserted.
