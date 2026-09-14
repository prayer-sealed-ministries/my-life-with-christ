# Journey

A personal journal keyed to Scripture.

Browse the Bible three ways — by book, by the outline entries within a book, or
by topic — and attach your own notes to any of them: sermons you heard, sermons
you found, notes from your own reading, prayers, reflections.

Everything is local. No account, no server, no network calls at all.

## Why

The point is inheritance.

A lifetime of entries should come out as a readable book that a child or
grandchild can hold: *My Journey with God*. Every data decision here follows from
that — no lock-in, no data trapped in a service, and an export that a person can
read in 2060 with nothing but a text editor.

That is also why **notes** and **reflection** are two separate fields, never one
box. What was taught and what it meant to you are different things, and the
second is the one worth handing down.

## Status

| | |
| --- | --- |
| Ingest | done — 66 books, 1,312 outline entries, 0 rows dropped |
| Scripture | done — KJV vendored, 31,102 verses, lazy-loaded per book |
| Topics | done — 40 topics, 344 scripture refs, all machine-verified |
| Data layer | done — types, Dexie, provider seams, DATA_PROFILE gate |
| Export | in progress |
| Browse / journal / search / timeline UI | not started |

## Getting started

```bash
npm install
npm run dev
```

See `CLAUDE.md` for the operating contract: what is generated, what is
hand-edited, and the rules that are not up for renegotiation.

---

## Privacy

**Entries are private by default.** This is not a setting that happens to default
to off; it is a rule the code is built around.

- Sharing is **per entry**, **explicit**, and **revocable**.
- **Reflections and prayers are never shared implicitly along with notes.**
  Including them takes its own affirmative choice, every time.
- v1 makes **no network calls**. Nothing leaves your device unless you export it
  yourself.

Sharing (v2) is designed for but not built. The seams — `StorageProvider` and
`ShareProvider` — exist so it can be added without rewriting callers.

## Your data is yours

Browser storage **is not a backup**. Clearing your browser data, reinstalling, or
a failed disk can take all of it. The app says so out loud if you have not
exported in 30 days.

Export produces one zip containing a plain-text README, a manifest with SHA-256
checksums, the canonical JSON plus its schema, a CSV, one Markdown file per entry
with the KJV text embedded, cross-reference indexes, and a self-contained HTML
book that prints cleanly to PDF. Import reads it back losslessly.

---

## Provenance

### Outline data — purchased, not redistributable

The book outlines derive from **purchased** third-party material: *Blueprint
Outlines*, Old and New Testament. They are the author's intellectual property,
not this project's, and nothing here grants a licence to redistribute them.

The parsed JSON is a derivative work. The per-book introductions are the author's
prose, reproduced essentially verbatim.

**This repository is private and must stay private.** A public build must not
contain the outline titles or the intro prose — and note that **GitHub Pages
serves publicly even from a private repository.**

The `DATA_PROFILE` build switch exists for exactly this:

| Profile | Ships | Use |
| --- | --- | --- |
| `full` | outlines + intros + KJV | private use (default) |
| `refs-only` | chapter/verse + KJV | publishable |

Bare scripture references are facts and carry no copyright; the titles and prose
are the author's expression. `npm run verify:bundle` greps the built artefact to
prove the exclusion rather than trusting the flag, and CI runs both directions.

See `DATA-LICENSE.md`.

### Scripture — King James Version

Vendored from [aruljohn/Bible-kjv](https://github.com/aruljohn/Bible-kjv) (MIT
packaging), verified at 31,102 verses across 66 books — the canonical KJV count.
Full provenance in `src/data/kjv/SOURCE.md`.

**United States:** the KJV is public domain.

**United Kingdom: it is not.** The KJV rests under perpetual Crown copyright,
exercised through letters patent held by Cambridge University Press as the King's
Printer. This is a real restriction, not a formality — UK reproduction beyond fair
dealing requires permission from the patent holder, and the usual permitted
allowance (about 500 verses, not a whole book, under 25% of the work) is far
below the full text shipped here.

Recorded plainly so a UK-facing deployment is a deliberate decision rather than a
later discovery. It does not affect personal or private use.

### Code

MIT. See `LICENSE`. The ingest parser is MIT like the rest — it is the parser,
not the data.

---

## Known data characteristics

Both reports regenerate on every `npm run ingest`.

- **`data/ingest-report.md`** — 68 flagged lines. Alias resolutions
  (`Galations` → Galatians), layout repairs, two impossible verse ranges kept
  verbatim, and one open question awaiting a decision. Nothing is silently
  corrected.
- **`data/coverage-report.md`** — the outlines cover 30,816 of 31,102 verses.
  The remaining 286, across 46 gaps, plus 12 overlapping entry pairs. These are
  the shape of the source, not ingest defects. Uncovered passages are still
  browsable and journalable.

## Roadmap

**v1** — browse by book/outline/topic, read KJV, create and edit entries with a
fast capture path, search, timeline, full export/import, printable legacy view,
offline, light and dark, mobile-first, WCAG 2.1 AA.

**v2** — sharing. A single entry as a read-only link or self-contained HTML file;
small private groups (a congregation, a family, a study group) posting notes on
the same sermon; "this sermon" as a joinable object gathering many people's notes
on one date, speaker and passage. The privacy rule above holds throughout.
