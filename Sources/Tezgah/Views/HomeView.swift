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
        let waiting = store.sessions.filter { [.blocked, .error].contains(store.status(of: $0)) }
        let working = store.sessions.filter { store.status(of: $0) == .working }

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header(waiting: waiting.count, working: working.count)
                VStack(alignment: .leading, spacing: Grid.Space.s8) {
                    HStack(spacing: Grid.Space.s2) {
                        QuickAction(symbol: "plus", title: "New Session", keys: "⌘T") { AppActions.newSessionHere() }
                        QuickAction(symbol: "folder", title: "Open Folder", keys: "⌘O") { AppActions.openFolder() }
                        QuickAction(symbol: "chevron.forward.2", title: "Terminal", keys: "⌘N") { _ = store.newSession(projectId: nil) }
                        QuickAction(symbol: "magnifyingglass", title: "Search Everything", keys: "⌘K") { store.paletteOpen = true }
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
                    VStack(alignment: .leading, spacing: Grid.Space.s3) {
                        SectionTitle(title: "Projects", count: store.projects.count)
                        if store.projects.isEmpty {
                            EmptyProjects()
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: Grid.Space.s3, alignment: .top)], spacing: Grid.Space.s3) {
                                ForEach(store.recentProjects) { ProjectCard(project: $0) }
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
        .background(alignment: .top) {
            VStack(spacing: 0) {
                SkyView().frame(height: Self.horizon)
                PaperGrid()
            }
        }
        .background(look.base)
    }

    private func header(waiting: Int, working: Int) -> some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
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
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 4) {
                SkyButton(symbol: "magnifyingglass", label: "Search") { store.paletteOpen = true }
                SkyButton(symbol: "bell", label: "Notifications") { store.notificationsOpen.toggle() }
                SkyButton(symbol: "gearshape", label: "Settings") { AppActions.showSettings() }
            }
            .padding(.top, 12).padding(.trailing, 12)
        }
    }

    private var hello: String {
        switch Calendar.current.component(.hour, from: .now) {
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
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(.white.opacity(hover ? 0.16 : 0), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
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
        return "\(who) · \(project) · \(Durations.short(Date.now.timeIntervalSince(store.statusSince(of: session))))"
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
                    Text(lead?.statusMessage ?? store.sessionTitle(s)).type(.body, .medium).foregroundStyle(look.ink).lineLimit(1)
                    Text("\(AgentKind(program: store.icon(of: s))?.command ?? store.sessionTitle(s)) · \(store.project(s.projectId)?.name ?? String(localized: "Terminal"))")
                        .type(.caption).foregroundStyle(look.muted).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text(Durations.short(Date.now.timeIntervalSince(store.statusSince(of: s)))).type(.caption, mono: true).foregroundStyle(look.faint)
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
    @State private var branch: String?
    @State private var hover = false

    var body: some View {
        let sessions = store.sessions(in: project.id)
        let agents = Array(Set(sessions.compactMap { AgentKind(program: store.icon(of: $0)) })).sorted { $0.rawValue < $1.rawValue }
        Button { store.openProject(project.id) } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(project.name).type(.body, .semibold).foregroundStyle(look.ink).lineLimit(1)
                    Spacer(minLength: 4)
                    StateMark(state: store.status(ofProject: project.id))
                }
                Text(line(sessions)).type(.small).foregroundStyle(look.muted).lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 6)
                HStack(spacing: 6) {
                    ForEach(agents) { AgentLogo(kind: $0, size: 13) }
                    if agents.isEmpty { Text(" ").type(.caption) }
                }
            }
            .frame(minHeight: 84, alignment: .topLeading)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card(look, ring: hover ? look.selectedEdge : nil)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
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
        if count > 0 { parts.append(String(localized: "\(count) sessions")) }
        if let d = project.lastOpened { parts.append(d.formatted(.relative(presentation: .named))) }
        return parts.joined(separator: " · ")
    }
}

private struct EmptyProjects: View {
    @Environment(\.look) private var look
    var body: some View {
        VStack(alignment: .leading, spacing: Grid.Space.s3) {
            Text("Add a folder you work in. Its sessions, changes and agents gather here.").type(.body).foregroundStyle(look.soft)
            Button("Open Folder…") { AppActions.openFolder() }.buttonStyle(TZButtonStyle(kind: .primary))
        }
        .padding(Grid.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(look)
    }
}

/// A project's board: its agents, its changes. Services, resources and logs come in 0.2.
struct BoardView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let project: ProjectRecord
    @State private var git: GitSummary?

    var body: some View {
        let sessions = store.sessions(in: project.id)
        ScrollView {
            VStack(alignment: .leading, spacing: Grid.Space.s6) {
                HStack(spacing: Grid.Space.s4) {
                    Monogram(name: project.name, size: 44, active: true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(project.name).type(.title2, .semibold).foregroundStyle(look.ink)
                        Text([Paths.tilde(project.path), git?.branch].compactMap { $0 }.joined(separator: " · "))
                            .type(.caption, mono: true).foregroundStyle(look.muted)
                    }
                    Spacer()
                    Button { store.newSessionPicker = project.id } label: { Label("New Session", systemImage: "plus") }
                        .buttonStyle(TZButtonStyle(kind: .primary))
                }

                if sessions.isEmpty {
                    VStack(spacing: Grid.Space.s3) {
                        TezgahMark(width: 56, blinking: true)
                        Text("No open sessions in \(project.name)").type(.title3, .semibold).foregroundStyle(look.ink)
                        Text("Start with an agent, or open a terminal.").type(.body).foregroundStyle(look.muted)
                        HStack(spacing: Grid.Space.s2) {
                            Button("Terminal  ⌘N") { _ = store.newSession(projectId: project.id) }.buttonStyle(TZButtonStyle())
                            Button("New Session  ⌘T") { store.newSessionPicker = project.id }.buttonStyle(TZButtonStyle(kind: .primary))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Grid.Space.s16)
                    .background { PaperGrid() }
                    .clipShape(RoundedRectangle(cornerRadius: Grid.Radius.card, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card, style: .continuous).strokeBorder(look.line))
                } else {
                    HStack(alignment: .top, spacing: Grid.Space.s3) {
                        BoardCard(title: "Sessions", trailing: "\(sessions.count)") {
                            ForEach(sessions) { s in
                                Button { store.open(session: s.id) } label: {
                                    HStack(spacing: 10) {
                                        ProgramMark(program: store.icon(of: s), size: 16)
                                        VStack(alignment: .leading, spacing: 0) {
                                            Text(store.sessionTitle(s)).type(.body, .medium).foregroundStyle(look.ink)
                                            (store.status(of: s).map { Text($0.spokenName) } ?? Text("idle"))
                                                .type(.caption).foregroundStyle(look.muted)
                                        }
                                        Spacer()
                                        Text(Durations.short(Date.now.timeIntervalSince(store.statusSince(of: s)))).type(.caption, mono: true).foregroundStyle(look.faint)
                                        StateMark(state: store.status(of: s))
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if let p = store.leadPane(of: s)?.progress { ProgressBar(value: Double(p) / 100) }
                            }
                        }
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
                            } else if git != nil {
                                Text("Nothing changed.").type(.body).foregroundStyle(look.muted)
                            } else {
                                Text("Not a git repository.").type(.body).foregroundStyle(look.muted)
                            }
                        }
                    }
                }
            }
            .padding(Grid.Space.s6)
        }
        .background(look.base)
        .task(id: project.path) { git = await Git.summary(at: project.path) }
    }

    private func color(_ status: String) -> Color {
        switch status {
        case "A", "??": look.done
        case "D": look.failed
        default: look.waiting
        }
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
