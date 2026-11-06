import AppKit
import SwiftUI
import TezgahCore

/// A project's board: its agents, its changes, its services.
struct DashboardView: View {
    @Environment(AppStore.self) private var store
    let project: ProjectRecord
    @State private var git: GitSummary?
    @State private var gitLoaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                HStack(alignment: .top, spacing: 16) {
                    agents.frame(maxWidth: .infinity)
                    changes.frame(width: 340)
                }
                services
            }
            .padding(.horizontal, 28)
            .padding(.top, 14)
            .padding(.bottom, 28)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
        .task(id: project.path) { await refresh() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await refresh() }
        }
    }

    private func refresh() async {
        git = await Git.summary(at: project.path)
        gitLoaded = true
    }

    private var header: some View {
        HStack(spacing: 14) {
            ProjectIconView(path: project.path, name: project.name, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text(project.name).font(.system(size: 24, weight: .semibold)).foregroundStyle(Palette.ink)
                HStack(spacing: 6) {
                    Text(Paths.tilde(project.path))
                    if let branch = git?.branch {
                        Text("·")
                        Image(systemName: "arrow.triangle.branch").font(.system(size: 11))
                        Text(branch)
                    }
                }
                .font(.system(size: 13))
                .foregroundStyle(Palette.secondary)
                .textSelection(.enabled)
            }
            Spacer()
            Button { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.path)]) } label: {
                Label("Finder", systemImage: "folder")
            }
            .help("Reveal in Finder")
            Button { store.newSession(projectId: project.id) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text("New Session")
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.ink)
            .help("New Session  ⌘T")
        }
        .controlSize(.large)
        .padding(.bottom, 4)
    }

    private var agents: some View {
        let sessions = store.sessions(in: project.id)
        return Card {
            VStack(alignment: .leading, spacing: 10) {
                CardTitle(title: "Agents", detail: sessions.isEmpty ? nil : "\(sessions.count)")
                if sessions.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("No sessions yet. Start a shell here and run any agent: Claude Code, Codex, Gemini…")
                            .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                            .fixedSize(horizontal: false, vertical: true)
                        Button { store.newSession(projectId: project.id) } label: {
                            HStack(spacing: 8) { Text("New Session"); KeyCap(keys: "⌘T") }
                        }
                    }
                    .padding(.vertical, 6)
                }
                ForEach(sessions) { s in AgentRow(session: s, showProject: false) }
            }
        }
    }

    private var changes: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                CardTitle(title: "Changes")
                if let git {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(git.changedFiles)").font(.system(size: 30, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text(git.changedFiles == 1 ? "file changed" : "files changed").font(.system(size: 13)).foregroundStyle(Palette.secondary)
                    }
                    HStack(spacing: 10) {
                        Text("+\(git.added)").foregroundStyle(Palette.add)
                        Text("−\(git.removed)").foregroundStyle(Palette.del)
                        Spacer()
                        if let b = git.branch {
                            Label(b, systemImage: "arrow.triangle.branch").foregroundStyle(Palette.secondary).lineLimit(1)
                        }
                    }
                    .font(Fonts.mono(12.5, weight: .medium))
                    if !git.files.isEmpty {
                        Divider().opacity(0.6)
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(git.files.prefix(7), id: \.self) { f in
                                HStack(spacing: 8) {
                                    Text(f.status.isEmpty ? "M" : String(f.status.prefix(1)))
                                        .font(Fonts.mono(11, weight: .medium))
                                        .foregroundStyle(f.status.hasPrefix("?") || f.status.hasPrefix("A") ? Palette.add : f.status.hasPrefix("D") ? Palette.del : Palette.waiting)
                                        .frame(width: 12)
                                    Text(f.path).font(Fonts.mono(11.5)).foregroundStyle(Palette.secondary).lineLimit(1).truncationMode(.head)
                                    Spacer(minLength: 4)
                                    if let a = f.added, let r = f.removed {
                                        Text("+\(a) −\(r)").font(Fonts.mono(11)).foregroundStyle(Palette.tertiary)
                                    }
                                }
                            }
                            if git.files.count > 7 {
                                Text("and \(git.files.count - 7) more").font(.system(size: 11.5)).foregroundStyle(Palette.tertiary)
                            }
                        }
                    } else {
                        Text("Working tree clean").font(.system(size: 12.5)).foregroundStyle(Palette.tertiary)
                    }
                } else if gitLoaded {
                    Text("Not a git repository").font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                } else {
                    ProgressView().controlSize(.small)
                }
            }
        }
    }

    private var services: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                CardTitle(title: "Services", detail: "coming later")
                HStack(spacing: 12) {
                    Image(systemName: "server.rack").font(.system(size: 18, weight: .light)).foregroundStyle(Palette.tertiary)
                    Text("Dev servers and scripts this project runs (npm run dev, docker compose…) will live here, with their ports and logs.")
                        .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// A session as the board and the Agents page list it: icon, what it does, state and for how long.
struct AgentRow: View {
    @Environment(AppStore.self) private var store
    let session: Session
    var showProject: Bool
    @State private var hovering = false

    var body: some View {
        let lead = store.leadPane(of: session)
        let status = store.status(of: session)
        Button { store.open(session: session.id, pane: lead?.id) } label: {
            HStack(spacing: 12) {
                ProgramIcon(program: store.icon(of: session), size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(lead?.statusMessage ?? lead?.records.primary?.title ?? store.sessionTitle(session))
                        .font(.system(size: 13.5, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
                    TimelineView(.periodic(from: .now, by: 15)) { ctx in
                        Text(subtitle(status: status, now: ctx.date))
                            .font(.system(size: 12)).foregroundStyle(Palette.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if let status {
                    Text(status.label).font(.system(size: 11.5, weight: .medium)).foregroundStyle(Palette.status(status))
                }
                StatusDot(state: status, size: 8).opacity(status == nil ? 0.35 : 1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hovering ? Palette.hover : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .padding(.horizontal, -10)
    }

    private func subtitle(status: AgentState?, now: Date) -> String {
        var parts: [String] = [store.sessionTitle(session)]
        if showProject { parts.append(store.project(session.projectId)?.name ?? "terminal") }
        let since = Durations.short(now.timeIntervalSince(store.statusSince(of: session)))
        if let status { parts.append("\(status.label) \(since)") } else { parts.append("open \(since)") }
        let panes = session.layout.paneIds.count
        if panes > 1 { parts.append("\(panes) panes") }
        return parts.joined(separator: " · ")
    }
}
