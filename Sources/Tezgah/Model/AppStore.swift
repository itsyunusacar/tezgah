import AppKit
import Foundation
import Observation
import TezgahCore

enum Selection: Hashable {
    case welcome
    case agents
    case notifications
    case terminals
    case settings
    /// A project's board.
    case project(String)
    case session(String)

    var encoded: String? {
        switch self {
        case .welcome: nil
        case .agents: "agents"
        case .notifications: "notifications"
        case .terminals: "terminals"
        case .settings: "settings"
        case let .project(id): "project:\(id)"
        case let .session(id): "session:\(id)"
        }
    }

    init(encoded: String?) {
        switch encoded {
        case "agents": self = .agents
        case "notifications": self = .notifications
        case "terminals": self = .terminals
        case "settings": self = .settings
        case let s? where s.hasPrefix("project:"): self = .project(String(s.dropFirst(8)))
        case let s? where s.hasPrefix("session:"): self = .session(String(s.dropFirst(8)))
        default: self = .welcome
        }
    }
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

    init(record: SessionRecord) {
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
    var notifications: [AppNotification] = []
    var sidebarQuery = ""
    /// A short message at the bottom of the window.
    var toast: String?
    /// Status changes go to stderr (snapshot runs, `--verbose`).
    @ObservationIgnored var logsStatus = ProcessInfo.processInfo.arguments.contains("--verbose")
    /// Bumped to put the cursor in the sidebar's search field.
    var searchFocusRequest = 0
    /// ⌘K is open.
    var paletteOpen = false
    /// The new-session picker is open for this project ("" for a terminal of its own).
    var newSessionPicker: String?
    var notificationsOpen = false
    enum PaletteScope { case all, go }
    var paletteScope = PaletteScope.all
    /// Agents found on this Mac (refreshed at launch and when the picker opens).
    var installedAgents: [AgentDetector.Found] = []
    var lastAgent: AgentKind? {
        get { UserDefaults.standard.string(forKey: "agents.last").flatMap(AgentKind.init(rawValue:)) }
        set { UserDefaults.standard.set(newValue?.rawValue, forKey: "agents.last") }
    }

    func refreshAgents() {
        Task { installedAgents = await AgentDetector.detect() }
    }
    /// The last session you looked at in each project (project id → session id).
    var lastSession: [String: String] = [:]

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
        for record in file.sessions {
            // Shells start fresh in the folders they were in.
            let session = Session(record: record)
            sessions.append(session)
            for p in record.panes {
                panes[p.id] = TerminalPane(id: p.id, sessionId: session.id, cwd: p.cwd, command: p.command, store: self)
            }
        }
        let restored = Selection(encoded: file.selection)
        selection = isValid(restored) ? restored : .welcome
    }

    func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    private func poll() {
        for pane in panes.values { pane.poll() }
    }

    private func isValid(_ s: Selection) -> Bool {
        switch s {
        case let .project(id): project(id) != nil
        case let .session(id): session(id) != nil
        default: true
        }
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
        case .terminals: return .terminals
        case let .session(id):
            guard let s = session(id) else { return nil }
            return s.projectId.map(TabContext.project) ?? .terminals
        default: return nil
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

    func sessionTitle(_ session: Session) -> String {
        let lead = leadPane(of: session)
        if let app = lead?.agentApp { return AgentKind(program: app)?.name ?? app }
        if let program = lead?.program { return AgentKind(program: program)?.name ?? program }
        if let title = lead?.title, !title.isEmpty, title.count < 40 { return title }
        return Shell.programName(Shell.current)
    }

    func sessionSubtitle(_ session: Session) -> String {
        Paths.tilde(leadPane(of: session)?.cwd ?? session.cwd)
    }

    func icon(of session: Session) -> String? {
        let lead = leadPane(of: session)
        return lead?.agentApp ?? lead?.program
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
        for s in sessions(in: id) { closeSession(s.id) }
        projects.removeAll { $0.id == id }
        if currentProjectId == id { selection = .welcome }
        scheduleSave()
    }

    func openProject(_ id: String) {
        guard let i = projects.firstIndex(where: { $0.id == id }) else { return }
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
    @discardableResult
    func newSession(projectId: String?, command: String? = nil, kind: SessionKind = .shell) -> Session {
        let cwd = project(projectId)?.path ?? NSHomeDirectory()
        let paneId = UUID().uuidString
        let record = SessionRecord(projectId: projectId, kind: kind, command: command, cwd: cwd, layout: .pane(paneId),
                                   panes: [PaneRecord(id: paneId, cwd: cwd, command: command)], focusedPaneId: paneId)
        let session = Session(record: record)
        sessions.append(session)
        panes[paneId] = TerminalPane(id: paneId, sessionId: session.id, cwd: cwd, command: command, store: self)
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
        if case .session(id) = selection {
            let rest = sessions(in: s.projectId)
            if !rest.isEmpty {
                selection = .session(rest[min(index, rest.count - 1)].id)
            } else if let pid = s.projectId {
                selection = .project(pid)
            } else {
                selection = .terminals
            }
        }
        scheduleSave()
    }

    func split(_ axis: SplitAxis, paneId: String? = nil, command: String? = nil) {
        guard let s = currentSession, let target = paneId ?? s.focusedPaneId ?? s.layout.paneIds.last,
              let source = panes[target] else { return }
        let newId = UUID().uuidString
        panes[newId] = TerminalPane(id: newId, sessionId: s.id, cwd: source.cwd, command: command, store: self)
        s.layout = s.layout.splitting(target, axis: axis, newId: newId)
        s.focusedPaneId = newId
        scheduleSave()
        focusSoon(newId)
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
        let current = currentSession.flatMap { s in tabs.firstIndex { $0.id == s.id } } ?? -1
        selection = .session(tabs[(current + delta + tabs.count) % tabs.count].id)
    }

    func open(session id: String, pane paneId: String? = nil) {
        selection = .session(id)
        if let paneId { session(id)?.focusedPaneId = paneId }
        if let p = paneId ?? session(id)?.focusedPaneId { focusSoon(p) }
    }

    func focusSoon(_ paneId: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.panes[paneId]?.focus()
        }
    }

    private func selectionChanged(from old: Selection) {
        if case let .session(id) = selection, let s = session(id) {
            if let pid = s.projectId { lastSession[pid] = id }
            for n in notifications.indices where notifications[n].sessionId == id { notifications[n].read = true }
            if let f = s.focusedPaneId { focusSoon(f) }
        }
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
        guard let new, new == .blocked || (new == .done && old == .working) else { return }
        let looking = selection == .session(pane.sessionId) && NSApp.isActive
        notifications.insert(AppNotification(sessionId: pane.sessionId, paneId: pane.id, state: new, app: pane.agentApp,
                                             message: pane.statusMessage, date: Date(), read: looking), at: 0)
        if notifications.count > 200 { notifications.removeLast(notifications.count - 200) }
        if !NSApp.isActive, new == .blocked { NSApp.requestUserAttention(.informationalRequest) }
        let wants = UserDefaults.standard.object(forKey: new == .blocked ? "notify.waiting" : "notify.done") as? Bool ?? true
        if !looking, persistence != nil, wants {
            let who = pane.agentApp.flatMap { AgentKind(program: $0)?.name } ?? sessionTitle(session(pane.sessionId) ?? sessions[0])
            let place = project(session(pane.sessionId)?.projectId)?.name ?? String(localized: "Terminal")
            let title = new == .blocked ? String(localized: "\(who) is waiting for you") : String(localized: "\(who) is done")
            SystemNotices.post(title: title, body: [pane.statusMessage, place].compactMap { $0 }.joined(separator: " · "),
                               sessionId: pane.sessionId, sound: new == .blocked)
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
                              PaneRecord(id: id, cwd: panes[id]?.cwd ?? s.cwd, command: panes[id]?.command)
                          },
                          focusedPaneId: s.focusedPaneId, createdAt: s.createdAt)
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
