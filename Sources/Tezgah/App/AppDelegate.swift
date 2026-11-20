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
        panel.canCreateDirectories = true
        panel.prompt = String(localized: "Add Project")
        panel.message = String(localized: "Choose a folder to work in.")
        guard panel.runModal() == .OK else { return }
        var last: ProjectRecord?
        for url in panel.urls { last = store.addProject(path: url.path) }
        store.checkFolders()
        if let last { store.showBoard(last.id) }
    }

    /// ⇧⌘N: makes a new folder where you say and opens it as a project.
    static func newFolder() {
        guard let store else { return }
        let panel = NSSavePanel()
        panel.title = String(localized: "New Folder")
        panel.prompt = String(localized: "Create")
        panel.nameFieldLabel = String(localized: "Name:")
        panel.nameFieldStringValue = String(localized: "new-project")
        panel.message = String(localized: "Tezgah makes the folder and opens it as a project.")
        panel.canCreateDirectories = true
        panel.showsTagField = false
        // Beside the project you opened last, where new work usually goes.
        if let recent = store.recentProjects.first(where: { !store.missingProjects.contains($0.id) }) {
            panel.directoryURL = URL(fileURLWithPath: recent.path).deletingLastPathComponent()
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        } catch {
            let alert = NSAlert(error: error)
            alert.runModal()
            return
        }
        let project = store.addProject(path: url.path)
        store.checkFolders()
        store.showBoard(project.id)
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
        // `--workspace <dir>` keeps workspace.json there instead (trying things out without touching your own).
        var directory = Persistence.defaultDirectory
        if let i = args.firstIndex(of: "--workspace"), args.indices.contains(i + 1) {
            directory = URL(fileURLWithPath: args[i + 1], isDirectory: true)
        }
        // Snapshots use a throwaway workspace and never touch the saved one.
        store = AppStore(persistence: snapshotDir == nil ? Persistence(directory: directory) : nil)
        AppActions.store = store
        store.sidebarOpen = appearance.sidebarPinned
        if let issue = TerminalLook.controller.lastConfigurationIssue {
            FileHandle.standardError.write(Data("tezgah: ghostty config: \(issue)\n".utf8))
        }

        NSApp.appearance = appearance.nsAppearance
        // The saved text size, cursor and the rest apply from the first terminal on, not from the next change in Settings.
        TerminalLook.apply(appearance)
        NSApp.mainMenu = MainMenu.make(target: self)
        window = makeWindow()
        store.sidebarStaysOpen = { [weak self] in self?.appearance.sidebarPinned ?? true }
        store.windowInSight = { [weak self] in
            guard let w = self?.window else { return false }
            return NSApp.isActive && w.isVisible && !w.isMiniaturized && w.isKeyWindow
        }
        watchAppearance()
        if let snapshotDir {
            Task { await Snapshotter(store: store, window: window, look: appearance, app: self, directory: snapshotDir).run() }
        } else {
            // Before any shell starts: the shims and the zsh integration they are found through.
            AgentHooks.install()
            store.load()
            store.startPolling()
            store.refreshAgents()
            Updates.shared.start()
            // Rewrites the Finder service if the app moved; after the window is up, not in its way.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                if FinderService.isRealBuild, FinderService.isInstalled { FinderService.install() }
            }
            UNUserNotificationCenter.current().delegate = self
            menuBar = MenuBarController(store: store, appearance: appearance)
            if Onboarding.isDone {
                store.launching = store.selection == .welcome && store.persistence?.unreadable != true
                window.makeKeyAndOrderFront(nil)
                DispatchQueue.main.async { [weak self] in self?.warnAboutUnreadableWorkspace() }
            } else {
                showOnboarding()
            }
        }
        installKeyMonitor()
        // `kill` (logout, a script) quits like ⌘Q: the workspace is saved and the shells end.
        signal(SIGTERM, SIG_IGN)
        let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        term.setEventHandler { [weak self] in
            // Nobody is there to answer a question.
            self?.quitWithoutAsking = true
            NSApp.terminate(nil)
        }
        term.resume()
        termSource = term
        NSApp.activate()
        // What macOS asked Tezgah to open as it started it (a folder from Finder, a script, an ssh link).
        launched = true
        let waiting = pendingOpens
        pendingOpens = []
        if !waiting.isEmpty { open(waiting) }
    }

    private var launched = false
    private var pendingOpens: [URL] = []

    /// macOS can hand these over before the app has finished starting: they wait until it has.
    func application(_: NSApplication, open urls: [URL]) {
        guard launched else { pendingOpens += urls; return }
        open(urls)
    }

    private func open(_ urls: [URL]) {
        for url in urls { store.handleOpen(url) }
        // During the first run they are opened behind it and shown when it ends.
        if onboardingWindow == nil { showMainWindow() }
    }

    func applicationDidBecomeActive(_: Notification) {
        // Back at the session you left: what arrived for it meanwhile has been seen.
        guard launched, let store, case let .session(id) = store.selection, store.windowInSight() else { return }
        for i in store.notifications.indices where store.notifications[i].sessionId == id { store.notifications[i].read = true }
        SystemNotices.clear(sessionId: id)
    }

    func windowDidBecomeKey(_ note: Notification) {
        if (note.object as? NSWindow) === window { applicationDidBecomeActive(note) }
    }

    /// Left full screen with the green button: full focus ends with it.
    func windowDidExitFullScreen(_ note: Notification) {
        if (note.object as? NSWindow) === window, case .full = store.focus { store.focus = .none }
    }

    func windowWillClose(_ note: Notification) {
        // The first run closed with its red button counts as "later": the main window opens.
        if let w = note.object as? NSWindow, w === onboardingWindow { onboarding.finish() }
    }

    /// Closing the window leaves Tezgah (and the agents in it) running: the Dock icon and the menu bar
    /// icon bring the window back. ⌘Q quits.
    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_: NSApplication, hasVisibleWindows visible: Bool) -> Bool {
        if !visible, onboardingWindow == nil { showMainWindow() }
        return true
    }

    func showMainWindow() {
        guard onboardingWindow == nil else { return }
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }

    private var quitWithoutAsking = false

    /// Quitting ends every agent; ask first when some are in the middle of something.
    func applicationShouldTerminate(_: NSApplication) -> NSApplication.TerminateReply {
        guard !quitWithoutAsking, snapshotDir == nil, let store else { return .terminateNow }
        // Agents that say what they're doing, and programs that don't but are plainly running.
        let busy = store.sessions.filter { s in
            let state = store.status(of: s)
            return state == .working || state == .blocked || (state == nil && store.panes(of: s).contains(where: \.busy))
        }.count
        guard busy > 0 else { return .terminateNow }
        showMainWindow()
        let alert = NSAlert()
        alert.messageText = busy == 1 ? String(localized: "An agent is still at work. Quit Tezgah?")
            : String(localized: "\(busy) agents are still at work. Quit Tezgah?")
        alert.informativeText = String(localized: "They stop when Tezgah quits. Claude Code returns to its conversations when you open Tezgah again.")
        alert.addButton(withTitle: String(localized: "Quit"))
        alert.addButton(withTitle: String(localized: "Cancel"))
        return alert.runModal() == .alertFirstButtonReturn ? .terminateNow : .terminateCancel
    }

    /// workspace.json is there but can't be read: say so instead of opening empty and quietly not saving.
    private func warnAboutUnreadableWorkspace() {
        guard let persistence = store.persistence, persistence.unreadable else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = String(localized: "Tezgah couldn't read its workspace file")
        alert.informativeText = String(localized: "Your projects and sessions are in a file that is damaged. Nothing is saved over it. Start fresh and Tezgah sets the old file aside, or look at the file first.")
        alert.addButton(withTitle: String(localized: "Start Fresh"))
        alert.addButton(withTitle: String(localized: "Show the File"))
        alert.addButton(withTitle: String(localized: "Continue Without Saving"))
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            persistence.startFresh()
            store.scheduleSave()
        case .alertSecondButtonReturn:
            NSWorkspace.shared.activateFileViewerSelecting([persistence.fileURL])
        default: break
        }
    }

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
        // Closed is only out of sight: the window (and its terminals) come back as they were.
        w.isReleasedWhenClosed = false
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
        let w = NSWindow(contentRect: NSRect(origin: .zero, size: OnboardingView.size),
                         styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.contentViewController = host
        w.title = NSLocalizedString("Welcome to Tezgah", comment: "window")
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        w.isMovableByWindowBackground = true
        w.isReleasedWhenClosed = false
        w.delegate = self
        w.setContentSize(OnboardingView.size)
        w.center()
        onboarding.onFinish = { [weak self, weak w] in
            guard let self, self.onboardingWindow != nil else { return }
            self.onboardingWindow = nil
            w?.orderOut(nil)
            self.store.launching = self.store.selection == .welcome
            self.window.makeKeyAndOrderFront(nil)
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
            // Only in the main window, with nothing over it.
            guard event.window === self.window, !store.sheetOpen, !store.launching else { return event }
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

    @objc func newSession(_: Any?) { showMainWindow(); AppActions.newSessionHere() }
    @objc func newTerminal(_: Any?) { showMainWindow(); store.newSession(projectId: nil) }
    @objc func openFolder(_: Any?) { showMainWindow(); AppActions.openFolder() }
    @objc func newFolder(_: Any?) { showMainWindow(); AppActions.newFolder() }
    @objc func nextWaiting(_: Any?) { store.openNextWaiting() }
    @objc func showBoard(_: Any?) {
        guard let id = store.currentProjectId else { return NSSound.beep() }
        store.showBoard(id)
    }
    @objc func splitRight(_: Any?) { store.split(.row) }
    @objc func splitDown(_: Any?) { store.split(.column) }
    /// The main window is the one in front, with no sheet over it: session shortcuts mean what they say.
    private var sessionInFront: Bool { NSApp.keyWindow === window && !store.sheetOpen }

    /// ⌘W closes what is in front: Settings or another window, else the pane or session, else the window.
    @objc func closeSessionOrPane(_: Any?) {
        guard let key = NSApp.keyWindow else { return NSSound.beep() }
        if key !== window { key.performClose(nil); return }
        if store.sheetOpen { store.paletteOpen = false; store.newSessionPicker = nil; store.renaming = nil; return }
        guard let s = store.currentSession else { window.performClose(nil); return }
        if s.layout.paneIds.count > 1 { store.closeFocusedPane() } else { store.requestClose(session: s.id) }
    }
    @objc func closeProject(_: Any?) {
        guard let id = store.currentProjectId else { return NSSound.beep() }
        let sessions = store.sessions(in: id)
        // Several sessions, or an agent in the middle of something, don't go on one keystroke.
        if sessions.count > 1 || sessions.contains(where: { store.agent(of: $0) != nil }) {
            let alert = NSAlert()
            alert.messageText = String(localized: "Close \(sessions.count) sessions in \(store.project(id)?.name ?? "")?")
            alert.informativeText = String(localized: "Their agents and shells stop. Conversations stay on the project's board.")
            alert.addButton(withTitle: String(localized: "Close Sessions"))
            alert.addButton(withTitle: String(localized: "Cancel"))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        for s in sessions { store.closeSession(s.id) }
        store.selection = .welcome
    }
    @objc func arrangeGrid(_: Any?) { store.arrangeGrid() }
    @objc func nextPane(_: Any?) { store.cyclePane(1) }
    @objc func previousPane(_: Any?) { store.cyclePane(-1) }
    @objc func selectTab(_ sender: NSMenuItem) { store.selectTab(sender.tag) }
    @objc func nextTab(_: Any?) { store.cycleTab(1) }
    @objc func previousTab(_: Any?) { store.cycleTab(-1) }
    @objc func showHome(_: Any?) { showMainWindow(); store.selection = .welcome }
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
        showMainWindow()
        store.paletteScope = .all
        store.paletteOpen = true
    }
    @objc func quickSwitch(_: Any?) {
        showMainWindow()
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
    @objc func toggleSidePanel(_: Any?) { store.toggleNotifications() }
    @objc func toggleProjects(_: Any?) {
        // Home has no strip, nor has the bar at the top or bottom: nothing to flip unseen.
        guard store.selection != .welcome, appearance.navPosition.isVertical else { return NSSound.beep() }
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
    @objc func showShortcuts(_: Any?) { openSettings(section: "keyboard") }

    /// Settings, on one of its sections.
    func openSettings(section: String) {
        UserDefaults.standard.set(section, forKey: "settings.section")
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
        // Not the ones open in a pane right now: their agents would lose the conversation they're in.
        let open = store.openConversations
        let files = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "jsonl" && !open.contains($0.deletingPathExtension().lastPathComponent) }
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
        case #selector(closeSessionOrPane(_:)):
            return NSApp.keyWindow != nil
        case #selector(splitRight(_:)), #selector(splitDown(_:)), #selector(nextPane(_:)), #selector(previousPane(_:)):
            return sessionInFront && store.currentSession != nil
        case #selector(closeProject(_:)), #selector(deleteConversations(_:)), #selector(showBoard(_:)):
            return sessionInFront && store.currentProjectId != nil
        case #selector(nextWaiting(_:)):
            return !store.waitingSessions.isEmpty
        case #selector(find(_:)), #selector(clearTerminal(_:)), #selector(renameSession(_:)):
            return sessionInFront && store.currentSession != nil
        case #selector(arrangeGrid(_:)):
            return sessionInFront && (store.currentSession?.layout.paneIds.count ?? 0) > 1
        case #selector(toggleFocus(_:)):
            item.state = { if case .project = store.focus { return .on } else { return .off } }()
            return store.currentProjectId != nil || store.focus != .none
        case #selector(toggleFullFocus(_:)):
            item.state = { if case .full = store.focus { return .on } else { return .off } }()
            return store.currentProjectId != nil || store.focus != .none
        case #selector(selectTab(_:)):
            return sessionInFront && store.tabSessions.indices.contains(item.tag)
        case #selector(nextTab(_:)), #selector(previousTab(_:)):
            return sessionInFront && !store.tabSessions.isEmpty
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
        /// The same command under a second shortcut, not shown: the brackets and backslash of a US keyboard
        /// need ⌥ on others (Turkish, German…), so the listed shortcuts are ones every layout can type.
        func also(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
            let i = item(title, action, key, mods)
            i.isHidden = true
            i.allowsKeyEquivalentWhenHidden = true
            return i
        }
        let right = String(UnicodeScalar(NSRightArrowFunctionKey)!), left = String(UnicodeScalar(NSLeftArrowFunctionKey)!)
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
            item("Open Folder…", #selector(AppDelegate.openFolder(_:)), "o"),
            item("New Folder…", #selector(AppDelegate.newFolder(_:)), "n", [.command, .shift]),
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
            item("Project Board", #selector(AppDelegate.showBoard(_:)), "b", [.command, .shift]),
            item("Show Projects", #selector(AppDelegate.toggleProjects(_:)), "0"),
            also("Show Projects", #selector(AppDelegate.toggleProjects(_:)), "\\"),
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
        view.insertItem(navItem, at: 4)
        submenu("Session", [
            item("Split Right", #selector(AppDelegate.splitRight(_:)), "d"),
            item("Split Down", #selector(AppDelegate.splitDown(_:)), "d", [.command, .shift]),
            item("Next Pane", #selector(AppDelegate.nextPane(_:)), right, [.command, .option]),
            item("Previous Pane", #selector(AppDelegate.previousPane(_:)), left, [.command, .option]),
            also("Next Pane", #selector(AppDelegate.nextPane(_:)), "]"),
            also("Previous Pane", #selector(AppDelegate.previousPane(_:)), "["),
            item("Arrange Panes in a Grid", #selector(AppDelegate.arrangeGrid(_:)), "g", [.command, .shift]),
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
            item("Next Agent Waiting", #selector(AppDelegate.nextWaiting(_:)), "j"),
            .separator(),
            item("Previous Session", #selector(AppDelegate.previousTab(_:)), "\t", [.control, .shift]),
            item("Next Session", #selector(AppDelegate.nextTab(_:)), "\t", [.control]),
            also("Previous Session", #selector(AppDelegate.previousTab(_:)), "[", [.command, .shift]),
            also("Next Session", #selector(AppDelegate.nextTab(_:)), "]", [.command, .shift]),
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
