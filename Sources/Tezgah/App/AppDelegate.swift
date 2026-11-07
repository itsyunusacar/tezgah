import AppKit
import SwiftUI
import TezgahCore
import UserNotifications

/// Things menus and buttons in different places ask for.
enum AppActions {
    nonisolated(unsafe) static weak var store: AppStore?

    static func showSettings() { NSApp.sendAction(#selector(AppDelegate.showSettings(_:)), to: nil, from: nil) }

    static func openFolder() {
        guard let store else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Add Project"
        panel.message = "Choose a folder to work in."
        guard panel.runModal() == .OK else { return }
        var last: ProjectRecord?
        for url in panel.urls { last = store.addProject(path: url.path) }
        if let last { store.selection = .project(last.id) }
    }

    /// ⌘T: a session in the project you're in, else a terminal of its own.
    static func newSessionHere() {
        guard let store else { return }
        store.refreshAgents()
        store.newSessionPicker = store.currentProjectId ?? ""
    }

    static func openSettings() { (NSApp.delegate as? AppDelegate)?.openSettings() }

    static func toast(_ text: String) {
        guard let store else { return }
        store.toast = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { [weak store] in
            if store?.toast == text { store?.toast = nil }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation, UNUserNotificationCenterDelegate {
    private var menuBar: MenuBarController?
    private(set) var store: AppStore!
    let appearance = Appearance()
    let permissions = Permissions()
    let onboarding = Onboarding()
    private(set) var onboardingWindow: NSWindow?
    private(set) var window: NSWindow!
    private var keyMonitor: Any?
    private var snapshotDir: URL?
    private var termSource: (any DispatchSourceSignal)?

    func applicationDidFinishLaunching(_: Notification) {
        let args = ProcessInfo.processInfo.arguments
        // `--export-finder <dir>`: writes the Finder service's files there (for checking) and quits.
        if let i = args.firstIndex(of: "--export-finder"), args.indices.contains(i + 1) {
            let dir = URL(fileURLWithPath: args[i + 1])
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? FinderService.info(title: FinderService.title).write(to: dir.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)
            try? FinderService.document(command: FinderService.command(appPath: "/Applications/Tezgah.app", bundleId: "dev.tezgah.app"))
                .write(to: dir.appendingPathComponent("document.wflow"), atomically: true, encoding: .utf8)
            exit(0)
        }
        if let i = args.firstIndex(of: "--snapshot"), args.indices.contains(i + 1) {
            snapshotDir = URL(fileURLWithPath: args[i + 1], isDirectory: true)
        }
        // Snapshots use a throwaway workspace and never touch the saved one.
        store = AppStore(persistence: snapshotDir == nil ? Persistence(directory: Persistence.defaultDirectory) : nil)
        AppActions.store = store
        store.sidebarOpen = appearance.sidebarPinned
        if let issue = TerminalLook.controller.lastConfigurationIssue {
            FileHandle.standardError.write(Data("tezgah: ghostty config: \(issue)\n".utf8))
        }

        NSApp.appearance = appearance.nsAppearance
        NSApp.mainMenu = MainMenu.make(target: self)
        window = makeWindow()
        watchAppearance()
        if let snapshotDir {
            Task { await Snapshotter(store: store, window: window, look: appearance, app: self, directory: snapshotDir).run() }
        } else {
            store.load()
            store.startPolling()
            store.refreshAgents()
            AgentHooks.install()
            Updates.shared.start()
            if FinderService.isRealBuild, UserDefaults.standard.object(forKey: "finder.enabled") as? Bool ?? true, FinderService.isInstalled {
                FinderService.install() // rewrites the service if the app moved
            }
            UNUserNotificationCenter.current().delegate = self
            menuBar = MenuBarController(store: store, appearance: appearance)
            if Onboarding.isDone {
                window.makeKeyAndOrderFront(nil)
            } else {
                showOnboarding()
            }
        }
        installKeyMonitor()
        // `kill` (logout, a script) quits like ⌘Q: the workspace is saved and the shells end.
        signal(SIGTERM, SIG_IGN)
        let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        term.setEventHandler { NSApp.terminate(nil) }
        term.resume()
        termSource = term
        NSApp.activate()
    }

    func application(_: NSApplication, open urls: [URL]) {
        for url in urls { store.handleOpen(url) }
        window.makeKeyAndOrderFront(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { true }

    func applicationWillTerminate(_: Notification) {
        store.saveNow()
        store.terminateAll()
    }

    func applicationSupportsSecureRestorableState(_: NSApplication) -> Bool { true }

    private func makeWindow() -> NSWindow {
        let root = LookProvider { RootView() }
            .environment(store)
            .environment(appearance)
        let host = NSHostingController(rootView: root)
        host.sizingOptions = []

        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        w.contentViewController = host
        w.title = "Tezgah"
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        // An empty toolbar makes the title bar band taller and centres the window buttons in it.
        let toolbar = NSToolbar(identifier: "tezgah")
        w.toolbar = toolbar
        applyChrome(to: w)
        w.minSize = NSSize(width: 780, height: 480)
        w.setContentSize(NSSize(width: 1440, height: 900))
        w.setFrameAutosaveName("TezgahMain")
        if w.frame.origin == .zero { w.center() }
        w.delegate = self
        w.tabbingMode = .disallowed
        w.backgroundColor = NSColor(name: nil) { ap in
            NSColor(ChromePalette.of(dark: ap.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua).paper)
        }
        return w
    }

    /// The first run: its own window with five pages; the main window appears when it ends.
    func showOnboarding() {
        let root = LookProvider { OnboardingView() }
            .environment(store)
            .environment(appearance)
            .environment(permissions)
            .environment(onboarding)
        let host = NSHostingController(rootView: root)
        host.sizingOptions = []
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 760),
                         styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.contentViewController = host
        w.title = NSLocalizedString("Welcome to Tezgah", comment: "window")
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        w.isMovableByWindowBackground = true
        w.setContentSize(NSSize(width: 1200, height: 760))
        w.center()
        onboarding.onFinish = { [weak self, weak w] in
            w?.orderOut(nil)
            self?.window.makeKeyAndOrderFront(nil)
            self?.onboardingWindow = nil
        }
        onboardingWindow = w
        w.makeKeyAndOrderFront(nil)
    }

    /// The band's height follows the strip: tall when the strip shares it (left, top), compact otherwise.
    func applyChrome(to w: NSWindow) {
        switch appearance.navPosition {
        case .left, .right, .top: w.toolbarStyle = .unified
        case .bottom: w.toolbarStyle = .unifiedCompact
        }
    }

    private func watchAppearance() {
        withObservationTracking { _ = appearance.navPosition } onChange: { [weak self] in
            DispatchQueue.main.async {
                guard let self else { return }
                self.applyChrome(to: self.window)
                self.watchAppearance()
            }
        }
    }

    private func installKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let store = self.store else { return event }
            // On the welcome page, 1–9 open recent projects.
            if store.selection == .welcome,
               event.modifierFlags.intersection([.command, .control, .option]).isEmpty,
               !(event.window?.firstResponder is NSText),
               let c = event.charactersIgnoringModifiers, let n = Int(c), (1...9).contains(n) {
                let recent = store.recentProjects
                if recent.indices.contains(n - 1) {
                    store.openProject(recent[n - 1].id)
                    return nil
                }
            }
            return event
        }
    }

    // A click on a system notification opens its session.
    nonisolated func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let id = response.notification.request.content.userInfo["session"] as? String
        await MainActor.run {
            NSApp.activate()
            window.makeKeyAndOrderFront(nil)
            if let id { store.open(session: id) }
        }
    }

    nonisolated func userNotificationCenter(_: UNUserNotificationCenter, willPresent _: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    // MARK: - Menu actions

    @objc func newSession(_: Any?) { AppActions.newSessionHere() }
    @objc func newTerminal(_: Any?) { store.newSession(projectId: nil) }
    @objc func openFolder(_: Any?) { AppActions.openFolder() }
    @objc func splitRight(_: Any?) { store.split(.row) }
    @objc func splitDown(_: Any?) { store.split(.column) }
    @objc func closeSessionOrPane(_: Any?) {
        guard let s = store.currentSession else { return NSSound.beep() }
        if s.layout.paneIds.count > 1 { store.closeFocusedPane() } else { store.closeSession(s.id) }
    }
    @objc func closeProject(_: Any?) {
        guard let id = store.currentProjectId else { return NSSound.beep() }
        for s in store.sessions(in: id) { store.closeSession(s.id) }
        store.selection = .welcome
    }
    @objc func nextPane(_: Any?) { store.cyclePane(1) }
    @objc func previousPane(_: Any?) { store.cyclePane(-1) }
    @objc func selectTab(_ sender: NSMenuItem) { store.selectTab(sender.tag) }
    @objc func nextTab(_: Any?) { store.cycleTab(1) }
    @objc func previousTab(_: Any?) { store.cycleTab(-1) }
    @objc func showHome(_: Any?) { store.selection = .welcome }
    @objc func showSettings(_: Any?) { openSettings() }

    private var settingsWindow: NSWindow?

    func openSettings() {
        if let w = settingsWindow {
            w.makeKeyAndOrderFront(nil)
            return
        }
        let root = LookProvider { SettingsView() }
            .environment(store)
            .environment(appearance)
            .environment(permissions)
        let host = NSHostingController(rootView: root)
        host.sizingOptions = []
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 720),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.contentViewController = host
        w.title = NSLocalizedString("Settings", comment: "window")
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        w.minSize = NSSize(width: 820, height: 520)
        w.setContentSize(NSSize(width: 960, height: 720))
        w.setFrameAutosaveName("TezgahSettings")
        w.isReleasedWhenClosed = false
        if w.frame.origin == .zero { w.center() }
        settingsWindow = w
        w.makeKeyAndOrderFront(nil)
    }
    @objc func search(_: Any?) {
        store.paletteScope = .all
        store.paletteOpen = true
    }
    @objc func quickSwitch(_: Any?) {
        store.paletteScope = .go
        store.paletteOpen = true
    }
    @objc func setNavPosition(_ sender: NSMenuItem) {
        appearance.navPosition = NavPosition.allCases[sender.tag]
    }

    private var focusedPane: TerminalPane? {
        store.currentSession.flatMap { s in s.focusedPaneId.flatMap { store.panes[$0] } }
    }

    @objc func find(_: Any?) { focusedPane?.startFind() ?? NSSound.beep() }
    @objc func clearTerminal(_: Any?) { focusedPane?.clearScreen() ?? NSSound.beep() }
    @objc func toggleFocus(_: Any?) {
        if store.focus != .none { store.focus = .none; return }
        guard let id = store.currentProjectId else { return NSSound.beep() }
        store.focus = .project(id)
    }
    @objc func toggleFullFocus(_: Any?) {
        if case .full = store.focus { store.focus = .none; if window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }; return }
        guard let id = store.currentProjectId else { return NSSound.beep() }
        store.focus = .full(id)
        if !window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
    }
    @objc func toggleSidePanel(_: Any?) { store.notificationsOpen.toggle() }
    @objc func toggleProjects(_: Any?) {
        store.sidebarByHover = false
        store.sidebarOpen.toggle()
    }
    @objc func biggerText(_: Any?) { changeFontSize(1) }
    @objc func smallerText(_: Any?) { changeFontSize(-1) }
    private func changeFontSize(_ delta: Double) {
        let size = min(24, max(10, TerminalSettings.fontSize + delta))
        UserDefaults.standard.set(size, forKey: "terminal.fontSize")
        TerminalLook.apply(appearance)
    }
    @objc func renameSession(_: Any?) { store.renaming = store.currentSession?.id }
    @objc func clearNotifications(_: Any?) { store.notifications.removeAll() }
    @objc func showShortcuts(_: Any?) {
        UserDefaults.standard.set("keyboard", forKey: "settings.section")
        settingsWindow?.close()
        settingsWindow = nil
        openSettings()
    }
    @objc func checkForUpdates(_: Any?) { Updates.shared.checkNow() }
    @objc func openDocs(_: Any?) { NSWorkspace.shared.open(URL(string: "https://tezgah.itsyunusacar.com")!) }
    @objc func reportProblem(_: Any?) { NSWorkspace.shared.open(URL(string: "https://github.com/itsyunusacar/tezgah/issues")!) }

    /// Moves this project's Claude Code conversations to the Trash, after asking. Nothing is deleted for good.
    @objc func deleteConversations(_: Any?) {
        guard let pid = store.currentProjectId, let project = store.project(pid) else { return NSSound.beep() }
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/projects")
            .appendingPathComponent(Conversations.claudeFolderName(for: project.path))
        let files = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "jsonl" }
        let alert = NSAlert()
        if files.isEmpty {
            alert.messageText = String(localized: "No conversations in \(project.name)")
            alert.informativeText = String(localized: "Claude Code hasn't saved any conversation for this folder.")
            alert.runModal()
            return
        }
        alert.messageText = String(localized: "Move \(files.count) conversations to the Trash?")
        alert.informativeText = String(localized: "Claude Code's conversations for \(project.name). You can put them back from the Trash.")
        alert.addButton(withTitle: String(localized: "Move to Trash"))
        alert.addButton(withTitle: String(localized: "Cancel"))
        alert.buttons.first?.hasDestructiveAction = true
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        var moved = 0
        for f in files where (try? FileManager.default.trashItem(at: f, resultingItemURL: nil)) != nil { moved += 1 }
        AppActions.toast(String(localized: "\(moved) conversations moved to the Trash"))
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(splitRight(_:)), #selector(splitDown(_:)), #selector(closeSessionOrPane(_:)),
             #selector(nextPane(_:)), #selector(previousPane(_:)):
            return store.currentSession != nil
        case #selector(closeProject(_:)), #selector(deleteConversations(_:)):
            return store.currentProjectId != nil
        case #selector(find(_:)), #selector(clearTerminal(_:)), #selector(renameSession(_:)):
            return store.currentSession != nil
        case #selector(toggleFocus(_:)):
            item.state = { if case .project = store.focus { return .on } else { return .off } }()
            return store.currentProjectId != nil || store.focus != .none
        case #selector(toggleFullFocus(_:)):
            item.state = { if case .full = store.focus { return .on } else { return .off } }()
            return store.currentProjectId != nil || store.focus != .none
        case #selector(selectTab(_:)):
            return store.tabSessions.indices.contains(item.tag)
        case #selector(nextTab(_:)), #selector(previousTab(_:)):
            return store.tabSessions.count > 1
        case #selector(setNavPosition(_:)):
            item.state = NavPosition.allCases[item.tag] == appearance.navPosition ? .on : .off
            return true
        default:
            return true
        }
    }
}

enum MainMenu {
    /// Seven menus, left of the notch. Everything here is also reachable from ⌘K.
    static func make(target: AppDelegate) -> NSMenu {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command],
                  target t: AnyObject? = target, tag: Int = 0) -> NSMenuItem {
            let i = NSMenuItem(title: NSLocalizedString(title, comment: "menu"), action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = t
            i.tag = tag
            return i
        }
        @discardableResult
        func submenu(_ title: String, _ items: [NSMenuItem], into parent: NSMenu? = nil) -> NSMenu {
            let m = NSMenu(title: NSLocalizedString(title, comment: "menu"))
            items.forEach(m.addItem)
            (parent ?? main).addItem(withTitle: m.title, action: nil, keyEquivalent: "").submenu = m
            return m
        }
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Tezgah"
        submenu(name, [
            item(String(localized: "About \(name)"), #selector(NSApplication.orderFrontStandardAboutPanel(_:)), target: nil),
            .separator(),
            item("Settings…", #selector(AppDelegate.showSettings(_:)), ","),
            item("Check for Updates…", #selector(AppDelegate.checkForUpdates(_:))),
            .separator(),
            item(String(localized: "Hide \(name)"), #selector(NSApplication.hide(_:)), "h", target: nil),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option], target: nil),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:)), "", target: nil),
            .separator(),
            item(String(localized: "Quit \(name)"), #selector(NSApplication.terminate(_:)), "q", target: nil),
        ])
        submenu("File", [
            item("New Session", #selector(AppDelegate.newSession(_:)), "t"),
            item("New Terminal", #selector(AppDelegate.newTerminal(_:)), "n"),
            item("New Project…", #selector(AppDelegate.openFolder(_:)), "n", [.command, .shift]),
            item("Open Folder…", #selector(AppDelegate.openFolder(_:)), "o"),
            .separator(),
            item("Close Session", #selector(AppDelegate.closeSessionOrPane(_:)), "w"),
            item("Close Project", #selector(AppDelegate.closeProject(_:)), "w", [.command, .shift]),
        ])
        submenu("Edit", [
            item("Undo", Selector(("undo:")), "z", target: nil),
            item("Redo", Selector(("redo:")), "z", [.command, .shift], target: nil),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x", target: nil),
            item("Copy", #selector(NSText.copy(_:)), "c", target: nil),
            item("Paste", #selector(NSText.paste(_:)), "v", target: nil),
            item("Select All", #selector(NSText.selectAll(_:)), "a", target: nil),
            .separator(),
            item("Find…", #selector(AppDelegate.find(_:)), "f"),
            item("Clear Terminal", #selector(AppDelegate.clearTerminal(_:)), "l"),
        ])
        let view = submenu("View", [
            item("Home", #selector(AppDelegate.showHome(_:)), "h", [.command, .shift]),
            item("Show Projects", #selector(AppDelegate.toggleProjects(_:)), "\\"),
            .separator(),
            item("Focus Mode", #selector(AppDelegate.toggleFocus(_:)), "f", [.command, .shift]),
            item("Full Focus", #selector(AppDelegate.toggleFullFocus(_:)), "f", [.command, .shift, .control]),
            item("Show Side Panel", #selector(AppDelegate.toggleSidePanel(_:)), "s", [.command, .option]),
            .separator(),
            item("Make Text Bigger", #selector(AppDelegate.biggerText(_:)), "+"),
            item("Make Text Smaller", #selector(AppDelegate.smallerText(_:)), "-"),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control], target: nil),
        ])
        let nav = NSMenu(title: NSLocalizedString("Navigation Position", comment: "menu"))
        for (i, p) in NavPosition.allCases.enumerated() {
            nav.addItem(item(["Left", "Right", "Top", "Bottom"][i], #selector(AppDelegate.setNavPosition(_:)), tag: i))
            _ = p
        }
        let navItem = NSMenuItem(title: nav.title, action: nil, keyEquivalent: "")
        navItem.submenu = nav
        view.insertItem(navItem, at: 3)
        submenu("Session", [
            item("Split Right", #selector(AppDelegate.splitRight(_:)), "d"),
            item("Split Down", #selector(AppDelegate.splitDown(_:)), "d", [.command, .shift]),
            item("Next Pane", #selector(AppDelegate.nextPane(_:)), "]"),
            item("Previous Pane", #selector(AppDelegate.previousPane(_:)), "["),
            .separator(),
            item("Rename…", #selector(AppDelegate.renameSession(_:))),
            item("Delete Conversation History…", #selector(AppDelegate.deleteConversations(_:))),
            item("Clear Notifications", #selector(AppDelegate.clearNotifications(_:))),
        ])
        let window = submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m", target: nil),
            item("Zoom", #selector(NSWindow.performZoom(_:)), "", target: nil),
            .separator(),
            item("Quick Switch…", #selector(AppDelegate.quickSwitch(_:)), "p"),
            .separator(),
            item("Previous Session", #selector(AppDelegate.previousTab(_:)), "[", [.command, .shift]),
            item("Next Session", #selector(AppDelegate.nextTab(_:)), "]", [.command, .shift]),
            .separator(),
        ] + (1...9).map { n in item(String(localized: "Session \(n)"), #selector(AppDelegate.selectTab(_:)), "\(n)", tag: n - 1) } + [
            .separator(),
            item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:)), "", target: nil),
        ])
        NSApp.windowsMenu = window
        let help = submenu("Help", [
            item("Search Everything", #selector(AppDelegate.search(_:)), "k"),
            item("Keyboard Shortcuts", #selector(AppDelegate.showShortcuts(_:)), "/"),
            .separator(),
            item("Tezgah Documentation", #selector(AppDelegate.openDocs(_:))),
            item("Report a Problem…", #selector(AppDelegate.reportProblem(_:))),
        ])
        NSApp.helpMenu = help
        return main
    }
}
