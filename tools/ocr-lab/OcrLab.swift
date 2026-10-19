// OCR feasibility lab: corpus renderer + Apple Vision runner.
//
// Two jobs, deliberately in one tool so the ground truth and the recognition
// cannot drift apart:
//
//   render  writes a reproducible corpus of fictional note pages, each with the
//           exact text that produced it, so accuracy is measured against what
//           was actually drawn rather than against a transcription of a photo.
//   ocr     runs VNRecognizeTextRequest over an image and prints structured
//           JSON: text, per-line boxes and confidences, timing.
//
// Everything rendered here is fictional. No real journal content is used.
//
// Build:  swiftc -O tools/ocr-lab/OcrLab.swift -o <bin>
// Usage:  ocrlab render <outdir>
//         ocrlab ocr <image.png> [--level accurate|fast] [--correction on|off]
//                                [--revision 1|2|3] [--langs en-US]

import Foundation
import CoreGraphics
import CoreText
import CoreImage
import Vision
import ImageIO
import UniformTypeIdentifiers
import AppKit

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/// One benchmark page: the text drawn, and how the image was degraded.
struct Sample {
    let id: String
    let label: String
    let text: String
    let fontSize: CGFloat
    let columns: Int
    /// Degradations applied after rendering, in order.
    let rotate: CGFloat      // degrees
    let perspective: Bool
    let dim: CGFloat         // 0 = none, 1 = heavy
    let shadow: Bool
    let blur: CGFloat
    let noise: CGFloat
    let photocopy: Bool
    /// Downscale factor before upscaling back (simulates a low-resolution capture).
    var lowRes: CGFloat = 1.0
    /// JPEG quality 0-1 applied as a round trip; 1.0 means no JPEG step.
    var jpeg: CGFloat = 1.0
    /// A handwriting-style face. SYNTHETIC: a font is not handwriting, and
    /// results from these samples are a diagnostic, never evidence about real
    /// handwritten pages. See docs for why they are reported separately.
    var handwritingFont: String? = nil
}

let bodyText = """
FICTIONAL-COMPAT Sermon Notes

Speaker: Pastor Example
Series: A Fictional Series
Date: 12 October 2026

The passage this morning was John 3:16, and the speaker returned to it twice.
He said that the love described there is not sentimental but costly, and that
the word "gave" carries the whole weight of the sentence.

A second reading came from Romans 10:9, which was read aloud slowly. The point
made was that confession and belief are not two separate transactions but one
turning of the whole person.

He closed by reading Psalm 119:11 and asking us to carry one verse into the week.
"""

let bulletText = """
FICTIONAL-COMPAT Outline

- Opening prayer and welcome
- First point: the text says what it says
- Second point: context is not decoration
- Third point: obedience follows understanding
- Closing: carry one verse into the week
"""

let numberedText = """
FICTIONAL-COMPAT Numbered Outline

1. Created for God
2. Separated by sin
3. Promised a Savior
4. Jesus came and died
5. He rose again
6. Receive Him by grace through faith
7. Walk with Him daily
"""

let scriptureText = """
FICTIONAL-COMPAT Scripture References

John 3:16
John 3:16-18
1 Corinthians 10:31
Psalm 119:11
Romans 10:9
Luke 24:27
Matthew 6:19-34
2 Timothy 3:16-17
"""

let punctuationText = """
FICTIONAL-COMPAT Punctuation Check

He asked, "Is this the whole of it?" — and then waited.
Notes (taken quickly): comma, semicolon; colon: dash — ellipsis ...
Quotes: 'single' and "double". Apostrophes: don't, it's, Lord's.
Numbers: 1, 2, 3; 10:31; 119:11; 2026.
"""

let mixedCaseText = """
FICTIONAL-COMPAT MIXED CASE

ALL CAPS HEADING FOR THE MORNING
Sentence case body text follows here.
camelCase and PascalCase words appear.
A Title In Headline Case Appears Here.
"""

let headingBodyText = """
FICTIONAL-COMPAT Heading

The Weight of a Single Word

This paragraph sits beneath a large heading. The heading is set much larger
than the body so that the recognizer has to cope with two very different text
sizes on one page without losing either of them.
"""

let twoColumnText = """
FICTIONAL-COMPAT Two Column Handout

Left column begins here and continues for several lines so that the column
boundary is unambiguous. It mentions Luke 24:27 near its end.

The second column starts after the first and also runs for several lines. It
mentions 2 Timothy 3:16-17 so the two columns can be told apart in the output.
"""

let samples: [Sample] = [
    Sample(id: "A-clean-print", label: "clean laser-printed page", text: bodyText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "B-phone-photo", label: "phone photo of printed page", text: bodyText, fontSize: 15, columns: 1,
           rotate: 1.5, perspective: true, dim: 0.15, shadow: false, blur: 0.8, noise: 0.03, photocopy: false),
    Sample(id: "C-rotated", label: "slight rotation", text: bodyText, fontSize: 15, columns: 1,
           rotate: 4, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "D-perspective", label: "perspective distortion", text: bodyText, fontSize: 15, columns: 1,
           rotate: 0, perspective: true, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "E-dim", label: "moderately dim lighting", text: bodyText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0.45, shadow: false, blur: 0.3, noise: 0.02, photocopy: false),
    Sample(id: "F-shadow", label: "shadow across page", text: bodyText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: true, blur: 0.2, noise: 0, photocopy: false),
    Sample(id: "G-small-text", label: "small text", text: bodyText, fontSize: 8.5, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "H-heading-body", label: "large heading plus body", text: headingBodyText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "I-bullets", label: "bulleted sermon outline", text: bulletText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "J-numbered", label: "numbered outline", text: numberedText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "K-scripture", label: "multiple Scripture references", text: scriptureText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "L-mixed-case", label: "mixed uppercase/lowercase", text: mixedCaseText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "M-punctuation", label: "punctuation", text: punctuationText, fontSize: 15, columns: 1,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "N-two-column", label: "two-column handout", text: twoColumnText, fontSize: 14, columns: 2,
           rotate: 0, perspective: false, dim: 0, shadow: false, blur: 0, noise: 0, photocopy: false),
    Sample(id: "O-photocopy", label: "low-quality photocopy-style image", text: bodyText, fontSize: 15, columns: 1,
           rotate: 0.7, perspective: false, dim: 0.2, shadow: false, blur: 1.1, noise: 0.08, photocopy: true),

    // ---- Hard tier -------------------------------------------------------
    //
    // The first fifteen samples turned out not to discriminate at all: Apple
    // Vision returned 0.00% CER on almost every one, which says more about
    // synthetic rendering than about the recogniser. These are deliberately
    // nasty — the kind of photograph someone actually takes of a handout in a
    // dim room with a moving hand — so the numbers mean something.
    Sample(id: "P-hard-blur", label: "HARD: heavy motion blur", text: bodyText, fontSize: 15, columns: 1,
           rotate: 2.5, perspective: false, dim: 0.25, shadow: false, blur: 4.5, noise: 0.05, photocopy: false),
    Sample(id: "Q-low-res", label: "HARD: low-resolution capture", text: bodyText, fontSize: 15, columns: 1,
           rotate: 1.0, perspective: false, dim: 0.1, shadow: false, blur: 0.5, noise: 0.04, photocopy: false,
           lowRes: 0.28),
    Sample(id: "R-jpeg", label: "HARD: heavy JPEG artefacts", text: bodyText, fontSize: 15, columns: 1,
           rotate: 0.8, perspective: false, dim: 0.15, shadow: false, blur: 0.6, noise: 0.03, photocopy: false,
           lowRes: 0.45, jpeg: 0.12),
    Sample(id: "S-very-dim", label: "HARD: very dim with shadow", text: bodyText, fontSize: 15, columns: 1,
           rotate: 1.2, perspective: false, dim: 0.78, shadow: true, blur: 1.6, noise: 0.07, photocopy: false),
    Sample(id: "T-severe-skew", label: "HARD: severe perspective and blur", text: bulletText, fontSize: 15, columns: 1,
           rotate: 7.0, perspective: true, dim: 0.3, shadow: false, blur: 2.2, noise: 0.05, photocopy: false,
           lowRes: 0.5),
    Sample(id: "U-hard-small", label: "HARD: small text, dim, blurred", text: scriptureText, fontSize: 8.0, columns: 1,
           rotate: 1.5, perspective: false, dim: 0.5, shadow: false, blur: 2.0, noise: 0.06, photocopy: false,
           lowRes: 0.5),

    // ---- Synthetic handwriting diagnostic --------------------------------
    //
    // A handwriting FONT is not handwriting. Real handwriting varies in slant,
    // spacing, baseline, pressure and letterform from word to word and writer
    // to writer; a font repeats the same glyph every time. These samples are a
    // smoke test for "does the recogniser attempt cursive-like shapes at all",
    // and they are reported in their own section, never mixed into a
    // handwriting accuracy claim.
    Sample(id: "HS1-noteworthy", label: "SYNTHETIC handwriting: neat print style", text: bulletText, fontSize: 16, columns: 1,
           rotate: 0.6, perspective: false, dim: 0.05, shadow: false, blur: 0.3, noise: 0.01, photocopy: false,
           handwritingFont: "Noteworthy-Light"),
    Sample(id: "HS2-bradley", label: "SYNTHETIC handwriting: casual print style", text: scriptureText, fontSize: 16, columns: 1,
           rotate: 0.9, perspective: false, dim: 0.05, shadow: false, blur: 0.3, noise: 0.01, photocopy: false,
           handwritingFont: "BradleyHandITCTT-Bold"),
    Sample(id: "HS3-marker", label: "SYNTHETIC handwriting: marker style", text: numberedText, fontSize: 16, columns: 1,
           rotate: 0.5, perspective: false, dim: 0.05, shadow: false, blur: 0.3, noise: 0.01, photocopy: false,
           handwritingFont: "MarkerFelt-Thin"),
    Sample(id: "HS4-cursive", label: "SYNTHETIC handwriting: cursive script", text: bulletText, fontSize: 18, columns: 1,
           rotate: 0.4, perspective: false, dim: 0.05, shadow: false, blur: 0.3, noise: 0.01, photocopy: false,
           handwritingFont: "SnellRoundhand"),
    Sample(id: "HS5-chalk", label: "SYNTHETIC handwriting: rounded hand", text: bodyText, fontSize: 15, columns: 1,
           rotate: 0.5, perspective: false, dim: 0.05, shadow: false, blur: 0.3, noise: 0.01, photocopy: false,
           handwritingFont: "Chalkboard"),
]

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let pageWidth: CGFloat = 1700   // ~200dpi letter width, a realistic phone capture
let pageHeight: CGFloat = 2200
let margin: CGFloat = 120

func renderPage(_ sample: Sample) -> CGImage {
    let space = CGColorSpaceCreateDeviceRGB()
    let ctx = CGContext(data: nil, width: Int(pageWidth), height: Int(pageHeight),
                        bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight))

    let lines = sample.text.components(separatedBy: "\n")
    // The first line is a heading; H also has a large sub-heading on line 3.
    let columnWidth = sample.columns == 2
        ? (pageWidth - margin * 2 - 60) / 2
        : pageWidth - margin * 2

    var columnIndex = 0
    var y = pageHeight - margin
    let halfway = lines.count / 2

    for (index, line) in lines.enumerated() {
        if sample.columns == 2 && index == halfway {
            columnIndex = 1
            y = pageHeight - margin
        }
        let isHeading = index == 0
        let isSubHeading = sample.id == "H-heading-body" && index == 2
        let size: CGFloat = isHeading ? sample.fontSize * 1.6
            : isSubHeading ? sample.fontSize * 2.4
            : sample.fontSize
        let weight: NSFont.Weight = (isHeading || isSubHeading) ? .bold : .regular
        let pointSize = size * 2.0 // 2x for 200dpi feel
        let font: NSFont
        if let face = sample.handwritingFont, let custom = NSFont(name: face, size: pointSize) {
            font = custom
        } else {
            font = NSFont.systemFont(ofSize: pointSize, weight: weight)
        }

        if line.trimmingCharacters(in: .whitespaces).isEmpty {
            y -= font.pointSize * 0.8
            continue
        }

        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.black,
        ]
        let attributed = NSAttributedString(string: line, attributes: attrs)
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let x = margin + CGFloat(columnIndex) * (columnWidth + 60)
        let suggested = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter, CFRangeMake(0, 0), nil,
            CGSize(width: columnWidth, height: .greatestFiniteMagnitude), nil)
        let rect = CGRect(x: x, y: y - suggested.height, width: columnWidth, height: suggested.height)
        let path = CGPath(rect: rect, transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, 0), path, nil)
        CTFrameDraw(frame, ctx)
        y -= suggested.height + font.pointSize * 0.35
    }

    return ctx.makeImage()!
}

/// Apply the degradations that make a rendered page look photographed.
///
/// Every step re-crops to the original page rectangle. Several Core Image
/// generators (CIRandomGenerator above all) have an INFINITE extent, and an
/// infinite extent reaching `createCGImage` aborts the process with SIGTRAP —
/// which is exactly how the first run of this tool died.
func degrade(_ image: CGImage, _ sample: Sample) -> CGImage {
    let pageRect = CGRect(x: 0, y: 0, width: CGFloat(image.width), height: CGFloat(image.height))
    var ci = CIImage(cgImage: image)
    let context = CIContext()

    func clamp(_ input: CIImage) -> CIImage { input.cropped(to: pageRect) }

    if sample.photocopy {
        ci = clamp(ci.applyingFilter("CIColorControls", parameters: [
            kCIInputSaturationKey: 0.0, kCIInputContrastKey: 1.45, kCIInputBrightnessKey: -0.05,
        ]))
    }
    if sample.blur > 0 {
        // Blur reads beyond the edges, so clamp first and re-crop after.
        ci = clamp(ci.clampedToExtent()
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: sample.blur]))
    }
    if sample.dim > 0 {
        ci = clamp(ci.applyingFilter("CIColorControls", parameters: [
            kCIInputBrightnessKey: -sample.dim * 0.5, kCIInputContrastKey: 1.0 - sample.dim * 0.25,
        ]))
    }
    if sample.shadow {
        let gradient = CIFilter(name: "CILinearGradient")!
        gradient.setValue(CIVector(x: 0, y: pageRect.height), forKey: "inputPoint0")
        gradient.setValue(CIColor(red: 0.4, green: 0.4, blue: 0.4, alpha: 1), forKey: "inputColor0")
        gradient.setValue(CIVector(x: pageRect.width * 0.85, y: 0), forKey: "inputPoint1")
        gradient.setValue(CIColor(red: 1, green: 1, blue: 1, alpha: 1), forKey: "inputColor1")
        if let g = gradient.outputImage {
            ci = clamp(ci.applyingFilter("CIMultiplyBlendMode", parameters: [
                kCIInputBackgroundImageKey: clamp(g),
            ]))
        }
    }
    if sample.noise > 0 {
        if let generated = CIFilter(name: "CIRandomGenerator")?.outputImage {
            let grey = clamp(generated).applyingFilter("CIColorControls", parameters: [
                kCIInputSaturationKey: 0.0,
            ])
            ci = clamp(grey.applyingFilter("CISourceOverCompositing", parameters: [
                kCIInputBackgroundImageKey: ci,
            ]).applyingFilter("CIDissolveTransition", parameters: [
                kCIInputTargetImageKey: ci, kCIInputTimeKey: 1.0 - Double(sample.noise),
            ]))
        }
    }
    if sample.perspective {
        let e = pageRect
        ci = clamp(ci.applyingFilter("CIPerspectiveTransform", parameters: [
            "inputTopLeft": CIVector(x: e.minX + 38, y: e.maxY - 14),
            "inputTopRight": CIVector(x: e.maxX - 12, y: e.maxY - 52),
            "inputBottomRight": CIVector(x: e.maxX - 30, y: e.minY + 16),
            "inputBottomLeft": CIVector(x: e.minX + 10, y: e.minY + 46),
        ]))
    }
    if sample.rotate != 0 {
        let radians = sample.rotate * .pi / 180
        let rotated = ci.transformed(by: CGAffineTransform(rotationAngle: radians))
        let white = CIImage(color: CIColor.white).cropped(to: rotated.extent)
        ci = rotated.composited(over: white).cropped(to: rotated.extent)
    }

    if sample.lowRes < 1.0 {
        // Downscale then scale back: throws away detail the way a small sensor
        // crop or an aggressive resize does, without changing the pixel count
        // the recogniser is handed.
        let down = clamp(ci).transformed(by: CGAffineTransform(scaleX: sample.lowRes, y: sample.lowRes))
        let up = down.transformed(by: CGAffineTransform(scaleX: 1 / sample.lowRes, y: 1 / sample.lowRes))
        ci = up.cropped(to: pageRect)
    }

    let finalExtent = ci.extent.isInfinite ? pageRect : ci.extent
    guard var out = context.createCGImage(ci, from: finalExtent) else { return image }

    if sample.jpeg < 1.0 {
        // A real JPEG round trip, not a filter that imitates one.
        let data = NSMutableData()
        if let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) {
            CGImageDestinationAddImage(dest, out, [kCGImageDestinationLossyCompressionQuality: sample.jpeg] as CFDictionary)
            if CGImageDestinationFinalize(dest),
               let src = CGImageSourceCreateWithData(data as CFData, nil),
               let decoded = CGImageSourceCreateImageAtIndex(src, 0, nil) {
                out = decoded
            }
        }
    }
    return out
}

func writePNG(_ image: CGImage, to url: URL) {
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
}

func runRender(_ outDir: String) throws {
    let dir = URL(fileURLWithPath: outDir)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var index: [[String: Any]] = []
    for sample in samples {
        let page = degrade(renderPage(sample), sample)
        let png = dir.appendingPathComponent("\(sample.id).png")
        writePNG(page, to: png)
        let truth = dir.appendingPathComponent("\(sample.id).txt")
        try sample.text.write(to: truth, atomically: true, encoding: .utf8)
        index.append([
            "id": sample.id, "label": sample.label,
            "kind": sample.handwritingFont == nil ? "printed" : "synthetic-handwriting",
            "image": png.lastPathComponent, "truth": truth.lastPathComponent,
            "width": page.width, "height": page.height,
        ])
        print("rendered \(sample.id)  \(page.width)x\(page.height)  — \(sample.label)")
    }
    let json = try JSONSerialization.data(withJSONObject: index, options: [.prettyPrinted, .sortedKeys])
    try json.write(to: dir.appendingPathComponent("index.json"))
    print("\n\(samples.count) printed samples written to \(outDir)")
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

func runOCR(_ path: String, level: String, correction: Bool, revision: Int, langs: [String]) throws {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        throw NSError(domain: "ocrlab", code: 2, userInfo: [NSLocalizedDescriptionKey: "cannot read \(path)"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = level == "fast" ? .fast : .accurate
    request.usesLanguageCorrection = correction
    request.revision = revision
    if !langs.isEmpty { request.recognitionLanguages = langs }

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    let started = DispatchTime.now()
    try handler.perform([request])
    let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000

    var lines: [[String: Any]] = []
    for case let observation as VNRecognizedTextObservation in request.results ?? [] {
        guard let best = observation.topCandidates(1).first else { continue }
        lines.append([
            "text": best.string,
            "confidence": best.confidence,
            "box": ["x": observation.boundingBox.origin.x, "y": observation.boundingBox.origin.y,
                    "w": observation.boundingBox.width, "h": observation.boundingBox.height],
        ])
    }

    let out: [String: Any] = [
        "image": path,
        "engine": "AppleVision",
        "revision": revision,
        "level": level,
        "languageCorrection": correction,
        "languages": langs,
        "imageWidth": image.width,
        "imageHeight": image.height,
        "elapsedMs": elapsedMs,
        "lineCount": lines.count,
        "lines": lines,
        "text": lines.compactMap { $0["text"] as? String }.joined(separator: "\n"),
    ]
    let json = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(json)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

// ---------------------------------------------------------------------------

let args = CommandLine.arguments
func flag(_ name: String, _ fallback: String) -> String {
    guard let i = args.firstIndex(of: "--\(name)"), i + 1 < args.count else { return fallback }
    return args[i + 1]
}

do {
    guard args.count >= 3 else {
        print("usage: ocrlab render <outdir> | ocrlab ocr <image> [--level accurate|fast] [--correction on|off] [--revision 1|2|3] [--langs en-US]")
        exit(64)
    }
    switch args[1] {
    case "render":
        try runRender(args[2])
    case "ocr":
        try runOCR(args[2],
                   level: flag("level", "accurate"),
                   correction: flag("correction", "on") == "on",
                   revision: Int(flag("revision", "3")) ?? 3,
                   langs: flag("langs", "en-US").split(separator: ",").map(String.init))
    default:
        print("unknown command \(args[1])")
        exit(64)
    }
} catch {
    FileHandle.standardError.write("ocrlab error: \(error)\n".data(using: .utf8)!)
    exit(1)
}
