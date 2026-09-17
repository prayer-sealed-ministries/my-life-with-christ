import UIKit
import Capacitor

/**
 * The bridge view controller, so an in-repository plugin can be registered.
 *
 * Capacitor discovers plugins that ship as packages. This project's document
 * bridge lives in the app target itself, which nothing scans — the class
 * compiled, the app ran, and the call failed at runtime with
 * `"JourneyDocuments" plugin is not implemented on ios` because no one had
 * introduced them.
 *
 * `capacitorDidLoad()` is the documented place to say so, and it is the exact
 * counterpart of `registerPlugin(JourneyDocumentsPlugin.class)` in
 * `MainActivity` on Android. Keeping both explicit means the two platforms
 * register the same capability the same way, in a place someone will find.
 */
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(JourneyDocumentsPlugin())
    }
}
