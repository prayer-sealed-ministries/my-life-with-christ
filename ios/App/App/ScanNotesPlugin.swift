import Capacitor
import Foundation
import UIKit
import Vision
import VisionKit

/**
 Scan notes, on this device.

 Apple Vision reads the page. Nothing leaves the phone: there is no URLSession
 here, no endpoint, and no fallback. If Vision cannot read the page, the answer
 is that it could not read the page.

 Configuration is the one the benchmark chose, and the reasoning is worth
 keeping next to the code:

   `.accurate` — the fast path was not measured as adequate for notes.

   `usesLanguageCorrection = false` — correction changed nothing on clean pages
   and, on degraded ones, substituted plausible wrong words ("khn 3:16" became
   "she 3:16") and dropped whole lines, while costing ~57% more time. A journal
   that preserves people's words must not let the recogniser guess; the person
   reviews the text anyway.

 Temporary scans live in a dedicated directory inside the app's caches, with
 random names. They are deleted on discard, and any left by a run that crashed
 are swept at launch. A photo the person picked from their own library is never
 touched — only our copy of it.
 */
@objc(ScanNotesPlugin)
public class ScanNotesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScanNotesPlugin"
    public let jsName = "ScanNotes"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "choose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognise", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cleanupStale", returnType: CAPPluginReturnPromise),
    ]

    /// Our own corner of the cache. Never the shared container, never Documents.
    private static let directoryName = "scan-notes"
    /// A scan older than this is certainly abandoned.
    private static let staleAfter: TimeInterval = 60 * 60 * 6
    /// Beyond this the image is downscaled before recognition; see `normalise`.
    private static let maxWorkingDimension: CGFloat = 2600
    /// Refuse absurd input before decoding it.
    private static let maxSourceBytes = 40 * 1024 * 1024

    private var pendingCall: CAPPluginCall?

    // MARK: - Temporary storage

    private func scanDirectory() throws -> URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let directory = caches.appendingPathComponent(Self.directoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /**
     A random name, carrying nothing about the page.

     No entry title, no date, no Scripture, nothing a file listing could reveal
     about what somebody photographed.
     */
    private func newHandle() -> String { UUID().uuidString }

    private func url(for handle: String) throws -> URL? {
        // A handle is a UUID and nothing else, so a crafted value cannot walk
        // out of our directory.
        guard UUID(uuidString: handle) != nil else { return nil }
        return try scanDirectory().appendingPathComponent("\(handle).jpg")
    }

    // MARK: - Capture and choose

    @objc func capture(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                call.resolve(["failure": "unsupported"])
                return
            }
            self.pendingCall = call
            if VNDocumentCameraViewController.isSupported {
                // The system document scanner gives edge detection, perspective
                // correction, cropping and retake without a custom camera.
                let scanner = VNDocumentCameraViewController()
                scanner.delegate = self
                self.bridge?.viewController?.present(scanner, animated: true)
            } else {
                let picker = UIImagePickerController()
                picker.sourceType = .camera
                picker.delegate = self
                self.bridge?.viewController?.present(picker, animated: true)
            }
        }
    }

    @objc func choose(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingCall = call
            // The photo library picker hands over only what was selected. The
            // app never gains access to the library itself.
            let picker = UIImagePickerController()
            picker.sourceType = .photoLibrary
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    // MARK: - Recognition

    @objc func recognise(_ call: CAPPluginCall) {
        // `try?` on a throwing function that already returns URL? flattens to a
        // single optional, so one unwrap is both necessary and sufficient.
        guard let handle = call.getString("handle"),
              let location = try? url(for: handle),
              FileManager.default.fileExists(atPath: location.path) else {
            call.resolve(["failure": "failed"])
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: location.path),
                  let size = attributes[.size] as? Int, size <= Self.maxSourceBytes,
                  let image = UIImage(contentsOfFile: location.path),
                  let cgImage = self.normalise(image)?.cgImage else {
                call.resolve(["failure": "unreadable"])
                return
            }

            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            // Measured, not assumed. See the note at the top of this file.
            request.usesLanguageCorrection = false
            request.recognitionLanguages = ["en-US"]

            let started = DispatchTime.now()
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                call.resolve(["failure": "failed"])
                return
            }
            let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000

            var lines: [[String: Any]] = []
            var joined: [String] = []
            for observation in request.results ?? [] {
                guard let best = observation.topCandidates(1).first else { continue }
                joined.append(best.string)
                lines.append([
                    "text": best.string,
                    "confidence": best.confidence,
                    // Vision reports a bottom-left origin; the shared layer and
                    // the review screen use top-left, so convert here rather
                    // than leak a platform convention upwards.
                    "box": [
                        "x": observation.boundingBox.origin.x,
                        "y": 1 - observation.boundingBox.origin.y - observation.boundingBox.height,
                        "width": observation.boundingBox.width,
                        "height": observation.boundingBox.height,
                    ],
                ])
            }

            // Deliberately no logging of recognised text anywhere in this file.
            call.resolve([
                "text": joined.joined(separator: "\n"),
                "lines": lines,
                "imageWidth": cgImage.width,
                "imageHeight": cgImage.height,
                "engine": "AppleVision",
                "elapsedMs": elapsedMs,
            ])
        }
    }

    /**
     Hold the working image to a sane size.

     Recognition stayed at 0.00% character error through 0.28x downscaling in
     the benchmark, so there is no accuracy reason to decode a 48-megapixel
     photograph at full resolution, and a good memory reason not to.
     */
    private func normalise(_ image: UIImage) -> UIImage? {
        let longest = max(image.size.width, image.size.height)
        guard longest > Self.maxWorkingDimension else { return image.fixedOrientation() }
        let scale = Self.maxWorkingDimension / longest
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    // MARK: - Cleanup

    @objc func discard(_ call: CAPPluginCall) {
        if let handle = call.getString("handle"), let location = try? url(for: handle) {
            try? FileManager.default.removeItem(at: location)
        }
        call.resolve()
    }

    @objc func cleanupStale(_ call: CAPPluginCall) {
        var removed = 0
        if let directory = try? scanDirectory(),
           let entries = try? FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) {
            for entry in entries {
                let modified = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
                if let modified, Date().timeIntervalSince(modified) > Self.staleAfter {
                    if (try? FileManager.default.removeItem(at: entry)) != nil { removed += 1 }
                }
            }
        }
        call.resolve(["removed": removed])
    }

    // MARK: - Shared result handling

    fileprivate func finish(with image: UIImage?) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let image, let prepared = normalise(image), let data = prepared.jpegData(compressionQuality: 0.92) else {
            call.resolve(["failure": "unreadable"])
            return
        }
        do {
            let handle = newHandle()
            guard let location = try url(for: handle) else {
                call.resolve(["failure": "failed"])
                return
            }
            try data.write(to: location, options: .completeFileProtection)
            call.resolve([
                "handle": handle,
                // A data URL, so the review screen never receives a file path.
                "preview": "data:image/jpeg;base64,\(data.base64EncodedString())",
                "width": Int(prepared.size.width),
                "height": Int(prepared.size.height),
                "blurScore": prepared.blurScore(),
            ])
        } catch {
            call.resolve(["failure": "failed"])
        }
    }

    fileprivate func cancel() {
        pendingCall?.resolve(["failure": "cancelled"])
        pendingCall = nil
    }
}

// MARK: - Picker delegates

extension ScanNotesPlugin: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        picker.dismiss(animated: true)
        finish(with: info[.originalImage] as? UIImage)
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        cancel()
    }
}

extension ScanNotesPlugin: VNDocumentCameraViewControllerDelegate {
    public func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFinishWith scan: VNDocumentCameraScan
    ) {
        controller.dismiss(animated: true)
        // One page in v1. The scanner already cropped and straightened it.
        finish(with: scan.pageCount > 0 ? scan.imageOfPage(at: 0) : nil)
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        cancel()
    }

    public func documentCameraViewController(
        _ controller: VNDocumentCameraViewController,
        didFailWithError error: Error
    ) {
        controller.dismiss(animated: true)
        pendingCall?.resolve(["failure": "failed"])
        pendingCall = nil
    }
}

// MARK: - Image helpers

private extension UIImage {
    /// Redraw so the pixels match what the camera showed, dropping EXIF rotation.
    func fixedOrientation() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = scale
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: size))
        }
    }

    /**
     A rough variance-of-Laplacian focus score.

     Only ever used to decide whether to OFFER a warning. Blur was the single
     catastrophic failure in the benchmark, so it is worth telling someone
     before they discover it in the transcription — but a score is not a
     verdict, and the person may always proceed.
     */
    func blurScore() -> Double {
        guard let cgImage else { return 1000 }
        let width = min(cgImage.width, 512)
        let height = max(1, Int(Double(cgImage.height) * (Double(width) / Double(cgImage.width))))
        var grey = [UInt8](repeating: 0, count: width * height)
        guard let context = CGContext(
            data: &grey, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return 1000 }
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        var values: [Double] = []
        values.reserveCapacity((width - 2) * (height - 2))
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let i = y * width + x
                let laplacian = -4.0 * Double(grey[i])
                    + Double(grey[i - 1]) + Double(grey[i + 1])
                    + Double(grey[i - width]) + Double(grey[i + width])
                values.append(laplacian)
            }
        }
        guard !values.isEmpty else { return 1000 }
        let mean = values.reduce(0, +) / Double(values.count)
        return values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count)
    }
}
