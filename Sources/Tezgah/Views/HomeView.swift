import AppKit
import SwiftUI
import TezgahCore

/// Home: the sky with the day's summary, what waits for you, and every project. No bars here: the
/// projects are the page.
struct HomeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    static let horizon: Double = 196

    var body: some View {
        let waiting = store.waitingSessions
        let working = store.workingSessions
        let finished = store.sessions.filter { store.status(of: $0) == .done }

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header(waiting: waiting.count, working: working.count)
                VStack(alignment: .leading, spacing: Grid.Space.s8) {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Grid.Space.s2) { projectActions; sessionActions }
                        VStack(alignment: .leading, spacing: Grid.Space.s2) {
                            HStack(spacing: Grid.Space.s2) { projectActions }
                            HStack(spacing: Grid.Space.s2) { sessionActions }
                        }
                    }
                    if !waiting.isEmpty {
                        VStack(alignment: .leading, spacing: Grid.Space.s3) {
                            SectionTitle(title: "Waiting for you", count: waiting.count)
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 380, maximum: 560), spacing: Grid.Space.s3, alignment: .top)],
                                      alignment: .leading, spacing: Grid.Space.s3) {
                                ForEach(waiting) { WaitingCard(session: $0) }
                            }
                        }
                    }
                    // Every agent at work, whichever project it is in.
                    if !working.isEmpty {
                        VStack(alignment: .leading, spacing: Grid.Space.s3) {
                            SectionTitle(title: "Working", count: working.count)
                            RowList(sessions: working)
                        }
                    }
                    if !finished.isEmpty {
                        VStack(alignment: .leading, spacing: Grid.Space.s3) {
                            SectionTitle(title: "Finished", count: finished.count)
                            RowList(sessions: finished)
                        }
                    }
                    VStack(alignment: .leading, spacing: Grid.Space.s3) {
                        SectionTitle(title: "Projects", count: store.projects.count)
                        if store.projects.isEmpty {
                            EmptyProjects()
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: Grid.Space.s3, alignment: .top)], spacing: Grid.Space.s3) {
                                ForEach(Array(store.recentProjects.enumerated()), id: \.element.id) { i, p in
                                    ProjectCard(project: p, number: i < 9 ? i + 1 : nil)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, Grid.Space.s12)
                .padding(.top, Grid.Space.s8)
                .padding(.bottom, Grid.Space.s12)
                .frame(maxWidth: 1240, alignment: .leading)
            }
        }
        .scrollIndicators(.automatic)
        .background { PaperGrid() }
        .background(look.base)
    }

    @ViewBuilder private var projectActions: some View {
        QuickAction(symbol: "folder", title: "Open Folder", keys: "⌘O") { AppActions.openFolder() }
        QuickAction(symbol: "folder.badge.plus", title: "New Folder", keys: "⇧⌘N") { AppActions.newFolder() }
    }

    @ViewBuilder private var sessionActions: some View {
        QuickAction(symbol: "plus", title: "New Session", keys: "⌘T") { AppActions.newSessionHere() }
        QuickAction(symbol: "chevron.forward.2", title: "Terminal", keys: "⌘N") { _ = store.newSession(projectId: nil) }
        QuickAction(symbol: "magnifyingglass", title: "Search", keys: "⌘K") { store.paletteOpen = true }
    }

    private func header(waiting: Int, working: Int) -> some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                    .type(.body).foregroundStyle(.white.opacity(0.8))
                Text(hello).type(.title1, .semibold).foregroundStyle(.white).accessibilityAddTraits(.isHeader)
                Text(summary(waiting: waiting, working: working)).type(.lead).foregroundStyle(.white.opacity(0.88))
            }
            .padding(.leading, Grid.Space.s12)
            .padding(.top, 60)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            TezgahMark(width: 92, color: .white, blinking: true)
                .padding(.trailing, 64)
        }
        .frame(height: Self.horizon)
        // The sky is part of the page: it leaves with the greeting when you scroll, instead of staying
        // behind as a blue band under the cards.
        .background { SkyView() }
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 4) {
                SkyButton(symbol: "magnifyingglass", label: "Search") { store.paletteOpen = true }
                SkyButton(symbol: "bell", label: "Notifications", badge: store.unreadNotifications > 0) { store.toggleNotifications() }
                SkyButton(symbol: "gearshape", label: "Settings") { AppActions.showSettings() }
            }
            .padding(.top, 12).padding(.trailing, 12)
        }
    }

    private var hello: String {
        switch Calendar.current.component(.hour, from: store.now) {
        case 5 ..< 12: String(localized: "Good morning")
        case 12 ..< 18: String(localized: "Good afternoon")
        default: String(localized: "Good evening")
        }
    }

    private func summary(waiting: Int, working: Int) -> String {
        var parts: [String] = []
        if working > 0 { parts.append(String(localized: "\(working) at work.")) }
        if waiting == 1 { parts.append(String(localized: "An agent is waiting for you.")) }
        if waiting > 1 { parts.append(String(localized: "\(waiting) agents are waiting for you.")) }
        return parts.isEmpty ? String(localized: "Nothing is running right now.") : parts.joined(separator: " ")
    }
}

/// A white icon on the sky.
private struct SkyButton: View {
    let symbol: String
    let label: LocalizedStringKey
    var badge = false
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(.white.opacity(hover ? 0.16 : 0), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if badge { Circle().fill(.white).frame(width: 6, height: 6).padding(5) }
                }
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(Text(label))
        .accessibilityLabel(Text(label))
    }
}

private struct SectionTitle: View {
    let title: LocalizedStringKey
    let count: Int
    var color: Color?
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: Grid.Space.s2) {
            Text(title).type(.lead, .semibold).foregroundStyle(color ?? look.ink)
            Text("\(count)").type(.small).foregroundStyle(look.faint)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct Quiet: View {
    let text: LocalizedStringKey
    @Environment(\.look) private var look
    var body: some View {
        Text(text).type(.body).foregroundStyle(look.muted)
            .padding(Grid.Space.s4).frame(maxWidth: .infinity, alignment: .leading).card(look)
    }
}

struct QuickAction: View {
    let symbol: String
    let title: LocalizedStringKey
    let keys: String
    let action: () -> Void
    @Environment(\.look) private var look
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(look.muted)
                Text(title).type(.body, .medium).foregroundStyle(look.ink)
                KeyHint(keys: keys)
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(hover ? look.sunken : look.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(look.line))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// An agent asking you something: its question, where, and a way to answer.
private struct WaitingCard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let session: Session

    var body: some View {
        let lead = store.leadPane(of: session)
        VStack(alignment: .leading, spacing: Grid.Space.s3) {
            HStack(spacing: Grid.Space.s3) {
                LogoTile(program: store.icon(of: session), size: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(lead?.statusMessage ?? String(localized: "Waiting for your answer"))
                        .type(.body, .semibold).foregroundStyle(look.ink).lineLimit(2)
                    Text(meta).type(.caption).foregroundStyle(look.muted).lineLimit(1)
                }
                Spacer(minLength: 8)
                StateMark(state: store.status(of: session))
            }
            HStack {
                Spacer()
                Button("Show") { store.open(session: session.id, pane: lead?.id) }
                    .buttonStyle(TZButtonStyle(kind: .primary, small: true))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(Grid.Space.s4)
        .card(look)
    }

    private var meta: String {
        let who = AgentKind(program: store.icon(of: session))?.command ?? store.sessionTitle(session)
        let project = store.project(session.projectId)?.name ?? String(localized: "Terminal")
        return "\(who) · \(project) · \(Durations.local(store.now.timeIntervalSince(store.statusSince(of: session))))"
    }
}

private struct RowList: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let sessions: [Session]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(sessions.enumerated()), id: \.element.id) { i, s in
                Button { store.open(session: s.id) } label: { row(s) }.buttonStyle(.plain)
                if i < sessions.count - 1 { Rectangle().fill(look.line).frame(height: 1) }
            }
        }
        .card(look)
    }

    private func row(_ s: Session) -> some View {
        let lead = store.leadPane(of: s)
        return VStack(alignment: .leading, spacing: Grid.Space.s2) {
            HStack(spacing: Grid.Space.s3) {
                LogoTile(program: store.icon(of: s), size: 28)
                VStack(alignment: .leading, spacing: 0) {
                    Text(store.sessionTitle(s)).type(.body, .medium).foregroundStyle(look.ink).lineLimit(1)
                    Text([store.project(s.projectId)?.name ?? String(localized: "Terminal"), lead?.statusMessage].compactMap { $0 }.joined(separator: " · "))
                        .type(.caption).foregroundStyle(look.muted).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(Durations.local(store.now.timeIntervalSince(store.statusSince(of: s)))).type(.caption, mono: true).foregroundStyle(look.faint)
                StateMark(state: store.status(of: s))
            }
            if let p = lead?.progress {
                ProgressBar(value: Double(p) / 100)
            }
        }
        .padding(.horizontal, Grid.Space.s4)
        .padding(.vertical, Grid.Space.s3)
        .contentShape(Rectangle())
    }
}

struct ProgressBar: View {
    let value: Double
    @Environment(\.look) private var look
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(look.ink.opacity(0.08))
                Capsule().fill(look.working).frame(width: g.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: 3)
        .accessibilityElement()
        .accessibilityLabel(Text("Progress"))
        .accessibilityValue(Text("\(Int(value * 100))%"))
    }
}

/// An agent's logo on a small raised square.
struct LogoTile: View {
    let program: String?
    var size: Double = 28
    @Environment(\.look) private var look
    var body: some View {
        ProgramMark(program: program, size: size * 0.57)
            .frame(width: size, height: size)
            .background(look.raised, in: RoundedRectangle(cornerRadius: size / 3.5, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: size / 3.5, style: .continuous).strokeBorder(look.line))
    }
}

private struct ProjectCard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let project: ProjectRecord
    /// The key that opens it from home (1–9).
    var number: Int?
    @State private var branch: String?
    @State private var hover = false

    var body: some View {
        let sessions = store.sessions(in: project.id)
        let agents = Array(Set(sessions.compactMap { AgentKind(program: store.icon(of: $0)) })).sorted { $0.rawValue < $1.rawValue }
        let missing = store.missingProjects.contains(project.id)
        Button { if missing { store.relocateProject(project.id) } else { store.openProject(project.id) } } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(project.name).type(.body, .semibold).foregroundStyle(missing ? look.muted : look.ink).lineLimit(1)
                    Spacer(minLength: 4)
                    if missing {
                        Image(systemName: "exclamationmark.triangle").font(.system(size: 12)).foregroundStyle(look.waiting)
                    } else {
                        StateMark(state: store.status(ofProject: project.id))
                    }
                }
                Text(missing ? String(localized: "The folder can't be found. Click to locate it.") : line(sessions))
                    .type(.small).foregroundStyle(look.muted).lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 6)
                HStack(spacing: 6) {
                    ForEach(agents) { AgentLogo(kind: $0, size: 13) }
                    if agents.isEmpty { Text(" ").type(.caption) }
                    Spacer()
                    if let number, !missing { KeyHint(keys: "\(number)").opacity(hover ? 1 : 0.6) }
                }
            }
            .frame(minHeight: 84, alignment: .topLeading)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card(look, ring: hover ? look.selectedEdge : nil)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .contextMenu {
            Button("New Session…") { store.refreshAgents(); store.newSessionPicker = project.id }
            Button("Show Board") { store.showBoard(project.id) }
            Divider()
            if missing { Button("Locate Folder…") { store.relocateProject(project.id) } }
            Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.path)]) }
                .disabled(missing)
            Divider()
            Button("Remove from Tezgah") { store.confirmRemoveProject(project.id) }
        }
        .help(Text(Paths.tilde(project.path)))
        .task(id: project.path) { branch = await Git.branch(at: project.path) }
    }

    /// What's happening inside, else where it stands.
    private func line(_ sessions: [Session]) -> String {
        if let s = sessions.first(where: { [.blocked, .error, .working].contains(store.status(of: $0)) }),
           let m = store.leadPane(of: s)?.statusMessage { return m }
        return subtitle(sessions.count)
    }

    private func subtitle(_ count: Int) -> String {
        var parts: [String] = []
        if let branch { parts.append(branch) }
        if count == 1 { parts.append(String(localized: "1 session")) }
        if count > 1 { parts.append(String(localized: "\(count) sessions")) }
        if let d = project.lastOpened { parts.append(d.formatted(.relative(presentation: .named))) }
        return parts.joined(separator: " · ")
    }
}

private struct EmptyProjects: View {
    @Environment(\.look) private var look
    var body: some View {
        VStack(alignment: .leading, spacing: Grid.Space.s3) {
            Text("Add a folder you work in. Its sessions, changes and conversations gather here.").type(.body).foregroundStyle(look.soft)
            HStack(spacing: Grid.Space.s2) {
                Button("Open Folder…") { AppActions.openFolder() }.buttonStyle(TZButtonStyle(kind: .primary))
                Button("New Folder…") { AppActions.newFolder() }.buttonStyle(TZButtonStyle())
            }
        }
        .padding(Grid.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(look)
    }
}

/// A project's board: its sessions, its changes, and the conversations its agents have had here.
struct BoardView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let project: ProjectRecord
    @State private var git: GitSummary?
    @State private var gitRead = false
    @State private var conversations: [ConversationInfo] = []
    @State private var showAll = false

    private static let shown = 8

    var body: some View {
        let sessions = store.sessions(in: project.id)
        let missing = store.missingProjects.contains(project.id)
        ScrollView {
            VStack(alignment: .leading, spacing: Grid.Space.s6) {
                HStack(spacing: Grid.Space.s3) {
                    Monogram(name: project.name, size: 40, active: true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(project.name).type(.title3, .semibold).foregroundStyle(look.ink).lineLimit(1)
                        Text([Paths.tilde(project.path), git?.branch].compactMap { $0 }.joined(separator: " · "))
                            .type(.caption, mono: true).foregroundStyle(look.muted).lineLimit(1).truncationMode(.middle)
                    }
                    Spacer(minLength: Grid.Space.s4)
                    if !missing {
                        IconButton(symbol: "folder", label: "Show in Finder") {
                            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.path)])
                        }
                        Button { _ = store.newSession(projectId: project.id) } label: { Label("Terminal", systemImage: "chevron.forward.2") }
                            .buttonStyle(TZButtonStyle())
                        Button { store.refreshAgents(); store.newSessionPicker = project.id } label: { Label("New Session", systemImage: "plus") }
                            .buttonStyle(TZButtonStyle(kind: .primary))
                    }
                }

                if missing {
                    VStack(alignment: .leading, spacing: Grid.Space.s3) {
                        Label { Text("The folder can't be found").type(.body, .semibold).foregroundStyle(look.ink) } icon: {
                            Image(systemName: "exclamationmark.triangle").foregroundStyle(look.waiting)
                        }
                        Text("It was moved, renamed, or is on a disk that isn't connected. Show Tezgah where it is now, or take it off the list.")
                            .type(.body).foregroundStyle(look.muted)
                        HStack(spacing: Grid.Space.s2) {
                            Button("Locate Folder…") { store.relocateProject(project.id) }.buttonStyle(TZButtonStyle(kind: .primary))
                            Button("Remove from Tezgah") { store.confirmRemoveProject(project.id) }.buttonStyle(TZButtonStyle())
                        }
                    }
                    .padding(Grid.Space.s4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(look)
                } else {
                    HStack(alignment: .top, spacing: Grid.Space.s3) {
                        BoardCard(title: "Sessions", trailing: sessions.isEmpty ? "" : "\(sessions.count)") {
                            if sessions.isEmpty {
                                Text(conversations.isEmpty ? "Nothing is open here yet. Start an agent or a terminal."
                                    : "Nothing is open here yet. Start an agent or a terminal, or pick up a conversation below.")
                                    .type(.body).foregroundStyle(look.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            ForEach(sessions) { s in
                                Button { store.open(session: s.id) } label: {
                                    HStack(spacing: 10) {
                                        ProgramMark(program: store.icon(of: s), size: 16)
                                        VStack(alignment: .leading, spacing: 0) {
                                            Text(store.sessionTitle(s)).type(.body, .medium).foregroundStyle(look.ink).lineLimit(1)
                                            (store.status(of: s).map { Text($0.spokenName) } ?? Text("idle"))
                                                .type(.caption).foregroundStyle(look.muted)
                                        }
                                        Spacer()
                                        Text(Durations.local(store.now.timeIntervalSince(store.statusSince(of: s)))).type(.caption, mono: true).foregroundStyle(look.faint)
                                        StateMark(state: store.status(of: s))
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if let p = store.leadPane(of: s)?.progress { ProgressBar(value: Double(p) / 100) }
                            }
                        }
                        changes
                    }
                    if !conversations.isEmpty { history }
                }
            }
            .padding(.horizontal, Grid.Space.s8)
            .padding(.vertical, Grid.Space.s6)
            .frame(maxWidth: 1080)
            .frame(maxWidth: .infinity)
        }
        // Not into the title bar's safe area: there it would paint over the bar above.
        .background(look.base, ignoresSafeAreaEdges: [])
        // The board keeps up with what the agents do while you look at it.
        .task(id: project.path) {
            while !Task.isCancelled {
                // Nobody is looking (another app in front, the window closed): nothing to keep up with.
                if gitRead, !store.windowInSight() {
                    try? await Task.sleep(for: .seconds(2))
                    continue
                }
                let g = await Git.summary(at: project.path)
                if g != git { git = g }
                gitRead = true
                let c = await ConversationList.all(for: project.path)
                if c != conversations { conversations = c }
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    private var changes: some View {
        BoardCard(title: "Changes", trailing: git.map { "+\($0.added) −\($0.removed)" } ?? "") {
            if let git, !git.files.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.branch").font(.system(size: 12)).foregroundStyle(look.soft)
                    Text(git.branch ?? "").type(.body, .medium).foregroundStyle(look.ink)
                    Spacer()
                    Text("\(git.changedFiles) files").type(.caption).foregroundStyle(look.muted)
                }
                ForEach(git.files.prefix(8), id: \.self) { f in
                    HStack(spacing: 8) {
                        Text(f.status).type(.caption, .medium, mono: true).foregroundStyle(color(f.status)).frame(width: 16, alignment: .leading)
                        Text(f.path).type(.caption, mono: true).foregroundStyle(look.soft).lineLimit(1).truncationMode(.head)
                    }
                }
                if git.files.count > 8 {
                    Text("and \(git.files.count - 8) more").type(.caption).foregroundStyle(look.faint)
                }
            } else if git != nil {
                Text("Nothing changed.").type(.body).foregroundStyle(look.muted)
            } else if gitRead {
                Text("Not a git repository.").type(.body).foregroundStyle(look.muted)
            } else {
                Text(" ").type(.body)
            }
        }
    }

    /// Every conversation an agent has had in this folder (Claude Code, Grok, Codex): they stay with the project.
    private var history: some View {
        let open = store.openConversations
        let list = showAll ? conversations : Array(conversations.prefix(Self.shown))
        return BoardCard(title: "Conversations", trailing: "\(conversations.count)") {
            VStack(spacing: 2) {
                ForEach(list) { c in
                    ConversationRow(conversation: c, isOpen: open.contains(c.id)) {
                        store.resume(c, in: project.id)
                    } trash: {
                        trash(c)
                    }
                }
            }
            .padding(.horizontal, -8).padding(.vertical, -6)
            if conversations.count > Self.shown {
                Button(showAll ? "Show fewer" : "Show all \(conversations.count)") { showAll.toggle() }
                    .buttonStyle(.plain).type(.caption, .medium).foregroundStyle(look.soft)
            }
        }
    }

    private func trash(_ c: ConversationInfo) {
        if (try? FileManager.default.trashItem(at: c.url, resultingItemURL: nil)) != nil {
            conversations.removeAll { $0.id == c.id }
            AppActions.toast(String(localized: "Conversation moved to the Trash"))
        }
    }

    private func color(_ status: String) -> Color {
        switch status {
        case "A", "??": look.done
        case "D": look.failed
        default: look.waiting
        }
    }
}

/// One past conversation: what it was about, when, and a way back into it.
private struct ConversationRow: View {
    let conversation: ConversationInfo
    let isOpen: Bool
    let resume: () -> Void
    let trash: () -> Void
    @Environment(\.look) private var look
    @State private var hover = false

    var body: some View {
        Button(action: resume) {
            HStack(spacing: 10) {
                AgentLogo(kind: conversation.agent, size: 14).frame(width: 16)
                Text(conversation.title).type(.body).foregroundStyle(look.ink).lineLimit(1)
                Spacer(minLength: 12)
                if isOpen {
                    Text("open").type(.caption, .medium).foregroundStyle(look.accent)
                        .padding(.horizontal, 6).frame(height: 18)
                        .background(look.selected, in: Capsule())
                } else if hover {
                    Text("Resume").type(.caption, .medium).foregroundStyle(look.soft)
                }
                Text(conversation.modified.formatted(.relative(presentation: .named))).type(.caption).foregroundStyle(look.faint)
                    .frame(minWidth: 72, alignment: .trailing)
            }
            .padding(.horizontal, 8)
            .frame(height: 32)
            .background(hover ? look.selected : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .contextMenu {
            Button(isOpen ? "Go to Session" : "Resume") { resume() }
            Button("Copy Conversation ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(conversation.id, forType: .string)
                AppActions.toast(String(localized: "Copied"))
            }
            Divider()
            Button("Move to Trash") { trash() }.disabled(isOpen)
        }
        .accessibilityLabel(Text(conversation.title))
        .accessibilityHint(Text(isOpen ? "Go to Session" : "Resume"))
    }
}

private struct BoardCard<Content: View>: View {
    let title: LocalizedStringKey
    var trailing: String = ""
    @ViewBuilder var content: Content
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title).type(.body, .semibold).foregroundStyle(look.ink)
                Spacer()
                Text(trailing).type(.caption, mono: true).foregroundStyle(look.faint)
            }
            .padding(.horizontal, Grid.Space.s4)
            .frame(height: 44)
            Rectangle().fill(look.line).frame(height: 1)
            VStack(alignment: .leading, spacing: 10) { content }.padding(Grid.Space.s4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(look)
    }
}
