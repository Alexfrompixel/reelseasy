// ReelsEasy: a native window around the local editor.
//
// The app starts the local server (scripts/reel.ts serve) on 127.0.0.1, shows
// its pages in a web view, and stops it on quit. There is no sign-in and no
// network use beyond this Mac, apart from what the editor page itself loads.
//
// projectRoot and bunPath come from Config.swift, written by app/build.sh.

import Cocoa
import WebKit

let port = 4310
let home = URL(string: "http://127.0.0.1:\(port)/")!
let navy = NSColor(srgbRed: 10 / 255, green: 14 / 255, blue: 23 / 255, alpha: 1)

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSToolbarDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var ready = false
    var waitingClips: [String] = []

    // MARK: Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        // Our colours over the timeline editor. The stylesheet and the script come from our own
        // local server, so the look can change without rebuilding the app. Main frame only: the
        // video preview inside the editor is a frame of its own and must stay untouched.
        let skin = """
        (function () {
          if (location.port === "\(port)") return;
          var root = document.documentElement;
          var css = document.createElement("link");
          css.rel = "stylesheet";
          css.href = "http://127.0.0.1:\(port)/skin.css";
          root.appendChild(css);
          document.addEventListener("DOMContentLoaded", function () {
            var js = document.createElement("script");
            js.src = "http://127.0.0.1:\(port)/skin.js";
            document.head.appendChild(js);
          });
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: skin, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1480, height: 940),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "ReelsEasy"
        window.minSize = NSSize(width: 980, height: 640)
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = navy
        window.titlebarAppearsTransparent = true
        window.center()
        window.setFrameAutosaveName("ReelEditorMain")
        window.contentView = web

        let toolbar = NSToolbar(identifier: "main")
        toolbar.delegate = self
        toolbar.displayMode = .iconAndLabel
        window.toolbar = toolbar
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        show(message: "Starting…")
        startServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        server?.terminate()
    }

    /// A clip dropped on the Dock icon, or opened with the app.
    func application(_ application: NSApplication, open urls: [URL]) {
        let clips = urls.filter { $0.isFileURL }.map { $0.path }
        if ready { clips.forEach(ingest) } else { waitingClips.append(contentsOf: clips) }
    }

    // MARK: Local server

    func startServer() {
        ping { alreadyRunning in
            if alreadyRunning { self.serverIsUp(); return }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: bunPath)
            process.arguments = ["\(projectRoot)/scripts/reel.ts", "serve", "--port", String(port)]
            process.currentDirectoryURL = URL(fileURLWithPath: projectRoot)
            var env = ProcessInfo.processInfo.environment
            // ffmpeg, node and bun live in Homebrew's folder, which apps do not get by default.
            env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
            env["HYPERFRAMES_NO_TELEMETRY"] = "1"
            env["DO_NOT_TRACK"] = "1"
            process.environment = env
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            do { try process.run() } catch {
                self.show(message: "Could not start the editor: \(error.localizedDescription)")
                return
            }
            self.server = process
            self.waitForServer(attempt: 0)
        }
    }

    func ping(_ done: @escaping (Bool) -> Void) {
        var request = URLRequest(url: home.appendingPathComponent("api/state"))
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }

    func waitForServer(attempt: Int) {
        ping { up in
            if up { self.serverIsUp(); return }
            if attempt > 60 { self.show(message: "The editor did not start. Run “bun scripts/reel.ts serve” in the project folder to see why."); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.waitForServer(attempt: attempt + 1) }
        }
    }

    func serverIsUp() {
        ready = true
        if waitingClips.isEmpty { goHome() } else {
            let clips = waitingClips
            waitingClips = []
            clips.forEach(ingest)
        }
        if let path = ProcessInfo.processInfo.environment["REEL_SNAPSHOT"] { snapshotLater(path) }
    }

    // MARK: Actions

    @objc func goHome() { web.load(URLRequest(url: home)) }
    @objc func reloadPage() { web.reload() }

    func post(_ path: String, _ body: [String: String], done: @escaping ([String: Any]?, String?) -> Void) {
        var request = URLRequest(url: home.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.timeoutInterval = 900
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("1", forHTTPHeaderField: "X-Reel-Editor")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, error in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let problem = error?.localizedDescription ?? (json?["error"] as? String)
            DispatchQueue.main.async { done(problem == nil ? json : nil, problem) }
        }.resume()
    }

    func ingest(_ path: String) {
        let name = (path as NSString).lastPathComponent
        show(message: "Transcribing \(name) and proposing a cut. This takes up to a minute…")
        post("api/ingest", ["file": path]) { result, problem in
            guard let slug = result?["slug"] as? String else {
                self.show(message: problem ?? "Could not read that clip.")
                return
            }
            self.post("api/open", ["slug": slug]) { opened, problem in
                if let text = opened?["url"] as? String, let url = URL(string: text) {
                    self.web.load(URLRequest(url: url))
                } else {
                    self.show(message: problem ?? "Could not open the editor.")
                }
            }
        }
    }

    func show(message: String) {
        let safe = message.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        web.loadHTMLString("""
        <html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0e17;color:#94a0b8;font:16px -apple-system,sans-serif;text-align:center;padding:40px">
        <div>\(safe)<div style="margin-top:18px"><a href="\(home.absoluteString)" style="color:#4f8cff">All reels</a></div></div></body></html>
        """, baseURL: nil)
    }

    /// For testing the window without a person: save what it shows, then quit.
    func snapshotLater(_ path: String) {
        let env = ProcessInfo.processInfo.environment
        if let text = env["REEL_SNAPSHOT_URL"], let url = URL(string: text) { web.load(URLRequest(url: url)) }
        let delay = Double(env["REEL_SNAPSHOT_DELAY"] ?? "6") ?? 6
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            self.web.takeSnapshot(with: nil) { image, _ in
                if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                   let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: path))
                }
                NSApp.terminate(nil)
            }
        }
    }

    // MARK: Web view behaviour

    static func isLocal(_ url: URL?) -> Bool {
        guard let host = url?.host else { return url?.scheme == "about" || url?.scheme == "blob" || url?.scheme == "data" }
        return host == "127.0.0.1" || host == "localhost"
    }

    /// Links that leave this Mac open in the normal browser, never inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame != false, let url = action.request.url, !AppDelegate.isLocal(url), url.scheme?.hasPrefix("http") == true {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(action.shouldPerformDownload ? .download : .allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if AppDelegate.isLocal(url) { webView.load(action.request) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let onHome = webView.url?.port == port
        window.title = onHome ? "ReelsEasy" : "ReelsEasy — \(webView.url?.fragment?.components(separatedBy: "?").first?.replacingOccurrences(of: "project/", with: "") ?? "editing")"
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }

    // Files the editor offers for download go to the Downloads folder.
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        var target = folder.appendingPathComponent(suggestedFilename)
        var count = 2
        while FileManager.default.fileExists(atPath: target.path) {
            let base = (suggestedFilename as NSString).deletingPathExtension
            let ext = (suggestedFilename as NSString).pathExtension
            target = folder.appendingPathComponent("\(base) \(count)\(ext.isEmpty ? "" : ".\(ext)")")
            count += 1
        }
        completionHandler(target)
    }
    func downloadDidFinish(_ download: WKDownload) {
        NSWorkspace.shared.open(FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!)
    }

    // MARK: Toolbar and menu

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [NSToolbarItem.Identifier("reels"), .flexibleSpace, NSToolbarItem.Identifier("reload")]
    }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(toolbar) }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: id)
        item.target = self
        if id.rawValue == "reels" {
            item.label = "All Reels"
            item.toolTip = "Back to the list of reels, where you export"
            item.image = NSImage(systemSymbolName: "square.grid.2x2", accessibilityDescription: "All Reels")
            item.action = #selector(goHome)
        } else {
            item.label = "Reload"
            item.image = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "Reload")
            item.action = #selector(reloadPage)
        }
        return item
    }

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let holder = NSMenuItem()
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            holder.submenu = menu
            main.addItem(holder)
        }
        func item(_ title: String, _ action: Selector?, _ key: String, _ mask: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.keyEquivalentModifierMask = mask
            entry.target = target
            return entry
        }
        add("ReelsEasy", [
            item("Hide ReelsEasy", #selector(NSApplication.hide(_:)), "h"),
            .separator(),
            item("Quit ReelsEasy", #selector(NSApplication.terminate(_:)), "q"),
        ])
        add("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        add("View", [
            item("All Reels", #selector(goHome), "1", target: self),
            item("Reload", #selector(reloadPage), "r", target: self),
        ])
        add("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Close", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.mainMenu = main
    }
}

@main
enum ReelsEasyApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
