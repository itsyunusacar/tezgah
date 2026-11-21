import AppKit
import GhosttyTerminal
import TezgahCore

/// `--snapshot <dir> --demo`: plays a short story in the real app (three projects under ~/acme, stand-in
/// agents that print and report like the real ones) and writes it to <dir>/frames as JPEGs with a list of
/// their times, drawn by AppKit itself (no screen recording). scripts/demo/record.sh turns that into the
/// video and GIF for the README and the site. The app's language decides the language of the take.
extension Snapshotter {
    @MainActor
    final class Recorder {
        let folder: URL
        private let window: NSWindow
        private let snapshotter: Snapshotter
        private var times: [Double] = []
        private var running = false
        private let start = Date()
        private let writes = DispatchQueue(label: "tezgah.demo.frames")

        init(folder: URL, window: NSWindow, snapshotter: Snapshotter) {
            self.folder = folder
            self.window = window
            self.snapshotter = snapshotter
            try? FileManager.default.removeItem(at: folder)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }

        func begin(fps: Double = 14) {
            running = true
            Task { @MainActor in
                while running {
                    let began = Date()
                    frame()
                    let spent = Date().timeIntervalSince(began)
                    try? await Task.sleep(for: .milliseconds(Int(max(4, (1 / fps - spent) * 1000))))
                }
            }
        }

        private func frame() {
            window.displayIfNeeded()
            guard let view = window.contentView?.superview ?? window.contentView,
                  let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
            view.cacheDisplay(in: view.bounds, to: rep)
            snapshotter.drawTerminalText(into: rep, root: view)
            let index = times.count
            times.append(Date().timeIntervalSince(start))
            let url = folder.appendingPathComponent(String(format: "f%05d.jpg", index))
            nonisolated(unsafe) let image = rep
            writes.async {
                try? image.representation(using: .jpeg, properties: [.compressionFactor: 0.9])?.write(to: url)
            }
        }

        /// Stops, waits for the last frames to be written, and writes the list ffmpeg reads (each frame and how long it stays).
        func end() async {
            running = false
            try? await Task.sleep(for: .milliseconds(200))
            writes.sync {}
            var list = ""
            for (i, t) in times.enumerated() {
                let next = i + 1 < times.count ? times[i + 1] : t + 0.6
                list += "file 'f\(String(format: "%05d", i)).jpg'\nduration \(String(format: "%.4f", next - t))\n"
            }
            if let last = times.indices.last { list += "file 'f\(String(format: "%05d", last)).jpg'\n" }
            try? list.write(to: folder.appendingPathComponent("frames.txt"), atomically: true, encoding: .utf8)
            FileHandle.standardError.write(Data("demo: \(times.count) frames over \(String(format: "%.1f", times.last ?? 0)) s in \(folder.path)\n".utf8))
        }
    }

    /// Key presses, as the window would get them from the keyboard.
    private func type(_ text: String, each: Double = 0.045) async {
        for ch in text {
            press(String(ch))
            await wait(each)
        }
    }

    private func press(_ characters: String, code: UInt16 = 0, flags: NSEvent.ModifierFlags = []) {
        for kind in [NSEvent.EventType.keyDown, .keyUp] {
            if let e = NSEvent.keyEvent(with: kind, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                        windowNumber: window.windowNumber, context: nil, characters: characters,
                                        charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                window.sendEvent(e)
            }
        }
    }

    func demo() async {
        let home = NSHomeDirectory()
        let acme = "\(home)/acme"
        guard FileManager.default.fileExists(atPath: "\(acme)/web/.git") else {
            FileHandle.standardError.write(Data("demo: ~/acme isn't staged; run scripts/demo/record.sh\n".utf8))
            return
        }
        Rendering.flat = true
        let savedPosition = look.navPosition, savedPinned = look.sidebarPinned, savedMode = look.mode
        look.navPosition = .left
        look.sidebarPinned = true
        look.mode = .light
        store.sidebarOpen = true
        NSApp.appearance = NSAppearance(named: .aqua)
        window.appearance = NSAppearance(named: .aqua)
        window.setFrame(NSRect(x: 60, y: 60, width: 1280, height: 800), display: true)
        window.makeKeyAndOrderFront(nil)
        AgentHooks.install()
        store.startPolling()
        store.installedAgents = [AgentDetector.Found(kind: .claude, path: "/usr/local/bin/claude", version: "2.1.312"),
                                 AgentDetector.Found(kind: .codex, path: "/usr/local/bin/codex", version: "0.159"),
                                 AgentDetector.Found(kind: .grok, path: "/usr/local/bin/grok", version: "1.0.89")]
        store.lastAgent = .claude
        let node = " clear && node \(Self.fakeAgent)"
        store.demoAgent = { kind in "\(node) \(kind == .codex ? "codex" : kind == .grok ? "grok" : "login")" }

        let web = store.addProject(path: "\(acme)/web")
        let api = store.addProject(path: "\(acme)/api")
        let docs = store.addProject(path: "\(acme)/docs")
        store.projects = store.projects.enumerated().map { i, p in
            var p = p
            p.lastOpened = Date(timeIntervalSinceNow: -Double(i) * 5400 - 600)
            return p
        }
        // Work already under way elsewhere when the story begins.
        store.newSession(projectId: api.id, command: "\(node) tests", kind: .agent, hint: "Why do the payment tests fail on CI only?")
        store.newSession(projectId: docs.id, command: "\(node) grok", kind: .agent, hint: "README for the export command")
        store.selection = .welcome
        await wait(3.5)

        let recorder = Recorder(folder: directory.appendingPathComponent("frames"), window: window, snapshotter: self)
        store.launching = true
        recorder.begin()
        await wait(4.6) // the opening, then home: one agent at work, one finished, three projects

        store.showBoard(web.id) // the project's board: nothing open, its changes, its conversations
        await wait(2.6)

        app.newSession(nil) // ⌘T
        await wait(0.9)
        await type("Fix the login: it accepts expired tokens")
        await wait(0.7)
        press("\r", code: 36)
        await wait(6.4) // the agent reads, edits, writes a test, then asks to run it

        store.split(.row) // ⌘D: a shell beside it
        if let s = store.currentSession, let shell = s.layout.paneIds.last, let pane = store.panes[shell] {
            // A prompt without this Mac's name, set before the shell has drawn its own.
            pane.send(" PROMPT='%F{4}%1~%f %# '; clear\n")
            await wait(1.3)
            for ch in "git status --short" { pane.send(String(ch)); await wait(0.04) }
            pane.send("\n")
            await wait(1.6)
            if let agent = s.layout.paneIds.first { store.panes[agent]?.focus(); store.panes[agent]?.send("1") } // allow it
        }
        await wait(3.4) // it runs the tests and finishes

        store.toggleNotifications()
        await wait(2.2)
        store.notificationsOpen = false
        await wait(0.5)

        store.selection = .welcome // home again: everything, everywhere
        await wait(3.2)
        await recorder.end()

        store.terminateAll()
        look.navPosition = savedPosition
        look.sidebarPinned = savedPinned
        look.mode = savedMode
        await wait(0.5)
    }
}
