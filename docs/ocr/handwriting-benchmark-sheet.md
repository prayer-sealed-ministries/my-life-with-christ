# Handwriting benchmark sheet

**What this is.** A printable sheet for finding out whether Scan Notes can read
*handwriting* — not whether it can read print. Print is settled: both engines
read printed pages at 0.00% median character error across every degradation
that was measured except heavy blur. Handwriting is **unproven**, on zero real
pages, and this kit is how that changes.

**Why a kit instead of a claim.** The product currently says "Printed notes
usually work best. Clear handwriting may also be recognized." That wording is
deliberately cautious because nobody has measured it. It must not be upgraded
to a promise on the strength of one person's tidy sample, and it must not be
downgraded to "handwriting is not supported" on the strength of one person's
hurried one. Four hands, four styles, scored the same way, is the smallest
thing that would justify changing the sentence either way.

`handwriting-benchmark-sheet.pdf` is generated from this file by
`node scripts/benchmark-sheet.mjs`. Edit this file, not the PDF.

---

## How to use it

1. **Print it on US Letter paper.** One-sided. Do not scale it to fit.
2. **Copy each section's printed text in the style that section asks for**, in
   the ruled space underneath it. Use whatever pen you normally use.
3. **Photograph each section** with the app's Scan notes, in ordinary indoor
   light. Fill the frame with the page. Do not flatten a curled page with your
   fingers in the shot.
4. **Save what the app produced**, exactly as it produced it, before correcting
   anything. The uncorrected transcription is the measurement; your correction
   is the product working as intended and tells you nothing about accuracy.
5. **Score it** against the ground truth at the end of this file.

### What not to write on it

Nothing from a real journal. Nothing about a real person. Every line here is
fictional for that reason: a benchmark sheet gets photographed, attached to a
report, and passed around, and a page of somebody's actual prayers is not a
test fixture. If you want to test your own handwriting on real content, do it
privately in the app and do not send the result anywhere.

---

## Section 1 — Neat printing

> Copy in careful, separated block printing. This is the best case: if an
> engine cannot read this, it cannot read handwriting at all.

```
FICTIONAL-SCAN SECTION ONE
Pastor Alder Finch, Harbour Chapel, 14 March 2027
The second reading was Jhn 3:16 and the series is called Deep Water.
Three points: wait, watch, walk.
Attendance 148. Offering counted twice.
```

## Section 2 — Normal handwriting

> Copy in your everyday handwriting — the hand you would use for a shopping
> list. Not your best, not your fastest.

```
FICTIONAL-SCAN SECTION TWO
The shepherd leaves the ninety-nine and goes after the one.
Rev. Marisol Okonkwo asked us to read Eph 4:2-3 slowly, twice.
She said: patience is not politeness; it is staying.
Next week — chapter 11, verses 1 to 16.
```

## Section 3 — Cursive

> Copy in joined cursive. If you do not write cursive, write "not applicable"
> on the first line and leave the rest blank; a missing sample is honest and an
> imitation of cursive is not a measurement.

```
FICTIONAL-SCAN SECTION THREE
Grace does not arrive in proportion to effort.
Hymn 212, sung twice, verse 3 omitted.
Fictional Bay Fellowship, 7:30 in the evening.
Ask about the Thursday study group.
```

## Section 4 — Natural note-taking

> Do not copy anything. Write four or five lines the way you actually write
> during a talk: fast, abbreviated, with arrows and underlining if that is what
> you do. Invent the content — a sermon that never happened.
>
> Then, **in the box at the bottom, print what you wrote**, so there is a
> ground truth to score against. You are the only person who can supply it.

---

## Scoring

Character error rate, computed the same way as the printed benchmark:

```
CER = (substitutions + insertions + deletions) / characters in the ground truth
WER = the same, counted over whitespace-separated words
```

Compare line by line. Count what the engine produced, not what you meant.

Four rules that keep the number meaningful:

- **Score the uncorrected output.** Once you have fixed a word, the sample is
  spent.
- **Do not normalise the reference.** `Jhn 3:16` is the ground truth. An engine
  returning `John 3:16` has made a substitution and must be scored as wrong,
  even though it guessed correctly — a recogniser that expands references is
  rewriting a journal, and that is a defect whatever the accuracy figure says.
- **Record the lighting and the device.** A result without them cannot be
  compared with anything.
- **Report blur separately.** A sample the app warned was blurry is a
  measurement of the photograph, not of the handwriting.

### Ground truth

The three copied sections are the fenced blocks above, verbatim, including
capitals, punctuation and the reference spellings. Section 4's ground truth is
whatever you printed in its box.

### What a result would justify

| Finding across four or more hands | What the product should then say |
| --- | --- |
| Neat printing reads well, everyday hands read poorly | Keep the current cautious wording. |
| All three copied styles read well | The wording may become warmer — still never "any handwriting". |
| Even neat printing reads poorly | Say plainly that handwriting is not supported yet, and keep offering it anyway for printed pages. |

One person's sheet justifies none of these. It is one hand.
