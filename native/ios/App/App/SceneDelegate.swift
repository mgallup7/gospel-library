import UIKit
import WebKit
import Capacitor

// Each window (scene) of the app gets its own LibraryViewController, so its own web view, bridge
// and Windows plugin. The plugin answers for the window that asked.

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let library = LibraryViewController()
        // a window opened by Windows.open carries its place in the connecting activity; a window
        // the system brings back carries the place it last remembered
        if let activity = connectionOptions.userActivities.first(where: { $0.activityType == WindowsPlugin.activityType }) {
            library.openedHash = WindowsPlugin.hash(in: activity)
        } else if let activity = session.stateRestorationActivity, activity.activityType == WindowsPlugin.activityType {
            library.openedHash = WindowsPlugin.hash(in: activity)
            library.restored = true
        }
        if library.openedHash != nil {
            scene.userActivity = WindowsPlugin.makeActivity(hash: library.openedHash)
        }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = library
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        #if DEBUG
        let opened = library.openedHash ?? "none"
        let restored = library.restored
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            print("GL-WINDOWS-SCENES \(UIApplication.shared.connectedScenes.count) (connected a window: hash \(opened), restored \(restored))")
        }
        #endif
    }

    // what the system keeps so it can bring this window back where it was
    func stateRestorationActivity(for scene: UIScene) -> NSUserActivity? {
        if let library = window?.rootViewController as? LibraryViewController, let hash = library.rememberedHash ?? library.openedHash {
            return WindowsPlugin.makeActivity(hash: hash)
        }
        if let activity = scene.userActivity, activity.activityType == WindowsPlugin.activityType {
            return activity
        }
        return nil
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        #if DEBUG
        DispatchQueue.main.async {
            print("GL-WINDOWS-SCENES \(UIApplication.shared.connectedScenes.count) (a window disconnected)")
        }
        #endif
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// MARK: - One window's view controller

class LibraryViewController: CAPBridgeViewController {
    /// The place (a location hash) this window was opened or restored at; nil for an ordinary window.
    var openedHash: String?
    /// True when the system brought this window back from a previous run.
    var restored = false
    /// The place the page last asked to remember (Windows.remember).
    private(set) var rememberedHash: String?

    private let windowsPlugin = WindowsPlugin()

    // The page draws edge to edge and keeps clear of the clock by itself. After the keyboard had
    // been up, the web view was left pushed in from the top and bottom by the safe area (bars of
    // the background showed, and taps no longer landed where the page drew). So the scroll view
    // is held to no insets of its own, and put back in place once the keyboard is gone.
    private var keyboardUp = false

    override func viewDidLoad() {
        super.viewDidLoad()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardCame), name: UIResponder.keyboardWillShowNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWent), name: UIResponder.keyboardDidHideNotification, object: nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if !keyboardUp { keepEdgeToEdge(settle: false) }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        if !keyboardUp { keepEdgeToEdge(settle: false) }
    }

    @objc private func keyboardCame() { keyboardUp = true }

    @objc private func keyboardWent() {
        keyboardUp = false
        keepEdgeToEdge(settle: true)
        for wait in [0.3, 0.9] {
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
                guard let self = self, !self.keyboardUp else { return }
                self.keepEdgeToEdge(settle: true)
            }
        }
    }

    private func keepEdgeToEdge(settle: Bool) {
        guard let web = webView else { return }
        let scroll = web.scrollView
        if scroll.contentInsetAdjustmentBehavior != .never { scroll.contentInsetAdjustmentBehavior = .never }
        if scroll.contentInset != .zero { scroll.contentInset = .zero }
        guard settle else { return }
        let most = max(0, scroll.contentSize.height - scroll.bounds.height)
        let y = min(max(0, scroll.contentOffset.y), most)
        if y != scroll.contentOffset.y || scroll.contentOffset.x != 0 {
            scroll.setContentOffset(CGPoint(x: 0, y: y), animated: false)
        }
        web.setNeedsLayout()
        web.layoutIfNeeded()
        #if DEBUG
        print("GL-EDGES settled after the keyboard: insets \(scroll.adjustedContentInset), offset \(scroll.contentOffset.y)")
        #endif
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // registered on this window's bridge before the page loads: the plugin's script is added
        // to the web view's user scripts, so Capacitor.Plugins.Windows exists at page load
        bridge?.registerPluginInstance(windowsPlugin)
        #if DEBUG
        installWindowsCheck()
        #endif
    }

    func remember(hash: String) {
        guard hash != rememberedHash else { return }
        rememberedHash = hash
        guard let scene = viewIfLoaded?.window?.windowScene else { return }
        if let activity = scene.userActivity, activity.activityType == WindowsPlugin.activityType {
            activity.userInfo = ["hash": hash]
        } else {
            scene.userActivity = WindowsPlugin.makeActivity(hash: hash)
        }
    }

    // File > New Window (Cmd+N), when the app adds that menu item itself (see AppDelegate)
    @objc func newLibraryWindow(_ sender: Any?) {
        guard UIApplication.shared.supportsMultipleScenes else { return }
        WindowsPlugin.requestWindow(hash: nil, from: viewIfLoaded?.window?.windowScene, errorHandler: nil)
    }

    #if DEBUG
    // A debug build proves the plugin from inside the web view: the page asks Windows.current
    // through the bridge and logs the answer (GL-WINDOWS-CHECK). Started with the argument
    // -GLWindowsOpenTest, the first window also opens a second one and the two report what
    // they share (localStorage, OPFS, Web Locks, BroadcastChannel).
    private func installWindowsCheck() {
        var mode = "plain"
        if ProcessInfo.processInfo.arguments.contains("-GLWindowsOpenTest") {
            if openedHash == nil {
                mode = "first"
            } else if openedHash == WindowsPlugin.testHash {
                mode = "second"
            }
        }
        let source = LibraryViewController.windowsCheckJS
            .replacingOccurrences(of: "__MODE__", with: mode)
            .replacingOccurrences(of: "__TESTHASH__", with: WindowsPlugin.testHash)
        let script = WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(script)
    }

    private static let windowsCheckJS = """
    (function () {
      var MODE = "__MODE__";
      var TEST = "gl-windows-test";
      function log(tag, o) { try { console.log(tag + " " + JSON.stringify(o)); } catch (e) { console.log(tag + " unprintable"); } }
      function msg(e) { return String((e && e.message) || e); }
      function opfsRoot() {
        if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") return Promise.reject(new Error("no OPFS"));
        return navigator.storage.getDirectory();
      }
      function opfsWrite(text) {
        return opfsRoot().then(function (root) { return root.getFileHandle(TEST + ".txt", { create: true }); })
          .then(function (fh) {
            if (typeof fh.createWritable !== "function") return "no createWritable on the main thread";
            return fh.createWritable().then(function (w) { return w.write(text).then(function () { return w.close(); }); })
              .then(function () { return "written"; });
          }).catch(function (e) { return "error: " + msg(e); });
      }
      function opfsRead() {
        return opfsRoot().then(function (root) { return root.getFileHandle(TEST + ".txt"); })
          .then(function (fh) { return fh.getFile(); }).then(function (f) { return f.text(); })
          .catch(function (e) { return "error: " + msg(e); });
      }
      function first(c) {
        var stamp = "first-" + Date.now();
        try { localStorage.setItem(TEST, stamp); } catch (e) {}
        if (typeof BroadcastChannel === "function") {
          var bc = new BroadcastChannel(TEST);
          bc.onmessage = function (ev) { log("GL-WINDOWS-BROADCAST", { heard: ev.data }); };
          window.__glWindowsChannel = bc;
        }
        var locked = new Promise(function (res) {
          if (!navigator.locks) { res("no Web Locks"); return; }
          navigator.locks.request(TEST, function () {
            res("held");
            return new Promise(function (done) { setTimeout(done, 120000); });
          }).catch(function (e) { res("error: " + msg(e)); });
        });
        Promise.all([opfsWrite(stamp), locked]).then(function (r) {
          log("GL-WINDOWS-FIRST", { stamp: stamp, opfs: r[0], lock: r[1] });
          return c.nativePromise("Windows", "remember", { hash: "#gl-remembered-first" });
        }).then(function () {
          return c.nativePromise("Windows", "open", { hash: "__TESTHASH__" });
        }).then(function () { log("GL-WINDOWS-OPEN", { ok: true }); },
                function (e) { log("GL-WINDOWS-OPEN", { ok: false, error: msg(e) }); });
      }
      function second(c) {
        var out = {};
        try { out.localStorage = localStorage.getItem(TEST); } catch (e) { out.localStorage = "error: " + msg(e); }
        out.broadcastChannel = typeof BroadcastChannel === "function";
        out.sharedWorker = typeof SharedWorker === "function";
        var lock = !navigator.locks ? Promise.resolve("no Web Locks") :
          navigator.locks.request(TEST, { ifAvailable: true }, function (l) {
            return l ? "free here: locks are NOT shared between windows" : "held by the other window: locks are shared";
          }).catch(function (e) { return "error: " + msg(e); });
        Promise.all([opfsRead(), lock]).then(function (r) {
          out.opfs = r[0];
          out.lock = r[1];
          if (out.broadcastChannel) {
            var bc = new BroadcastChannel(TEST);
            window.__glWindowsChannel = bc;
            bc.postMessage("hello from the second window");
          }
          log("GL-WINDOWS-SHARED", out);
          return c.nativePromise("Windows", "remember", { hash: "#gl-remembered-second" });
        }).then(function () { return c.nativePromise("Windows", "current", {}); })
          .then(function (r) { log("GL-WINDOWS-SECOND", r); }, function (e) { log("GL-WINDOWS-SECOND", { error: msg(e) }); });
      }
      function go() {
        var c = window.Capacitor;
        if (!c || typeof c.nativePromise !== "function") { log("GL-WINDOWS-CHECK", { error: "no Capacitor bridge" }); return; }
        c.nativePromise("Windows", "current", {}).then(function (r) {
          var o = { mode: MODE, plugin: c.isPluginAvailable("Windows"), filesystem: c.isPluginAvailable("Filesystem"), share: c.isPluginAvailable("Share") };
          for (var k in r) { o[k] = r[k]; }
          log("GL-WINDOWS-CHECK", o);
          if (MODE === "first") { first(c); } else if (MODE === "second") { second(c); }
        }, function (e) { log("GL-WINDOWS-CHECK", { error: msg(e) }); });
      }
      setTimeout(go, 0);
    })();
    """
    #endif
}

// MARK: - The Windows plugin (JS name "Windows")

@objc(GLWindowsPlugin)
class WindowsPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    let identifier = "GLWindowsPlugin"
    let jsName = "Windows"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remember", returnType: CAPPluginReturnPromise)
    ]

    /// Declared in Info.plist under NSUserActivityTypes.
    static let activityType = "io.github.mgallup7.library.window"
    #if DEBUG
    static let testHash = "#gl-window-test"
    #endif

    static func makeActivity(hash: String?) -> NSUserActivity {
        let activity = NSUserActivity(activityType: activityType)
        activity.title = "Library"
        // only for opening and restoring this app's own windows: not offered to other devices or to search
        activity.isEligibleForHandoff = false
        activity.isEligibleForSearch = false
        activity.isEligibleForPublicIndexing = false
        activity.isEligibleForPrediction = false
        if let hash = hash {
            activity.userInfo = ["hash": hash]
        }
        return activity
    }

    static func hash(in activity: NSUserActivity) -> String? {
        return activity.userInfo?["hash"] as? String
    }

    /// Asks the system for a new window of the app, beside the requesting one.
    static func requestWindow(hash: String?, from requestingScene: UIScene?, errorHandler: ((Error) -> Void)?) {
        let options = UIScene.ActivationRequestOptions()
        options.requestingScene = requestingScene
        UIApplication.shared.requestSceneSessionActivation(nil, userActivity: makeActivity(hash: hash), options: options) { error in
            CAPLog.print("⚡️  Windows: the new window was refused: \(error.localizedDescription)")
            errorHandler?(error)
        }
    }

    // the window this plugin instance belongs to (each window has its own bridge and plugin)
    private var library: LibraryViewController? {
        return bridge?.viewController as? LibraryViewController
    }

    @objc func open(_ call: CAPPluginCall) {
        let hash = call.getString("hash")
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsMultipleScenes else {
                call.reject("This device shows the app in one window only.", "UNAVAILABLE")
                return
            }
            WindowsPlugin.requestWindow(hash: hash, from: self.library?.viewIfLoaded?.window?.windowScene, errorHandler: nil)
            call.resolve()
        }
    }

    @objc func current(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let library = self.library
            var result: [String: Any] = [
                "multiple": UIApplication.shared.supportsMultipleScenes,
                "restored": library?.restored ?? false
            ]
            if let hash = library?.openedHash {
                result["hash"] = hash
            } else {
                result["hash"] = NSNull()
            }
            call.resolve(result)
        }
    }

    @objc func remember(_ call: CAPPluginCall) {
        guard let hash = call.getString("hash") else {
            call.reject("Windows.remember needs { hash: string }.")
            return
        }
        DispatchQueue.main.async {
            guard let library = self.library else {
                call.reject("This window is gone.")
                return
            }
            library.remember(hash: hash)
            call.resolve()
        }
    }
}
