import AppKit
import Foundation
import Observation
import TezgahCore

enum Selection: Hashable {
    /// Home: every project and every agent.
    case welcome
    /// A project's board.
    case project(String)
    case session(String)

    var encoded: String? {
        switch self {
        case .welcome: nil
        case let .project(id): "project:\(id)"
        case let .session(id): "session:\(id)"
        }
    }
}

/// An agent you added in Settings: any command-line program you talk to.
struct OwnAgent: Codable, Identifiable, Hashable {
    var name: String
    /// What starts it, with any options ("cursor-agent", "aider --model sonnet").
    var command: String
    var id: String { command }
    /// Its first word: how a pane recognizes it.
    var word: String { command.split(separator: " ").first.map(String.init) ?? command }
}

@Observable
final class Session: Identifiable {
    let id: String
    let projectId: String?
    var kind: SessionKind
    var command: String?
    var cwd: String
    var layout: LayoutNode
    var focusedPaneId: String?
    let createdAt: Date
    var title: String?
    /// The first message it was started with.
    var hint: String?

    init(record: SessionRecord) {
        title = record.title
        hint = record.hint
        id = record.id
        projectId = record.projectId
        kind = record.kind
        command = record.command
        cwd = record.cwd
        layout = record.layout
        focusedPaneId = record.focusedPaneId ?? record.layout.paneIds.first
        createdAt = record.createdAt
    }
}

struct AppNotification: Identifiable, Hashable {
    let id = UUID()
    let sessionId: String
    let paneId: String
    let state: AgentState
    let app: String?
    let message: String?
    let date: Date
    var read = false
}

/// Everything the window shows. Lives on the main actor.
@Observable
final class AppStore {
    var projects: [ProjectRecord] = []
    var sessions: [Session] = []
    var panes: [String: TerminalPane] = [:]
    var selection: Selection = .welcome {
        didSet { selectionChanged(from: oldValue) }
    }
    var importedLegacy = false
    /// The opening plays over home, once, when the app has just been started.
    var launching = false
    var notifications: [AppNotification] = []
    var sidebarQuery = ""
    /// A short message at the bottom of the window.
    var toast: String?
    /// Status changes go to stderr (snapshot runs, `--verbose`).
    @ObservationIgnored var logsStatus = ProcessInfo.processInfo.arguments.contains("--verbose")
    /// Bumped to put the cursor in the sidebar's search field.
    var searchFocusRequest = 0
    /// ⌘K is open. Only one sheet shows at a time: opening one puts the others away.
    var paletteOpen = false {
        didSet { if paletteOpen { newSessionPicker = nil; renaming = nil } }
    }
    /// The new-session picker is open for this project ("" for a terminal of its own).
    var newSessionPicker: String? {
        didSet {
            guard let id = newSessionPicker else { return }
            // A project whose folder is gone can't take a session (it would start in the home folder): show its board, which says so.
            if missingProjects.contains(id) {
                newSessionPicker = nil
                showBoard(id)
                AppActions.toast(String(localized: "The folder can't be found"))
                return
            }
            paletteOpen = false
            renaming = nil
        }
    }
    /// A sheet is over the window: the session behind it takes no shortcuts.
    var sheetOpen: Bool { paletteOpen || newSessionPicker != nil || renaming != nil }
    /// The window's height, so sheets fit a short window.
    var windowHeight = 900.0
    /// Ticks once a second while the app runs: "42s" and the day's greeting stay true.
    var now = Date()
    /// Whether you can see the main window right now (the app delegate knows).
    @ObservationIgnored var windowInSight: () -> Bool = { NSApp.isActive }
    /// Whether the strip is a column of its own (pinned) rather than floating over the page.
    @ObservationIgnored var sidebarStaysOpen: () -> Bool = { true }
    var notificationsOpen = false
    /// The projects strip: a column when pinned, otherwise floating over the page.
    var sidebarOpen = false
    /// Opened by moving to the window's edge: it closes again when the pointer leaves it.
    var sidebarByHover = false
    /// Focus mode: one project fills the window until you leave; notifications still arrive.
    enum Focus: Equatable { case none, project(String), full(String) }
    var focus = Focus.none
    var focusedProjectId: String? {
        switch focus {
        case .none: nil
        case let .project(id), let .full(id): id
        }
    }
    /// The rename sheet is open for this session.
    var renaming: String? {
        didSet { if renaming != nil { paletteOpen = false; newSessionPicker = nil } }
    }
    enum PaletteScope { case all, go }
    var paletteScope = PaletteScope.all
    /// Agents found on this Mac (refreshed at launch and when the picker opens).
    var installedAgents: [AgentDetector.Found] = []
    var lastAgent: AgentKind? {
        get { UserDefaults.standard.string(forKey: "agents.last").flatMap(AgentKind.init(rawValue:)) }
        set { UserDefaults.standard.set(newValue?.rawValue, forKey: "agents.last") }
    }

    @ObservationIgnored private var detecting = false

    /// Settings › Agents › Your own.
    var ownAgents: [OwnAgent] = AppStore.readOwnAgents() {
        didSet {
            // Not from a snapshot or test run: those leave your settings alone.
            if persistence != nil { UserDefaults.standard.set(try? JSONEncoder().encode(ownAgents), forKey: "agents.own") }
            agentWords = Self.words(ownAgents)
        }
    }
    /// Every word that starts an agent: the built-in ones and yours.
    @ObservationIgnored private(set) var agentWords: Set<String> = AppStore.words(AppStore.readOwnAgents())

    private static func readOwnAgents() -> [OwnAgent] {
        UserDefaults.standard.data(forKey: "agents.own").flatMap { try? JSONDecoder().decode([OwnAgent].self, from: $0) } ?? []
    }

    private static func words(_ own: [OwnAgent]) -> Set<String> {
        Set(AgentKind.allCases.map(\.command)).union(own.map(\.word))
    }

    /// Adds an agent of your own; false when its command is empty or one Tezgah already has.
    @discardableResult
    func addOwnAgent(name: String, command: String) -> Bool {
        let command = command.trimmingCharacters(in: .whitespaces)
        guard let word = command.split(separator: " ").first.map(String.init), !agentWords.contains(word),
              !Shell.shells.contains(word) else { return false }
        let name = name.trimmingCharacters(in: .whitespaces)
        ownAgents.append(OwnAgent(name: name.isEmpty ? word : name, command: command))
        return true
    }

    /// What an agent is called: a built-in one's name, or the one you gave yours.
    func agentName(_ word: String?) -> String? {
        guard let word else { return nil }
        return AgentKind(program: word)?.name ?? ownAgents.first { $0.word == word }?.name
    }

    func refreshAgents() {
        // One look at a time: each starts a shell and asks every agent for its version.
        guard !detecting else { return }
        detecting = true
        Task {
            installedAgents = await AgentDetector.detect()
            detecting = false
        }
    }
    /// The last session you looked at in each project (project id → session id).
    var lastSession: [String: String] = [:]
    /// Projects whose folder is gone (moved, renamed, a disk that isn't connected).
    var missingProjects: Set<String> = []
    /// What each open conversation is called (conversation id → name).
    var conversationTitles: [String: String] = [:]
    @ObservationIgnored private var ticks = 0
    /// The room a session's panes have, kept by the session's view: a split that would leave panes too
    /// small to use tidies the session into a grid instead.
    @ObservationIgnored var sessionArea = CGSize(width: 1200, height: 720)
    static let smallestPane = CGSize(width: 300, height: 170)

    @ObservationIgnored let persistence: Persistence?
    @ObservationIgnored private var saveWork: DispatchWorkItem?
    @ObservationIgnored private var pollTimer: Timer?

    init(persistence: Persistence?) {
        self.persistence = persistence
    }

    // MARK: - Launch

    func load() {
        guard let file = persistence?.load() else { return }
        projects = file.projects
        importedLegacy = file.importedLegacy
        // Settings › General › Restore the last workspace: off keeps the projects and starts without sessions.
        let restore = UserDefaults.standard.object(forKey: "general.restore") as? Bool ?? true
        // A session whose project is gone from the file would run unseen: it isn't brought back.
        let known = Set(file.projects.map(\.id))
        for record in file.sessions where restore && (record.projectId == nil || known.contains(record.projectId!)) {
            // Shells start fresh in the folders they were in.
            let session = Session(record: record)
            sessions.append(session)
            for p in record.panes {
                // An agent comes back to its conversation; first messages and one-off commands are not typed again.
                // A conversation where nothing was said yet has no file to resume; it starts under the same id.
                let agent = p.command?.split(separator: " ").first.map(String.init)
                let written = p.conversation.map { ConversationList.exists($0, in: p.cwd, agent: agent) } ?? false
                let command = Restore.command(saved: p.command, conversation: p.conversation, written: written, own: Set(ownAgents.map(\.word)))
                // Its agent starts again when you open the session, not all of them at launch.
                panes[p.id] = TerminalPane(id: p.id, sessionId: session.id, cwd: p.cwd, command: command,
                                           conversation: command?.contains(p.conversation ?? "\u{0}") == true ? p.conversation : nil,
                                           asleep: true, store: self)
            }
        }
        checkFolders()
        refreshConversationTitles()
        // Tezgah opens on home: every project and what its agents are doing, one click from any of them.
        selection = .welcome
    }

    func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    private func poll() {
        for pane in panes.values { pane.poll() }
        ticks += 1
        now = Date()
        if ticks % 4 == 0 { checkFolders() }
        if ticks % 5 == 2 { refreshConversationTitles() }
    }

    func checkFolders() {
        var missing: Set<String> = []
        var isDir: ObjCBool = false
        for p in projects where !FileManager.default.fileExists(atPath: p.path, isDirectory: &isDir) || !isDir.boolValue {
            missing.insert(p.id)
        }
        if missing != missingProjects { missingProjects = missing }
    }

    // MARK: - Lookup

    func project(_ id: String?) -> ProjectRecord? {
        guard let id else { return nil }
        return projects.first { $0.id == id }
    }

    func session(_ id: String?) -> Session? {
        guard let id else { return nil }
        return sessions.first { $0.id == id }
    }

    func sessions(in projectId: String?) -> [Session] {
        sessions.filter { $0.projectId == projectId }
    }

    var currentSession: Session? {
        if case let .session(id) = selection { return session(id) }
        return nil
    }

    /// The project the window is in (its board or one of its sessions).
    var currentProjectId: String? {
        switch selection {
        case let .project(id): id
        case let .session(id): session(id)?.projectId
        default: nil
        }
    }

    /// What the tab strip shows: a project's sessions, or the terminals of their own.
    enum TabContext: Equatable {
        case project(String)
        case terminals
    }

    var tabContext: TabContext? {
        switch selection {
        case let .project(id): return .project(id)
        case let .session(id):
            guard let s = session(id) else { return nil }
            return s.projectId.map(TabContext.project) ?? .terminals
        case .welcome: return nil
        }
    }

    var tabSessions: [Session] {
        switch tabContext {
        case let .project(id): sessions(in: id)
        case .terminals: sessions(in: nil)
        case nil: []
        }
    }

    func panes(of session: Session) -> [TerminalPane] {
        session.layout.paneIds.compactMap { panes[$0] }
    }

    /// The most urgent state among a session's panes.
    func status(of session: Session) -> AgentState? {
        panes(of: session).compactMap(\.status).min(by: { $0.urgency < $1.urgency })
    }

    func status(ofProject id: String) -> AgentState? {
        sessions(in: id).compactMap { status(of: $0) }.min(by: { $0.urgency < $1.urgency })
    }

    /// Since when the session has been in its state.
    func statusSince(of session: Session) -> Date {
        let s = status(of: session)
        return panes(of: session).filter { $0.status == s }.map(\.statusSince).min() ?? session.createdAt
    }

    /// The pane that speaks for a session: the one that needs you, else the one working, else focused.
    func leadPane(of session: Session) -> TerminalPane? {
        let all = panes(of: session)
        if let s = status(of: session), let p = all.first(where: { $0.status == s }) { return p }
        return session.focusedPaneId.flatMap { panes[$0] } ?? all.first
    }

    /// Agents that report (OSC 7501) in a live pane.
    var liveAgentCount: Int {
        panes.values.filter { !$0.exited && $0.status != nil && $0.status != .idle }.count
    }

    var unreadNotifications: Int { notifications.filter { !$0.read }.count }

    /// What a session is called: your name for it, else what its agent is working on (the title it
    /// gave the terminal, or the message it was started with), else the program in it.
    func sessionTitle(_ session: Session) -> String {
        if let t = session.title, !t.isEmpty { return t }
        let lead = leadPane(of: session)
        if let agent = agentName(lead?.agentApp) ?? agent(of: session)?.name ?? agentName(lead?.program) {
            if let c = lead?.conversation, let name = conversationTitles[c] { return name }
            if let topic = lead.flatMap({ Restore.topic(fromTitle: $0.title) }) { return topic }
            if let hint = session.hint, !hint.isEmpty { return hint }
            return agent
        }
        if let program = lead?.program { return program }
        if let title = lead?.title, !title.isEmpty, title.count < 40 { return title }
        return Shell.programName(Shell.current)
    }

    /// The agent in a session, if any.
    func agent(of session: Session) -> AgentKind? {
        let lead = leadPane(of: session)
        return AgentKind(program: lead?.agentApp) ?? lead?.launched ?? AgentKind(program: lead?.program)
    }

    func sessionSubtitle(_ session: Session) -> String {
        Paths.tilde(leadPane(of: session)?.cwd ?? session.cwd)
    }

    func icon(of session: Session) -> String? {
        let lead = leadPane(of: session)
        return lead?.agentApp ?? lead?.launched?.command ?? lead?.program
    }

    // MARK: - Projects

    @discardableResult
    func addProject(path: String) -> ProjectRecord {
        let std = (path as NSString).standardizingPath
        if let existing = projects.first(where: { $0.path == std }) { return existing }
        let p = ProjectRecord(name: (std as NSString).lastPathComponent, path: std, lastOpened: Date())
        projects.append(p)
        scheduleSave()
        return p
    }

    func removeProject(_ id: String) {
        let wasCurrent = currentProjectId == id
        for s in sessions(in: id) { closeSession(s.id) }
        projects.removeAll { $0.id == id }
        missingProjects.remove(id)
        lastSession[id] = nil
        if focusedProjectId == id { focus = .none }
        if wasCurrent || currentProjectId == id { selection = .welcome }
        scheduleSave()
    }

    /// Removing a project only takes it off Tezgah's list (the folder stays); ask first when it has open sessions.
    func confirmRemoveProject(_ id: String) {
        guard let p = project(id) else { return }
        let open = sessions(in: id).count
        if open > 0 {
            let alert = NSAlert()
            alert.messageText = String(localized: "Remove \(p.name) from Tezgah?")
            alert.informativeText = String(localized: "Its \(open) open sessions will close. The folder and its conversations stay where they are.")
            alert.addButton(withTitle: String(localized: "Remove"))
            alert.addButton(withTitle: String(localized: "Cancel"))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        removeProject(id)
    }

    /// The strip keeps the order you gave it.
    func moveProject(_ id: String, by delta: Int) {
        guard let i = projects.firstIndex(where: { $0.id == id }) else { return }
        let j = min(max(i + delta, 0), projects.count - 1)
        guard i != j else { return }
        projects.insert(projects.remove(at: i), at: j)
        scheduleSave()
    }

    /// Points a project whose folder moved at its new place.
    func relocateProject(_ id: String) {
        guard let i = projects.firstIndex(where: { $0.id == id }) else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = String(localized: "Choose")
        panel.message = String(localized: "Where is \(projects[i].name) now?")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let path = (url.path as NSString).standardizingPath
        if let other = projects.first(where: { $0.path == path && $0.id != id }) {
            AppActions.toast(String(localized: "That folder is already \(other.name)"))
            return
        }
        // Its sessions and their panes follow it to the new place.
        let old = projects[i].path
        for s in sessions(in: id) {
            if s.cwd == old { s.cwd = path } else if s.cwd.hasPrefix(old + "/") { s.cwd = path + s.cwd.dropFirst(old.count) }
            for pane in panes(of: s) { pane.moved(from: old, to: path) }
        }
        projects[i].path = path
        projects[i].name = (path as NSString).lastPathComponent
        checkFolders()
        scheduleSave()
    }

    func openProject(_ id: String) {
        guard let i = projects.firstIndex(where: { $0.id == id }) else { return }
        if let f = focusedProjectId, f != id { focus = .none }
        projects[i].lastOpened = Date()
        if let last = lastSession[id], session(last)?.projectId == id {
            selection = .session(last)
        } else if let first = sessions(in: id).first {
            selection = .session(first.id)
        } else {
            selection = .project(id)
        }
        scheduleSave()
    }

    func showBoard(_ id: String) {
        guard project(id) != nil else { return }
        if let f = focusedProjectId, f != id { focus = .none }
        selection = .project(id)
    }

    var recentProjects: [ProjectRecord] {
        projects.sorted { ($0.lastOpened ?? .distantPast) > ($1.lastOpened ?? .distantPast) }
    }

    var legacyWorkspaceURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Tezgah/workspace.json")
    }

    var canImportLegacy: Bool {
        !importedLegacy && FileManager.default.isReadableFile(atPath: legacyWorkspaceURL.path)
    }

    /// Adds Tezgah 0.1's projects (not its sessions). The file is only read.
    @discardableResult
    func importLegacyProjects() -> Int {
        guard let data = try? Data(contentsOf: legacyWorkspaceURL) else { return 0 }
        var added = 0
        for p in LegacyImport.projects(from: data) where !projects.contains(where: { $0.path == p.path }) {
            projects.append(ProjectRecord(name: p.name, path: p.path))
            added += 1
        }
        importedLegacy = true
        scheduleSave()
        return added
    }

    // MARK: - Sessions

    /// A new shell in the project (or, without one, a terminal of its own in the home folder).
    /// `hint` is the first message an agent was given: its name until it names its own work.
    @discardableResult
    func newSession(projectId: String?, command: String? = nil, kind: SessionKind = .shell, hint: String? = nil,
                    conversation: String? = nil) -> Session {
        let cwd = project(projectId)?.path ?? NSHomeDirectory()
        let paneId = UUID().uuidString
        let record = SessionRecord(projectId: projectId, kind: kind, command: command, cwd: cwd, layout: .pane(paneId),
                                   panes: [PaneRecord(id: paneId, cwd: cwd, command: command)], focusedPaneId: paneId, hint: hint)
        let session = Session(record: record)
        sessions.append(session)
        panes[paneId] = TerminalPane(id: paneId, sessionId: session.id, cwd: cwd, command: command, conversation: conversation, store: self)
        if let i = projects.firstIndex(where: { $0.id == projectId }) { projects[i].lastOpened = Date() }
        if let f = focusedProjectId, f != projectId { focus = .none }
        selection = .session(session.id)
        scheduleSave()
        focusSoon(paneId)
        return session
    }

    func closeSession(_ id: String) {
        guard let i = sessions.firstIndex(where: { $0.id == id }) else { return }
        let s = sessions[i]
        let siblings = sessions(in: s.projectId)
        let index = siblings.firstIndex { $0.id == id } ?? 0
        for paneId in s.layout.paneIds {
            panes[paneId]?.terminate()
            panes[paneId] = nil
        }
        sessions.remove(at: i)
        notifications.removeAll { $0.sessionId == id }
        SystemNotices.clear(sessionId: id)
        if case .session(id) = selection {
            let rest = sessions(in: s.projectId)
            if !rest.isEmpty {
                selection = .session(rest[min(index, rest.count - 1)].id)
            } else if let pid = s.projectId {
                selection = .project(pid)
            } else {
                selection = .welcome
            }
        }
        scheduleSave()
    }

    /// A new pane beside the focused one, in its folder; `cwd` puts it in another (another project's, side by side).
    func split(_ axis: SplitAxis, paneId: String? = nil, command: String? = nil, cwd: String? = nil, conversation: String? = nil) {
        guard let s = currentSession, let target = paneId ?? s.focusedPaneId ?? s.layout.paneIds.last,
              let source = panes[target] else { return }
        let newId = UUID().uuidString
        panes[newId] = TerminalPane(id: newId, sessionId: s.id, cwd: cwd ?? source.cwd, command: command, conversation: conversation, store: self)
        let layout = s.layout.splitting(target, axis: axis, newId: newId)
        s.layout = fits(layout) ? layout : grid(layout.paneIds)
        s.focusedPaneId = newId
        scheduleSave()
        focusSoon(newId)
    }

    private func fits(_ layout: LayoutNode) -> Bool {
        let share = layout.smallestShare
        return share.width * sessionArea.width >= Self.smallestPane.width && share.height * sessionArea.height >= Self.smallestPane.height
    }

    /// Even rows, as many across as the window has room for.
    private func grid(_ ids: [String]) -> LayoutNode {
        let across = max(1, Int(sessionArea.width / Self.smallestPane.width))
        let down = max(1, Int(sessionArea.height / Self.smallestPane.height))
        var columns = min(across, Int(Double(ids.count).squareRoot().rounded(.up)))
        while columns < across, (ids.count + columns - 1) / columns > down { columns += 1 }
        return .grid(ids, columns: columns)
    }

    /// Session › Arrange Panes in a Grid.
    func arrangeGrid() {
        guard let s = currentSession, s.layout.paneIds.count > 1 else { return }
        s.layout = grid(s.layout.paneIds)
        scheduleSave()
    }

    func closePane(_ paneId: String) {
        guard let s = sessions.first(where: { $0.layout.contains(paneId) }) else { return }
        guard let rest = s.layout.removing(paneId) else {
            closeSession(s.id)
            return
        }
        let next = s.layout.neighbor(of: paneId)
        panes[paneId]?.terminate()
        panes[paneId] = nil
        notifications.removeAll { $0.paneId == paneId }
        s.layout = rest
        if s.focusedPaneId == paneId { s.focusedPaneId = next }
        scheduleSave()
        if let next, case .session(s.id) = selection { focusSoon(next) }
    }

    func closeFocusedPane() {
        guard let s = currentSession, let id = s.focusedPaneId ?? s.layout.paneIds.last else { return }
        closePane(id)
    }

    func resize(session: Session, path: [Int], sizes: [Double]) {
        session.layout = session.layout.resizing(at: path, sizes: sizes)
        scheduleSave()
    }

    /// ⌘] / ⌘[: the next or previous pane of the session.
    func cyclePane(_ delta: Int) {
        guard let s = currentSession else { return }
        let ids = s.layout.paneIds
        guard ids.count > 1 else { return }
        let i = s.focusedPaneId.flatMap { ids.firstIndex(of: $0) } ?? 0
        let next = ids[(i + delta + ids.count) % ids.count]
        s.focusedPaneId = next
        focusSoon(next)
    }

    func selectTab(_ index: Int) {
        let tabs = tabSessions
        guard tabs.indices.contains(index) else { return }
        selection = .session(tabs[index].id)
    }

    func cycleTab(_ delta: Int) {
        let tabs = tabSessions
        guard !tabs.isEmpty else { return }
        // From the board: forward lands on the first tab, back on the last.
        guard let current = currentSession.flatMap({ s in tabs.firstIndex { $0.id == s.id } }) else {
            selection = .session((delta > 0 ? tabs.first : tabs.last)!.id)
            return
        }
        selection = .session(tabs[(current + delta + tabs.count) % tabs.count].id)
    }

    func open(session id: String, pane paneId: String? = nil) {
        // It may have closed since the notification that points at it.
        guard session(id) != nil else { return }
        // In focus mode the layout stays on its project until you agree to leave.
        if let f = focusedProjectId, let target = session(id), target.projectId != f {
            let alert = NSAlert()
            alert.messageText = String(localized: "Leave focus and switch to that project?")
            alert.informativeText = String(localized: "You're focused on \(project(f)?.name ?? "")." )
            alert.addButton(withTitle: String(localized: "Switch"))
            alert.addButton(withTitle: String(localized: "Stay Focused"))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            focus = .none
        }
        selection = .session(id)
        if let paneId, panes[paneId] != nil, session(id)?.layout.contains(paneId) == true { session(id)?.focusedPaneId = paneId }
        if let p = session(id)?.focusedPaneId { focusSoon(p) }
    }

    /// Back to the terminal after a sheet closes, so typing lands where you were.
    func refocus() {
        if let s = currentSession, let p = s.focusedPaneId ?? s.layout.paneIds.first { focusSoon(p) }
    }

    /// Closing a session whose agent is in the middle of something asks first.
    func requestClose(session id: String) {
        guard let s = session(id) else { return }
        let state = status(of: s)
        if state == .working || state == .blocked {
            let alert = NSAlert()
            alert.messageText = String(localized: "Close \(sessionTitle(s))?")
            alert.informativeText = String(localized: "Its agent is still at work and stops with it. A Claude Code conversation stays on the project's board.")
            alert.addButton(withTitle: String(localized: "Close Session"))
            alert.addButton(withTitle: String(localized: "Cancel"))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        closeSession(id)
    }

    func focusSoon(_ paneId: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.panes[paneId]?.focus()
        }
    }

    private func selectionChanged(from old: Selection) {
        if case let .session(id) = selection, let s = session(id) {
            if let pid = s.projectId { lastSession[pid] = id }
            SystemNotices.clear(sessionId: id)
            // Agents brought back at launch start when you come to their session.
            for pane in panes(of: s) { pane.wake() }
            for n in notifications.indices where notifications[n].sessionId == id { notifications[n].read = true }
            if let f = s.focusedPaneId { focusSoon(f) }
        }
        // Home is nobody's focus.
        if selection == .welcome, focus != .none { focus = .none }
        if old != selection { scheduleSave() }
    }

    // MARK: - Pane events

    func paneFocused(_ pane: TerminalPane) {
        guard let s = session(pane.sessionId) else { return }
        if s.focusedPaneId != pane.id { s.focusedPaneId = pane.id }
    }

    func paneStatusChanged(_ pane: TerminalPane, from old: AgentState?, to new: AgentState?) {
        if logsStatus {
            let line = "tezgah: pane \(pane.id.prefix(8)) status \(old?.rawValue ?? "none") -> \(new?.rawValue ?? "none") app=\(pane.agentApp ?? "-") msg=\(pane.statusMessage ?? "-")\n"
            FileHandle.standardError.write(Data(line.utf8))
        }
        // "Done" after work, or after a question you answered that ended the turn.
        guard var new, new == .blocked || (new == .done && (old == .working || old == .blocked)) else { return }
        guard let session = session(pane.sessionId) else { return }
        // A pane's summary folds errors into "waiting for you"; the notification says which it was.
        if new == .blocked, pane.records.contains(where: { $0.state == .error }),
           !pane.records.contains(where: { $0.state == .blocked }) { new = .error }
        let looking = selection == .session(pane.sessionId) && windowInSight()
        notifications.insert(AppNotification(sessionId: pane.sessionId, paneId: pane.id, state: new, app: pane.agentApp,
                                             message: pane.statusMessage, date: Date(), read: looking), at: 0)
        if notifications.count > 200 { notifications.removeLast(notifications.count - 200) }
        let asks = new == .blocked || new == .error
        if !NSApp.isActive, asks { NSApp.requestUserAttention(.informationalRequest) }
        let wants = UserDefaults.standard.object(forKey: asks ? "notify.waiting" : "notify.done") as? Bool ?? true
        let who = pane.agentApp.flatMap { AgentKind(program: $0)?.name } ?? sessionTitle(session)
        let title = asks ? String(localized: "\(who) is waiting for you") : String(localized: "\(who) is done")
        // Settings › Accessibility › Announce state changes: VoiceOver says it.
        if persistence != nil, UserDefaults.standard.object(forKey: "a11y.announce") as? Bool ?? true {
            NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                                 userInfo: [.announcement: title, .priority: NSAccessibilityPriorityLevel.high.rawValue])
        }
        // You're looking right at it when it finishes: it doesn't stay "done" waiting for a glance you already gave.
        if new == .done, looking, pane.focused {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self, weak pane] in
                guard let self, let pane, self.selection == .session(pane.sessionId), pane.focused, self.windowInSight() else { return }
                pane.acknowledge()
            }
        }
        if !looking, persistence != nil, wants {
            let place = project(session.projectId)?.name ?? String(localized: "Terminal")
            SystemNotices.post(title: title, body: [pane.statusMessage, place].compactMap { $0 }.joined(separator: " · "),
                               sessionId: pane.sessionId, sound: asks)
        }
    }

    func paneExited(_ pane: TerminalPane, code _: Int32) {
        // A shell you ended (exit, ^D) takes its pane with it.
        closePane(pane.id)
    }

    // MARK: - Saving

    func scheduleSave() {
        guard persistence != nil else { return }
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveNow() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    func saveNow() {
        guard let persistence else { return }
        var file = WorkspaceFile()
        file.projects = projects
        file.importedLegacy = importedLegacy
        file.selection = selection.encoded
        file.sessions = sessions.map { s in
            SessionRecord(id: s.id, projectId: s.projectId, kind: s.kind, command: s.command, cwd: s.cwd, layout: s.layout,
                          panes: s.layout.paneIds.map { id in
                              // Only a running agent is written down, with its conversation, to come back to.
                              let word = panes[id]?.wordToRestore
                              // One of yours comes back with the whole command you gave it.
                              let command = word.map { w in ownAgents.first { $0.word == w }?.command ?? w }
                              return PaneRecord(id: id, cwd: panes[id]?.cwd ?? s.cwd, command: command,
                                                conversation: word != nil ? panes[id]?.conversation : nil)
                          },
                          focusedPaneId: s.focusedPaneId, createdAt: s.createdAt, title: s.title, hint: s.hint)
        }
        persistence.save(file)
    }

    func terminateAll() {
        for p in panes.values { p.terminate() }
    }
}

extension AgentState {
    /// Lower is more urgent.
    var urgency: Int {
        switch self {
        case .blocked, .error: 0
        case .working: 1
        case .done: 2
        case .idle: 3
        }
    }
}
