# Data licensing

Everything in this repository is either public domain or written for this
project. No licensed third-party data is here, and nothing here can build
something that contains any.

---

## What ships, and where it came from

| Data | Source | Status |
| --- | --- | --- |
| Bible text | King James Version | Public domain. See `src/data/kjv/SOURCE.md` for the UK Crown-patent note. |
| Section headings and divisions | Berean Standard Bible | Dedicated to the public domain on 2023-04-30. Generated into `src/data/sections.json` by `npm run ingest:sections`; see `src/data/sections/SOURCE.md`. |
| Book introductions | Written for this project | `src/data/intros.json`. Drawn from plain historical fact and public-domain reference works. |
| Life topics | Written for this project | `src/data/topics.json`. Forty topics and the verse ranges they point at. |
| Everything a person writes | The person using the app | Theirs. It never leaves their device unless they export it. |

Attribution for the BSB and the KJV is not legally required and is given
anyway — `src/lib/attribution.ts`, shown in the app and written into every
export.

## Build profiles

There are two, and both are publishable:

| Profile | Divisions | Use |
| --- | --- | --- |
| `public` | BSB section headings plus this project's introductions | The deployed build, and the default. |
| `refs-only` | None. Whole chapters, from KJV versification. | The fallback. |

`refs-only` carries no division data at all rather than a copy with the titles
removed. In a compilation the selection and arrangement is the substance of the
work — deciding where a chapter divides is editorial judgement, not a fact — so
"the same divisions without the titles" is not a redaction of anything, and this
repository does not offer one.

## Licensed third-party material

A licensed third-party outline compilation was used during earlier development
of this project. **It is not part of this repository.**

- The source documents are not here.
- Nothing generated from them is here.
- Neither is in the Git history.
- There is no build profile that reads them, and no flag, environment variable
  or local file that can turn one on.

This is a statement about the repository, not a licence. That material remains
its author's property, was licensed for one purchaser's private use, and is not
ours to distribute. Nothing in this repository grants any right to it.

## Private data must never be committed

`.gitignore` names the locations licensed or private source material would
land in, so a wide `git add` cannot stage it.

`npm run verify:no-private-data` is the check that does not rely on anyone
remembering. It fails closed if such material is tracked — by path, by private
location, or by a short set of distinctive strings that would identify the
content itself — and it has floors, so a run that scanned nothing fails as
loudly as a run that found something.

It runs:

- in `.githooks/pre-push`, before anything reaches a remote;
- in CI as the first step of the `data-gate` job, before anything is built;
- as the first step of `npm run gate`.

`npm run verify:bundle` asks the same question of a **built artefact**: that it
was really read, that no source document or generated report was copied into
it, that no source map is carrying a module out whole, and that none of those
strings appear.

### If you are adding data

Ask where it came from and whether the answer can be written in the table at
the top of this file. If it cannot, it does not belong here — put it outside
the repository. A local working copy of something you have licensed is your
business; committing it is not, and neither check above can tell the difference
between a mistake and a decision.
