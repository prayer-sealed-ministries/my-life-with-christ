# Operating contract

My Life With Christ — a Bible reading and sermon/reflection journal.
Local-first, no backend.

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
npm run build          # public profile, which is what the Pages workflow deploys
npm run build:refs-only
npm run verify:bundle -- --profile public
npm run verify:no-private-data   # nothing licensed or private is tracked
npm run gate           # the guard, workflow policy, and a refs-only bundle check
```

```bash
npm run test:e2e       # Playwright, against the built site
npm run test:a11y      # axe + keyboard + contrast + reflow
```

## Regenerating data

```bash
npm run ingest:sections  # BSB USFM -> src/data/sections.json
npm run fetch:kjv        # re-vendor the KJV (rarely needed; output is committed)
```

---

## What is generated and what is hand-edited

**Generated — never edit by hand. They are overwritten on every ingest.**

| Path | What it is |
| --- | --- |
| `src/data/sections.json` | 66 books of BSB section headings |
| `src/data/kjv/*.json` | KJV text, one file per book |
| `src/data/kjv/versification.json` | verse counts per chapter |
| `data/sections-ingest-report.md` | every heading the parser could not read strictly |
| `src/lib/canon.ts` | book names/order, generated from `scripts/lib/books.mjs` |

**Hand-edited — the ingest reads these and never writes them.**

| Path | What it is |
| --- | --- |
| `src/data/topics.json` | 40 life topics, mapped to scripture refs |
| `src/data/kjv/SOURCE.md` | KJV provenance and the UK Crown-patent note |
| `src/data/intros.json` | book introductions, written for this project |

The BSB's USFM files live in `data/source/bsb_usfm/`. The sections ingest reads
them and never writes them. Nothing else belongs under `data/source/`.

---

## Rules that are not up for renegotiation

### 1. Never silently correct the source

Source documents carry typesetting artifacts. The parser does not guess.
Anything it cannot read strictly, or reads only by applying an alias or a layout
repair, is recorded in `data/sections-ingest-report.md` for a human to
adjudicate.

Every entry keeps its source wording verbatim. Readable wording goes in the
derived `displayTitle`.
The original spelling always stays on the record.

An adjudication marked `resolved: false` is an open question. It is NOT applied —
the entry keeps the source reading and the report raises it every run.

### 2. Topics never depend on outlines, and are visible from both ends

`topics.json` maps to scripture refs, never to outline entry ids. Under the
`refs-only` data profile the outline layer is absent entirely, and a topic
pointing at outline ids would resolve to nothing.

The outline layer is an *enhancement* over topics, never a dependency. Same rule
for journal entries: a passage anchor always carries a resolved scripture ref and
may additionally carry an outline entry id — a format-compatibility field, kept
so archives written by older versions still read. A journal written under
`public` must stay fully readable after an export/import into `refs-only`.

`src/lib/topic-index.ts` builds the reverse index — passage to topics — at load,
from `topics.json` and versification alone. Under `refs-only` it is the entire
discovery layer, so it must never acquire an outline dependency. Search
(`src/lib/search.ts`) covers typed references, topics and their aliases, book
names and their aliases, the journal, and outline titles where they exist; its
empty state names every source it searched and any the build cannot.

### 3. Every passage is reachable and journalable

The outlines cover 30,876 of 31,102 verses. The remaining 226, across 42 gaps,
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
| 3 | e2e suite | hardcoded a passage id that exists under only one profile, so it swept a not-found page and called it clean — and never said which profile it had tested |
| 4 | attribution | written, exported, unit-tested, passing, and **called by nothing** — it shipped to production entirely unwired |

| 5 | the flake hunt | 40 iterations run with `--reporter=basic`, which does not exist in vitest 5. Every run failed to start; the loop recorded 40 identical "failures" and would have hidden the real one underneath |
| 6 | the fix for #5's target | the DataView focus race was declared fixed after the detached-node case was handled. A **second** race remained — the effect can run before React detaches the node — and it kept failing about 1 run in 20. The first fix made it rarer, which is worse than not fixing it: eight clean runs then looked like proof |
| 7 | the e2e suite, again | Playwright's `reuseExistingServer` was true off CI, so it probed port 4173, found a preview server left running from an earlier session, and adopted it. A whole suite ran against hours-old bytes and reported **124 passed**. When the new feature's specs later failed against that same stale server, the symptom — plain text search working, every Scripture query returning nothing — was indistinguishable from a real defect in the code under development |
| 8 | a hardware smoke probe | it read the matched-field label with `body.innerText.match(/Notes\|Reflection\|Title/)` over the **whole page**, and the search view renders an entry-kind filter chip reading "Reflection" above the results. The probe reported "Reflection" for an entry whose reflection was the empty string. The product was correct; the measurement was reading the furniture |

Another was caught before shipping, by the revert-and-confirm rule: the focus
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

### The server under test must prove which build it is serving

A 200 on a health probe means something is listening. It does not say what.

The e2e suite once ran a full pass against a `vite preview` server left over
from an earlier session, because `reuseExistingServer` was true off CI and
"something answered on 4173" was the entire readiness condition. The build had
run first — that is not evidence either, since a build writes `dist/` and says
nothing about what an already-running process has open.

So every build stamps `dist/build-id.json` with a content digest over the files
it emitted, and `tests/e2e/global-setup.ts` refuses to run a single spec until
the server hands back the same digest and the same profile. Playwright also
owns the server's lifecycle everywhere now: a process already on the port is a
hard error, never an adoption.

Two things this deliberately does not do. It does not `pkill` — a harness that
kills by pattern match will one day kill a developer's own work in another
checkout, and it did not solve the problem anyway. And it does not stamp a
commit SHA: a dirty tree, a half-finished rebuild and a stale `dist/` all carry
the same SHA, while a digest over the built bytes answers the actual question.

`scripts/__tests__/build-identity.test.mjs` proves both directions against real
HTTP servers — a correct build passes, a different build is rejected — and
asserts the guard is still wired into both configs, because every one of those
tests would pass with the plugin unregistered.

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

- **Let licensed third-party data into this repository, or into an artefact
  built from it.** This is the one irreversible mistake available here.
  Everything else can be corrected. See `DATA-LICENSE.md`.
- **Silence or skip a failing test.** Quarantine it by name, with its measured
  rate, the hypothesis, and the date — or fix it. A skipped test is a check that
  examines nothing, which is the failure this whole file is about.
- **Bypass the pre-push hook.** An agent pushes with the owner's token and
  inherits the owner's admin bypass, so the required status checks on `main` do
  not stop it adding a commit. (Force-pushing and deleting the branch ARE
  blocked, admins included — see the residual-risk note below for what was
  measured.) For the one mistake that matters here, the hook is what stands in
  the way. `--no-verify` is not available to you.

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

Everything here is public domain or written for this project. **No licensed
third-party data is in this repository or its history**, and no build profile
can produce something containing any. See `DATA-LICENSE.md`.

A licensed third-party outline compilation was used during earlier development.
It is gone: the source documents, everything generated from them, the profile
that read them, and the history that carried them. Do not bring it back — not
as data, not as a test fixture, and not as a quoted example in a comment. The
audit that removed it found licensed titles in three test files, which is where
this kind of thing actually hides.

**Note that GitHub Pages serves whatever is built, publicly.** Whatever ships
must be material this project owns or that is public domain.

`DATA_PROFILE` selects which division scheme is built:

| Profile | Divisions | Use |
| --- | --- | --- |
| `public` | **BSB section headings** — public domain since 2023-04-30 — plus intros written here | **what `pages.yml` deploys**, and the default |
| `refs-only` | none; whole chapters from KJV versification | the fallback |

`refs-only` ships no division data at all rather than a copy with the titles
stripped. In a compilation the selection and arrangement is the substance —
deciding where a chapter divides is editorial judgement, not a fact — so
"the same divisions without the titles" redacts nothing.

`src/data/sections.json` is generated by `npm run ingest:sections` from
`data/source/bsb_usfm/`; see `src/data/sections/SOURCE.md`. Verse ranges from
`topics.json` ship under both profiles — we authored those.

### Two Scripture sources, never merged

The **verse text is the King James Version**, in every build, loaded from
`src/data/kjv/`. The **BSB supplies section headings and the spans they divide
the text into**, and no verse text at all. Do not let documentation, UI copy or
an export blur the two: a reader of the archive in 2060 should be able to tell
which words are whose.

The KJV is public domain in the **United States** and is **not** in the
**United Kingdom**, where perpetual Crown letters patent apply — a real
constraint on a UK-facing public deployment. `src/data/kjv/SOURCE.md` holds the
detail; do not restate it from memory.

*Attribution* is not required by either source and is given anyway —
`src/lib/attribution.ts`, shown on the site and written into every export.
Attribution and permission are different questions, and crediting a text does
not answer the second.

### Two checks, and what each one asks

`npm run verify:no-private-data` asks it of **the repository**: that no
licensed or private material is tracked, by path, by private location, or by a
short set of distinctive strings. It has floors, so a run that scanned nothing
fails as loudly as one that found something. It runs in the pre-push hook, as
the first step of CI's `data-gate`, and as the first step of `npm run gate`.

`npm run verify:bundle` asks it of **a built artefact**, with four named
assertions. The flag is not evidence; the assertions are.

| Assertion | What it means |
| --- | --- |
| `BUNDLE_WAS_READ` | files were actually opened and three known-present sentinels found |
| `NO_SOURCE_FILES` | no source documents or generated reports in `dist/` |
| `NO_SOURCE_MAPS` | no `.map` files — they can carry a whole module post-tree-shake |
| `NO_LICENSED_CONTENT` | none of the licensed sentinels appear |

Both read `scripts/lib/licensed-sentinels.mjs`, so the two cannot drift into
disagreeing about what they are looking for. The list is kept short on purpose:
a guard that embedded a substantial excerpt in order to detect it would be
republishing it to detect it.

**A lazily-loaded chunk is shipped data.** The Scripture section headings are no
longer in the startup chunk — `src/app/sections.ts` fetches them on demand, from
the bundle, so that Fast Capture does not wait for three quarters of a megabyte
it never reads. Nothing about the licensing changed with the loading: the chunk
is published the moment the build is, and `verify:bundle` walks the whole of
`dist/` rather than following the entry's imports, so it reads that chunk with
exactly the same eyes. Proven by putting a forbidden sentinel into
`src/data/sections.json` and watching the gate fail, naming the lazy chunk.

`npm run verify:startup` asks the other question about the same bytes: that the
divisions are still reached only by `import()`, still in exactly one chunk, and
that the chunk a build carries belongs to the profile that built it — a
refs-only build with the public arrangement in it fails `PROFILE_ISOLATED`. It
runs in `npm run gate` and in CI beside each bundle gate.

### Two ways the line could be lost, and what stops each

**1. Someone re-adds the data.** `.gitignore` names the locations it would land
in, so a wide `git add` cannot stage it, and `verify:no-private-data` fails
closed if it is tracked anyway. Both were proven by staging representative
violations and watching them fail.

**2. The workflow is edited.** The realistic path to an accidental publication
is one line in `.github/workflows/pages.yml`.
`scripts/__tests__/workflow-policy.test.mjs` parses both workflows and asserts
the deployed profile is pinned to the exact value it expects — `public` — that
no build step omits it, that verification happens *before* the artefact upload,
that `deploy` needs `build`, and that the deploy job builds nothing of its own.

**3. Someone pushes past it.** `data-gate` is a standalone CI job, and it is
required by branch protection on `main`. It depends on no other job on purpose:
chained behind lint or tests, an unrelated failure would leave the required
check *pending* rather than failing, and a check that can sit pending is not a
gate.

Branch protection was configured on this repository on 2026-09-19. The exact
required checks, as GitHub reports them:

| Required status check | Workflow |
| --- | --- |
| `data-gate` | CI |
| `typecheck, lint, test (all profiles)` | CI |
| `e2e (public)` | CI |
| `e2e (refs-only)` | CI |
| `accessibility (public)` | CI |
| `accessibility (refs-only)` | CI |

Two checks are deliberately NOT required. `deploy` is permanently **skipped**
while publication is deferred, and a skipped check never satisfies a
requirement — requiring it would deadlock the branch. `build` belongs to
`pages.yml`, the workflow that changes when the site is published, and the
public-profile verification it performs is already required through `data-gate`,
which builds and gates both profiles.

> ### Residual risk — read this before you push
>
> Branch protection runs with **`enforce_admins: false`**, so the repository
> owner can push to `main` past the required status checks. Coding agents push
> with the owner's token and inherit that bypass in full. If you are an agent
> reading this: **the required checks are not what stops you**, and you should
> not assume something upstream will catch a mistake.
>
> Be precise about what the bypass does and does not cover. Verified on
> 2026-09-19 by applying the identical protection to a scratch branch and
> attempting both operations with the owner's own admin token:
>
> | Operation | Admin with `enforce_admins: false` |
> | --- | --- |
> | Push to `main` without passing checks | **allowed** — this is the bypass |
> | Force-push to `main` | **rejected** — `GH006 … Cannot force-push to this branch` |
> | Delete `main` | **rejected** — `GH006 … Cannot delete this branch` |
>
> So force-pushing and deleting the branch are blocked for everyone, admins
> included; the bypass is narrower than "branch protection does not constrain
> agents", which is what this file used to say. History cannot be rewritten or
> thrown away through the remote. What an admin can still do is add a bad commit
> on top.
>
> That is why these two still matter most:
>
> 1. **`.githooks/pre-push`** — runs the private-data guard, the workflow-policy
>    tests and the bundle gate locally, before a bad commit reaches history. It
>    does not care who or what is pushing. `git push --no-verify` skips it
>    silently; git does not run the hook at all in that case, so nothing can
>    warn you. **Do not use `--no-verify` on this repository.**
>    `SKIP_DATA_GATE=1` also skips it, but at least says so loudly.
> 2. **`.github/workflows/pages.yml`** — gates what the public can actually
>    see. Nothing in its build job is conditional, verification runs before the
>    artefact upload, and `deploy` both needs `build` and runs only on a manual
>    `workflow_dispatch`, so a bad commit landing on `main` cannot reach a
>    published site — least of all while publication is deferred entirely.
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
data/source/bsb_usfm/  BSB USFM files, public domain (read-only inputs)
data/*.md              generated reports
scripts/               ingest, KJV fetch, vite plugin, bundle verifier
  lib/                 pure parsers, tested hard
src/
  data/                outlines, topics, overrides, KJV
  lib/                 canon, verse index, passages, bible loader
  storage/             StorageProvider + Dexie
  share/               one entry, as a document to send
  export/              zip, archive, generators, importer, migration
  types/               the domain contract
```

## The platform boundary

`src/platform/` is where the application is allowed to know what it is running
on. Four ports, one storage seam, one capability probe, one pure decision. The
web implementations live in `src/platform/web.ts`; native ones arrive in Phase 1
(see `docs/ADR-NATIVE-APP-ARCHITECTURE.md`).

The rules below are binding, and each exists because breaking it is both easy
and hard to notice.

### Native storage fails closed. It never falls back to Dexie.

`selectStorageProvider` returns the kind it was asked for or it throws. When a
native edition cannot open SQLite, the app must refuse to start.

The tempting alternative — fall back to the webview's IndexedDB so the app still
launches — would have a paid user write months of entries into a store they were
never told about, that cannot be handed to them, that does not appear in their
archive, and that the next successful launch would stop reading. They would lose
the record while every screen reported success.

An app that will not start is a bug report. An app that quietly writes to the
wrong place is a lost inheritance. Do not add the fallback.

### Native journal persistence is SQLite, and only SQLite.

Web is Dexie/IndexedDB. Native is SQLite, through
`@capacitor-community/sqlite`. There is no third option and no fallback between
them: `requiredStorageKind()` answers by edition, and `selectStorageProvider`
returns that kind or throws.

A native build whose SQLite will not **open** fails closed too, not just one
that cannot obtain a provider. On the web a blocked IndexedDB leaves a useful
app and gets a banner; on native the store is the product, and carrying on would
mean an app that looks ready, accepts an entry, and loses it.

**An acknowledged write has already committed.** Nothing may be queued in
JavaScript memory to be flushed by `pause`, `appStateChange`, `pagehide` or
`beforeunload` — the last two were measured and never fire at all on either
platform. If a caller was told a save succeeded, the transaction is on disk.

**Migrations are explicit, ordered and monotonic.** The schema version is
written inside the same transaction as the step that earns it, so a failed
migration leaves the old version authoritative rather than claiming an upgrade
that did not happen. A database numbered beyond what this build understands is
refused, never opened. Do not add a schema without adding its step.

**The SQLite file is not the user's backup.** It is this application's working
copy. The canonical archive is what the user owns and what the inheritance
promise is about; keep the two ideas apart in code and in wording.

### One description of persistence, shared by both providers.

`src/storage/semantics.ts` holds the defaulting, the derived anchor keys, the
query predicate, the ordering and the tie-break. Dexie and SQLite differ only in
how rows reach a disk. A provider is not allowed its own opinion about what an
answer means — two correct-looking implementations that disagreed about a
tie-break would put two sermons from one Sunday in a different order on a phone
than on a laptop, and no shared test would catch it unless someone had thought
to write that exact case.

The contract lives in `src/storage/contract.ts` as framework-neutral cases for
the same reason: Vitest runs it against Dexie, and the on-device harness runs
the identical array against real SQLite inside the app. Node's SQLite is a
useful check on the SQL and is **not** evidence about the native provider — the
plugin, the sandbox and the file location are exactly the parts that break, and
two of the three bugs found in Phase 2 were visible only on a device.

### Journal data never lives in convenience storage.

`localStorage` holds the theme choice and the first-visit flag. Both are
**disposable UI preferences**: losing them costs a reader one tap and nothing
else, which is why they are allowed to sit in storage that can vanish.

Nothing journal-critical may join them. Entries, settings that drive the export
reminder, and anything that would be missed if it disappeared go through
`StorageProvider`. The test is not "is this convenient" but "if this were gone
tomorrow, has the reader lost something they wrote?"

### Platform identity is confined to `src/platform/`.

Application views and domain code must not branch on `isNative`, `isIOS`,
`isAndroid`, `Capacitor.getPlatform()`, or equivalent platform checks. Platform
differences belong behind capability ports or in narrowly scoped platform
bootstrap/integration code.

The platform layer itself may inspect runtime identity only where the platform
genuinely changes the required capability — currently storage selection and
Android Back integration.

Prefer capability injection over platform branching. Do not export a generic
`isNative()` helper for convenient use throughout the application.

`src/platform/ports.ts` offers nothing to branch on: a view asks for a
capability and receives one; it never asks where it is. The moment a view
branches, journal behaviour has begun to fork three ways, which is the entire
thing this boundary prevents.

`scripts/__tests__/native-policy.test.mjs` holds the line: Capacitor may only be
imported inside `src/platform/`, no file outside it may sniff the user agent or
call `getPlatform()`, and `runtime.ts` has exactly one consumer outside the
platform layer — the storage wiring. Verified by adding each violation in turn,
which fails it.

`src/platform/platform.test.tsx` asserts the wiring from the product surface —
pressing the real button in the real view must reach the port. Verified by making
each view bypass its port, which fails.

### Canonical archive generation is shared, always.

`buildArchive()` produces identical bytes on every edition. Only *delivery* —
handing those bytes to a file system — crosses the platform boundary. A native
edition must never invent its own backup format; the archive already is one, and
it is the artefact the whole product promises.

### One conformance suite, every provider.

`src/storage/conformance.ts` holds the persistence contract: ordering, defaulting,
what `updateEntry` refuses to change, that `putEntries` writes verbatim while
`createEntry` defaults, that clearing entries leaves settings alone. Any new
`StorageProvider` runs it unchanged. Verified by four deliberate provider
violations, each of which fails it.

### User-facing errors say "device", not "browser".

Every runtime error string is reachable inside an installed app, where there is
no browser from the reader's point of view. `src/platform/wording.test.ts` holds
this for the messages that matter.

Wording that is genuinely about a browser stays: the archive's own README tells a
stranger to open an HTML file in any web browser, and the export reminder names
"clearing your browser data" because on the web that is the exact action that
destroys a journal. A native edition will need its own wording for that reminder
— uninstalling the app is the equivalent risk — and that is a Phase 4 decision,
not a find-and-replace.

## Names that are deliberately not the brand

The product is **My Life With Christ**; the book it exports is **My Journey With
Christ**, at `book/my-journey-with-christ.html`. Those are user-facing names and
they are expected to move again — a product can be renamed twice more before it
ships.

The identifiers below are NOT user-facing. They are stable machine names, and
they are short, boring and independent of branding precisely so that a rename
never has to touch stored data. **Do not "clean them up" for consistency.**

| Identifier | Where | Why it stays |
| --- | --- | --- |
| `data/journey.json` | the archive's canonical record | A filename inside every exported archive. Renaming it breaks every reader ever written against the format, in exchange for nothing a user sees. |
| `format: 'journey-export'` | the export envelope | The schema identifier. It is how a file declares what it is; it must outlive any brand. |
| `journey-export-<date>.zip` | the downloaded filename | Matches the `format` value above, so a stranger can connect the file to the schema that describes it. |
| `journey` | the IndexedDB database name | Renaming it orphans every existing local journal. There is no migration worth writing for a cosmetic gain. |
| `journey:theme`, `journey:welcomed` | localStorage keys | Same reason, smaller stakes: a rename silently resets people's preferences. |
| `name: "journey"` | `package.json` | Never published; the package is private. |
| "My journey" | the timeline nav label | Refers to the reader's own entries, not to the exported book. It is not a brand surface. |

`scripts/__tests__/branding.test.mjs` enforces the other direction: the retired
wording cannot return, and the current wording must actually be present — a
guard that only forbade the old name would be satisfied by deleting the title
altogether.

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
