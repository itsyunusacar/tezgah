import AppKit
import SwiftUI
import TezgahCore

/// The Tezgah mark that takes you home (⇧⌘H). Its cursor blinks while an agent waits for you.
struct HomeButton: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @State private var hover = false

    private var active: Bool { store.selection == .welcome }

    var body: some View {
        Button { store.selection = .welcome } label: {
            TezgahMark(width: 17, color: active ? look.accent : look.ink, blinking: store.anyoneWaiting)
                .frame(width: 28, height: 28)
                .background(active ? look.selected : hover ? look.ink.opacity(0.06) : .clear,
                            in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(Text("Home  ⇧⌘H"))
        .accessibilityLabel(Text(store.anyoneWaiting ? "Home, an agent is waiting for you" : "Home"))
    }
}

/// Opens and closes the projects strip (⌘\\).
struct SidebarToggle: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @State private var hover = false

    var body: some View {
        Button {
            store.sidebarByHover = false
            store.sidebarOpen.toggle()
        } label: {
            Image(systemName: "sidebar.left").font(.system(size: 14))
                .foregroundStyle(store.sidebarOpen ? look.accent : look.muted)
                .frame(width: 28, height: 28)
                .background(store.sidebarOpen ? look.selected : hover ? look.ink.opacity(0.06) : .clear,
                            in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(Text("Projects  ⌘0"))
        .accessibilityLabel(Text("Projects"))
    }
}

/// "1 waiting for you": always in sight, so the strip can stay closed. Click to go there.
struct WaitingPill: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    var body: some View {
        let waiting = store.waitingSessions
        if let first = waiting.first {
            Button { store.openNextWaiting() } label: {
                HStack(spacing: 6) {
                    WaitingBlock(size: 11)
                    Text("\(waiting.count) waiting for you").type(.small, .medium)
                }
                .foregroundStyle(look.waiting)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(look.selected, in: Capsule())
                .overlay(Capsule().strokeBorder(look.selectedEdge))
            }
            .buttonStyle(.plain)
            .help(Text(waiting.count == 1 ? "\(store.sessionTitle(first))  ⌘J" : "Go to the next one  ⌘J"))
        }
    }
}

/// ⌘K: search everything.
struct SearchField: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    var body: some View {
        Button { store.paletteOpen = true } label: {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(look.muted)
                Text("Search").type(.body).foregroundStyle(look.muted)
                Spacer()
                KeyHint(keys: "⌘K")
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(look.ink.opacity(look.dark ? 0.08 : 0.04), in: RoundedRectangle(cornerRadius: Grid.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Search projects, sessions, commands and settings"))
    }
}

// MARK: - Vertical

struct VerticalNav: View {
    var floating = false
    @Environment(AppStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let f = store.focusedProjectId, let p = store.project(f) {
                FocusPill(name: p.name)
            } else {
                SearchField().padding(.bottom, 8)
            }

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 4) {
                    // Every project with its sessions, always: what runs elsewhere stays in sight.
                    ForEach(store.navProjects) { project in
                        let sessions = store.sessions(in: project.id)
                        ProjectRow(project: project)
                        ForEach(sessions) { session in
                            SessionRow(session: session)
                        }
                        if !sessions.isEmpty { Spacer().frame(height: 6) }
                    }
                    let loose = store.focusedProjectId == nil ? store.sessions(in: nil) : []
                    if !loose.isEmpty {
                        Text("Terminals").type(.caption).foregroundStyle(look.muted).padding(.horizontal, 8).padding(.top, 12)
                        ForEach(loose) { SessionRow(session: $0, indent: 0) }
                    }
                }
            }
            .scrollIndicators(.never)

            HStack(spacing: 4) {
                Button { AppActions.openFolder() } label: {
                    Label { Text("Add Project").type(.body) } icon: { Image(systemName: "plus").font(.system(size: 12)) }
                        .foregroundStyle(look.soft)
                        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                        .padding(.horizontal, 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                IconButton(symbol: "bell", label: "Notifications", badge: store.unreadNotifications > 0) {
                    store.toggleNotifications()
                }
            }
        }
        .padding(12)
        .frame(width: floating ? 252 : 240)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(floating ? look.raised : look.bar)
        .clipShape(RoundedRectangle(cornerRadius: floating ? 12 : 0, style: .continuous))
        .overlay {
            if floating { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(look.line) }
        }
        .softShadow(color: .black.opacity(floating ? (look.dark ? 0.5 : 0.16) : 0), radius: floating ? 22 : 0, y: floating ? 10 : 0)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Projects and sessions"))
    }
}

struct ProjectRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let project: ProjectRecord
    @State private var hover = false

    private var open: Bool { store.currentProjectId == project.id }
    private var missing: Bool { store.missingProjects.contains(project.id) }
    private var onBoard: Bool { store.selection == .project(project.id) }

    var body: some View {
        // A click enters the project where you left it; a click on the one you're in shows its board.
        Button { if open { store.showBoard(project.id) } else { store.openProject(project.id) } } label: {
            HStack(spacing: 10) {
                Monogram(name: project.name, size: 22, active: open)
                Text(project.name).type(.body, open ? .semibold : .regular)
                    .foregroundStyle(missing ? look.faint : open ? look.ink : look.soft).lineLimit(1)
                Spacer(minLength: 28)
            }
            .padding(.horizontal, 8)
            .frame(height: 32)
            .background(onBoard || hover ? look.selected : .clear, in: RoundedRectangle(cornerRadius: Grid.Radius.control, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .trailing) {
            if missing {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 11)).foregroundStyle(look.waiting)
                    .padding(.trailing, 10)
                    .help(Text("The folder can't be found"))
                    .accessibilityLabel(Text("The folder can't be found"))
            } else if hover {
                IconButton(symbol: "plus", label: "New Session in \(project.name)", size: 11) {
                    store.refreshAgents()
                    store.newSessionPicker = project.id
                }
                .padding(.trailing, 2)
            }
        }
        .onHover { hover = $0 }
        .contextMenu {
            Button("New Session…") { store.refreshAgents(); store.newSessionPicker = project.id }
            Button("New Terminal") { _ = store.newSession(projectId: project.id) }
            Button("Show Board") { store.showBoard(project.id) }
            Divider()
            if missing { Button("Locate Folder…") { store.relocateProject(project.id) } }
            Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.path)]) }
                .disabled(missing)
            Button("Copy Path") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(project.path, forType: .string)
                AppActions.toast(String(localized: "Copied"))
            }
            Divider()
            Button("Move Up") { store.moveProject(project.id, by: -1) }.disabled(store.projects.first?.id == project.id)
            Button("Move Down") { store.moveProject(project.id, by: 1) }.disabled(store.projects.last?.id == project.id)
            Divider()
            Button("Remove from Tezgah") { store.confirmRemoveProject(project.id) }
        }
        .accessibilityLabel(Text(project.name))
        .accessibilityValue(missing ? Text("The folder can't be found") : Text(""))
    }
}

struct SessionRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let session: Session
    var indent: Double = 20
    @State private var hover = false

    var body: some View {
        let state = store.status(of: session)
        let active = store.selection == .session(session.id)
        let waiting = state == .blocked || state == .error
        Button { store.open(session: session.id) } label: {
            HStack(spacing: 8) {
                ProgramMark(program: store.icon(of: session), size: 14)
                Text(store.sessionTitle(session))
                    .type(.body, active || waiting ? .medium : .regular)
                    .foregroundStyle(waiting ? look.ink : active ? look.ink : look.soft)
                    .lineLimit(1)
                Spacer(minLength: 4)
                StateMark(state: state, size: 14)
            }
            .padding(.horizontal, 8)
            .frame(height: 30)
            .background {
                if active {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).fill(look.selected)
                } else if hover {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).fill(look.selected)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, indent)
        .onHover { hover = $0 }
        .contextMenu {
            Button("Rename…") { store.renaming = session.id }
            Divider()
            Button("Close Session") { store.requestClose(session: session.id) }
        }
        .accessibilityLabel(Text("\(store.sessionTitle(session))"))
        .accessibilityValue(state.map { Text($0.spokenName) } ?? Text(""))
    }
}

// MARK: - The bar

/// One thin bar: window buttons, the strip's toggle, home, the project, its sessions, and what waits.
struct TopBar: View {
    let atBottom: Bool
    @Environment(AppStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 4) {
            if !atBottom { Color.clear.frame(width: WindowChrome.buttonsWidth - 12) }
            if appearance.navPosition.isVertical {
                SidebarToggle()
                Rectangle().fill(look.line).frame(width: 1, height: 18).padding(.horizontal, 8)
            } else if !atBottom {
                // Room between the window's buttons and the project's name.
                Spacer().frame(width: 10)
            }
            if let pid = store.currentProjectId, let project = store.project(pid) {
                ProjectPicker(current: project)
                BoardButton(projectId: pid)
                Spacer().frame(width: 4)
                tabs(store.sessions(in: pid), newIn: pid)
            } else {
                Text("Terminals").type(.body, .semibold).foregroundStyle(look.ink)
                Spacer().frame(width: 8)
                tabs(store.sessions(in: nil), newIn: "")
            }
            Spacer(minLength: 8)
            // Focus mode shows wherever the bar is, with the way out of it.
            if let f = store.focusedProjectId, let p = store.project(f), !(appearance.navPosition.isVertical && store.sidebarOpen) {
                Button { store.focus = .none } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "moon.fill").font(.system(size: 10))
                        Text("Focus · \(p.name)").type(.small, .medium).lineLimit(1)
                    }
                    .foregroundStyle(look.accent)
                    .padding(.horizontal, 10).frame(height: 26)
                    .background(look.selected, in: Capsule())
                    .overlay(Capsule().strokeBorder(look.selectedEdge))
                }
                .buttonStyle(.plain)
                .help(Text("Leave focus"))
            }
            WaitingPill()
            IconButton(symbol: "magnifyingglass", label: "Search") { store.paletteOpen = true }
            IconButton(symbol: "bell", label: "Notifications", badge: store.unreadNotifications > 0) { store.toggleNotifications() }
            // The mark closes the bar, away from the window's own buttons: the way home.
            Rectangle().fill(look.line).frame(width: 1, height: 18).padding(.horizontal, 6)
            HomeButton()
        }
        .padding(.horizontal, 12)
        .frame(height: atBottom ? 44 : WindowChrome.band)
        .background(look.bar)
        .overlay(alignment: atBottom ? .top : .bottom) { Rectangle().fill(look.line).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Projects and sessions"))
    }

    private func tabs(_ sessions: [Session], newIn: String) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(sessions) { SessionTab(session: $0).id($0.id) }
                    IconButton(symbol: "plus", label: "New Session") { store.refreshAgents(); store.newSessionPicker = newIn }
                }
            }
            .scrollIndicators(.never)
            // The tab you're on is always in sight, however many there are.
            .onChange(of: store.selection, initial: true) {
                if case let .session(id) = store.selection { withAnimation(.easeOut(duration: Motion.standard)) { proxy.scrollTo(id) } }
            }
        }
    }
}

struct ProjectPicker: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let current: ProjectRecord

    var body: some View {
        Menu {
            ForEach(store.navProjects) { p in
                Button(p.name) { store.openProject(p.id) }
            }
            Divider()
            Button("Add Project…") { AppActions.openFolder() }
        } label: {
            HStack(spacing: 6) {
                Text(current.name).type(.body, .semibold).foregroundStyle(look.ink).lineLimit(1).truncationMode(.middle)
                    .frame(maxWidth: 180)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(look.faint)
            }
            .padding(.horizontal, 6)
            .frame(height: 28)
            .overlay(alignment: .topTrailing) {
                // Another project has an agent at work or waiting.
                if store.othersBusy(than: current.id) {
                    Circle().fill(look.working).frame(width: 6, height: 6).offset(x: 4, y: 2)
                }
            }
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}

/// The project's board: its sessions, changes and past conversations.
struct BoardButton: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let projectId: String
    @State private var hover = false

    var body: some View {
        let active = store.selection == .project(projectId)
        Button { store.showBoard(projectId) } label: {
            Image(systemName: "square.grid.2x2").font(.system(size: 13))
                .foregroundStyle(active ? look.accent : look.muted)
                .frame(width: 28, height: 28)
                .background(active ? look.selected : hover ? look.ink.opacity(0.06) : .clear,
                            in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(Text("Board: sessions, changes and conversations"))
        .accessibilityLabel(Text("Board"))
    }
}

struct SessionTab: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let session: Session
    @State private var hover = false

    var body: some View {
        let state = store.status(of: session)
        let active = store.selection == .session(session.id)
        let waiting = state == .blocked || state == .error
        HStack(spacing: 0) {
            Button { store.open(session: session.id) } label: {
                HStack(spacing: 8) {
                    ProgramMark(program: store.icon(of: session), size: 14)
                    Text(store.sessionTitle(session)).type(.body, active || waiting ? .medium : .regular)
                        .foregroundStyle(waiting ? look.waiting : active ? look.ink : look.soft).lineLimit(1)
                        .frame(maxWidth: 160)
                    StateMark(state: state, size: 14)
                }
                .padding(.leading, 10)
                .padding(.trailing, hover || active ? 4 : 10)
                .frame(height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // The tab you're on, and the one under the pointer, can be closed right here.
            if hover || active {
                Button { store.requestClose(session: session.id) } label: {
                    Image(systemName: "xmark").font(.system(size: 8.5, weight: .bold))
                        .foregroundStyle(look.muted)
                        .frame(width: 18, height: 18)
                        .background(hover ? look.ink.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 6)
                .help(Text("Close Session  ⌘W"))
                .accessibilityLabel(Text("Close Session"))
            }
        }
        .background {
            if active {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(look.raised)
                    .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(look.line))
                    .softShadow(color: .black.opacity(look.dark ? 0.3 : 0.05), radius: 2, y: 1)
            } else if hover {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(look.ink.opacity(0.05))
            }
        }
        .onHover { hover = $0 }
        .contextMenu {
            Button("Rename…") { store.renaming = session.id }
            Divider()
            Button("Close Session") { store.requestClose(session: session.id) }
        }
        .help(Text(store.sessionTitle(session)))
    }
}

extension AppStore {
    /// Projects in the strip, in the order you keep them (it doesn't shuffle as you move around);
    /// only the focused one in focus mode.
    var navProjects: [ProjectRecord] {
        if let f = focusedProjectId { return projects.filter { $0.id == f } }
        return projects
    }

    func othersBusy(than id: String) -> Bool {
        projects.contains { $0.id != id && status(ofProject: $0.id).map { $0 != .idle && $0 != .done } == true }
    }
}


/// Shown at the top of the strip in focus mode; click to leave.
struct FocusPill: View {
    let name: String
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    var body: some View {
        Button { store.focus = .none } label: {
            HStack(spacing: 8) {
                Image(systemName: "moon.fill").font(.system(size: 11))
                Text("Focus · \(name)").type(.caption, .medium).lineLimit(1)
                Spacer()
                Text("⇧⌘F").type(.caption, mono: true).opacity(0.7)
            }
            .foregroundStyle(look.accent)
            .padding(.horizontal, 10).frame(height: 32)
            .background(look.selected, in: RoundedRectangle(cornerRadius: Grid.Radius.control))
            .overlay(RoundedRectangle(cornerRadius: Grid.Radius.control).strokeBorder(look.selectedEdge))
        }
        .buttonStyle(.plain)
        .padding(.bottom, 8)
        .help(Text("Leave focus"))
    }
}
