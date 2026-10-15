# Document import — the security model

Every file imported into this application comes from outside it and is treated
as hostile input. This records what is checked, what is deliberately not, and
where the limits of that are.

---

## The rule

**A name is a claim.** A picker filter is a convenience, an extension is a
claim, and a MIME type is a hint from software that was itself told. None of
them is evidence about bytes.

Until this work, the import path chose a parser from the filename extension
alone: a file called `notes.pdf` reached pdf.js whatever was inside it. Now a
file must satisfy, in this order:

```
size → claimed extension → MIME agreement → signature at offset 0
     → container structure → format structure → the parser itself
```

Cheapest first, so a 25 MB executable named `.pdf` is refused by reading five
bytes rather than by feeding it to a document parser to find out. **Every
decision fails closed**; a check that cannot reach a conclusion refuses.

The canonical implementation is `src/import/document-type.ts`. There is exactly
one of it, reached from both import doorways — `parseDocument` for the general
importer and `readSermonNotes` for church notes, which is also where shared and
opened documents arrive. A secure picker route and a permissive share route
would simply move the problem.

---

## MIME is evidence only when it says something

Operating-system file providers routinely return nothing, an empty string, or
`application/octet-stream`. Treating that as disagreement would refuse ordinary
files on ordinary phones, so:

| What the provider said | What it means here |
| --- | --- |
| nothing, empty, `application/octet-stream` | no evidence; the bytes decide |
| something unrecognised | no evidence |
| something specific | must agree with the name, **by family** |

"By family" matters. `txt`, `markdown` and the sermon-notes JSON are one
family: a `.json` handed over as `text/plain` is an ordinary, true statement
about the bytes, and there is nothing to protect because a text file is decoded
as text whichever of those names it arrives under. PDF and DOCX are each their
own family, because each hands bytes to a parser whose job is to interpret
structure.

That distinction was not designed in advance — the first version demanded exact
agreement and refused ordinary sermon-notes JSON. The existing tests caught it.

**MIME never overrides bytes**, in either direction.

---

## PDF

| Check | Policy |
| --- | --- |
| Signature | `%PDF-` at **offset zero**, nowhere else |
| Version | one this build claims to read (1.0–1.7, 2.0) |
| Termination | a final `%%EOF` must exist |
| Tail | only whitespace may follow it, and not much |
| Cross-reference | a `startxref` must be present |
| Parser | pdf.js must then open it; any failure refuses |

Offset zero is the whole point: `%PDF-` appearing somewhere inside a file is
exactly what a polyglot arranges. `MZ…%PDF-`, `PK…%PDF-` and
`<html>…%PDF-` are all refused.

**The last `%%EOF` is the one that counts.** A handout that was corrected and
re-saved carries an incremental update — a second body and a second marker —
and that is ordinary, not an appended payload.

The case that justifies the whole layer: a valid PDF with an executable stapled
to the end **parses perfectly**. pdf.js reads the document in front of the
payload and reports no problem, because a parser's job is to read what it can,
not to police what came with it. Only the type check refuses it. There is a
test that proves exactly this, by parsing the file successfully and then
watching the import refuse it.

### Scanned PDFs

Still reported honestly as scanned pages with no selectable text. **No OCR is
performed on them in this work.**

---

## DOCX

A ZIP is not a Word document. The container signature says only that somebody
zipped something.

| Check | Policy |
| --- | --- |
| Signature | a ZIP local header at offset zero |
| Legacy `.doc` (`D0 CF 11 E0`) | refused, with wording that says what to do |
| `[Content_Types].xml` | required; must declare the main part |
| `_rels/.rels` | required; its root relationship must name the main part |
| Main part content type | the **ordinary, non-macro** WordprocessingML type |
| Macro-enabled type, anywhere | refused |
| `word/vbaProject.bin`, ActiveX, custom UI | refused |
| External root relationship | refused |
| `<!DOCTYPE` / `<!ENTITY` in a structural part | refused |
| Member paths | normalised; traversal, absolute, drive-letter and control characters refused; duplicates after normalisation refused |
| Ordinary images | **allowed** |

Images are allowed deliberately. Church handouts are full of logos and
photographs, the text parser never opens them, and refusing them would refuse
the very documents this feature exists to read.

Only four small members are ever inflated: the content types, the root
relationships, and the document body. Embedded images, fonts and headers are
never decompressed, because nothing here needs them.

---

## The archive container

| Check | Policy |
| --- | --- |
| Member count ceiling | kept |
| Per-member inflated ceiling | kept |
| Total inflated ceiling | kept |
| Compression ratio | kept |
| Streaming early abort | kept — the budget is checked while it is spent |
| Encrypted members | refused |
| Unsupported compression methods | refused |
| **CRC-32 of every inflated member** | **verified** |
| **Central directory vs local header** | **name, method and size must agree** |
| **ZIP64** | **refused rather than half-parsed** |
| **Split / multi-disk archives** | **refused** |

The last four are new. A reader that trusts whichever header it happens to
consult can be shown one member by its checks and hand a different one to the
parser; size agreement alone cannot tell a corrupted member from an intact one;
and ZIP64's sentinel values would make every bound derived from the 16-bit
fields meaningless.

Structural Word parts get much tighter ceilings than a journal archive, because
a content-types declaration is a few kilobytes in every real document ever
produced.

---

## Network

Nothing in the import path reaches the network, and tests replace the network
primitives and fail if anything touches them. pdf.js runs with worker fetch,
CMap, font, ICC and wasm URLs all unset, and with auto-fetch, streaming and
range requests disabled. A document does not get to decide to contact anyone.
External DOCX relationships are never followed; a package whose *starting
point* is external is refused outright.

---

## What the person is told

Plain sentences that say nothing happened, and do not accuse anybody:

- *This file is named as a PDF, but its contents are not a supported PDF. Nothing was imported.*
- *This file is named as a Word document, but its contents are not a supported .docx file. Nothing was imported.*
- *This Word document contains features this app doesn't import safely. Save a copy as a standard .docx file without macros and try again.*
- *This document appears to be damaged and couldn't be read. Nothing was imported.*
- *This PDF is password-protected and can't be imported here. Nothing was imported.*

No message says "malware". Internally the reason is one of `type-mismatch`,
`malformed`, `unsupported-feature`, `active-content`, `encrypted` or
`resource-limit`; none of that reaches the screen, and no document text is ever
logged.

---

## Review before write

Unchanged, and worth restating: importing produces a **proposal**. Nothing
reaches the journal until a person has seen a preview and confirmed it. Every
rejection above happens before a proposal exists, so a refused file cannot have
written anything.

Import church notes is the door for material somebody else supplied, so what
comes through it becomes **Provided notes** — never My Notes, Reflection or
Prayer. File type never decides authorship; the route does.

---

## Limits of this

- **Checks are structural, not semantic.** A genuine, well-formed Word document
  containing something unpleasant in its prose is a document, and this layer
  will pass it. What it stops is files that are not what they claim to be.
- **Active-content detection for PDF is currently at the structural layer**
  (header, termination, tail, parser) rather than a full name-object lexer over
  inflated object streams. That is the next increment, and the shape it should
  take is recorded below.
- **No antivirus, no quarantine, no server.** This application is local-first
  and stores no uploaded file; the controls that make sense for a server upload
  pipeline were deliberately not copied.
- **The parser is the last word, and parsers have bugs.** `pdfjs-dist` is a
  dependency with its own history; keeping it current is part of this promise.

### Engineering inspiration

The layering, the fail-closed posture and several specific PDF rules were taken
from reading `systemslibrarian/secure-file-upload-dotnet` (at `4f48e4c`). It is
**not a dependency** — nothing from it runs here. Three of its lessons were
adopted directly: check the signature at offset zero, treat the final `%%EOF`
and what follows it as structural, and extract PDF name objects with a lexer
rather than by substring search, so that `/JSON` never reads as `/JS` and the
`/J#53` hex spelling is decoded rather than missed. Its server-side controls —
virus scanning, at-rest encryption, quarantine — were deliberately left there.
