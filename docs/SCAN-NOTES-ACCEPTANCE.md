# Scan Notes — acceptance record

Photograph a page of notes, read it on the device, review it, and decide where
the text goes. Android and iOS. Dated 2026-10-14.

**The promise this feature makes: the page is read on the device and goes
nowhere else.** Everything below exists to make that checkable rather than
stated.

---

## What needs a decision

**1. App Lock and the camera, on Android.** Opening the camera or the photo
picker moves the app to the background. With App Lock on and its timeout set to
"Immediately" — which is the default when somebody first switches App Lock on —
the journal re-locks before the person is back with their photograph. They then
unlock, the editor remounts, and the scan is gone. Their writing is not: the
draft autosave has it.

This is not new behaviour and nothing here changed it. Importing a file through
the system picker has always worked this way. Scan Notes matches it rather than
inventing an exemption, because an exemption would mean the app stays unlocked
while it is in the background, which is the opposite of what somebody switching
on App Lock asked for.

If that round trip should be exempted, that is the owner's call to make, not
one to infer from the fact that it is inconvenient. **Nothing was changed.**

**2. Handwriting is still unproven — zero real pages.** The kit to prove or
disprove it is now in the repository (`docs/ocr/handwriting-benchmark-sheet.pdf`)
and has not been filled in by anybody. Until it has been, the wording stays
"Printed notes usually work best. Clear handwriting may also be recognized."

---

## What was built

| Piece | Where |
| --- | --- |
| The state machine — the safety core | `src/scan/session.ts` |
| The review screen | `src/views/ScanNotes.tsx` |
| Editor entry point and draft integration | `src/views/EntryEditor.tsx` |
| Port and capability boundary | `src/platform/ports.ts`, `native-scan.ts`, `web-scanner.ts` |
| Apple Vision recogniser | `ios/App/App/ScanNotesPlugin.swift` |
| ML Kit recogniser, bundled model | `android/.../ScanNotesPlugin.java` |

`session.ts` has no storage import, and that is the design rather than a
convention: there is nothing in it to misuse. It returns a value the editor may
apply; it cannot write an entry.

---

## The seventeen gates, and the proof each can fail

Every gate below was broken on purpose, the test that claims to hold it was
run, and the file was restored and verified byte-for-byte. A gate that still
passed under mutation is a decoration — three of them were, and all three were
defects in the instruments rather than in the product.

| | Gate | Proven by failing |
| --- | --- | --- |
| G01 | The destination is never inferred or defaulted | 6 tests |
| G02 | Empty text can never be accepted | 1 |
| G03 | Acceptance requires a review in progress | 1 |
| G04 | What commits is the approved text, not the recognised text | 3 |
| G05 | Appending never overwrites what a person wrote | 3 |
| G06 | A stale recognition never lands on a newer page | 1 |
| G07 | One approval inserts text exactly once | 1 |
| G08 | No cloud recognition service is named in scan code | 1 |
| G09 | No transport exists by which a page or its text could leave | 1 |
| G10 | Recognised text is never logged | 1 |
| G11 | Android uses the bundled model, never the downloaded one | 1 |
| G12 | Android declares no INTERNET permission | 2 |
| G13 | The recogniser never guesses at a word | 1 |
| G14 | iOS asks for the camera and explains why | 1 |
| G15 | iOS holds no photo-library permission | 1 |
| G16 | Scanning is never offered where a page cannot be read | 1 |
| G17 | Provenance is dropped when a scan replaces imported material | 1 |

**17 of 17 proven.** Two more were proven separately: the temporary photograph
is discarded when the sheet is torn down, and the startup sweep is reached from
`main.tsx`. The web-build refusal was proven against the served bytes, by
rebuilding with `supported: true` and watching the end-to-end spec fail.

### The three that did not fail the first time

Worth recording, because each was a check that looked like coverage.

- **G03** — the stage condition in `canAccept` could be relaxed to `!== 'idle'`
  with every test still passing. The existing test walked idle → acquiring →
  acquired, where the transcription is empty and acceptance is already refused
  for a different reason. The case that matters was untested: a page reviewed
  and approved, a retake attempted, the retake failing — text and destination
  still present, stage no longer `reviewing`. Accepting there would commit
  words from a photograph the person is no longer looking at. Now covered.
- **G08** — adding `https://api.openai.com/...` to the scan bridge did **not**
  fail the privacy gate. The gate strips comments before searching, and its
  stripper treated the `//` in a URL as the start of a line comment, deleting
  the rest of the line. A hard-coded endpoint, the exact thing it exists to
  catch, was invisible to it. The stripper now tracks string literals.
- **G04** — an anchor typo in the harness, not a gate failure. Corrected and
  re-run.

---

## What was measured

### Package size — Android

Two full builds of the same tree, one with Scan Notes and one with the ML Kit
dependency and plugin removed. Compressed, as shipped.

| | Baseline | With Scan Notes | Delta |
| --- | --- | --- | --- |
| Universal APK (4 ABIs) | 15.3 MB | 56.6 MB | **+41.3 MB** |
| **Per device, arm64 (App Bundle)** | 10.0 MB | 22.7 MB | **+12.7 MB** |

The universal figure is the one that looks alarming and the per-device figure is
the one a reader actually downloads: Play delivers one ABI, and
`libmlkit_google_ocr_pipeline.so` is ~10.6 MB of the 12.7. The bundled Latin
models are 1.2 MB and are shared across ABIs.

For context, an earlier local-OCR attempt was closed at +43.7 MB. This is not
that, and the difference is per-device delivery plus a much smaller engine.

### Package size — iOS

**Effectively nothing.** Apple Vision is part of the operating system, so no
model and no engine is bundled: `find` over the built `App.app` turns up no
`.tflite`, no `.mlmodel`, nothing OCR-shaped. The only addition is the plugin's
own compiled code — 293 kB as an unoptimised debug object, less in a release
build — against system frameworks (`Vision`, `VisionKit`, `PhotosUI`) that were
already on the phone.

### Startup

Six cold starts each on the same emulator, app force-stopped between.

| | Median | Range |
| --- | --- | --- |
| Baseline | 706 ms | 650–732 |
| With Scan Notes | 727 ms | 702–889 |

**+21 ms at the median, with ranges that overlap.** Six samples on a headless
software-GPU emulator is indicative, not a device measurement, and this is not
evidence of a real regression. The recogniser is constructed when a page is
recognised, not at launch; the only startup work added is the stale-scan sweep,
which is one plugin call that returns a count.

---

## What was verified, and how

### Android — on an emulator, with the network off

`ScanNotesBundledModelTest`, run on `lwc-ocr-bench` (API 35, arm64,
`google_apis`) **in airplane mode**, with the device confirmed unable to reach
8.8.8.8:

```
com.myjourneywithchrist.lifewithchrist.ScanNotesBundledModelTest:..
OK (2 tests)
```

The first asserts the app declares no `INTERNET`, no `ACCESS_NETWORK_STATE`, and
no broad storage permission. The second draws a page and recognises it anyway.
Both passing together is the proof: an unbundled model would have to download
itself, and this device had nowhere to download from.

The airplane-mode run matters because `google_apis` images ship Google Play
Services. Choosing that image is not by itself evidence of anything; cutting the
network is.

### iOS — built, linked and launched

- The plugin is compiled into the app: 122 `ScanNotes` symbols in
  `App.debug.dylib`, and `ScanNotesPlugin.o` exists as its own object.
- It references Vision and PHPicker, and **no network symbol at all** — zero
  `URLSession`, `URLRequest` or `CFNetwork` references in `ScanNotesPlugin.o`.
  (The one `NSURLSession` reference anywhere in the dylib comes from a bundled
  dependency, not from any file in `ios/App/App/`.)
- `Info.plist` in the built bundle carries `NSCameraUsageDescription` and no
  `NSPhotoLibraryUsageDescription`.
- The app installs and launches on an iOS 26.5 simulator.

This matters because of a false green earlier in this work: an iOS build
reported BUILD SUCCEEDED while the plugin appeared **zero times** in
`project.pbxproj` and was compiled into nothing.

### Both platforms — the shared layer

2,407 unit tests pass, including 20 on the state machine, 13 on the review
screen and 8 on the editor integration. Typecheck, lint, the data gate and the
startup gate are clean.

---

## What was NOT verified

Stated plainly, so silence is not mistaken for a clean bill.

- **Handwriting. At all.** Zero real pages, on either platform. The product
  wording stays cautious for this reason.
- **The on-screen scan flow on iOS.** The plugin is proven present and correctly
  linked, and the shared review screen is covered by component tests, but
  nobody — and no automation — has pressed "Scan notes" on an iOS screen in
  this lane. Driving the simulator's UI needed accessibility permissions this
  session could not grant, and that line was stopped rather than worked around.
- **Any physical device.** The Galaxy A17 holds real journal data and was
  deliberately left alone. Nothing was installed on it, nothing was cleared,
  and no `adb` command touched it.
- **A real camera.** Both platforms were exercised through drawn and chosen
  images. Lens, autofocus and lighting on an actual phone are untested here;
  the printed benchmark covered degradation synthetically.
- **The photo picker's own screens.** `PHPickerViewController` and
  `ACTION_PICK_IMAGES` are system UI, and no test presses their buttons.

---

## Behaviour worth knowing

**If the process dies mid-scan**, the temporary photograph stays in the app's
cache — the sheet never got to delete it. `cleanupStaleScans()` runs at the next
launch and removes it, scoped to our own scan directory. Nothing in a person's
photo library is ever touched; the app deletes only its own copy.

**If the app locks mid-scan**, the sheet is unmounted and its cleanup effect
discards the photograph immediately. That effect exists specifically for this.

**A recognised page changes nothing on its own.** The transcription can be on
screen, read and correct, and the journal is still untouched. Only "Use text"
applies it, and only to the field the person chose.

**Nothing is normalised.** `Jhn 3:16` stays `Jhn 3:16`. An engine that expanded
it would be rewriting a journal, and the benchmark scores that as an error even
though the guess is right.
