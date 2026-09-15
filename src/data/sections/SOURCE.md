# BSB section headings — provenance

## What this is

`src/data/sections.json` — 3,016 section headings from the **Berean Standard
Bible**, with the verse span each one covers. This is the division scheme the
project owns outright, and the one the public build uses.

It exists because the purchased *[licensed content removed]* cannot be published. In a
compilation the protected element is the **selection and arrangement**, not the
labels — so rewording the titles would not have cleared the rights, and
paraphrasing the intros would have produced derivative works. The only durable
answer was to build on a scheme that is free of restriction.

## Where it came from

- **Source:** Berean Standard Bible, USFM edition
- **File:** <https://bereanbible.com/bsb_usfm.zip> (linked from <https://berean.bible/downloads.htm>)
- **Retrieved:** 2026-09-14
- **Archive size:** 1,598,046 bytes, 66 USFM files
- **Extracted by:** `scripts/ingest-sections.mjs`, via `scripts/lib/parse-usfm-sections.mjs`
- **Vendored at:** `data/source/bsb_usfm/`

## Licence

**Public domain.** The Berean Bible texts were dedicated to the public domain on
**30 April 2023**. From <https://berean.bible/terms.htm>:

> The Berean Bible and Majority Bible texts are officially dedicated to the
> public domain as of April 30, 2023. All uses are freely permitted.

There is no restriction on reproduction, adaptation, or commercial use, and no
attribution requirement.

## Attribution

Attribution is **not required**. It is given anyway, by decision, on the site
and in every export. The wording is the publisher's own suggested notice:

> The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with
> Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation
> Committee. This text of God's Word has been dedicated to the public domain.

## How the spans were derived

USFM marks a section with `\s1 <title>` and then continues with `\v` verse
markers. The heading itself carries no reference, so each section runs from the
first verse following it to the verse before the next heading — or to the end of
the book. Spans are therefore derived from position, and a section may cross a
chapter boundary.

**`\s2` subsections are excluded.** There are 80 of them, and each sits inside an
`\s1`. Including both would make every subsection overlap its parent and turn a
clean partition into duplicates. They are counted in
`data/sections-ingest-report.md` rather than silently dropped.

## Verification

- **3,016 sections across 66 books, zero ingest issues** — every heading resolved
  to a real verse span.
- **Complete partition of the canon**: 31,102 of 31,102 verses covered, 0 gaps,
  0 overlaps. Confirmed twice, once through the shared coverage analyser and once
  by an independent walk over consecutive spans.
- Compare against the purchased scheme in `data/coverage-comparison.md`.

## Who wrote the introductions, and what they had read

Provenance for the book introductions is part of the record, not a footnote.
The machine-readable version is `_provenance` in `src/data/intros.json`.

| Books | Drafted by | Exposure |
| --- | --- | --- |
| The 15 listed in `intros.json` `_provenance.drafted` | assistant (Claude Opus 5), 2026-09-14/15 | Had **not** read the purchased introduction for any of them. Asserted by test against the reserved list. |
| The 11 named below | **reserved for the owner** | Purchased introduction read on 2026-09-13. |
| The remaining 40 | not yet written | — |

### The eleven reserved books, by name

| Book | Exposure |
| --- | --- |
| Genesis | full introduction read |
| Matthew | full introduction read |
| Mark | full introduction read |
| Luke | full introduction read |
| John | full introduction read |
| Acts | full introduction read |
| Romans | full introduction read |
| 1 Corinthians | full introduction read |
| Song of Solomon | full introduction read |
| Psalms | full introduction read |
| Isaiah | opening sentence read |

The first eight were printed while surveying book headings and introduction
prose during the PDF ingest — output that was being read deliberately.

**Song of Solomon, Psalms and Isaiah came from a different command**, which is
why the first count missed them: `pdftotext` run in raw mode to compare against
`-layout` mode. Whole introduction paragraphs appeared as a side effect of a
formatting comparison. This was recorded as eight books on 2026-09-14 and
corrected to eleven on 2026-09-15, one batch before Psalms and Song of Solomon
would have been drafted under the wrong assumption.

None of the introductions drafted before the correction is among the eleven,
verified by test rather than by inspection.

They are reserved deliberately. A test asserts no drafted introduction
shares a sentence with the purchased prose, but a sentence-level check cannot
detect borrowed *structure* — which facts are chosen, in what order, where the
emphasis falls. Having read the original, anything drafted for those books would
be paraphrase-by-memory whatever the intent. They are also the books a reader
opens first, and the ones most worth having in the owner's own voice.

A book with no introduction simply renders without one.

## What this does NOT cover

Only the **divisions and their titles** come from the BSB. The scripture text
the app displays is still the KJV (`src/data/kjv/`, see its own `SOURCE.md`),
and the book introductions are written from scratch for this project — not
adapted from the BSB, and not from the purchased outlines.
