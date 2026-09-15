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
| `scripts/probe-baseline.json` | frozen size of the data gate — see below |

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

### 2. Topics never depend on outlines, and are visible from both ends

`topics.json` maps to scripture refs, never to outline entry ids. Under the
`refs-only` data profile the outline layer is absent entirely, and a topic
pointing at outline ids would resolve to nothing.

The outline layer is an *enhancement* over topics, never a dependency. Same rule
for journal entries: a passage anchor always carries a resolved scripture ref and
may additionally carry an outline entry id. A journal written under `full` must
stay fully readable after an export/import into `refs-only`.

`src/lib/topic-index.ts` builds the reverse index — passage to topics — at load,
from `topics.json` and versification alone. Under `refs-only` it is the entire
discovery layer, so it must never acquire an outline dependency. Search
(`src/lib/search.ts`) covers typed references, topics and their aliases, book
names and their aliases, the journal, and outline titles where they exist; its
empty state names every source it searched and any the build cannot.

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

WCAG 2.1 AA, enforced in CI against the built site — lint rules and code review
are not an accessibility pass.

```bash
npm run test:a11y      # axe + keyboard + contrast
npm run screenshots    # every view, both themes, 390px and 1280px
npm run test:e2e       # all of the above
```

| Suite | What it holds |
| --- | --- |
| `a11y.spec.ts` | axe-core at WCAG 2.1 AA over 12 views × 2 themes × 2 widths; exactly one h1 per view with no skipped levels; every control labelled by a real `<label>`, never by a placeholder |
| `keyboard.spec.ts` | the first-visit dialog traps focus and returns it; Escape dismisses; the skip link works; an entry can be written and saved with no mouse at all; no focus trap in any view |
| `contrast.spec.ts` | computed contrast on the rendered page, both themes, including placeholder and disabled text |
| `reflow.spec.ts` | the AA criteria axe cannot check — 1.4.10 reflow at 320 CSS px, 1.4.4 text at 200%, 1.4.12 reader-imposed text spacing, and the combinations |
| `screenshots.spec.ts` | evidence, not assertions — output lands in `screenshots/` |

### A regression test is not done until it has been seen to FAIL

**Rule for this repository, binding on anyone working in it, human or agent.**

When you fix a bug and write a test for it:

1. Write the test. Confirm it passes against the fix.
2. **Revert the fix.** Not the test — the fix.
3. **Run the test and watch it fail.** If it passes, the test does not test the
   bug, and you have learned that before shipping instead of after.
4. Restore the fix. Confirm it passes again.

State in the commit message that you did this. "Verified by reintroducing the
bug, which fails N cases" is the sentence to aim for.

This is not a preference. It caught a live example: a regression test for a focus
bug drove the component, parked focus on a detached node, and asserted the
restore — and **passed against the broken code**, because jsdom resets
`activeElement` to `<body>` before the effect runs. The race it claimed to
reproduce never happened. It read exactly like coverage and was none.

Where a race cannot be staged from outside, extract the decision as a pure
predicate and test that directly. `src/lib/focus-restore.ts` exists for this
reason: as a predicate, the five focus states are exact, and reintroducing the
original bug fails three of them.

### Reproduce under the conditions the failure occurred in

**Rule for this repository, binding on anyone working in it, human or agent.**

When something fails intermittently, reproduce it the way it failed. Not the way
that is quick to run.

A single test file runs on one worker with no contention. The full suite runs
parallel workers competing for timers, and that is precisely what a focus race,
a debounce, or anything touching `requestAnimationFrame` is sensitive to. A
clean single-file run says nothing about a failure seen in a full-suite run.

This cost three separate detours in one session, each with the same shape — the
convenient check came back clean, and the real one did not:

| Failure seen in | First verified with | Result |
| --- | --- | --- |
| a full-suite run | 60 single-file runs | clean, and wrong |
| the e2e suite | a hand-written probe | clean, and wrong |
| CI | local typecheck and tests | clean, and wrong — the path was machine-specific |

State the conditions with the number: **"unreproduced at 150 full-suite runs"**,
not "fixed". The two claims are different, and only one of them is measurable.

Do the arithmetic before believing a clean sweep, and **do it with the rate
observed for THAT bug**. The chance a bug survives `n` clean runs is `(1-p)^n`,
and `p` is not a property of the repository — it is a property of the bug.

Two real examples from this repo, with their own measured rates:

| | DataView focus race | EntryEditor focus race |
| --- | --- | --- |
| Observed | 2 failures in 45 runs — **4.4%** | 1 failure in 115 runs — **0.87%** |
| Survives 8 clean | 69.5% | 93.3% |
| Survives 45 clean | 12.9% | 67.6% |
| Survives 115 clean | 0.54% | 36.7% |
| Survives 150 clean | 0.11% | **27.0%** |
| Runs for 0.1% confidence | ~150 | **~780** |

Applying one bug's rate to another is its own instrument failure — a number that
was true somewhere else, reused where it is not. It happened here: 150 runs was
set as the bar for both, which would have been near-certainty for one and a
coin-flip for the other.

Two consequences:

- Report intermittent failures as **"unreproduced at N runs"** with N stated,
  never as "fixed", until the arithmetic for that bug's own rate justifies it.
- **Below roughly 1%, do not try to run your way out.** ~780 runs is not a
  verification strategy. Force the race instead: inject the timing seam, pin
  the interleaving, and assert both orderings. See
  `src/views/EntryEditor.focus-race.test.tsx`, which holds
  `requestAnimationFrame` and drives the exact ordering that failed once in 115
  runs. A test that drives a race beats any number of runs hoping to catch it.

### Do not mutate the repo while a verification loop is running

A loop measuring a moving target measures the movement.

A 45-iteration suite run was left going while `src/data/intros.json` was edited
underneath it. It duly reported a failing provenance test, which then had to be
investigated and disproved. The finding was real; it was a finding about the
edit, not about the code.

Start the loop, leave the tree alone, read the result. If something must be
edited meanwhile, edit a file no test reads — and check that claim rather than
assuming it.

#### Why these rules exist

One session produced four distinct instrument failures, each found by the layer
outside the one that should have caught it, never by the layer itself:

| # | The instrument | What it actually did |
| --- | --- | --- |
| 1 | contrast suite | matched zero colours (Tailwind emits `oklch()`, the regex wanted `rgb()`) and reported a clean pass having measured nothing |
| 2 | data gate | an **empty `dist/`** passed all four assertions and printed "This build is publishable" |
| 3 | e2e suite | hardcoded a passage id that exists only under `full`, so it swept a not-found page and called it clean — and never said which profile it had tested |
| 4 | attribution | written, exported, unit-tested, passing, and **called by nothing** — it shipped to production entirely unwired |

| 5 | the flake hunt | 40 iterations run with `--reporter=basic`, which does not exist in vitest 5. Every run failed to start; the loop recorded 40 identical "failures" and would have hidden the real one underneath |
| 6 | the fix for #5's target | the DataView focus race was declared fixed after the detached-node case was handled. A **second** race remained — the effect can run before React detaches the node — and it kept failing about 1 run in 20. The first fix made it rarer, which is worse than not fixing it: eight clean runs then looked like proof |

A seventh was caught before shipping, by the revert-and-confirm rule: the focus
regression test above, which passed against the broken code.

The common shape is not carelessness. Every one of those checks was written
attentively and every one passed. What they had in common is that **nobody asked
the instrument to prove it could fail.** That is the only question that reliably
separates a check from a decoration.

So: floors on what was examined, sentinels that must be found, wiring tests as
well as behaviour tests, and this rule.

### Test the wiring, not just the unit

A function tested in isolation proves the function works. It proves nothing
about whether anything calls it.

`src/lib/attribution.ts` was written, exported, unit-tested and passing — and
called by nothing. It shipped to production entirely unwired, and the live site
carried no attribution at all. `attribution.test.ts` was correct throughout; it
was simply answering a different question from the one that mattered.

So where a module must be *reached* to do its job, assert that it is:
`src/lib/attribution-wiring.test.ts` checks that something imports it, that a
view renders it, and that the export includes it. Verified by unwiring the view,
which fails it.

### Verify against the deployed artefact, not the local build

For anything the owner will see, check what is actually served.

Fetch the deployed HTML, follow it to every lazy chunk, and run the real
verifier over those bytes — not over `dist/`. The unwired attribution above
passed every local check and was caught only by reading the live bundle.

`dist/` also holds whichever profile was built last, which is not necessarily
the one being reasoned about. State which profile an artefact carries rather
than assuming; the e2e suite prints it for the same reason.

`npm run verify:deployed` does this for the data gate: it crawls the live
Pages site and runs `verify:bundle` over the mirror. Follow `./chunk-HASH.js`
references as well as `assets/...` ones — Vite splits per book, and a crawl
that only follows the latter finds 16 of 86 files. `BUNDLE_WAS_READ` is what
caught that; without the floor it would have reported a clean pass over a
near-empty read.

### Floors: no check may pass while examining nothing

Nearly every check here is shaped as *collect problems, assert the list is
empty*. Every one of them passes trivially when the collection step yields
nothing — and this repo has already shipped that bug twice:

- A contrast regex matched zero colours (Tailwind emits `oklch()`, the regex
  wanted `rgb()`), so the suite reported a clean pass having measured nothing.
- **An empty `dist/` passed all four gate assertions and printed "This build is
  publishable."** The most important gate in the repo could not distinguish an
  empty directory from a clean build.

So a check is not finished until it also asserts *what it looked at*. Use
`examinedAtLeast()` from `src/testing/floor.ts` (or `tests/e2e/floor.ts`), and
`assertRendered()` before measuring a page — an error page satisfies every
structural check while containing nothing.

`verify-bundle.mjs` additionally looks for three sentinels that ship under every
data profile. A count can be satisfied by the wrong files; a known-present
string proves the search reached the content it claims to search.

The same trap applies to shell commands: **do not pipe a build to `/dev/null`.**
A silently failing build leaves a stale `dist/`, and every conclusion drawn from
it is worthless.

Two more things that cost real time to learn, so they are written down:

- **Colours must be parsed by the browser, not by regex.** Tailwind v4 emits
  `oklch()`, and `getComputedStyle` returns it verbatim. A regex for `rgb()`
  returns null for every themed colour, the background walker falls through to
  white, and every dark button reads as white-on-white. `contrast.spec.ts`
  rasterises one canvas pixel instead.
- **A check that measures nothing passes.** The contrast suite asserts it
  actually sampled disabled controls before trusting the result.

What automation cannot settle is listed at the end of this file.

---

## Not without asking

These need the owner's decision. Stop and ask; a clean stop is better than a
guess carried forward.

- **Publishing, deploying, or changing `DATA_PROFILE`.** Including flipping which
  profile `pages.yml` builds.
- **Relaxing, narrowing, or adding an exclusion to the data gate.** Every
  exclusion must trace to a source the project owns — a BSB section or a
  `topics.json` range — and name it. `EXCLUSIONS_TRACEABLE` enforces that an
  exclusion can identify its source; it cannot judge whether a *new kind* of
  exclusion is legitimate. That judgement is the owner's.
- **Adjudicating ambiguous source data.** A reference that does not parse, a
  title that looks wrong, an intro whose provenance is unclear. Record both
  readings and stop.
- **Reversing a decision the owner made.** Say so plainly, give the reasoning,
  and wait — before acting, not after.
- **Anything that cannot be explained.** An unexplained result is a reason to
  stop, not a reason to try again.

### Never

- **Let purchased-outline content reach a public artefact.** This is the one
  irreversible mistake available in this repository. Everything else can be
  corrected.
- **Silence or skip a failing test.** Quarantine it by name, with its measured
  rate, the hypothesis, and the date — or fix it. A skipped test is a check that
  examines nothing, which is the failure this whole file is about.
- **Bypass the pre-push hook.** An agent pushes with the owner's token and
  inherits the owner's admin bypass; branch protection does not constrain it.
  The hook is the only thing that does. `--no-verify` is not available to you.

## Reporting

- Lead with what needs a decision. Not with status.
- **"Fixed" and "unreproduced at N runs" are different claims.** Never use the
  first for the second, and always give N.
- Report corrections downward as readily as upward. An alarm that turned out to
  be overblown must be said so — that is what makes the other reports usable.
- Say what was *not* verified. Silence from a test suite is not a clean bill.
- Read raw output, not summaries, when it matters. Summaries are where failures
  hide: a 40-iteration loop once reported forty identical "failures" that were
  all the same startup error, and the real flake would have been invisible
  underneath.

## The data licensing constraint

`src/data/outlines.json` derives from **purchased** third-party material. The
repository is private and must stay private.

**GitHub Pages serves publicly even from a private repository.** Publishing a
`full` build would republish the purchased titles and the author's intro prose.

**What is protected is the selection and arrangement, not just the prose.**
Deciding that Matthew 5 divides at 1-12 / 13-20 / 21-48 is the author's editorial
work. Stripping the titles but keeping the divisions would publish the skeleton
of the compilation and keep the whole risk.

`DATA_PROFILE` selects whose arrangement is published:

| Profile | Divisions | Use |
| --- | --- | --- |
| `full` | purchased [licensed content removed] | local only, by the purchaser. The default. |
| `public` | **BSB section headings** — public domain since 2023-04-30 — plus intros written here | publishable, owned outright |
| `refs-only` | none; whole chapters from KJV versification | the fallback |

Each profile reads only the file it ships: under `public` and `refs-only` the
purchased `outlines.json` is never opened. Verse ranges from `topics.json` ship
under all three — we authored those.

**The sections layer is deliberately separate from the outlines layer**, in file
names, scripts and profile. `src/data/sections.json` is generated by
`npm run ingest:sections` from `data/source/bsb_usfm/`; see
`src/data/sections/SOURCE.md`. `npm run compare:coverage` puts the two schemes
side by side.

Attribution for the BSB and KJV is not legally required and is given anyway —
`src/lib/attribution.ts`, shown on the site and written into every export.

`scripts/verify-bundle.mjs` proves it against the built artefact with five named
assertions. **The flag is not evidence; the assertions are.**

| Assertion | What it means |
| --- | --- |
| `PROBE_SET_INTACT` | the gate is at least as strong as its frozen baseline |
| `NO_SOURCE_FILES` | no PDFs, reports or `outlines.json` in `dist/` |
| `NO_SOURCE_MAPS` | no `.map` files — they can carry a whole module post-tree-shake |
| `NO_OUTLINE_PROSE` | every title and intro passage absent, the complete set |
| `NO_OUTLINE_DIVISIONS` | every verse-span division absent, minus ranges we authored |

### Three ways the gate could be lost, and what stops each

**1. The data shrinks.** Probes are derived from `outlines.json` at verify time,
so if the ingest ever dropped entries the probe set would shrink with it and the
gate would weaken while still reporting PASS.

`scripts/probe-baseline.json` freezes the expected size. `PROBE_SET_INTACT` fails
on any decrease. Accepting a smaller set takes an explicit flag:

```bash
node scripts/verify-bundle.mjs --accept-smaller-probe-set
```

which rewrites the baseline and prints exactly what shrank. **Never pass that
flag in CI** — a policy test asserts neither workflow does. Understand why the
data shrank first.

**2. The workflow is edited.** The realistic path to an accidental publication is
not a bug in the verifier; it is one line in `.github/workflows/pages.yml`.
`scripts/__tests__/workflow-policy.test.mjs` parses both workflows and asserts
the profile is pinned to `refs-only`, that no step sets it to `full`, that no
build step omits it (which would default to `full`), that verification happens
*before* the artefact upload, that `deploy` needs `build`, and that the deploy
job builds nothing of its own.

**3. Someone pushes past it.** `data-gate` is a standalone CI job, required by
branch protection on `main`. It depends on no other job on purpose: chained
behind lint or tests, an unrelated failure would leave the required check
*pending* rather than failing, and a check that can sit pending is not a gate.

> ### Residual risk — read this before you push
>
> Branch protection runs with **`enforce_admins: false`**. The repository owner
> can push directly past the required check.
>
> **This includes you.** Coding agents push with the owner's token, so an agent
> inherits the owner's bypass in full. **Branch protection does not constrain
> agents at all.** If you are an agent reading this: you are not being caught by
> branch protection, and you should not assume something upstream will stop a
> mistake.
>
> Two things do constrain you, and they are the ones to respect:
>
> 1. **`.githooks/pre-push`** — runs the workflow-policy tests and the bundle
>    gate locally, before a bad commit reaches history. It does not care who or
>    what is pushing. `git push --no-verify` skips it silently; git does not run
>    the hook at all in that case, so nothing can warn you. **Do not use
>    `--no-verify` on this repository.** `SKIP_DATA_GATE=1` also skips it, but
>    at least says so loudly.
> 2. **`.github/workflows/pages.yml`** — gates what the public can actually
>    see. Verification runs before the artefact upload and `deploy` needs
>    `build`, so a bad commit landing on `main` still cannot reach the public
>    site.
>
> That division is deliberate. Branch protection guards `main`'s *history*;
> `pages.yml` guards the *published artefact*. For the licensing risk, the
> second is the one that matters — admin enforcement would stop a bad commit
> existing, whereas the deploy gate stops it being served.
>
> Run the gate yourself at any time with `npm run gate`.

`scripts/vite-plugin-guard-public.mjs` additionally throws at `buildStart` if
anything forbidden sits in `public/`, which Vite copies into `dist/` verbatim
without passing it through the module graph.

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


---

## What the automated accessibility pass cannot tell you

The suites above hold a real line, and they are not the whole of accessibility.
Recorded so their silence is not mistaken for a clean bill of health.

**axe-core catches roughly a third to a half of WCAG issues**, and only the
machine-decidable part. It cannot judge:

- **Whether the words make sense.** Every link can have an accessible name and
  still be a page full of "read more". Only a person can say whether the name
  describes the destination.
- **Whether a screen reader's rendering is coherent.** Reading order, how the
  KJV verse numbers are announced mid-sentence, whether "Notes" and
  "Reflection" are distinguishable by ear, whether the export progress
  announcement interrupts at a sensible moment. This needs VoiceOver, NVDA or
  JAWS and a human listening.
- **Whether focus lands somewhere sensible.** The tests assert focus moves and
  is visible. They cannot tell you it landed where a person would expect.
- **Cognitive load.** Whether the fast-capture path is genuinely fast for
  somebody writing in a pew, on a phone, one-handed, during a sermon.
- ~~Zoom and reflow~~ — now covered by `reflow.spec.ts` (1.4.10, 1.4.4, 1.4.12).
- **Voice control and switch access.** Untested entirely.
- **Real assistive technology on real devices.** Chromium headless is not a
  screen reader, and Playwright's accessibility tree is not what a user hears.

A human with a screen reader is still required before this is put in front of
anyone who depends on one.
