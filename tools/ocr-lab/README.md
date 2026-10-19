# OCR lab

Measurement tooling for the on-device OCR feasibility question. **Not shipped,
not referenced by the application, not built by any production target.**

Findings: [`docs/OCR-FEASIBILITY-2026-10-15.md`](../../docs/OCR-FEASIBILITY-2026-10-15.md).

## Why the corpus is not committed

`corpus/` and `results/` are generated and git-ignored. The renderer is
deterministic, so the generator is the thing worth keeping; 21 MB of PNGs is
not. Regenerate with:

```sh
swiftc -O tools/ocr-lab/OcrLab.swift -o /tmp/ocrlab
/tmp/ocrlab render tools/ocr-lab/corpus
```

## Measuring

```sh
# one image, one configuration
/tmp/ocrlab ocr tools/ocr-lab/corpus/A-clean-print.png \
  --level accurate --correction off --revision 3 --langs en-US

# score a directory of results against ground truth
node tools/ocr-lab/score.mjs tools/ocr-lab/results
```

Each result JSON needs `id`, `kind`, and `truthPath` added alongside the
recogniser output; see the sweep script recorded in the feasibility document.

## Rules this lab follows

- Every page is fictional and marked `FICTIONAL-COMPAT`. No real journal content
  is ever used, and none is read.
- Ground truth is *the text that was drawn*, not a human transcription of a
  photograph, so accuracy is measured against a known answer.
- Printed and synthetic-handwriting samples are scored separately and never
  averaged together. A handwriting **font** is not handwriting: it repeats an
  identical glyph every time, while real handwriting varies within a single
  word. Those samples are a diagnostic, never evidence of handwriting support.
- Raw CER/WER are the headline. The normalised figure (case and punctuation
  folded) is reported beside it, never instead — for a journal that preserves
  people's words, punctuation and capitalisation are part of the words.
