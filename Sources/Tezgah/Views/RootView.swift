import AppKit
import SwiftUI
import TezgahCore

/// The whole window: one strip for projects and sessions, placed where the user chose, and the page.
struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look

    private var position: NavPosition { appearance.navPosition }

    private var isHome: Bool {
        switch store.selection {
        case .welcome, .agents, .notifications, .settings, .terminals: true
        case let .project(id): store.project(id) == nil
        case let .session(id): store.session(id) == nil
        }
    }
    private var fullFocus: Bool { if case .full = store.focus { true } else { false } }
    /// The strip as a column: only when pinned (Settings › Appearance) and open.
    private var columnVisible: Bool { position.isVertical && appearance.sidebarPinned && store.sidebarOpen && !fullFocus }
    private var floatingVisible: Bool { position.isVertical && !appearance.sidebarPinned && store.sidebarOpen && !fullFocus }

    var body: some View {
        Group {
            // Home has no bars: its projects are the page.
            if isHome { page } else { workspace }
        }
        .background(look.base)
        .overlay(alignment: .bottom) { ToastView() }
        .overlay {
            if let sid = store.renaming, let session = store.session(sid) {
                RenameSheet(session: session)
            } else if let pid = store.newSessionPicker {
                NewSessionSheet(projectId: pid.isEmpty ? nil : pid)
            } else if store.paletteOpen {
                CommandPalette()
            }
        }
        .animation(.easeOut(duration: Motion.quick), value: store.paletteOpen)
        .animation(.easeOut(duration: Motion.quick), value: store.newSessionPicker)
        .onChange(of: store.selection) {
            if !appearance.sidebarPinned { store.sidebarOpen = false }
        }
        .ignoresSafeArea()
    }

    private var workspace: some View {
        VStack(spacing: 0) {
            if fullFocus || position == .bottom { TitleBand() } else { TopBar(atBottom: false) }
            HStack(spacing: 0) {
                if columnVisible && position == .left { VerticalNav(); Rectangle().fill(look.line).frame(width: 1) }
                page.frame(maxWidth: .infinity, maxHeight: .infinity)
                if columnVisible && position == .right { Rectangle().fill(look.line).frame(width: 1); VerticalNav() }
            }
            .overlay(alignment: position == .right ? .trailing : .leading) { floatingStrip }
            if position == .bottom && !fullFocus { TopBar(atBottom: true) }
        }
    }

    /// The strip floating over the page; the window's edge opens it too.
    @ViewBuilder private var floatingStrip: some View {
        if floatingVisible {
            ZStack(alignment: position == .right ? .trailing : .leading) {
                if !store.sidebarByHover {
                    Color.black.opacity(0.001).onTapGesture { store.sidebarOpen = false }
                }
                VerticalNav(floating: true)
                    .padding(8)
                    .onHover { inside in
                        if !inside && store.sidebarByHover { store.sidebarOpen = false }
                    }
                    .transition(.move(edge: position == .right ? .trailing : .leading).combined(with: .opacity))
            }
        } else if position.isVertical && !appearance.sidebarPinned && !fullFocus {
            Color.clear.frame(width: 6).contentShape(Rectangle())
                .onHover { inside in
                    if inside { store.sidebarByHover = true; store.sidebarOpen = true }
                }
        }
    }

    @ViewBuilder private var page: some View {
        HStack(spacing: 0) {
            pageContent
            if store.notificationsOpen {
                NotificationsPanel().padding(.vertical, Grid.Space.s2).padding(.trailing, Grid.Space.s2)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: Motion.standard), value: store.notificationsOpen)
    }

    @ViewBuilder private var pageContent: some View {
        switch store.selection {
        case .welcome, .agents, .notifications, .settings, .terminals:
            HomeView()
        case let .project(id):
            if let p = store.project(id) { BoardView(project: p).id(p.id) } else { HomeView() }
        case let .session(id):
            if let s = store.session(id) { SessionView(session: s).id(s.id) } else { HomeView() }
        }
    }
}

/// The band at the top that holds the window buttons when the strip isn't on the left or top.
struct TitleBand: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    var body: some View {
        HStack {
            Spacer()
            if case let .full(id) = store.focus, let p = store.project(id) {
                Button { store.focus = .none } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "viewfinder").font(.system(size: 11))
                        Text("Full focus · \(p.name) · ⌃⇧⌘F to leave").type(.small, .medium)
                    }
                    .foregroundStyle(look.accent)
                }
                .buttonStyle(.plain)
            } else {
                Text(store.windowTitle).type(.caption).foregroundStyle(look.faint).lineLimit(1)
            }
            Spacer()
        }
        .frame(height: WindowChrome.compactBand)
        .padding(.leading, WindowChrome.buttonsWidth)
    }
}

enum WindowChrome {
    /// The title bar band with a unified toolbar: the window buttons sit centred in it.
    static let band: Double = 52
    static let compactBand: Double = 38
    /// Room the three window buttons take from the left edge.
    static let buttonsWidth: Double = 78
}

/// Short messages at the bottom ("Copied").
struct ToastView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    var body: some View {
        Group {
            if let toast = store.toast {
                Text(toast)
                    .type(.body, .medium)
                    .foregroundStyle(look.ink)
                    .padding(.horizontal, 16)
                    .frame(height: 36)
                    .card(look, radius: 18)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .animation(.easeOut(duration: Motion.standard), value: store.toast)
    }
}

extension AppStore {
    var windowTitle: String {
        switch selection {
        case let .session(id): session(id).map { "\(project($0.projectId)?.name ?? "Terminal") · \(sessionTitle($0))" } ?? "Tezgah"
        case let .project(id): project(id)?.name ?? "Tezgah"
        default: "Tezgah"
        }
    }

    /// Something, anywhere, waits for the user.
    var anyoneWaiting: Bool { sessions.contains { status(of: $0) == .blocked || status(of: $0) == .error } }
}


/// Session › Rename…
struct RenameSheet: View {
    let session: Session
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        SheetFrame(width: 420, onDismiss: { store.renaming = nil }) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Rename Session").type(.lead, .semibold).foregroundStyle(look.ink)
                TextField(store.sessionTitle(session), text: $name)
                    .textFieldStyle(.roundedBorder).font(Typeface.sans(13))
                    .focused($focused)
                    .onSubmit(save)
                Text("Leave it empty to show the program's name.").type(.caption).foregroundStyle(look.muted)
                HStack {
                    Spacer()
                    Button("Cancel") { store.renaming = nil }.buttonStyle(TZButtonStyle()).keyboardShortcut(.cancelAction)
                    Button("Rename", action: save).buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
                }
            }
            .padding(20)
        }
        .onAppear { name = session.title ?? ""; focused = true }
    }

    private func save() {
        let t = name.trimmingCharacters(in: .whitespaces)
        session.title = t.isEmpty ? nil : t
        store.renaming = nil
        store.scheduleSave()
    }
}
