# KJV text provenance

## What is here

`src/data/kjv/<book-id>.json` — one file per book, 66 files:

```json
{ "id": "genesis", "name": "Genesis", "chapters": [ ["In the beginning...", "..."], ... ] }
```

Chapters are arrays of verse strings. Verse numbers are **positional** (index 0 is
verse 1), which roughly halves the file size versus storing numbered objects.
Files are loaded one book at a time, on demand — never bundled together.

`src/data/kjv/versification.json` — verse counts per chapter, keyed by book id.
Small enough to load eagerly. It is what the coverage report uses to work out
which passages the outlines leave uncovered.

## Where it came from

- **Source:** <https://github.com/aruljohn/Bible-kjv>
- **Upstream licence:** MIT (covers the repository's packaging of the text)
- **Retrieved:** 2026-09-13, from `master`, last upstream push 2021-01-31
- **Fetched by:** `scripts/fetch-kjv.mjs` (re-runnable; output is committed)

## Verification

The vendored text totals **31,102 verses across 66 books**, which matches the
canonical KJV verse count. Chapter counts were checked against the independent
table in `scripts/lib/books.mjs`, which the ingest uses to validate references.

## Copyright status — read before deploying

**United States:** the KJV is in the public domain. No restriction.

**United Kingdom:** the KJV is **not** public domain. It rests under perpetual
Crown copyright, exercised through letters patent held by Cambridge University
Press as the King's Printer, with Oxford University Press and (in Scotland) the
Scottish Bible Board also holding rights. This is a genuine restriction and not
a formality: reproduction in the UK beyond fair dealing requires permission from
the patent holder.

Practically, for this project:

- Personal and private use is not the concern.
- A **UK-facing public deployment** reproducing the full KJV text is the concern,
  and would need permission from CUP.
- The usual permitted allowance is up to 500 verses, provided they are not a
  complete book and do not amount to 25% of the work quoted. Shipping all 31,102
  verses is far outside that.

This is recorded so the decision is made deliberately rather than discovered
later. See `DATA-LICENSE.md` for how it interacts with the outline data, and
`README.md` for the deployment posture.
