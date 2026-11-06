import AppKit
import SwiftUI
import TezgahCore

private struct PageHeader: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 24, weight: .semibold)).foregroundStyle(Palette.ink)
            if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(Palette.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 6)
    }
}

/// Every session, the ones that need you first.
struct AgentsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader(title: "Agents", subtitle: "Any agent that reports its state (OSC 7501): Claude Code, Codex, Gemini, your own scripts.")
                let groups: [(String, [Session])] = [
                    ("Needs you", filter { $0 == .blocked || $0 == .error }),
                    ("Working", filter { $0 == .working }),
                    ("Done", filter { $0 == .done }),
                    ("Other sessions", store.sessions.filter { s in let st = store.status(of: s); return st == nil || st == .idle }),
                ]
                if store.sessions.isEmpty {
                    Card {
                        Text("No sessions are open. ⌘T starts one in a project, ⌘N in your home folder.")
                            .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                    }
                }
                ForEach(groups, id: \.0) { title, list in
                    if !list.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                CardTitle(title: title, detail: "\(list.count)")
                                ForEach(list) { s in AgentRow(session: s, showProject: true) }
                            }
                        }
                    }
                }
            }
            .padding(28)
            .padding(.top, -14)
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
    }

    private func filter(_ match: (AgentState) -> Bool) -> [Session] {
        store.sessions.filter { s in store.status(of: s).map(match) ?? false }
    }
}

struct NotificationsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    PageHeader(title: "Notifications", subtitle: "When an agent needs you or finishes.")
                    if !store.notifications.isEmpty {
                        Button("Clear") { store.notifications.removeAll() }
                    }
                }
                Card(padding: 8) {
                    VStack(alignment: .leading, spacing: 0) {
                        if store.notifications.isEmpty {
                            Text("Nothing yet.").font(.system(size: 13)).foregroundStyle(Palette.tertiary).padding(10)
                        }
                        ForEach(store.notifications) { n in row(n) }
                    }
                }
            }
            .padding(28)
            .padding(.top, -14)
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
        .onDisappear {
            for i in store.notifications.indices { store.notifications[i].read = true }
        }
    }

    private func row(_ n: AppNotification) -> some View {
        let session = store.session(n.sessionId)
        return HoverLine {
            store.open(session: n.sessionId, pane: n.paneId)
        } content: {
            StatusDot(state: n.state, size: 7)
            ProgramIcon(program: n.app, size: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(Programs.displayName(n.app ?? "shell")) \(n.state == .blocked ? "needs you" : "is done")")
                    .font(.system(size: 13, weight: n.read ? .regular : .semibold)).foregroundStyle(Palette.ink)
                Text([session.flatMap { store.project($0.projectId)?.name } ?? "terminal", n.message].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(Palette.secondary).lineLimit(1)
            }
            Spacer()
            Text(n.date, style: .time).font(Fonts.mono(11.5)).foregroundStyle(Palette.tertiary)
        }
        .frame(height: 46)
        .padding(.horizontal, 10)
    }
}

struct SettingsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader(title: "Settings", subtitle: "A prototype: most choices are fixed for now.")
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        row("Appearance", "Follows the system (light and dark)")
                        row("Terminal", "Ghostty (libghostty) · \(TerminalLook.fontFamily) \(Int(TerminalLook.fontSize)) pt")
                        row("Shell", "\(Shell.current) -l  · TERM=xterm-256color")
                        row("Agent status", "OSC 7501, answered for programs that ask")
                        HStack {
                            row("Data folder", Paths.tilde(store.persistence?.directory.path ?? "—"))
                            Spacer()
                            if let dir = store.persistence?.directory {
                                Button("Reveal") { NSWorkspace.shared.activateFileViewerSelecting([dir]) }
                            }
                        }
                        if store.canImportLegacy {
                            HStack {
                                row("Tezgah 0.1", "Bring over its projects (read only)")
                                Spacer()
                                Button("Import Projects") {
                                    let n = store.importLegacyProjects()
                                    AppActions.toast(n == 0 ? "No new projects to import" : "Imported \(n) project\(n == 1 ? "" : "s")")
                                }
                            }
                        }
                        row("Version", "Tezgah Prototype \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                    }
                }
            }
            .padding(28)
            .padding(.top, -14)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink).frame(width: 120, alignment: .leading)
            Text(value).font(.system(size: 13)).foregroundStyle(Palette.secondary).textSelection(.enabled)
        }
    }
}
