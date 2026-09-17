import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/**
 * The native document bridge for iOS.
 *
 * Two verbs, and deliberately no more: hand the user bytes and let them choose
 * where the file goes, and let them choose a file and hand us its bytes.
 *
 * This file knows nothing about journals or archives. It moves bytes and a
 * filename. The canonical archive — manifest, checksums, schema, the book — is
 * built and parsed entirely in shared TypeScript, so there is one implementation
 * of the format across every edition. Nothing here may grow an opinion about it.
 *
 * `UIDocumentPickerViewController` in export mode is used rather than a share
 * sheet. Both can end with the file in Files, but the share sheet's question is
 * "send a copy to an app" while the document picker's is "put this document
 * where you want it" — and ownership of the archive is the entire promise being
 * kept here.
 */
@objc(JourneyDocumentsPlugin)
public class JourneyDocumentsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JourneyDocumentsPlugin"
    public let jsName = "JourneyDocuments"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickDocument", returnType: CAPPluginReturnPromise)
    ]

    /// The in-flight call, so the delegate can resolve it.
    private var pendingCall: CAPPluginCall?
    /// Where a staged export currently lives, so it can be cleaned up.
    private var stagedURL: URL?

    // MARK: - Save

    @objc func saveDocument(_ call: CAPPluginCall) {
        guard let name = call.getString("name"),
              let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64) else {
            call.reject("A document needs a name and its bytes.")
            return
        }

        // The document picker exports a file URL, so the bytes are staged first.
        // Staging goes in the caches directory, not Documents: it is a hand-off
        // buffer, not the user's copy, and the system may reclaim it freely.
        // The name is the archive's own — no journal content is ever put in a
        // filename.
        let staged = FileManager.default.temporaryDirectory
            .appendingPathComponent("export", isDirectory: true)

        do {
            try FileManager.default.createDirectory(at: staged, withIntermediateDirectories: true)
            // Remove anything left from a previous export before writing a new
            // one: the staging area holds at most the export in progress.
            try? cleanDirectory(staged)

            let fileURL = staged.appendingPathComponent(name)
            try data.write(to: fileURL, options: .atomic)
            self.stagedURL = fileURL

            DispatchQueue.main.async {
                self.pendingCall = call
                let picker = UIDocumentPickerViewController(forExporting: [fileURL], asCopy: true)
                picker.delegate = self
                picker.modalPresentationStyle = .formSheet
                self.bridge?.viewController?.present(picker, animated: true)
            }
        } catch {
            call.reject("The archive could not be prepared for saving: \(error.localizedDescription)")
        }
    }

    // MARK: - Pick

    @objc func pickDocument(_ call: CAPPluginCall) {
        let types = contentTypes(from: call.getArray("mimeTypes", String.self))

        DispatchQueue.main.async {
            self.pendingCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            picker.modalPresentationStyle = .formSheet
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    /// Map the caller's hints to UTTypes, falling back to "any file".
    private func contentTypes(from hints: [String]?) -> [UTType] {
        guard let hints = hints, !hints.isEmpty else { return [UTType.item] }

        var types: [UTType] = []
        for hint in hints {
            if hint == "application/zip" || hint == ".zip" {
                types.append(UTType.zip)
            } else if hint.hasPrefix(".") {
                if let type = UTType(filenameExtension: String(hint.dropFirst())) {
                    types.append(type)
                }
            } else if let type = UTType(mimeType: hint) {
                types.append(type)
            }
        }
        // A picker with no types would show nothing at all, which looks like a
        // broken app rather than a filter that matched nothing.
        return types.isEmpty ? [UTType.item] : types
    }

    // MARK: - Staging hygiene

    private func cleanDirectory(_ directory: URL) throws {
        let contents = try FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil)
        for url in contents {
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// Drop the staged copy once the OS has taken what it needs.
    fileprivate func discardStaged() {
        if let url = stagedURL {
            try? FileManager.default.removeItem(at: url)
            stagedURL = nil
        }
    }
}

// MARK: - Picker delegate

extension JourneyDocumentsPlugin: UIDocumentPickerDelegate {
    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let call = pendingCall else { return }
        pendingCall = nil

        // Export mode: the OS has copied the file to where the user chose.
        if controller.documentPickerMode == .exportToService {
            discardStaged()
            call.resolve(["saved": true])
            return
        }

        guard let url = urls.first else {
            call.resolve(["cancelled": true])
            return
        }

        // A picked document may live outside our sandbox, which requires an
        // explicit security scope. Asking when it is not needed is harmless;
        // not asking when it is means an empty read on a file the user chose.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        do {
            let data = try Data(contentsOf: url)
            call.resolve([
                "cancelled": false,
                "name": url.lastPathComponent,
                "base64": data.base64EncodedString()
            ])
        } catch {
            call.reject("That file could not be read: \(error.localizedDescription)")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        discardStaged()

        // Backing out is an ordinary outcome, not a failure. Rejecting here
        // would surface an error to someone who simply changed their mind.
        if controller.documentPickerMode == .exportToService {
            call.resolve(["saved": false])
        } else {
            call.resolve(["cancelled": true])
        }
    }
}
