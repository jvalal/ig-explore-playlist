// Replaces the converter's default view controller (copied in by tools/mac-safari.sh).
// Shows whether the extension is on, re-checks whenever the app comes to the front, and opens
// Safari's extension settings or Instagram Explore in Safari.
import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "com.jvalal.Explore-Playlist-Gen.Extension"
let exploreURL = URL(string: "https://www.instagram.com/explore/")!

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshState()
        }
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.setContentSize(NSSize(width: 460, height: 500))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshState()
    }

    func refreshState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            let enabled = (error == nil && state != nil) ? (state!.isEnabled ? "true" : "false") : "undefined"
            DispatchQueue.main.async { self.webView.evaluateJavaScript("show(\(enabled))") }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? String else { return }
        switch msg {
        case "open-preferences":
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
        case "open-explore":
            if let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") {
                NSWorkspace.shared.open([exploreURL], withApplicationAt: safari, configuration: NSWorkspace.OpenConfiguration())
            } else {
                NSWorkspace.shared.open(exploreURL)
            }
        default:
            break
        }
    }
}
