# On-device OCR feasibility — 15 October 2026

Measured, not surveyed. Everything below comes from running real recognisers
over a reproducible corpus, or from measuring real artifacts.

**Verdict: OCR is feasible with a platform asymmetry. Printed notes are ready on
iOS at zero package cost. Android carries a real package cost or an offline
compromise, and Android accuracy was not measured in this lane. Handwriting
remains unproven.**

## What was measured, and what was not

| | Status |
| --- | --- |
| Apple Vision accuracy, 26 samples, 4 configurations | **measured** (104 recognition runs) |
| Apple Vision latency | **measured** |
| ML Kit package payload | **measured** (artifacts from Google Maven) |
| ML Kit offline behaviour | **determined from artifact structure** |
| ML Kit accuracy | **NOT MEASURED** — no Android emulator available |
| Real handwriting accuracy | **NOT MEASURED** — no legally usable corpus obtained |
| Physical device behaviour | **NOT TESTED** |
| Review-before-commit UI prototype | **NOT BUILT** |

## Prior art this lane was asked to revisit

On 2026-09-23 bundled ML Kit was measured here and the investigation was closed:
a universal debug APK went from 16,008,533 to 59,676,323 bytes. The decision
left one door open — "an OS-provided API … but only when asked". This lane is
that request, and Apple Vision is exactly that door.

## The corpus

21 printed pages plus 5 synthetic-handwriting pages, rendered deterministically
by `tools/ocr-lab/OcrLab.swift` so ground truth is *what was drawn*, not a human
transcription of a photo. All content is fictional and marked `FICTIONAL-COMPAT`.

Two tiers, because the first one did not discriminate:

- **Easy (15):** clean print, phone-photo simulation, rotation, perspective, dim
  light, shadow, small text, heading+body, bullets, numbered list, Scripture
  references, mixed case, punctuation, two-column, photocopy.
- **Hard (6):** heavy motion blur, 0.28× low resolution, real JPEG round trip at
  quality 0.12, very dim with shadow, severe skew with blur, small text degraded.

The easy tier returned **0.00% median CER**, which says more about synthetic
rendering than about the recogniser. The hard tier was added so the numbers mean
something. Even so, synthetic degradation is milder than a real photograph taken
in a pew: **treat these as a lower bound on difficulty.**

## Apple Vision results

`VNRecognizeTextRequest`, `.accurate`, `en-US`, macOS 26 (Vision revisions 2 and 3).

| Tier | median CER | median WER | worst CER |
| --- | --- | --- | --- |
| Easy (15) | **0.00%** | 0.00% | 1.52% |
| Hard (6) | **5.33%** | 16.22% | 77.74% |

Hard tier, per sample (revision 3, correction off):

| Sample | CER | WER |
| --- | --- | --- |
| Q-low-res (0.28×) | **0.00%** | 0.00% |
| R-jpeg (q=0.12) | **0.00%** | 0.00% |
| S-very-dim + shadow | **0.00%** | 0.00% |
| U-hard-small (8pt, dim, blur) | 10.67% | 57.14% |
| T-severe-skew (7°, perspective, blur) | 16.44% | 32.43% |
| P-hard-blur (4.5px blur) | **77.74%** | 91.00% |

**The failure mode is motion blur, and only motion blur.** Low resolution, heavy
JPEG artefacts and very dim light were all recognised perfectly. That is a
directly actionable product finding: the capture step should reject or re-prompt
on blur, and blur is cheap to detect before recognition.

### Revision 2 vs revision 3

The app's iOS deployment target is **15.0**, where revision 2 is the ceiling.
Measured difference across all 26 samples: **none worth reporting** — identical
medians, worst-case within 0.5 percentage points. The iOS 15 target costs
nothing in accuracy.

### Language correction: recommend OFF

`usesLanguageCorrection` changed nothing on any clean sample. On degraded
samples it changed words — and not always for the better:

| correction off | correction on |
| --- | --- |
| `khn 3:16` | `she 3:16` |
| `Johe 3:16-18` | `John 3:16-18` ✓ |
| `Matthee 6:19-34` | `Matthen 6:19-34` |
| `Luảa 24.:27` | `Luản 24:27` |

On the worst sample, correction **dropped three lines entirely** that
correction-off recovered. It also costs ~57% more time (156ms → 244ms median).

For a journal that preserves people's words, a recogniser that silently
substitutes a plausible word is the wrong default — especially when a human
reviews the text anyway. **Recommend `usesLanguageCorrection = false`.**

### Scripture references

54 references across the corpus. **43/54 exact** overall; **34/34 exact** on the
easy tier. Every miss was on a hard-tier image. No systematic confusion of `1`/`I`/`l`
or `:`/`;` was observed on legible input; failures were wholesale, not subtle,
which is the better kind for a review screen to catch.

### Layout

Two-column recognition was **correct in reading order** — the left column was
read fully, then the right. Its 1.52% CER is line-break placement only; **WER was
0.00%**. Bullets, numbered lists, headings and blank-line structure all survived
well enough to edit.

### Latency

Median **156–180ms** per 1700×2200 page with correction off; **244–278ms** with it
on. Worst observed 477ms. Measured on an Apple-silicon Mac, so a phone will be
slower — but the margin is large.

## Android: ML Kit Text Recognition v2

Measured from the actual artifacts (`com.google.mlkit:text-recognition:16.0.1`,
`text-recognition-bundled-common:17.0.0`, and
`com.google.android.gms:play-services-mlkit-text-recognition:19.0.1`):

| Option | Payload | Offline on first use | Needs Play Services |
| --- | --- | --- | --- |
| **Bundled** | `libmlkit_google_ocr_pipeline.so`: arm64-v8a **10.6 MB**, armeabi-v7a 6.5 MB, x86 11.0 MB, x86_64 11.1 MB — **39.1 MB all four ABIs** | **yes** | no |
| **Unbundled** | 78 KB AAR | **no — model downloads on first use** | yes |

A correction to how the September figure is often quoted: **+43.7 MB was the
universal-APK number.** Google Play delivers per-ABI from an AAB, so the real
install cost on a modern phone is the **arm64-v8a figure, ~10.6 MB**, not 39 MB.
That is a materially different decision from the one taken in September, and it
is the honest framing.

The unbundled option is cheap in bytes and wrong for this product: a first-use
model download breaks the offline-first promise and reintroduces a network
dependency the app currently does not have at all.

**Android accuracy was not measured.** No Android emulator is installed on this
machine and none was created in this lane. Nothing here claims ML Kit accuracy
parity with Vision, in either direction.

## Handwriting

**Representative handwriting acceptance remains unproven.**

Five synthetic handwriting-font pages (Noteworthy, Bradley Hand, Marker Felt,
Snell Roundhand cursive, Chalkboard) scored 0.00–1.33% CER. That number is
reported here only to show the recogniser attempts cursive-like letterforms at
all. **A font is not handwriting**: it repeats an identical glyph every time,
while real handwriting varies in slant, spacing, baseline and letterform within a
single word. These samples are a diagnostic and are labelled
`synthetic-handwriting` in the corpus index so they can never be folded into a
handwriting claim.

No real handwritten page images were obtained. Public handwriting corpora
generally require registration and carry redistribution terms incompatible with
committing images to this repository. Sourcing a small licensed set, or
collecting consented fictional handwritten sheets, is the next step before any
handwriting claim is made.

**Do not advertise handwriting recognition on this evidence.**

## Privacy

The current baseline is unusually clean and must not be given away:

- Android declares **zero permissions** — no `INTERNET`.
- iOS declares **zero usage descriptions**.
- No `fetch`, `XMLHttpRequest` or `WebSocket` anywhere in non-test app source.

Apple Vision is an OS framework: no permission, no network, no package cost.
Bundled ML Kit is local and needs no `INTERNET` either. Unbundled ML Kit would
require network and Play Services.

No cloud OCR was used, considered or added. No image or recognised text leaves
the device in any design described here.

## Scanned PDFs

Today a scanned PDF is detected and reported honestly as scanned, never as
empty — `src/import/pdf.ts` with `pdf.scanned.test.ts` pinning it. There is **no
page rasteriser**: the importer reads the text layer only.

OCR of scanned PDFs is therefore feasible but is not free: it needs pdfjs page
rendering to a bitmap, then the same OCR path. Expect roughly width×height×4
bytes per page in memory, so a page cap and a bounded render scale would be
required. Recommend treating it as a **separate, later** piece of work, not part
of a first Scan Notes feature.

## Recommended product shape, if this proceeds

The existing import architecture already enforces what matters: parse → review →
explicit commit, with `SourceMaterial` provenance that is "never guessed from a
filename, and never read out of unstructured prose". OCR should feed that same
review model rather than inventing a parallel path.

- Capture or choose image → recognise on device → **editable review with the
  source image visible** → person chooses the destination → confirm.
- Never infer whether a page is the reader's own notes or church-provided
  material. The person chooses.
- `usesLanguageCorrection = false`.
- Detect blur before recognising and re-prompt; it is the one failure mode that
  matters.
- Do not store the photograph, and do not add an attachments schema for it.
- No LLM, no "clean-up" pass, no reconstruction of uncertain words.

## What is NOT claimed

- No Android accuracy measurement.
- No handwriting claim of any kind.
- No physical-device or emulator evidence.
- No review UI was built; the flow above is a recommendation, not a prototype
  result.
- Latency measured on a Mac, not a phone.
