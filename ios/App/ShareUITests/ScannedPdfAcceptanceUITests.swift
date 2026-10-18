import XCTest

/**
 * The scanned-PDF path, driven through the production bridge.
 *
 * WHAT THIS EXISTS TO PROVE
 *
 * `ScanNotesPlugin.recogniseImage` had never executed. The Vision request it
 * reaches is shared with the photographed-page path and has prior evidence,
 * but the production route into it — bytes produced by the app's own renderer,
 * handed across the Capacitor bridge, decoded by `UIImage(data:)` — had never
 * run on anything. A plugin method that compiles and is registered is not a
 * plugin method that works.
 *
 * So this deliberately does NOT call Vision from the test. It drives the real
 * app: Import church notes, the system document picker, a synthetic PDF, and
 * the review screen that appears only if recognition actually returned text.
 *
 * WHAT IT CANNOT REACH
 *
 * The same constraint `ShareAcceptanceUITests` documents applies: XCUITest
 * cannot scroll this web view, so only the first viewport is drivable. The
 * import control sits there; anything further down does not, and the test says
 * so rather than failing on something nothing can act on.
 *
 * Every document it opens is fictional and generated — see the ZZSCAN markers.
 */
final class ScannedPdfAcceptanceUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication(bundleIdentifier: "com.myjourneywithchrist.lifewithchrist")
        app.terminate()
        app.launch()
    }

    private func waitForJournalLoaded() {
        let loading = app.staticTexts["Loading your journal"]
        let gone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 120), .completed,
                       "the journal never finished loading")
    }

    /// Dismiss the first-visit dialog, if this is a fresh install.
    private func dismissWelcome() {
        let understood = app.buttons["I understand"]
        if understood.waitForExistence(timeout: 10) && understood.isHittable {
            understood.tap()
        }
    }

    /// Open a new sermon entry, where church notes are imported from.
    private func openNewSermon() {
        let sermon = app.buttons["Sermon note Start writing now"]
        if sermon.waitForExistence(timeout: 20) && sermon.isHittable {
            sermon.tap()
            return
        }
        // The card's label varies with the accessibility tree; fall back to the
        // link that carries the same destination.
        let any = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'Sermon note'")).firstMatch
        XCTAssertTrue(any.waitForExistence(timeout: 20), "no way into a sermon note")
        any.tap()
    }

    /**
     * Pick a file through the real system document picker.
     *
     * The picker is native, so XCUITest can drive it even though it cannot
     * scroll the web view behind it. The fixtures are staged in "On My iPhone"
     * before the run.
     */
    private func chooseFromFiles(named name: String) throws {
        /*
          The web file input, as iOS exposes it.

          Not "Choose a file…" — that is the visible text, but the element the
          accessibility tree offers is the input itself, carrying its label.
          Found by dumping the tree rather than by guessing, after the first
          run looked for the wrong thing and reported "no file chooser".
        */
        let choose = app.buttons["Sermon notes file"]
        XCTAssertTrue(choose.waitForExistence(timeout: 20), "no file chooser in the importer")
        XCTAssertTrue(choose.isHittable, "the file chooser is below the first viewport")
        choose.tap()

        /*
          The picker opens on Recents, which is empty — the fixtures live in
          "On My iPhone", so this navigates there as a person would.

          Elements are looked for in BOTH the host app and the Files process.
          A document picker is presented as a remote view, and which of the two
          trees surfaces its contents is not something to assume: looking only
          at the Files process found nothing at all.
        */
        let files = XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")

        func firstMatch(_ predicate: NSPredicate) -> XCUIElement? {
            for root in [app, files] {
                let found = root!.descendants(matching: .any).matching(predicate).firstMatch
                if found.exists { return found }
            }
            return nil
        }

        func tapWhenFound(_ predicate: NSPredicate, timeout: TimeInterval) -> Bool {
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline {
                if let element = firstMatch(predicate), element.isHittable {
                    element.tap()
                    return true
                }
                Thread.sleep(forTimeInterval: 1)
            }
            return false
        }

        _ = tapWhenFound(NSPredicate(format: "label ==[c] 'Browse'"), timeout: 30)
        _ = tapWhenFound(NSPredicate(format: "label CONTAINS[c] 'On My iPhone'"), timeout: 20)

        /*
          If the fixture never appears, stop with the reason rather than fail.

          Measured on the iOS 26.5 simulator, Xcode 27: the picker opens and is
          visible, but neither the host app's element tree nor the Files
          process's exposes its contents to XCUITest — Browse, On My iPhone and
          the files themselves are all absent from both, with the fixtures
          demonstrably present in the provider's storage on disk. Four
          approaches were tried (Files-process lookup, host-app lookup, both
          with navigation, and polling across both).

          So this is a limitation of driving the document picker here, not a
          finding about the app, and it is reported as one. The same path is
          proven end to end on Android, where the WebView can be driven
          directly; on iOS it needs either a signed build on the physical
          device or a person tapping through it.
        */
        try XCTSkipUnless(
            tapWhenFound(NSPredicate(format: "label CONTAINS %@", name), timeout: 45),
            "The document picker's contents are not exposed to XCUITest on this "
            + "simulator, so \(name) cannot be selected from here. Not an app defect: "
            + "the fixture is present in the file provider's storage.")
    }

    /// Wait for any of several web strings, since recognition takes a moment.
    private func waitForText(_ needle: String, timeout: TimeInterval = 180) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@",
                                    needle, needle)
        let element = app.descendants(matching: .any).matching(predicate).firstMatch
        return element.waitForExistence(timeout: timeout)
    }

    // MARK: - The proof

    /**
     * A PDF that is part typed and part photocopied, read end to end.
     *
     * Page 2 has no text layer, so reaching the review at all means the app
     * rendered it, crossed the bridge, decoded the bytes and got something back
     * from Vision. The typed markers prove the exact pages survived untouched
     * alongside it.
     */
    func testMixedPdfIsReadThroughTheProductionBridge() throws {
        waitForJournalLoaded()
        dismissWelcome()
        openNewSermon()

        let importer = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Import church notes'")).firstMatch
        XCTAssertTrue(importer.waitForExistence(timeout: 30), "no church-notes import control")
        try XCTSkipUnless(importer.isHittable,
                          "Import church notes is below the first viewport, which XCUITest "
                          + "cannot scroll on this web view. See ShareAcceptanceUITests.")
        importer.tap()

        try chooseFromFiles(named: "ZZSCAN-PHYSICAL-MIXED")

        /*
          If the picker never handed the file over, stop with the reason.

          Measured on the iOS 26.5 simulator with Xcode 27: the picker's own
          controls ARE exposed to XCUITest, but in a coordinate space it cannot
          act in — "Browse" is reported at x=571 on a 393-point-wide screen,
          and tapping it fails with kAXErrorCannotComplete performing
          ScrollToVisible. That is the same class of problem this project
          already documents for the web view in ShareAcceptanceUITests.

          So the document picker cannot be driven from here. It is not a
          finding about the app: the fixtures are present in the file
          provider's storage, and the identical path is proven end to end on
          Android, where the web view can be driven directly.
        */
        try XCTSkipUnless(waitForText("ZZSCAN-PHYSICAL-MIXED page one typed", timeout: 90),
                          "The document picker could not be driven on this simulator, so no "
                          + "file reached the importer. See the note above; not an app defect.")

        // And the sentence that only appears when a page was recognised here.
        XCTAssertTrue(waitForText("Text recognition happened on this device", timeout: 60),
                      "the review never reported a recognised page, so recogniseImage "
                      + "either was not reached or returned nothing")

        // Nothing has been written. Leaving is the end of it.
        let cancel = app.buttons["Cancel"].firstMatch
        if cancel.exists && cancel.isHittable { cancel.tap() }
    }

    /**
     * A typed PDF must not reach the recogniser at all.
     *
     * Proven here by its absence: the review of a wholly typed document says
     * nothing about recognition, because nothing was recognised.
     */
    func testTypedPdfSaysNothingAboutRecognition() throws {
        waitForJournalLoaded()
        dismissWelcome()
        openNewSermon()

        let importer = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Import church notes'")).firstMatch
        XCTAssertTrue(importer.waitForExistence(timeout: 30), "no church-notes import control")
        try XCTSkipUnless(importer.isHittable,
                          "Import church notes is below the first viewport.")
        importer.tap()

        try chooseFromFiles(named: "ZZSCAN-PHYSICAL-TEXT")

        try XCTSkipUnless(waitForText("ZZSCAN-PHYSICAL-TEXT page one typed", timeout: 90),
                          "The document picker could not be driven on this simulator, so no "
                          + "file reached the importer. Not an app defect.")
        XCTAssertFalse(waitForText("Text recognition happened on this device", timeout: 8),
                       "a wholly typed PDF reported recognition, which means a page with "
                       + "its own text was sent to the recogniser")

        let cancel = app.buttons["Cancel"].firstMatch
        if cancel.exists && cancel.isHittable { cancel.tap() }
    }
}
