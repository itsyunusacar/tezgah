import AppKit
import SwiftUI
import TezgahCore

/// Things menus and buttons in different places ask for.
enum AppActions {
    nonisolated(unsafe) static weak var store: AppStore?

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
        if case .terminals = store.tabContext {
            store.newSession(projectId: nil)
        } else {
            store.newSession(projectId: store.currentProjectId)
        }
    }

    static func toast(_ text: String) {
        guard let store else { return }
        store.toast = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { [weak store] in
            if store?.toast == text { store?.toast = nil }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation {
    private(set) var store: AppStore!
    private(set) var window: NSWindow!
    private var keyMonitor: Any?
    private var snapshotDir: URL?
    private var termSource: (any DispatchSourceSignal)?

    func applicationDidFinishLaunching(_: Notification) {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--snapshot"), args.indices.contains(i + 1) {
            snapshotDir = URL(fileURLWithPath: args[i + 1], isDirectory: true)
        }
        // Snapshots use a throwaway workspace and never touch the saved one.
        store = AppStore(persistence: snapshotDir == nil ? Persistence(directory: Persistence.defaultDirectory) : nil)
        AppActions.store = store
        if let issue = TerminalLook.controller.lastConfigurationIssue {
            FileHandle.standardError.write(Data("tezgah: ghostty config: \(issue)\n".utf8))
        }

        NSApp.mainMenu = MainMenu.make(target: self)
        window = makeWindow()
        if let snapshotDir {
            Task { await Snapshotter(store: store, window: window, directory: snapshotDir).run() }
        } else {
            store.load()
            store.startPolling()
            window.makeKeyAndOrderFront(nil)
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

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { true }

    func applicationWillTerminate(_: Notification) {
        store.saveNow()
        store.terminateAll()
    }

    func applicationSupportsSecureRestorableState(_: NSApplication) -> Bool { true }

    private func makeWindow() -> NSWindow {
        let split = NSSplitViewController()
        split.splitView.dividerStyle = .thin

        let sidebar = NSHostingController(rootView: SidebarView().environment(store))
        sidebar.sizingOptions = []
        let sidebarItem = NSSplitViewItem(sidebarWithViewController: sidebar)
        sidebarItem.minimumThickness = 220
        sidebarItem.maximumThickness = 340
        sidebarItem.canCollapse = true
        sidebarItem.allowsFullHeightLayout = true
        sidebarItem.titlebarSeparatorStyle = .none

        let content = NSHostingController(rootView: ContentRoot().environment(store))
        content.sizingOptions = []
        let contentItem = NSSplitViewItem(viewController: content)
        contentItem.titlebarSeparatorStyle = .none
        contentItem.minimumThickness = 480

        split.addSplitViewItem(sidebarItem)
        split.addSplitViewItem(contentItem)

        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 840),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        w.contentViewController = split
        w.title = "Tezgah"
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        w.isMovableByWindowBackground = false
        w.minSize = NSSize(width: 780, height: 480)
        w.setContentSize(NSSize(width: 1320, height: 840))
        w.setFrameAutosaveName("TezgahMain")
        if w.frame.origin == .zero { w.center() }
        w.delegate = self
        w.tabbingMode = .disallowed
        split.splitView.setPosition(250, ofDividerAt: 0)
        return w
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

    // MARK: - Menu actions

    @objc func newSession(_: Any?) { AppActions.newSessionHere() }
    @objc func newTerminal(_: Any?) { store.newSession(projectId: nil) }
    @objc func openFolder(_: Any?) { AppActions.openFolder() }
    @objc func splitRight(_: Any?) { store.split(.row) }
    @objc func splitDown(_: Any?) { store.split(.column) }
    @objc func closePane(_: Any?) {
        if store.currentSession != nil { store.closeFocusedPane() } else { NSSound.beep() }
    }
    @objc func closeSession(_: Any?) {
        if let s = store.currentSession { store.closeSession(s.id) }
    }
    @objc func selectTab(_ sender: NSMenuItem) { store.selectTab(sender.tag) }
    @objc func nextTab(_: Any?) { store.cycleTab(1) }
    @objc func previousTab(_: Any?) { store.cycleTab(-1) }
    @objc func showBoard(_: Any?) {
        if let p = store.currentProjectId { store.selection = .project(p) }
    }
    @objc func showWelcome(_: Any?) { store.selection = .welcome }
    @objc func showAgents(_: Any?) { store.selection = .agents }
    @objc func showSettings(_: Any?) { store.selection = .settings }
    @objc func focusSearch(_: Any?) {
        if let split = window.contentViewController as? NSSplitViewController, split.splitViewItems[0].isCollapsed {
            split.toggleSidebar(nil)
        }
        store.searchFocusRequest += 1
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(splitRight(_:)), #selector(splitDown(_:)), #selector(closeSession(_:)):
            return store.currentSession != nil
        case #selector(closePane(_:)):
            return store.currentSession != nil
        case #selector(showBoard(_:)):
            return store.currentProjectId != nil
        case #selector(selectTab(_:)):
            return store.tabSessions.indices.contains(item.tag)
        case #selector(nextTab(_:)), #selector(previousTab(_:)):
            return store.tabSessions.count > 1
        default:
            return true
        }
    }
}

enum MainMenu {
    static func make(target: AppDelegate) -> NSMenu {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command], target t: AnyObject? = target, tag: Int = 0) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = t
            i.tag = tag
            return i
        }
        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            main.addItem(withTitle: title, action: nil, keyEquivalent: "").submenu = m
            return m
        }
        let name = "Tezgah Prototype"
        _ = submenu(name, [
            item("About \(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), target: nil),
            .separator(),
            item("Settings…", #selector(AppDelegate.showSettings(_:)), ","),
            .separator(),
            item("Hide \(name)", #selector(NSApplication.hide(_:)), "h", target: nil),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option], target: nil),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:)), "", target: nil),
            .separator(),
            item("Quit \(name)", #selector(NSApplication.terminate(_:)), "q", target: nil),
        ])
        _ = submenu("File", [
            item("New Session", #selector(AppDelegate.newSession(_:)), "t"),
            item("New Terminal", #selector(AppDelegate.newTerminal(_:)), "n"),
            item("Open Folder…", #selector(AppDelegate.openFolder(_:)), "o"),
            .separator(),
            item("Close Pane", #selector(AppDelegate.closePane(_:)), "w"),
            item("Close Session", #selector(AppDelegate.closeSession(_:)), "w", [.command, .shift]),
        ])
        _ = submenu("Edit", [
            item("Copy", #selector(NSText.copy(_:)), "c", target: nil),
            item("Paste", #selector(NSText.paste(_:)), "v", target: nil),
            item("Select All", #selector(NSText.selectAll(_:)), "a", target: nil),
            .separator(),
            item("Search Projects and Sessions", #selector(AppDelegate.focusSearch(_:)), "f", [.command, .shift]),
        ])
        _ = submenu("View", [
            item("Split Right", #selector(AppDelegate.splitRight(_:)), "d"),
            item("Split Down", #selector(AppDelegate.splitDown(_:)), "d", [.command, .option]),
            .separator(),
            item("Welcome", #selector(AppDelegate.showWelcome(_:)), "0", [.command, .shift]),
            item("Board", #selector(AppDelegate.showBoard(_:)), "b", [.command, .shift]),
            item("Agents", #selector(AppDelegate.showAgents(_:)), "a", [.command, .shift]),
            .separator(),
            item("Toggle Sidebar", #selector(NSSplitViewController.toggleSidebar(_:)), "s", [.command, .control], target: nil),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control], target: nil),
        ])
        let window = submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m", target: nil),
            item("Zoom", #selector(NSWindow.performZoom(_:)), "", target: nil),
            .separator(),
            item("Next Tab", #selector(AppDelegate.nextTab(_:)), "]", [.command, .shift]),
            item("Previous Tab", #selector(AppDelegate.previousTab(_:)), "[", [.command, .shift]),
            .separator(),
        ] + (1...9).map { n in item("Tab \(n)", #selector(AppDelegate.selectTab(_:)), "\(n)", tag: n - 1) })
        NSApp.windowsMenu = window
        return main
    }
}
