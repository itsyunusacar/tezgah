import AppKit
import GhosttyTerminal
import TezgahCore

/// `--snapshot <dir>`: builds a demo workspace (real shells, the fake agent from the Electron
/// repo reporting OSC 7501), renders the window's screens to PNGs in light and dark with
/// AppKit's own drawing (no screen recording), and quits.
@MainActor
struct Snapshotter {
    let store: AppStore
    let window: NSWindow
    let look: Appearance
    let app: AppDelegate
    let directory: URL

    static let fakeAgent = "/Users/yunusacar/Project/tezgah/docs/demo/fake-agent.mjs"

    func run() async {
        store.logsStatus = true
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        window.setFrame(NSRect(x: 80, y: 80, width: 1360, height: 860), display: true)
        window.makeKeyAndOrderFront(nil)

        let home = NSHomeDirectory()
        let tezgah = store.addProject(path: "\(home)/Project/tezgah")
        let mac = store.addProject(path: "\(home)/Project/tezgah-mac")
        let web = store.addProject(path: "\(home)/Project/tezgah-web-site")
        _ = store.addProject(path: "\(home)/Project/ai_studio")
        store.projects = store.projects.enumerated().map { i, p in
            var p = p
            p.lastOpened = Date(timeIntervalSinceNow: -Double(i) * 3600)
            return p
        }
        let node = "node \(Self.fakeAgent)"
        let main = store.newSession(projectId: tezgah.id, command: "\(node) darkmode", kind: .agent)
        store.split(.row)
        if let right = main.layout.paneIds.last {
            store.panes[right]?.command = nil
            store.panes[right]?.send("clear; git log --oneline -8 && echo && git status --short | head -8\n")
        }
        store.split(.column)
        if let bottom = main.layout.paneIds.last {
            store.panes[bottom]?.send("clear; printf '\\e[1mColors\\e[0m  '; for i in 1 2 3 4 5 6; do printf \"\\e[3${i}m███\\e[0m \"; done; echo; ls -la | head -12\n")
        }
        store.newSession(projectId: tezgah.id, command: "\(node) login", kind: .agent)
        store.newSession(projectId: web.id, command: "\(node) grok", kind: .agent)
        store.newSession(projectId: mac.id, command: "\(node) tests", kind: .agent)
        store.newSession(projectId: nil)
        // Let the session's panes size themselves and the agents get going.
        store.selection = .session(main.id)
        if let first = main.layout.paneIds.first { store.focusSoon(first) }
        await wait(8)

        let savedPosition = look.navPosition
        for (mode, scheme) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            NSApp.appearance = NSAppearance(named: scheme)
            window.appearance = NSAppearance(named: scheme)
            await wait(0.6)
            for position in mode == "light" ? NavPosition.allCases : [.left] {
                look.navPosition = position
                store.open(session: main.id)
                await wait(4)
                capture("session-\(position.rawValue)-\(mode)")
            }
            look.navPosition = .left
            store.selection = .welcome
            await wait(1.0)
            capture("home-\(mode)")
            store.selection = .project(mac.id)
            await wait(1.0)
            capture("board-\(mode)")
        }
        look.navPosition = savedPosition

        // The five first-run pages, light then dark.
        app.showOnboarding()
        if let ob = app.onboardingWindow {
            for (mode, scheme) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
                NSApp.appearance = NSAppearance(named: scheme)
                ob.appearance = NSAppearance(named: scheme)
                for step in 0 ..< Onboarding.pages {
                    app.onboarding.step = step
                    await wait(step == 3 ? 3 : 1.6)
                    capture("onboarding-\(step + 1)-\(mode)", in: ob)
                }
            }
            ob.orderOut(nil)
            UserDefaults.standard.removeObject(forKey: "onboarding.step")
        }

        store.terminateAll()
        await wait(0.4)
        exit(0)
    }

    private func wait(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    private func capture(_ name: String, in target: NSWindow? = nil) {
        let window = target ?? self.window
        window.displayIfNeeded()
        guard let view = window.contentView?.superview ?? window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        let fallbacks = drawTerminalText(into: rep, root: view)
        guard let png = rep.representation(using: .png, properties: [:]) else { return }
        let url = directory.appendingPathComponent("\(name).png")
        try? png.write(to: url)
        FileHandle.standardError.write(Data("snapshot: \(url.path)\(fallbacks > 0 ? " (\(fallbacks) terminal(s) drawn from viewport text)" : "")\n".utf8))
    }

    /// cacheDisplay can't see what Metal drew. Where a terminal came out blank, draw its
    /// viewport text (read back from Ghostty) in the theme's colors instead.
    private func drawTerminalText(into rep: NSBitmapImageRep, root: NSView) -> Int {
        var terminals: [AppTerminalView] = []
        func walk(_ v: NSView) {
            if let t = v as? AppTerminalView { terminals.append(t) } else { v.subviews.forEach(walk) }
        }
        walk(root)
        guard !terminals.isEmpty, let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return 0 }
        let scale = CGFloat(rep.pixelsWide) / rep.size.width
        var drawn = 0
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ctx
        defer { NSGraphicsContext.restoreGraphicsState() }
        let dark = window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        for t in terminals {
            var r = t.convert(t.bounds, to: root)
            if root.isFlipped { r.origin.y = root.bounds.height - r.maxY }
            guard isBlank(rep, rect: r, scale: scale),
                  let pane = store.panes.values.first(where: { $0.view === t }),
                  let text = pane.viewportText() else { continue }
            drawn += 1
            NSColor(Appearance().theme(dark: dark).raised).setFill()
            r.fill()
            let font = NSFont(name: "GeistMono-Regular", size: 12.5) ?? .monospacedSystemFont(ofSize: 12.5, weight: .regular)
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(Appearance().theme(dark: dark).foreground)]
            let lineHeight = font.ascender - font.descender + font.leading + 2.5
            var y = r.maxY - 8 - lineHeight
            for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
                if y < r.minY + 4 { break }
                NSAttributedString(string: String(line), attributes: attrs).draw(at: NSPoint(x: r.minX + 12, y: y))
                y -= lineHeight
            }
        }
        return drawn
    }

    private func isBlank(_ rep: NSBitmapImageRep, rect: NSRect, scale: CGFloat) -> Bool {
        var colors = Set<UInt32>()
        for i in 1..<12 {
            for j in 1..<8 {
                let x = Int((rect.minX + rect.width * CGFloat(i) / 12) * scale)
                // NSBitmapImageRep rows run top-down.
                let y = Int((rep.size.height - (rect.minY + rect.height * CGFloat(j) / 8)) * scale)
                guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
                colors.insert(UInt32(c.redComponent * 255) << 16 | UInt32(c.greenComponent * 255) << 8 | UInt32(c.blueComponent * 255))
            }
        }
        return colors.count <= 1
    }
}
