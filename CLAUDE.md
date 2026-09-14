# Operating contract

Journey — a Bible outline and sermon/reflection journal. Local-first, no backend.

The long-term purpose is inheritance: a lifetime of entries should export as a
readable book a child or grandchild can hold. Every data decision follows from
that. No lock-in, no data trapped in a service.

---

## Run it

```bash
npm install
npm run dev            # Vite dev server
npm test               # Vitest
npm run typecheck      # tsc -b
npm run lint           # eslint
npm run build          # full data profile
npm run build:refs-only
npm run verify:bundle -- --profile refs-only
```

## Regenerating data

```bash
npm run ingest         # PDFs -> src/data/outlines.json + both reports
npm run fetch:kjv      # re-vendor the KJV (rarely needed; output is committed)
```

`npm run ingest` is idempotent. CI re-runs it and fails if the committed output
changes, so a parser edit that silently alters the data is caught rather than
merged.

---

## What is generated and what is hand-edited

**Generated — never edit by hand. They are overwritten on every ingest.**

| Path | What it is |
| --- | --- |
| `src/data/outlines.json` | 66 books, 1,312 entries parsed from the PDFs |
| `src/data/kjv/*.json` | KJV text, one file per book |
| `src/data/kjv/versification.json` | verse counts per chapter |
| `data/ingest-report.md` | every line the parser could not read strictly |
| `data/coverage-report.md` | passages the outlines do not cover, and overlaps |
| `src/lib/canon.ts` | book names/order, generated from `scripts/lib/books.mjs` |

**Hand-edited — the ingest reads these and never writes them.**

| Path | What it is |
| --- | --- |
| `src/data/topics.json` | 40 life topics, mapped to scripture refs |
| `src/data/title-overrides.json` | readable wording for specific outline entries |
| `src/data/reference-overrides.json` | adjudications of bad or ambiguous references |
| `src/data/kjv/SOURCE.md` | KJV provenance and the UK Crown-patent note |

Source PDFs live in `data/source/`. The ingest reads them and never writes them.

---

## Rules that are not up for renegotiation

### 1. Never silently correct the source

The purchased PDFs carry OCR and typing artifacts. The parser does not guess.
Anything it cannot read strictly, or reads only by applying an alias or a layout
repair, is recorded in `data/ingest-report.md` for a human to adjudicate.

Every entry keeps `title` and `sourceRef` verbatim. Readable wording goes in the
derived `displayTitle`; reference corrections go in `reference-overrides.json`.
The original spelling always stays on the record.

An adjudication marked `resolved: false` is an open question. It is NOT applied —
the entry keeps the source reading and the report raises it every run.

### 2. Topics never depend on outlines

`topics.json` maps to scripture refs, never to outline entry ids. Under the
`refs-only` data profile the outline layer is absent entirely, and a topic
pointing at outline ids would resolve to nothing.

The outline layer is an *enhancement* over topics, never a dependency. Same rule
for journal entries: a passage anchor always carries a resolved scripture ref and
may additionally carry an outline entry id. A journal written under `full` must
stay fully readable after an export/import into `refs-only`.

### 3. Every passage is reachable and journalable

The outlines cover 30,816 of 31,102 verses. The remaining 286, across 46 gaps,
are not defects — they are the shape of the source. Browsing a book shows every
chapter: outline entries render as titled sections, uncovered spans render as
plain chapters with the identical "Add entry" action.

A reader who opens Genesis 35 and finds no way to write a note is a product bug.
`src/lib/passages.ts` guarantees this; tests assert all 31,102 verses land in a
segment.

### 4. Notes and reflection are separate fields

"What was taught" and "what it meant to me" are different things. They are never
merged into one box, never concatenated in an export, and a reflection is never
shared implicitly along with notes.

### 5. Private by default

Entries are private. Sharing is per-entry, explicit, and revocable. Reflections
and prayers require their own affirmative choice, per share — `ShareScope`
defaults them to `false`, and that default does not change.

### 6. No network calls in v1

Not one. No analytics, no CDN fonts, no link-title fetching, no account. The KJV
and the outlines are vendored. `scripts/fetch-kjv.mjs` is a one-shot build tool,
not runtime.

### 7. The export is the product

Browser storage is not a backup, and the app says so out loud after 30 days.
The archive must be readable in 2060 by someone with a text editor and no app:
that is what `notes/*.md`, `README.txt`, `MANIFEST.txt` and `data/schema.json`
are for. Round-trip, downgrade and cold-read tests are non-negotiable.

### 8. Accessibility is checked, not assumed

WCAG 2.1 AA. Keyboard-operable throughout, visible focus, correct heading order,
labelled controls, adequate contrast in both themes. `eslint-plugin-jsx-a11y`
runs as errors, not warnings.

---

## The data licensing constraint

`src/data/outlines.json` derives from **purchased** third-party material. The
repository is private and must stay private.

**GitHub Pages serves publicly even from a private repository.** Publishing a
`full` build would republish the purchased titles and the author's intro prose.

`DATA_PROFILE` is the gate:

- `full` — outlines + intros + KJV. Private use. The default.
- `refs-only` — chapter/verse + KJV. Titles and intros never enter the bundle.

It is a build-time switch implemented by generating the data module
(`scripts/vite-plugin-data-profile.mjs`), so the protected strings cannot survive
a missed branch. `scripts/verify-bundle.mjs` greps the built artefact with probes
drawn from the real dataset and fails the build if any survive. **The flag is not
evidence; the grep is.** CI runs both directions.

See `DATA-LICENSE.md`.

---

## Layout

```
data/source/           purchased PDFs (read-only inputs)
data/*.md              generated reports
scripts/               ingest, KJV fetch, vite plugin, bundle verifier
  lib/                 pure parsers, tested hard
src/
  data/                outlines, topics, overrides, KJV
  lib/                 canon, verse index, passages, bible loader
  storage/             StorageProvider + Dexie, ShareProvider
  export/              zip, archive, generators, importer, migration
  types/               the domain contract
```

## Conventions

Conventional commits, small and focused. Comments explain *why*, not *what*.
Tests exercise real behaviour, not mocks — the ingest parser and the export
round-trip are the two places where silent rot would cost the most.
