import XCTest

/**
 * Physical-device coverage for the editor that feeds Share This Entry.
 *
 * The app is a web view in a native shell, so this drives real HTML through the
 * accessibility tree the way a person drives it with VoiceOver: by label, never
 * by coordinate. It targets the installed app by bundle identifier, so what is
 * exercised is the artefact that was actually signed and installed.
 *
 * WHAT THIS CANNOT REACH, AND WHY IT STOPS WHERE IT DOES
 *
 * XCUITest cannot scroll this web view. Measured on an iPhone 12 (iOS 18.6.2,
 * Xcode 27) three ways — swipeUp(), a press-drag, and the documented
 * press(forDuration:thenDragTo:withVelocity:thenHoldForDuration:) — and in
 * every case nothing moved: an element at the top of the page stayed hittable
 * with an unchanged frame, a button at document y=1350 stayed hittable=false,
 * and screen-point taps swept down the whole display reached none of it. The
 * web view exposes no scroll view at all (app.scrollViews.count == 0).
 *
 * Compounding it, a web element's frame here is reported in DOCUMENT
 * coordinates and does not change as the page scrolls, so position cannot be
 * used to reason about what is on screen either.
 *
 * Taps and typing work normally. The consequence is that anything below the
 * first viewport — Save, "Share this entry", the share surface, both system
 * share sheets, "Discard draft" — cannot be driven from here. Those steps are
 * covered by docs/IOS-SHARE-ACCEPTANCE.md instead.
 *
 * So this test asserts everything it can genuinely reach, then skips with that
 * reason rather than reporting a failure nothing can act on. Recorded
 * 2026-10-06.
 *
 * One contrast matters when reading the helpers: the option list iOS presents
 * for a <select> is a NATIVE collection view, and scrolling that works
 * perfectly. It is only web content that cannot be scrolled.
 */
final class ShareAcceptanceUITests: XCTestCase {
    private var app: XCUIApplication!

    // Synthetic markers. Unmistakable, and nothing a person would ever write.
    private let title = "ZZSHARE-TITLE"
    private let notes = "ZZSHARE-NOTES"
    private let reflection = "ZZSHARE-REFLECTION"
    private let prayer = "ZZSHARE-PRAYER"
    private let verse = "John 3:16"
    private let passage = "John 3:16-18"

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication(bundleIdentifier: "com.myjourneywithchrist.lifewithchrist")
        // A cold start, not an activation: launching an app that is already
        // running leaves it on whatever screen it was last on, and this test
        // begins from the home screen.
        app.terminate()
        app.launch()
    }

    // MARK: - Readiness

    /// The home screen renders before the journal has opened, and a tap landing
    /// in that window hits a link whose handler is not attached yet — which is
    /// how the first run of this test silently stayed on the home screen.
    private func waitForJournalLoaded() {
        let loading = app.staticTexts["Loading your journal"]
        let gone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 90), .completed,
                       "the journal never finished loading")
    }

    /// Put the software keyboard away before touching anything.
    ///
    /// `isHittable` does NOT account for the keyboard: XCUITest will happily
    /// "tap" a field the keyboard is sitting on top of, and the keystrokes then
    /// go nowhere — "neither element nor any descendant has keyboard focus" —
    /// with no indication that anything was in the way. With the keyboard down,
    /// hittability becomes a truthful oracle again.
    ///
    /// It is dismissed by tapping the banner's tagline: ordinary page text at
    /// the top of the document that cannot navigate anywhere, so it is always
    /// reachable and blurs whatever had focus.
    private func dismissKeyboard() {
        guard app.keyboards.firstMatch.exists else { return }

        let tagline = app.staticTexts["Your walk, remembered."]
        guard tagline.exists && tagline.isHittable else { return }
        tagline.tap()

        let gone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        _ = XCTWaiter.wait(for: [gone], timeout: 10)
    }

    /// Anything below the first viewport is unreachable here — see the note at
    /// the top of this file — so a control that exists but will not take a tap
    /// says so in those terms rather than looking like a flake.
    private func requireReachable(_ element: XCUIElement, _ what: String) {
        XCTAssertTrue(
            element.isHittable,
            "\(what) exists but is not reachable. Web content below the first "
            + "viewport cannot be tapped, and this web view cannot be scrolled.")
    }

    private func tapWhenReady(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 30) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(what) never appeared")
        dismissKeyboard()
        requireReachable(element, what)
        element.tap()
    }

    private func tapButton(_ label: String, _ what: String, timeout: TimeInterval = 30) {
        let query = app.buttons.matching(NSPredicate(format: "label == %@", label))
        XCTAssertTrue(query.firstMatch.waitForExistence(timeout: timeout), "\(what) never appeared")
        dismissKeyboard()
        // A control can appear more than once; take whichever copy is reachable.
        for element in query.allElementsBoundByIndex where element.exists && element.isHittable {
            element.tap()
            return
        }
        let states = query.allElementsBoundByIndex.map {
            "enabled=\($0.isEnabled) hittable=\($0.isHittable) frame=\($0.frame)"
        }
        XCTFail("\(what) is not reachable (web content below the first viewport): \(states)")
    }

    private func type(into element: XCUIElement, _ text: String, _ what: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 30), "\(what) never appeared")
        dismissKeyboard()
        requireReachable(element, what)
        element.tap()
        // Focus arrives with the keyboard; typing before it does throws.
        _ = app.keyboards.firstMatch.waitForExistence(timeout: 10)
        element.typeText(text)
    }

    // MARK: - Finding web controls

    /// Web content does not always land in the element type you would expect: a
    /// <summary> is not a static text, and its name carries the hint text after
    /// it. Match on a name prefix, across the types it could be.
    private func webControl(_ prefix: String, _ what: String) -> XCUIElement {
        find(prefix, what, in: [app.buttons, app.staticTexts, app.links, app.otherElements])
    }

    private func find(_ prefix: String, _ what: String, in queries: [XCUIElementQuery]) -> XCUIElement {
        let predicate = NSPredicate(format: "label BEGINSWITH %@", prefix)
        for query in queries {
            let candidate = query.matching(predicate).firstMatch
            if candidate.waitForExistence(timeout: 3) { return candidate }
        }
        XCTFail("\(what) was not found under any element type")
        return queries[0].matching(predicate).firstMatch
    }

    /// A <select>. WebKit exposes it as a generic element, and BOTH the <label>
    /// and the control itself carry the same name, with the label first. While
    /// the select shows its blank placeholder it has no value to tell the two
    /// apart — and picking the label then drove the wrong element, which
    /// surfaced one picker later as "To verse still reads Verse first". The
    /// control is the last of the pair.
    private func selectControl(_ label: String) -> XCUIElement {
        let candidates = app.otherElements
            .matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex
        for element in candidates where !((element.value as? String) ?? "").isEmpty {
            return element
        }
        return candidates.last ?? app.otherElements[label]
    }

    // MARK: - Driving a <select>

    private func choose(_ value: String, from label: String) {
        dismissKeyboard()
        let control = selectControl(label)

        // Chapter, Verse and To verse only fill in once the control before them
        // has been chosen, and tapping one while it still reads "Chapter first"
        // opens nothing at all.
        let placeholders = ["Book first", "Chapter first", "Verse first", ""]
        for _ in 0..<40 where placeholders.contains((control.value as? String) ?? "") {
            Thread.sleep(forTimeInterval: 0.5)
        }

        for _ in 0..<2 {
            if openList(for: control) && pick(value, from: label) {
                for _ in 0..<24 {
                    if (control.value as? String) == value { return }
                    Thread.sleep(forTimeInterval: 0.25)
                }
            }
        }
        XCTFail("\(label) still reads \(String(describing: control.value)) after choosing \(value)")
    }

    /// Tap a <select> open and wait for the option list iOS presents for it.
    private func openList(for control: XCUIElement) -> Bool {
        let list = app.collectionViews.firstMatch
        if list.exists { return true }
        control.tap()
        if list.waitForExistence(timeout: 8) { return true }
        // The first tap can land while the control is still being re-rendered
        // by the choice before it.
        control.tap()
        return list.waitForExistence(timeout: 15)
    }

    /// Steer to an option and tap it.
    ///
    /// This list is a native collection view, so scrolling it genuinely works —
    /// unlike the web content around it. It is virtualised and taller than the
    /// screen, so an option far down it has to be scrolled to before it exists
    /// at all, and the list opens scrolled to whatever is already selected, so
    /// an earlier option lies ABOVE the fold. Sweeping only downwards reported
    /// verse 1 as "never reachable" from a list sitting on verse 16; hence two
    /// sweeps, one each way.
    private func pick(_ value: String, from label: String) -> Bool {
        let list = app.collectionViews.firstMatch
        let option = list.buttons[value]
        let screen = app.windows.firstMatch.frame
        let high = app.coordinate(withNormalizedOffset: CGVector(dx: 0.33, dy: 0.45))
        let low = app.coordinate(withNormalizedOffset: CGVector(dx: 0.33, dy: 0.60))

        for sweep in 0..<2 {
            for _ in 0..<40 {
                if option.exists {
                    if option.isHittable {
                        option.tap()
                        return true
                    }
                    if option.frame.midY >= screen.maxY - 40 {
                        low.press(forDuration: 0.05, thenDragTo: high)
                    } else {
                        high.press(forDuration: 0.05, thenDragTo: low)
                    }
                } else if sweep == 0 {
                    list.swipeUp()
                } else {
                    list.swipeDown()
                }
            }
        }
        XCTFail("\(value) was never reachable in the \(label) list")
        return false
    }

    /// Choose a verse and prove the FORM took it, not merely the select.
    ///
    /// The select can report the value just chosen while the form behind it has
    /// registered no change at all. Because "To verse" and "Add verse" are both
    /// gated on that state, the symptom surfaces one control later as "To verse
    /// still reads Verse first" — a confusing place to debug the Verse picker
    /// from. "Add verse" is disabled whenever the form has no verse, so its
    /// enabled state is the honest reading, and re-picking through a
    /// neighbouring verse forces a real change through.
    private func chooseVerse(_ value: String) {
        let add = app.buttons["Add verse"]
        choose(value, from: "Verse")
        if add.exists && add.isEnabled { return }

        let detour = Int(value).map { String($0 == 1 ? 2 : $0 - 1) } ?? "1"
        choose(detour, from: "Verse")
        choose(value, from: "Verse")
        XCTAssertTrue(add.exists && add.isEnabled,
                      "the form did not register verse \(value)")
    }

    // MARK: - The test

    func testTheEditorAcceptsEverythingAShareNeeds() throws {
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 60), "app never foregrounded")

        let understand = app.buttons["I understand"]
        if understand.waitForExistence(timeout: 5) { understand.tap() }
        waitForJournalLoaded()

        // 1 — a new sermon entry, from the home screen.
        tapWhenReady(app.links["Sermon note Start writing now"], "the home sermon-note link")

        // 2 — title and notes.
        type(into: app.textFields["Title"], title, "the Title field")
        type(into: app.textViews["Notes"], notes, "the Notes field")

        // 3 — reflection, which sits outside the Details panel.
        type(into: app.textViews["Reflection"], reflection, "the Reflection field")

        // 4 — prayer, which is inside the Details panel. The panel is not always
        // shut when the editor opens — a resumed draft opens it — so toggling
        // unconditionally would close it over the field this needs.
        let prayerField = app.textViews["Prayer"]
        if !prayerField.waitForExistence(timeout: 5) {
            tapWhenReady(webControl("Details", "the Details disclosure"), "the Details disclosure")
        }
        type(into: prayerField, prayer, "the Prayer field")

        // 5 — both Scripture references. The search box matches whole sections,
        // so an exact verse and an exact range come from the verse picker.
        tapWhenReady(webControl("A verse", "the A verse mode"), "the A verse mode")
        choose("John", from: "Book")
        choose("3", from: "Chapter")

        // John 3:16 on its own.
        chooseVerse("16")
        tapButton("Add verse", "the Add verse button")

        // John 3:16-18. Adding clears the verse choice but keeps book and
        // chapter, so only the two verse ends are set again.
        chooseVerse("16")
        choose("18", from: "To verse")
        tapButton("Add verse", "the Add verse button")

        // The chips prove both were stored, not merely clicked.
        let chips = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Remove "))
            .allElementsBoundByIndex.map { $0.label }
        XCTAssertTrue(chips.contains { $0.contains(passage) },
                      "\(passage) was not attached — chips were \(chips)")
        XCTAssertTrue(chips.contains { $0.contains(verse) && !$0.contains(passage) },
                      "\(verse) was not attached — chips were \(chips)")

        throw XCTSkip(
            "Saving and sharing cannot be driven from here: Save, 'Share this "
            + "entry', the share surface and the system share sheets all sit "
            + "below the first viewport, and XCUITest cannot scroll this web "
            + "view (measured — see the note at the top of this file). Those "
            + "steps are covered by docs/IOS-SHARE-ACCEPTANCE.md.")
    }
}
