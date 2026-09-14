# Data licensing

The code in this repository is MIT licensed (see `LICENSE`). The *data* is not
all under the same terms. This file records what each dataset is and how it may
travel.

## 1. Blueprint outlines — purchased third-party material

**Files:** `data/source/*.pdf` (the originals), `src/data/outlines.json`
(the parsed form: 66 books, 1,310 outline entries, and the per-book intro prose).

These were **purchased**. They are the intellectual property of their author,
not of this project, and nothing here grants a licence to redistribute them.
The parsed JSON is a derivative work of the purchased PDFs — reformatting the
content does not change its copyright status. The per-book `intro` text is
especially exposed: it is the author's prose, reproduced essentially verbatim.

**Therefore:**

- This repository is **private**, and the outline data may stay in it on that basis.
- Do **not** make this repository public.
- Do **not** publish a build that contains `outlines.json` to any public URL —
  **including GitHub Pages**, which serves publicly even from a private repository.
- Do not redistribute `outlines.json` or the source PDFs as standalone files.

If the outline content is to be published, the options are, in order of
preference:

1. Obtain written permission from the rights holder to redistribute.
2. Ship only the *references* (book, chapter, verse range). Bare scripture
   citations are facts and are not copyrightable; the **titles and intro prose
   are the author's expression** and are the part at risk.
3. Replace the outline set with an openly licensed or original one.

`scripts/ingest-outlines.mjs` is MIT-licensed like the rest of the code. It is
the *parser*, not the data, and may be shared freely.

### How the exclusion is enforced

`DATA_PROFILE=refs-only` makes `scripts/vite-plugin-data-profile.mjs` generate an
**empty** outline module — the source JSON is not even read — so nothing from the
compilation enters the module graph.

`npm run verify:bundle -- --profile refs-only` then proves it against the built
artefact, with four assertions, each reported by name on failure:

| Assertion | What it checks |
| --- | --- |
| `NO_SOURCE_FILES` | no PDFs, ingest/coverage reports, or `outlines.json` anywhere in `dist/` |
| `NO_SOURCE_MAPS` | no `.map` files, which can carry an original module in full even after tree-shaking |
| `NO_OUTLINE_PROSE` | **every** title, `displayTitle`, source reference and intro passage in the compilation is absent — the complete set, plus each intro sentence |
| `NO_OUTLINE_DIVISIONS` | **every** verse-span division is absent, checked by entry id and by serialized tuple, excluding ranges we authored in `topics.json` |

`scripts/vite-plugin-guard-public.mjs` additionally fails the build at start if
anything forbidden is sitting in `public/`, which Vite copies into `dist/`
verbatim without passing it through the module graph.

The GitHub Pages workflow runs the verifier **before** `deploy-pages`, so a
failing assertion stops the publish rather than being discovered afterwards.

## 2. King James Version scripture text

**Files:** `src/data/kjv/` (see `src/data/kjv/SOURCE.md` for exact provenance).

The KJV is in the public domain in the United States.

In the **United Kingdom** the KJV is under perpetual Crown letters patent, held
by Cambridge University Press as the Queen's/King's Printer. This is a real
restriction, not a formality: UK reproduction beyond fair dealing requires
permission. It is noted here and in the README as a known distribution
consideration for any UK-facing deployment.

## 3. Topic mappings and title overrides

**Files:** `src/data/topics.json`, `src/data/title-overrides.json`

Original to this project, authored by hand. MIT, same as the code. Note that the
*entry ids* they reference derive from the purchased outlines, so these files are
only useful alongside data covered by section 1.

## 4. Journal entries

Entries created in the app are the user's own. They never leave the device in
v1. See the privacy rule in `README.md`.
