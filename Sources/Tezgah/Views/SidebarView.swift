import SwiftUI
import TezgahCore

/// The short menu: Agents, Notifications, Projects (with their sessions), Terminals, Settings.
struct SidebarView: View {
    @Environment(AppStore.self) private var store
    @FocusState private var searchFocused: Bool

    var body: some View {
        @Bindable var store = store
        VStack(spacing: 0) {
            // Room for the traffic lights.
            Color.clear.frame(height: 40)
            search(text: $store.sidebarQuery)
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    if query.isEmpty {
                        SidebarRow(symbol: "sparkle", title: "Agents", selected: store.selection == .agents,
                                   trailing: store.liveAgentCount > 0 ? AnyView(liveBadge) : nil) {
                            store.selection = .agents
                        }
                        SidebarRow(symbol: "bell", title: "Notifications", selected: store.selection == .notifications,
                                   trailing: store.unreadNotifications > 0 ? AnyView(count(store.unreadNotifications)) : nil) {
                            store.selection = .notifications
                        }
                        Color.clear.frame(height: 12)
                    }
                    projects
                    Color.clear.frame(height: 12)
                    terminals
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 12)
            }
            .scrollIndicators(.never)
            Spacer(minLength: 0)
            SidebarRow(symbol: "gearshape", title: "Settings", selected: store.selection == .settings) {
                store.selection = .settings
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 12)
        }
        .frame(maxHeight: .infinity)
        .onChange(of: store.searchFocusRequest) { searchFocused = true }
    }

    private var query: String { store.sidebarQuery.trimmingCharacters(in: .whitespaces).lowercased() }

    private func search(text: Binding<String>) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.secondary)
            TextField("Search", text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .focused($searchFocused)
                .onSubmit(openFirstMatch)
                .onExitCommand {
                    text.wrappedValue = ""
                    searchFocused = false
                }
            if !text.wrappedValue.isEmpty {
                Button { text.wrappedValue = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundStyle(Palette.tertiary)
                }
                .buttonStyle(.plain)
            } else {
                KeyCap(keys: "⇧⌘F")
            }
        }
        .padding(.horizontal, 9)
        .frame(height: 30)
        .background(.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func openFirstMatch() {
        if let p = filteredProjects.first {
            store.openProject(p.id)
        } else if let s = filteredTerminals.first {
            store.open(session: s.id)
        }
        searchFocused = false
        store.sidebarQuery = ""
    }

    private var filteredProjects: [ProjectRecord] {
        guard !query.isEmpty else { return store.projects }
        return store.projects.filter { p in
            p.name.lowercased().contains(query) || p.path.lowercased().contains(query)
                || store.sessions(in: p.id).contains { store.sessionTitle($0).lowercased().contains(query) }
        }
    }

    private var filteredTerminals: [Session] {
        let all = store.sessions(in: nil)
        guard !query.isEmpty else { return all }
        return all.filter { store.sessionTitle($0).lowercased().contains(query) || $0.cwd.lowercased().contains(query) }
    }

    private var liveBadge: some View {
        Text("\(store.liveAgentCount) live")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Palette.waiting)
    }

    private func count(_ n: Int) -> some View {
        Text("\(n)")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .frame(minWidth: 18, minHeight: 16)
            .background(Palette.waiting, in: Capsule())
    }

    @ViewBuilder private var projects: some View {
        SectionHeader(title: "Projects", action: ("plus", "Open Folder…  ⌘O", { AppActions.openFolder() }))
        if filteredProjects.isEmpty {
            Text(query.isEmpty ? "Open a folder to start." : "No matches")
                .font(.system(size: 12))
                .foregroundStyle(Palette.tertiary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
        }
        ForEach(filteredProjects) { p in
            let isCurrent = store.currentProjectId == p.id
            SidebarRow(icon: AnyView(ProjectIconView(path: p.path, name: p.name, size: 20)), title: p.name,
                       selected: store.selection == .project(p.id),
                       trailing: projectDot(p)) {
                store.openProject(p.id)
            }
            .contextMenu {
                Button("New Session") { store.newSession(projectId: p.id) }
                Button("Show Board") { store.selection = .project(p.id) }
                Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p.path)]) }
                Divider()
                Button("Remove from Tezgah") { store.removeProject(p.id) }
            }
            if isCurrent || !query.isEmpty {
                ForEach(store.sessions(in: p.id)) { s in
                    sessionRow(s)
                }
            }
        }
    }

    private func projectDot(_ p: ProjectRecord) -> AnyView? {
        if let s = store.status(ofProject: p.id) { return AnyView(StatusDot(state: s, size: 7)) }
        let count = store.sessions(in: p.id).count
        guard count > 0 else { return nil }
        return AnyView(Text("\(count)").font(.system(size: 11.5)).foregroundStyle(Palette.tertiary))
    }

    private func sessionRow(_ s: Session) -> some View {
        SidebarRow(icon: AnyView(ProgramIcon(program: store.icon(of: s), size: 16)), title: store.sessionTitle(s),
                   subtitle: store.leadPane(of: s)?.statusMessage, selected: store.selection == .session(s.id),
                   trailing: AnyView(StatusDot(state: store.status(of: s), size: 7).opacity(store.status(of: s) == nil ? 0.35 : 1)),
                   indent: 18, compact: true) {
            store.open(session: s.id)
        }
        .contextMenu {
            Button("Close Session") { store.closeSession(s.id) }
        }
    }

    @ViewBuilder private var terminals: some View {
        SectionHeader(title: "Terminals", action: ("plus", "New Terminal  ⌘N", { store.newSession(projectId: nil) }))
        let list = filteredTerminals
        if list.isEmpty {
            SidebarRow(symbol: "apple.terminal", title: "Home folder", subtitle: nil, selected: store.selection == .terminals,
                       dimmed: true) {
                store.selection = .terminals
            }
        }
        ForEach(list) { s in
            sessionRow(s).padding(.leading, -18)
        }
    }
}

private struct SectionHeader: View {
    let title: String
    var action: (String, String, () -> Void)?
    @State private var hovering = false

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Palette.secondary)
            Spacer()
            if let action {
                Button(action: action.2) {
                    Image(systemName: action.0)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(hovering ? Palette.ink : Palette.secondary)
                        .frame(width: 20, height: 20)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .help(action.1)
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .padding(.bottom, 4)
    }
}

struct SidebarRow: View {
    var symbol: String?
    var icon: AnyView?
    let title: String
    var subtitle: String?
    var selected = false
    var trailing: AnyView?
    var indent: CGFloat = 0
    var compact = false
    var dimmed = false
    let action: () -> Void
    @State private var hovering = false

    init(symbol: String? = nil, icon: AnyView? = nil, title: String, subtitle: String? = nil, selected: Bool = false,
         trailing: AnyView? = nil, indent: CGFloat = 0, compact: Bool = false, dimmed: Bool = false, action: @escaping () -> Void) {
        self.symbol = symbol
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.selected = selected
        self.trailing = trailing
        self.indent = indent
        self.compact = compact
        self.dimmed = dimmed
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon {
                    icon
                } else if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(Palette.secondary)
                        .frame(width: 20)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: compact ? 12.5 : 13.5, weight: selected ? .medium : .regular))
                        .foregroundStyle(dimmed ? Palette.secondary : Palette.ink)
                        .lineLimit(1)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.system(size: 11)).foregroundStyle(Palette.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                if let trailing { trailing }
            }
            .padding(.leading, 10 + indent)
            .padding(.trailing, 10)
            .padding(.vertical, subtitle?.isEmpty == false ? 4 : 0)
            .frame(minHeight: compact ? 28 : 34)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(selected ? Color.primary.opacity(0.09) : hovering ? Color.primary.opacity(0.045) : .clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
