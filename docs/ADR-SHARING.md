# Sharing

**Status:** accepted. Local one-entry sharing is built; everything else is
deliberately not designed yet.

## What exists

One saved entry, sent from the reader's own device, through the operating
system's share sheet.

```
src/share/entry-document.ts   ShareScope, PRIVATE_BY_DEFAULT,
                              buildSharedEntryDocument, text + Markdown
src/share/pdf.ts              the same document as a PDF
src/platform/ports.ts         Sharer — hand one thing to the OS
src/platform/web.ts           navigator.share, with honest capability detection
src/platform/native.ts        the Android document bridge's shareDocument
src/views/ShareEntry.tsx      choose, read what will be sent, send
```

`buildSharedEntryDocument(entry, scope)` is pure and takes exactly one entry.
The privacy boundary is that signature: it reads no storage and has no
collection to leak from.

`PRIVATE_BY_DEFAULT` carries rule 5 of CLAUDE.md — reflections and prayers
require their own affirmative choice, per share. Provided notes are off for the
neighbouring reason: they are somebody else's material.

## What was retired, and why

`src/storage/ShareProvider.ts` defined a `ShareProvider` interface with
`shareEntry`, a `ShareResult` carrying a `revokeToken`, and capability flags
for `file`, `link` and `group`. It was written before any sharing existed, to
shape a v2 of revocable links and small private groups.

It was never implemented and never imported by anything. When local sharing was
actually built it did not fit: a `revokeToken` is meaningless for a file handed
to a share sheet — that cannot be recalled, and the old file said so itself —
and `ShareResult`'s `Blob` is the wrong shape for a native bridge that moves
bytes and a filename.

Two interfaces both called "sharing", one of them dead, is worse than one.

The privacy rule it carried was the part worth keeping, so `ShareScope` and
`PRIVATE_BY_DEFAULT` moved into `src/share/` under the same names, with the
values for notes, reflection, prayer and links unchanged.

## Revocable links and group sharing

A separate capability from local OS sharing, and it will get its own API if and
when it is built.

Not designed here on purpose. A shareable read-only link, small private groups
posting on the same sermon, and revocation are a different product with
different requirements — identity, storage that is not this device, and a
promise about withdrawal that local sharing cannot make. Designing that against
today's guesses is how the retired interface came to exist.

It should be designed from real requirements, not inherited from a placeholder.

## Importable single entries

A future trusted or importable single-entry format — `.mlwc-entry` or whatever
it turns out to be — should build on the pure single-entry representation in
`src/share/entry-document.ts`, not on the retired provider.

That representation already has the properties such a format needs: it is one
entry, it is derived by a pure function, it keeps the four kinds of writing
apart and labelled, and it carries no identifiers or internal fields. A
receiver format would add a schema, a parser, and whatever trust story is
decided on — none of which exists today, and none of which should be guessed
at now.
