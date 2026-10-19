import AppKit
import WebKit
import RazzleLayout

enum Role: String { case audience, speaker }

/// Borderless window that can become key (so the web view receives arrows/space/clicker
/// keys) and that swallows keys the page did not consume instead of beeping.
final class PresenterWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func keyDown(with event: NSEvent) {
        // WKWebView re-sends keys the page did not handle (no preventDefault) up the
        // responder chain. Esc quits; everything else is dropped silently.
        if event.keyCode == 53 { NSApp.terminate(nil) }
    }

    override func cancelOperation(_ sender: Any?) { NSApp.terminate(nil) }
    override func noResponder(for eventSelector: Selector) {}
}

/// One WKWebView for one role, with a "waiting for server" state that probes every second.
final class WebPane: NSObject, WKNavigationDelegate, WKUIDelegate {
    let role: Role
    let target: URL
    let probeURL: URL
    let webView: WKWebView
    private var probeTimer: Timer?
    private var waiting = false

    init(role: Role, target: URL, probeURL: URL) {
        self.role = role
        self.target = target
        self.probeURL = probeURL

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false
        let css = "html,body{overscroll-behavior:none !important;background:#000}"
        let js = """
        (function(){var s=document.createElement('style');s.textContent=\(String(reflecting: css));
        (document.head||document.documentElement).appendChild(s);})();
        """
        config.userContentController.addUserScript(
            WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = .black }
        webView.autoresizingMask = [.width, .height]
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    func start() { webView.load(URLRequest(url: target)) }

    func reload() {
        if waiting { probe() } else { webView.reload() }
    }

    private func showWaiting() {
        guard !waiting else { return }
        waiting = true
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;background:#000;color:#555;
        font:13px -apple-system,system-ui,sans-serif;cursor:default;user-select:none}
        body{display:flex;align-items:center;justify-content:center}
        </style></head><body>waiting for Razzle server… (\(role.rawValue))</body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
        probeTimer?.invalidate()
        probeTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.probe()
        }
    }

    private func probe() {
        var req = URLRequest(url: probeURL)
        req.timeoutInterval = 0.9
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { [weak self] _, response, _ in
            guard response is HTTPURLResponse else { return }
            DispatchQueue.main.async {
                guard let self, self.waiting else { return }
                self.waiting = false
                self.probeTimer?.invalidate()
                self.probeTimer = nil
                self.start()
            }
        }.resume()
    }

    private func failed(_ error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        // WebKit "frame load interrupted" (e.g. a download) is not a server outage.
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return }
        NSLog("razzle-presenter[\(role.rawValue)]: load failed: \(ns.localizedDescription)")
        showWaiting()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if waiting { return }
        start()
    }

    // window.open / target=_blank: open in the default browser rather than nowhere.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url { NSWorkspace.shared.open(u) }
        return nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var options: Options
    private var panes: [Role: WebPane] = [:]
    private var windows: [Role: PresenterWindow] = [:]
    private var keyMonitor: Any?

    init(options: Options) { self.options = options }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        NSApp.appearance = NSAppearance(named: .darkAqua)
        NSApp.presentationOptions = [.hideDock, .hideMenuBar]

        // Cmd+Shift+S / Cmd+Q are caught before the web view sees them.
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let chars = event.charactersIgnoringModifiers?.lowercased()
            if mods == [.command, .shift] && chars == "s" {
                self?.swapScreens(nil)
                return nil
            }
            if mods == [.command] && chars == "q" {
                NSApp.terminate(nil)
                return nil
            }
            return event
        }

        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)

        layoutWindows()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationDidBecomeActive(_ notification: Notification) {
        NSApp.presentationOptions = [.hideDock, .hideMenuBar]
    }

    @objc private func screensChanged(_ n: Notification) {
        // Screen parameters often change in several notifications in a row; coalesce.
        NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(relayout), object: nil)
        perform(#selector(relayout), with: nil, afterDelay: 0.3)
    }

    @objc private func relayout() { layoutWindows() }

    @objc func swapScreens(_ sender: Any?) {
        options.swap.toggle()
        layoutWindows()
    }

    @objc func reloadPages(_ sender: Any?) {
        panes.values.forEach { $0.reload() }
    }

    private static func screenInfos() -> [ScreenInfo] {
        NSScreen.screens.enumerated().map { i, s in
            let num = (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
            return ScreenInfo(index: i, frame: s.frame, isBuiltin: CGDisplayIsBuiltin(num) != 0)
        }
    }

    private func layoutWindows() {
        let screens = NSScreen.screens
        guard let a = assignWindows(screens: Self.screenInfos(), single: options.single, swap: options.swap) else {
            NSLog("razzle-presenter: no screens")
            return
        }
        NSLog("razzle-presenter: \(screens.count) screen(s), \(a)")
        place(.audience, on: screens[a.audience])
        if let s = a.speaker {
            place(.speaker, on: screens[s])
        } else if let w = windows.removeValue(forKey: .speaker) {
            w.orderOut(nil)
            w.close()
            panes[.speaker] = nil
        }
        let keyRole: Role = windows[.speaker] != nil ? .speaker : .audience
        for (role, w) in windows where role != keyRole { w.orderFrontRegardless() }
        if let w = windows[keyRole] {
            w.makeKeyAndOrderFront(nil)
            w.makeFirstResponder(panes[keyRole]?.webView)
        }
    }

    private func place(_ role: Role, on screen: NSScreen) {
        if let w = windows[role] {
            w.setFrame(screen.frame, display: true)
            return
        }
        guard let target = options.pageURL(view: role.rawValue),
              let probe = URL(string: options.url + "/") else {
            NSLog("razzle-presenter: bad --url \(options.url)")
            NSApp.terminate(nil)
            return
        }
        let pane = WebPane(role: role, target: target, probeURL: probe)
        let w = PresenterWindow(contentRect: screen.frame, styleMask: [.borderless],
                                backing: .buffered, defer: false)
        w.setFrame(screen.frame, display: false)
        w.title = "Razzle — \(role.rawValue)"
        w.backgroundColor = .black
        w.isOpaque = true
        w.hasShadow = false
        w.isReleasedWhenClosed = false
        w.collectionBehavior = [.managed, .fullScreenNone]
        w.acceptsMouseMovedEvents = true
        pane.webView.frame = w.contentView!.bounds
        w.contentView!.addSubview(pane.webView)
        windows[role] = w
        panes[role] = pane
        pane.start()
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Swap Screens", action: #selector(swapScreens(_:)), keyEquivalent: "S")
            .keyEquivalentModifierMask = [.command, .shift]
        appMenu.addItem(withTitle: "Reload", action: #selector(reloadPages(_:)), keyEquivalent: "r")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Razzle Presenter", action: #selector(NSApplication.terminate(_:)),
                        keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)
        for item in appMenu.items where item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }

        // Standard editing commands so copy/paste work in any field on the speaker page.
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        NSApp.mainMenu = main
    }
}
