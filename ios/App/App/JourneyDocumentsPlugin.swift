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
    /// Must match MAX_PICKED_FILE_BYTES in src/platform/file-limits.ts.
    private let maxPickedBytes = 64 * 1024 * 1024
    public let identifier = "JourneyDocumentsPlugin"
    public let jsName = "JourneyDocuments"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareDocument", returnType: CAPPluginReturnPromise)
    ]

    /// The in-flight call, so the delegate can resolve it.
    private var pendingCall: CAPPluginCall?
    /// Where a staged export currently lives, so it can be cleaned up.
    private var stagedURL: URL?
    /// Where a staged share currently lives. Separate from `stagedURL`: an
    /// export and a share can be staged at once, and one finishing must not
    /// delete the other's file out from under the system.
    private var sharedURL: URL?

    private enum PickReadError: Error {
        case tooLarge
        case unreadable
    }

    /// Read incrementally so a provider with missing or incorrect size
    /// metadata cannot make `Data(contentsOf:)` allocate an unbounded file.
    private func readPickedData(from url: URL) throws -> Data {
        guard let stream = InputStream(url: url) else { throw PickReadError.unreadable }
        stream.open()
        defer { stream.close() }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? PickReadError.unreadable }
            if count == 0 { break }
            if data.count > maxPickedBytes - count { throw PickReadError.tooLarge }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }

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

    // MARK: - Share

    /**
     * Hand one prepared page to the system share sheet.
     *
     * The third verb, and the last this file should ever grow. Where
     * `saveDocument` asks "where do you want to keep this", a share asks "who
     * do you want to send this to" — different questions, so a different
     * controller, and the application still never learns the answer to either.
     *
     * One item, built above this line and already filtered by what the reader
     * ticked. Nothing here reads the journal, opens a database, or knows what a
     * reflection is; it receives bytes and a filename.
     *
     * `shared` means what `Sharer` says it means: "`shared: false` is an
     * ordinary outcome, not an error". iOS tells us whether the sheet completed,
     * so this reports it honestly rather than claiming success for a sheet the
     * reader dismissed — which is the one place this implementation is
     * deliberately better informed than Android's, where the platform never
     * says.
     */
    @objc func shareDocument(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let text = call.getString("text")
        let name = call.getString("name")
        let mimeType = call.getString("mimeType")
        let base64 = call.getString("base64")

        let item: ShareItem

        if let name, !name.isEmpty, let base64, !base64.isEmpty,
           let data = Data(base64Encoded: base64) {
            // A file. Staged under the caches directory for the same reason an
            // export is: it is a hand-off buffer the system may reclaim, it is
            // not the reader's copy, and it is not in Documents where a backup
            // would sweep it up.
            let staged = FileManager.default.temporaryDirectory
                .appendingPathComponent("share", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: staged, withIntermediateDirectories: true)
                // At most one share in flight. Anything older is from a sheet
                // that has already closed.
                try? cleanDirectory(staged)
                let fileURL = staged.appendingPathComponent(name)
                try data.write(to: fileURL, options: .atomic)
                self.sharedURL = fileURL
                item = ShareItem(url: fileURL, subject: title, mimeType: mimeType)
            } catch {
                call.reject("That page could not be prepared for sharing.")
                return
            }
        } else if let text, !text.isEmpty {
            item = ShareItem(text: text, subject: title)
        } else {
            call.reject("There was nothing to share.")
            return
        }

        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                self.discardShared()
                call.reject("There is no window to share from.")
                return
            }

            let sheet = UIActivityViewController(activityItems: [item], applicationActivities: nil)
            sheet.completionWithItemsHandler = { [weak self] _, completed, _, _ in
                // The copy the system took is its own now; ours is a buffer and
                // goes whether the reader sent it or changed their mind.
                self?.discardShared()
                call.resolve(["shared": completed])
            }

            // An iPad presents this as a popover and raises if it has no anchor
            // to point at. iPhone ignores all of it.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(
                    x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }

            presenter.present(sheet, animated: true)
        }
    }

    /// Drop the staged share copy once the sheet has finished with it.
    fileprivate func discardShared() {
        if let url = sharedURL {
            try? FileManager.default.removeItem(at: url)
            sharedURL = nil
        }
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
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            if let size = values.fileSize, size > maxPickedBytes {
                call.reject("That file is larger than the 64MB import limit and was not read.")
                return
            }
            let data = try readPickedData(from: url)
            call.resolve([
                "cancelled": false,
                "name": url.lastPathComponent,
                "base64": data.base64EncodedString()
            ])
        } catch PickReadError.tooLarge {
            call.reject("That file is larger than the 64MB import limit and was not read.")
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

/**
 * One thing to share, and what the system should call it.
 *
 * A bare `URL` or `String` in the activity items array would share correctly
 * and arrive with no subject, so a mailed entry would have an empty subject
 * line. `UIActivityItemSource` is the public way to supply one, and it keeps
 * the item itself unchanged — a file URL is still a file URL, so the filename
 * and the type travel with it rather than being described separately.
 *
 * Deliberately dumb. It holds what it was handed and answers three questions
 * about it. It does not read the file, inspect the text, or know that either
 * came from a journal.
 */
final class ShareItem: NSObject, UIActivityItemSource {
    private let item: Any
    private let subject: String
    private let mimeType: String?

    init(url: URL, subject: String, mimeType: String?) {
        self.item = url
        self.subject = subject
        self.mimeType = mimeType
    }

    init(text: String, subject: String) {
        self.item = text
        self.subject = subject
        self.mimeType = nil
    }

    func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any {
        // The placeholder only tells the sheet what KIND of thing is coming, so
        // it can decide which activities to offer before the real item is asked
        // for. Returning the item itself is correct and cheap here: both a file
        // URL and a short string are already in hand.
        item
    }

    func activityViewController(
        _ controller: UIActivityViewController,
        itemForActivityType activityType: UIActivity.ActivityType?
    ) -> Any? {
        item
    }

    func activityViewController(
        _ controller: UIActivityViewController,
        subjectForActivityType activityType: UIActivity.ActivityType?
    ) -> String {
        subject
    }

    /**
     * The type, stated rather than guessed.
     *
     * iOS infers a type from the file extension and usually gets it right. The
     * caller already knows it, so saying so removes the inference — and for the
     * text case there is no extension to infer from at all.
     */
    func activityViewController(
        _ controller: UIActivityViewController,
        dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?
    ) -> String {
        if let mimeType, let type = UTType(mimeType: mimeType) {
            return type.identifier
        }
        if let url = item as? URL, let type = UTType(filenameExtension: url.pathExtension) {
            return type.identifier
        }
        return UTType.plainText.identifier
    }
}
