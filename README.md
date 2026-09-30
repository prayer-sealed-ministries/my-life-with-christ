# My Life With Christ

**Your walk, remembered.**

Keep Scripture notes, sermons, prayers and personal reflections together in one
private journal. Over the years, My Life With Christ becomes **My Journey With
Christ** — a readable record of your faith that you can preserve, print and pass
on.

| | |
| --- | --- |
| Application | **My Life With Christ** |
| The journal it produces | **My Journey With Christ** |
| Planned product home | **mylifewithchrist.com** |

---

## Why this exists

This is not primarily a Bible app with a notes feature.

> We are not building a place to store notes. We are building a record of a life
> with Christ that can outlive the software that created it.

Most of what people write about their faith is lost — in notebooks nobody can
read, in apps that shut down, in accounts nobody can get into after a death. The
sermon that changed someone's mind at thirty is gone by the time a grandchild
might have wanted it.

So the governing question here is not "where do I put this note?" It is: *will
this still be readable in 2060, by someone who has never heard of this
software?* Every architectural decision follows from that answer — the file
formats, the export, the refusal to require an account, the insistence that the
archive be plain text a person can open with nothing but a text editor.

**These are your words. Your prayers. Your story.**

---

## What makes it different

**Notes and reflection are separate fields, never one box.** What was taught and
what it meant to you are different records. The first is a summary of someone
else's work; the second is yours, and it is the one worth handing down. They are
never merged, never concatenated in an export, and a reflection is never shared
along with notes by default.

**Private by default, not private by setting.** Entries are private. Sharing —
when it exists — is per entry, explicit, and revocable, and prayers and
reflections require their own affirmative choice each time.

**No account, and nothing to lock you out.** There is no sign-up, no profile, no
server holding your journal. Nothing is held hostage.

**The export is the product, not a convenience.** A journal you cannot get out
of an app is a journal you do not own.

**Your own words.** Generative AI is not part of the journal experience. Nothing
drafts your reflections or rewrites your prayers. The value of this record comes
entirely from the fact that a real person wrote it.

---

## How the journal works

Reach a passage three ways — browse by book, by the titled sections within a
book, or by life topic — and write against any of it.

- **Fast capture.** A sermon starts and there are a few seconds before the first
  point lands. The new-entry form opens with the kind already set, the date
  already today, and the cursor already in the notes box. Everything else folds
  away behind a details panel.
- **Entry kinds.** Sermon, Bible reading, prayer, reflection, letter.
- **What an entry is about.** A passage, a topic, or a whole book. A passage
  anchor always stores a resolved Scripture range, so a note keeps its meaning
  even in a build that carries no section titles at all.
- **Light formatting.** Headings, bold, italic, lists, quotes and links, written
  through a small toolbar and stored as plain Markdown in the same fields — so
  the archive stays readable as text rather than becoming a pile of HTML.
- **Search** covers typed references, topics and their aliases, book names, your
  own journal, and section titles where the build has them. Its empty state
  names every source it searched, and any it could not.
- **Timeline** shows the journal oldest first — the way it was lived.
- **Import** brings in notes you already have, from `.txt`, `.md`, `.docx` or
  text-based `.pdf`. Files are read in the browser, you review and correct what
  was found, and nothing is written until you confirm.

Scripture text throughout is the **King James Version**, vendored with the app.

---

## Your data is yours

**Browser storage is not a backup.** Clearing site data, reinstalling a browser,
or a failed disk can take all of it. The app says so out loud if you have not
exported in thirty days. This is stated plainly rather than buried, because it
is the one way a person could lose everything while believing it was safe.

Export produces a single zip built to be understood without this application:

| In the archive | What it is |
| --- | --- |
| `README.txt` | what this is, for a stranger who found the file |
| `MANIFEST.txt` | every file with its size and SHA-256, so damage is detectable |
| `notes/` | one Markdown file per entry — the real archive |
| `data/journey.json` | the canonical record, with `schema.json` beside it |
| `data/entries.csv` | a flat table for a spreadsheet |
| `indexes/` | cross-references into `notes/` |
| `book/my-journey-with-christ.html` | the whole journal as one self-contained page that prints cleanly to PDF |

That HTML book is **My Journey With Christ**: the whole journal as something a
person can hold, or print, or leave behind.

Import reads the archive back losslessly. Fields written by a newer version are
preserved rather than dropped, so a journal exported by a later build does not
lose anything by being read here.

> **A note on names.** The archive's machine-readable parts — `data/journey.json`
> and the `journey-export` format identifier — deliberately do not carry the
> product name. They are short, boring and brand-independent so that renaming the
> product never has to touch stored data or break a reader written against the
> format. `CLAUDE.md` lists them, so a future maintainer does not tidy them away.

---

## Privacy

- **No account.** Nothing to create, nothing to lose access to.
- **No backend in v1.** There is no server to hold your journal, because there
  is no server.
- **No runtime network calls.** Scripture, section data and topics are vendored
  into the build. Nothing is fetched at runtime, there is no analytics or
  telemetry, and imported documents are parsed entirely on the device.
- **No ads and no data mining**, now or as part of the intended product.
- **Sharing is one entry at a time, through your own device.** From a saved
  entry you can send that page — and only that page — to the operating
  system's share sheet as a PDF or as plain text. Reflections, prayers and
  provided church notes are excluded unless you tick them, every time. Nothing
  is uploaded, nothing is recorded, and there are no share links or accounts.

**This is local-first, not invulnerable.** Data sits in your browser's storage
on a device you control. Anyone with access to that unlocked device has access
to the journal. There is no encryption at rest, no passcode, and no protection
against malware or a shared computer. The honest summary is that your journal is
exactly as private as the device it lives on — which is the point, and also the
limit.

---

## Current status

Assessed against the code, not against intentions.

| Area | State | Notes |
| --- | --- | --- |
| Scripture | **Done** | KJV vendored, 31,102 verses, lazy-loaded per book |
| Topics | **Done** | 40 topics, 344 Scripture references |
| Browse, book and passage views | **Done** | every chapter reachable and journalable |
| Journal entries | **Done** | create, edit, delete; fast-capture path |
| Light formatting | **Done** | Markdown editor and renderer, shared by written and imported notes |
| Search | **Done** | references, topics, books, journal, section titles |
| Timeline | **Done** | chronological, grouped by year and month |
| Export | **Done** | zip archive, printable book, checksummed manifest |
| Import — own archive | **Done** | lossless round trip, forward migration |
| Import — outside documents | **Done** | `.txt`, `.md`, `.docx`, text-based `.pdf`; review before commit |
| Data-profile gate | **Done** | enforced in CI and by a local pre-push hook |
| Accessibility | **Done** | WCAG 2.1 AA checked in CI against the built site |
| Light and dark themes | **Done** | including system preference |
| Offline support | **Not built** | no service worker or installable manifest yet; the app makes no network calls once loaded, which is not the same thing |
| Sharing | **Not built** | interface only |
| Native iOS and Android apps | **In progress** | both shells build and launch from bundled assets; they cannot open a journal yet — native storage is Phase 2, and the app refuses rather than falling back to webview storage |
| OCR for scanned PDFs | **Not built** | scanned files are refused with a clear message rather than silently producing empty notes |

---

## Scripture, sections, and what comes from where

These are three different things and the distinction matters legally as well as
technically.

**Scripture text** is the King James Version, in every build. Nothing else
supplies verse text.

**Section headings and divisions** — the titled spans a book is broken into —
come from a different source depending on how the app was built. That is what
`DATA_PROFILE` selects:

| Profile | Section divisions come from | Used for |
| --- | --- | --- |
| `public` | **BSB section headings** plus introductions written for this project | **the deployed build**, and the default |
| `refs-only` | none — whole chapters from KJV versification | fallback |

Each profile reads only the file it ships. Both are publishable.

### No licensed third-party data is in this repository

Every division scheme here is either public domain or written for this project:
the section headings come from the Berean Standard Bible, dedicated to the
public domain on 2023-04-30, and the book introductions were written here from
plain historical fact and public-domain reference works.

A licensed third-party outline compilation was used during earlier development.
**It is not part of this repository** — not the source documents, not anything
generated from them, and not in the history. There is no build profile that
reads it and no flag that can turn one on. See `DATA-LICENSE.md`.

Private or licensed source data must never be committed here.
`npm run verify:no-private-data` fails closed if any is, and runs in CI before
anything is built or uploaded, and in the pre-push hook.

### The gate

The build switch is not the safeguard. The safeguard is a verifier that reads
the built files and looks for the material itself:

```bash
npm run gate                              # what the pre-push hook runs
npm run verify:bundle -- --profile public # check a built artefact directly
```

It reports seven named assertions, including floors that stop it passing while
having examined nothing:

`BUNDLE_WAS_READ` · `EXCLUSIONS_TRACEABLE` · `PROBE_SET_INTACT` ·
`NO_SOURCE_FILES` · `NO_SOURCE_MAPS` · `NO_OUTLINE_PROSE` ·
`NO_OUTLINE_DIVISIONS`

CI runs it as a standalone required job, and the Pages workflow verifies the
artefact *before* uploading it.

### Scripture provenance, stated plainly

The KJV is **public domain in the United States**. In the **United Kingdom it is
not**: it rests under perpetual Crown copyright exercised through letters patent.
This is recorded so that a UK-facing deployment is a deliberate decision rather
than a later discovery. It does not affect personal or private use.

BSB section headings were dedicated to the public domain on **30 April 2023**.
The BSB supplies **only the headings and the spans they divide the text into**,
never the verse text itself.

*Attribution* is not required by either source and is given anyway, on the site
and in every export. Attribution and permission are separate questions: the UK
position above is about reproduction, and crediting the text does not answer
it.

Full provenance: `src/data/kjv/SOURCE.md`, `src/data/sections/SOURCE.md`,
`DATA-LICENSE.md`.

---

## Running it

```bash
npm install
npm run dev            # Vite dev server (public profile by default)
npm test               # unit tests
npm run typecheck
npm run lint
npm run build          # public profile, the one that deploys
npm run build:refs-only
npm run verify:no-private-data   # no licensed or private data is tracked
npm run gate           # the guard, workflow policy, and the data gate
```

End-to-end and accessibility suites run against the built site:

```bash
npm run test:e2e
npm run test:a11y      # axe, keyboard, contrast, reflow
```

A few checks in `npm test` inspect the web assets copied into the iOS and
Android projects, which are generated rather than committed. On a fresh clone
they have nothing to look at and say so. Generate them once:

```bash
npm run native:assets && npm run native:sync
```

Regenerating data (both outputs are committed; the ingest is idempotent and CI
fails if re-running changes them):

```bash
npm run ingest:sections  # BSB USFM -> src/data/sections.json
```

### The native shells

iOS and Android wrap this same application. They run entirely from bundled
local assets — there is no `server.url`, and the shells do not point at a
website.

```bash
npm run native:assets    # build with DATA_PROFILE=public, then verify it
npm run native:sync      # refuse unless verified, copy, then verify again
npm run native:ios       # sync, then open Xcode
npm run native:android   # sync, then open Android Studio
```

**Never run `npx cap sync` or `npx cap copy` directly.** The Capacitor CLI
copies whatever is sitting in `dist/`, and `dist/` holds whichever profile was
built last, verified or not. `native:sync` exists to refuse that: it will not
copy without a marker proving the bytes on disk are the bytes a `public` build
verified, and it re-runs the data gate on the copied assets afterwards. A store build is not revocable the way a Pages
deploy is.

**Tested JDK: 21.** The Android project was built with Android Studio's bundled
JBR (OpenJDK 21.0.10), which is the recommended environment for this repository
today. One other combination was tried and failed: Homebrew OpenJDK 26.0.2 with
this project's Gradle 8.14.3, which stops at `Unsupported class file major
version 70`. That is a single observed pairing, not a general statement about
JDK 26 — a newer Gradle may well accept it; we have not tested that.

A native build currently stops at a screen saying it cannot open a journal.
That is correct: native editions require SQLite, which arrives in Phase 2, and
the app refuses rather than quietly writing the journal into webview storage it
would later stop reading. See `docs/ADR-NATIVE-APP-ARCHITECTURE.md`.

`CLAUDE.md` holds the operating contract: what is generated, what is
hand-edited, and the rules that are not open to renegotiation.

---

## Known data characteristics

Regenerated by the ingest, not maintained by hand.

- **`data/sections-ingest-report.md`** — every heading the USFM parser could
  not read strictly. Nothing is silently corrected.
- The BSB scheme is a complete partition: 3,016 sections, every verse covered,
  no gaps or overlaps. A division scheme with holes in it is still supported —
  uncovered passages remain browsable and journalable — but this one has none.

---

## Product direction

**Everything in this section is intent, not implemented behaviour.**

The long-term goal is a commercial native application for iOS and Android, with
the same journal at its centre and the same constraints holding.

The principles meant to survive that move:

- **A one-time purchase, not a subscription that holds a journal hostage.** A
  lifetime record should not stop being readable because a card expired.
- **No cloud account required** to use the core journal.
- **User-owned export and restore** on the device, in an open format.
- **If optional paid services ever exist**, ending payment must never make an
  existing journal inaccessible. Whatever has been written stays readable and
  exportable, always.

Pricing is a product decision and is deliberately not recorded in this
engineering README.

Also intended, and also not built: sharing (a single entry as a read-only file
or link; small private groups posting notes on the same sermon), offline
install, and OCR for scanned documents.

---

## Licence

Code is MIT — see `LICENSE`.

Data licensing is documented separately in `DATA-LICENSE.md`. The short version
is that everything here is public domain or written for this project, no
licensed third-party data is in this repository or its history, and
`npm run verify:no-private-data` is what keeps it that way.
