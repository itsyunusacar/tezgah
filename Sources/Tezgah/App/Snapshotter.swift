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

    /// scripts/demo/fake-agent.mjs in this repository, found from where this file was compiled.
    static let fakeAgent = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("scripts/demo/fake-agent.mjs").path

    /// `--click-test`: a real click on the bar while a project's board (a scrolling page) is showing.
    private func clickTest() async {
        let saved = look.navPosition
        look.navPosition = .top
        AgentHooks.install()
        let project = store.addProject(path: "\(NSHomeDirectory())/Project/tezgah-mac")
        store.selection = .project(project.id)
        window.setFrame(NSRect(x: 80, y: 80, width: 1360, height: 860), display: true)
        window.makeKeyAndOrderFront(nil)
        await wait(1.5)
        let size = window.contentView?.bounds.size ?? .zero
        // The mark at the bar's far end: it takes you home.
        let point = NSPoint(x: size.width - 12 - 14, y: size.height - WindowChrome.band / 2)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            if let e = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                          windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
                window.sendEvent(e)
            }
            await wait(0.15)
        }
        await wait(0.5)
        FileHandle.standardError.write(Data("click test: the bar over a board → \(store.selection == .welcome ? "ok" : "FAILED")\n".utf8))
        // Three panes in a row, the first one closed: the other two must still be on screen, each in its own slot.
        let s = store.newSession(projectId: project.id)
        await wait(0.8)
        store.split(.row)
        await wait(0.4)
        store.split(.row)
        await wait(0.8)
        let ids = s.layout.paneIds
        store.closePane(ids[0])
        await wait(1.0)
        let shown = ids.dropFirst().map { id -> Bool in
            guard let v = store.panes[id]?.view else { return false }
            return v.superview != nil && v.window === window && v.superview?.subviews.count == 1
        }
        let slots = Set(ids.dropFirst().compactMap { store.panes[$0]?.view.superview.map(ObjectIdentifier.init) })
        FileHandle.standardError.write(Data("pane test: closing the first of three → \(shown.allSatisfy { $0 } && slots.count == 2 ? "ok" : "FAILED \(shown) slots=\(slots.count)")\n".utf8))
        if ProcessInfo.processInfo.arguments.contains("--with-claude") {
            let id = UUID().uuidString.lowercased()
            let c = store.newSession(projectId: project.id, command: Restore.start("claude", conversation: id, message: nil), kind: .agent, conversation: id)
            await wait(12)
            let ps = Process()
            ps.executableURL = URL(fileURLWithPath: "/bin/ps")
            ps.arguments = ["-axo", "command"]
            let out = Pipe()
            ps.standardOutput = out
            try? ps.run()
            let lines = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).split(separator: "\n")
            let mine = lines.first { $0.contains(id) && !$0.contains("/bin/ps") } ?? "-"
            FileHandle.standardError.write(Data("claude test: started through Tezgah's shim (hooks for this run): \(mine.contains("claude-hooks.json"))\n".utf8))
            let pane = store.leadPane(of: c)
            FileHandle.standardError.write(Data("claude test: reports as \(pane?.agentApp ?? "-"), state \(pane?.status?.rawValue ?? "none"), conversation kept: \(pane?.conversation == id), program \(pane?.program ?? "-")\n".utf8))
        }
        if ProcessInfo.processInfo.arguments.contains("--with-agents") {
            store.startPolling()
            // Grok says what it is doing by itself (OSC 7501), once the terminal answers its question.
            let gid = UUID().uuidString.lowercased()
            let g = store.newSession(projectId: project.id, command: Restore.start("grok", conversation: gid, message: nil), kind: .agent, conversation: gid)
            await wait(12)
            let gp = store.leadPane(of: g)
            FileHandle.standardError.write(Data("grok test: reports as \(gp?.agentApp ?? "-"), records \(gp?.records.count ?? 0), state \(gp?.status?.rawValue ?? "none"), named \(store.sessionTitle(g))\n".utf8))
            store.closeSession(g.id)
            await wait(1.5)
            // The empty session this left in Grok's history goes again.
            for group in (try? FileManager.default.contentsOfDirectory(at: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".grok/sessions"), includingPropertiesForKeys: nil)) ?? [] {
                try? FileManager.default.removeItem(at: group.appendingPathComponent(gid))
            }

            // An agent of your own that reports nothing: its state is read from its screen.
            let script = directory.appendingPathComponent("quietagent")
            let body = """
            #!/bin/sh
            i=0; while [ $i -lt 60 ]; do printf '\\r* Working on it, step %s of many: reading files and thinking them over' $i; i=$((i+1)); sleep 0.1; done
            printf '\\n\\nDo you want to apply this change? (y/n) '; read answer
            i=0; while [ $i -lt 40 ]; do printf '\\r* Applying, %s more lines to go before this is finished' $i; i=$((i+1)); sleep 0.1; done
            printf '\\nAll done.\\n'; sleep 40
            """
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try? body.write(to: script, atomically: true, encoding: .utf8)
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
            store.addOwnAgent(name: "Quiet Agent", command: script.path)
            let q = store.newSession(projectId: project.id, command: script.path, kind: .agent)
            var seen: [String] = []
            func note(_ at: String) { seen.append("\(at)=\(store.status(of: q)?.rawValue ?? "none")") }
            await wait(5.5); note("after 5s")
            await wait(6.5); note("when it asks")
            store.leadPane(of: q)?.send("y\n")
            await wait(3.5); note("after the answer")
            await wait(8); note("at the end")
            FileHandle.standardError.write(Data("quiet agent test: \(seen.joined(separator: ", ")); named \(store.sessionTitle(q)); notifications \(store.notifications.map { $0.state.rawValue })\n".utf8))
        }
        store.terminateAll()
        look.navPosition = saved
    }

    func run() async {
        if ProcessInfo.processInfo.arguments.contains("--click-test") {
            await clickTest()
            exit(0)
        }
        if ProcessInfo.processInfo.arguments.contains("--demo") {
            await demo()
            exit(0)
        }
        store.logsStatus = true
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        window.setFrame(NSRect(x: 80, y: 80, width: 1360, height: 860), display: true)
        window.makeKeyAndOrderFront(nil)

        let home = NSHomeDirectory()
        let tezgah = store.addProject(path: "\(home)/Project/tezgah")
        let mac = store.addProject(path: "\(home)/Project/tezgah-mac")
        let web = store.addProject(path: "\(home)/Project/tezgah-web-site")
        _ = store.addProject(path: "\(home)/Project/ai_studio")
        // A project whose folder is gone, to show how the strip, home and its board say so.
        _ = store.addProject(path: "\(home)/Project/moved-away")
        store.checkFolders()
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
        // Tezgah's own hook script, as Claude Code would run it on a permission prompt.
        AgentHooks.install()
        let hooked = store.newSession(projectId: mac.id, command: #"printf '{"message":"Claude needs your permission to use Bash"}' | "$TEZGAH_BIN/tezgah-report" blocked claude"#, kind: .agent)
        // Let the session's panes size themselves and the agents get going.
        store.selection = .session(main.id)
        if let first = main.layout.paneIds.first { store.focusSoon(first) }
        await wait(8)

        // The opening: the mark in the middle of the sky, then the sky lifting to home's header.
        let session = store.selection
        store.selection = .welcome
        store.launching = true
        await wait(1.25)
        capture("launch-1-mark")
        await wait(0.75)
        capture("launch-2-lifting")
        await wait(1.2)
        capture("launch-3-home")
        store.selection = session

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
                if position == .left {
                    store.sidebarOpen = true
                    await wait(0.8)
                    capture("session-left-open-\(mode)")
                    store.sidebarOpen = look.sidebarPinned
                }
            }
            look.navPosition = .left
            store.selection = .welcome
            await wait(1.0)
            capture("home-\(mode)")
            store.selection = .project(mac.id)
            await wait(1.0)
            capture("board-\(mode)")
            if mode == "light", let empty = store.projects.first(where: { $0.name == "ai_studio" }) {
                store.selection = .project(empty.id)
                await wait(1.0)
                capture("board-empty-light")
                // Nine terminals in one session: each split takes an equal share, then the session tidies into a grid.
                let crowded = store.newSession(projectId: empty.id)
                await wait(0.6)
                for _ in 0 ..< 8 { store.split(.row); await wait(0.25) }
                await wait(2.5)
                capture("crowded-light")
                store.closeSession(crowded.id)
            }
        }
        look.navPosition = savedPosition
        NSApp.appearance = NSAppearance(named: .aqua)
        window.appearance = NSAppearance(named: .aqua)
        store.refreshAgents()
        store.open(session: main.id)
        await wait(3)
        store.newSessionPicker = mac.id
        await wait(1)
        capture("picker-light")
        store.newSessionPicker = nil
        store.paletteOpen = true
        await wait(1)
        capture("palette-light")
        store.paletteOpen = false
        FileHandle.standardError.write(Data("hook test: \(store.status(of: hooked).map(\.rawValue) ?? "none") · \(store.leadPane(of: hooked)?.statusMessage ?? "-")\n".utf8))
        store.notificationsOpen = true
        await wait(1)
        capture("notifications-light")
        let kept = store.notifications
        store.notifications = []
        store.selection = .welcome
        await wait(0.8)
        capture("notifications-empty-light")
        store.notifications = kept
        store.open(session: main.id)
        store.notificationsOpen = false
        app.openSettings()
        if let sw = NSApp.windows.first(where: { $0.title == NSLocalizedString("Settings", comment: "window") }) {
            await wait(1.2)
            capture("settings-appearance-light", in: sw)
            sw.orderOut(nil)
        }
        // Settings › Agents with an agent of your own, and the picker that offers it.
        store.addOwnAgent(name: "Aider", command: "aider --model sonnet")
        app.openSettings(section: "agents")
        if let sw = NSApp.windows.first(where: { $0.title == NSLocalizedString("Settings", comment: "window") && $0.isVisible }) {
            await wait(2.5)
            capture("settings-agents-light", in: sw)
            sw.orderOut(nil)
        }
        UserDefaults.standard.removeObject(forKey: "settings.section")
        store.newSessionPicker = mac.id
        await wait(1)
        capture("picker-own-light")
        store.newSessionPicker = nil

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

    func wait(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    func capture(_ name: String, in target: NSWindow? = nil) {
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
    @discardableResult
    func drawTerminalText(into rep: NSBitmapImageRep, root: NSView) -> Int {
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
