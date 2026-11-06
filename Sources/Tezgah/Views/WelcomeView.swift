import SwiftUI
import TezgahCore

/// Tezgah's mark as text: a tabletop on two legs with a block (the cursor) on it, in plain
/// ASCII so it draws the same in any monospaced font (Geist Mono has no block elements).
enum BenchArt {
    static let block: [String] = [
        "     .------.",
        "     |######|",
        "     |######|",
        "     |######|",
        "     '------'",
    ]
    static let table: [String] = [
        ".--------------------------------.",
        "|================================|",
        "'---.-----.------------.-----.---'",
        "    |:::::|            |:::::|",
        "    |:::::|            |:::::|",
        "    |:::::|            |:::::|",
        "    |:::::|            |:::::|",
        "    |:::::|            |:::::|",
        "    '-----'            '-----'",
    ]
}

struct BenchView: View {
    /// Any agent is working: the block breathes.
    let breathing: Bool
    var fontSize: CGFloat = 14
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            lines(BenchArt.block)
                .foregroundStyle(breathing ? Palette.working : Palette.ink)
                .compositingGroup()
                .opacity(breathing && !reduceMotion ? (dim ? 0.22 : 1) : 1)
            lines(BenchArt.table)
                .foregroundStyle(Palette.secondary)
        }
        .accessibilityElement()
        .accessibilityLabel(breathing ? "Tezgah: agents are working" : "Tezgah")
        .onAppear(perform: animate)
        .onChange(of: breathing) { animate() }
        .onChange(of: reduceMotion) { animate() }
    }

    private func lines(_ rows: [String]) -> some View {
        Text(rows.joined(separator: "\n"))
            .font(Fonts.mono(fontSize, weight: .medium))
            // Any tracking turns Geist Mono's ligatures off (### and |= would merge).
            .tracking(0.2)
            .lineSpacing(0)
            .fixedSize()
    }

    private func animate() {
        guard breathing, !reduceMotion else {
            withAnimation(.easeOut(duration: 0.3)) { dim = false }
            return
        }
        dim = false
        withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) { dim = true }
    }
}

/// Shown when nothing is selected: the bench, what needs you, what's working, recent projects.
struct WelcomeView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        let needs = sessions(where: { $0 == .blocked || $0 == .error })
        let working = sessions(where: { $0 == .working })
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 36)
                BenchView(breathing: !working.isEmpty)
                    .padding(.bottom, 26)
                Text("t e z g a h")
                    .font(Fonts.mono(13, weight: .medium))
                    .foregroundStyle(Palette.secondary)
                Text(summary(needs: needs.count, working: working.count))
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.tertiary)
                    .padding(.top, 6)
                    .padding(.bottom, 40)

                HStack(alignment: .top, spacing: 56) {
                    VStack(alignment: .leading, spacing: 26) {
                        group("needs you", count: needs.count) {
                            if needs.isEmpty { quiet("Nothing is waiting for you.") }
                            ForEach(needs) { s in agentLine(s) }
                        }
                        group("working", count: working.count) {
                            if working.isEmpty { quiet("No agent is working right now.") }
                            ForEach(working) { s in agentLine(s) }
                        }
                    }
                    .frame(width: 340, alignment: .leading)

                    VStack(alignment: .leading, spacing: 26) {
                        group("recent projects", count: nil) {
                            if store.projects.isEmpty { quiet("No projects yet. Open a folder to add one.") }
                            ForEach(Array(store.recentProjects.prefix(9).enumerated()), id: \.element.id) { i, p in
                                projectLine(p, index: i)
                            }
                        }
                        group("start", count: nil) {
                            actionLine("New terminal", keys: "⌘N") { store.newSession(projectId: nil) }
                            actionLine("Open folder…", keys: "⌘O") { AppActions.openFolder() }
                            if store.canImportLegacy {
                                actionLine("Import projects from Tezgah 0.1", keys: nil, symbol: "square.and.arrow.down") {
                                    let n = store.importLegacyProjects()
                                    AppActions.toast(n == 0 ? "No new projects to import" : "Imported \(n) project\(n == 1 ? "" : "s")")
                                }
                            }
                        }
                    }
                    .frame(width: 340, alignment: .leading)
                }
                Spacer(minLength: 40)
            }
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
    }

    private func sessions(where match: (AgentState) -> Bool) -> [Session] {
        store.sessions.filter { s in store.status(of: s).map(match) ?? false }
    }

    private func summary(needs: Int, working: Int) -> String {
        var parts: [String] = []
        if needs > 0 { parts.append("\(needs) need\(needs == 1 ? "s" : "") you") }
        if working > 0 { parts.append("\(working) working") }
        if parts.isEmpty {
            return store.sessions.isEmpty ? "A terminal for your coding agents." : "All quiet on the bench."
        }
        return parts.joined(separator: " · ")
    }

    private func group<C: View>(_ title: String, count: Int?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(title)
                    .font(Fonts.mono(11.5, weight: .medium))
                    .foregroundStyle(Palette.tertiary)
                    .textCase(.uppercase)
                    .tracking(0.6)
                if let count, count > 0 {
                    Text("\(count)").font(Fonts.mono(11.5)).foregroundStyle(Palette.tertiary)
                }
                Rectangle().fill(Palette.border).frame(height: 1)
            }
            .padding(.bottom, 4)
            content()
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text).font(.system(size: 13)).foregroundStyle(Palette.tertiary).padding(.vertical, 3)
    }

    private func agentLine(_ s: Session) -> some View {
        let lead = store.leadPane(of: s)
        let status = store.status(of: s)
        return HoverLine {
            store.open(session: s.id, pane: lead?.id)
        } content: {
            StatusDot(state: status, size: 7)
            Text(store.sessionTitle(s)).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink)
            Text(store.project(s.projectId)?.name ?? "terminal").font(.system(size: 13)).foregroundStyle(Palette.secondary)
            if let msg = lead?.statusMessage {
                Text(msg).font(Fonts.mono(11.5)).foregroundStyle(Palette.tertiary).lineLimit(1).truncationMode(.tail)
            }
            Spacer(minLength: 4)
            TimelineView(.periodic(from: .now, by: 15)) { ctx in
                Text(Durations.short(ctx.date.timeIntervalSince(store.statusSince(of: s))))
                    .font(Fonts.mono(11.5)).foregroundStyle(Palette.tertiary)
            }
        }
    }

    private func projectLine(_ p: ProjectRecord, index: Int) -> some View {
        HoverLine {
            store.openProject(p.id)
        } content: {
            Text("\(index + 1)").font(Fonts.mono(12, weight: .medium)).foregroundStyle(Palette.tertiary).frame(width: 14)
            ProjectIconView(path: p.path, name: p.name, size: 18)
            Text(p.name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink).lineLimit(1)
            Text(Paths.tilde((p.path as NSString).deletingLastPathComponent))
                .font(.system(size: 12)).foregroundStyle(Palette.tertiary).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 4)
            if let st = store.status(ofProject: p.id) { StatusDot(state: st, size: 7) }
        }
    }

    private func actionLine(_ title: String, keys: String?, symbol: String? = nil, action: @escaping () -> Void) -> some View {
        HoverLine(action: action) {
            Image(systemName: symbol ?? (keys == "⌘N" ? "apple.terminal" : "folder"))
                .font(.system(size: 12.5)).foregroundStyle(Palette.secondary).frame(width: 18)
            Text(title).font(.system(size: 13)).foregroundStyle(Palette.ink)
            Spacer(minLength: 4)
            if let keys { KeyCap(keys: keys) }
        }
    }
}

/// A list line that highlights under the pointer.
struct HoverLine<Content: View>: View {
    let action: () -> Void
    @ViewBuilder var content: Content
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) { content }
                .padding(.horizontal, 8)
                .frame(height: 30)
                .background(hovering ? Palette.hover : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .padding(.horizontal, -8)
    }
}
