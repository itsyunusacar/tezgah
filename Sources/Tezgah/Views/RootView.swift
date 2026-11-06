import AppKit
import SwiftUI
import TezgahCore

/// The whole window: one strip for projects and sessions, placed where the user chose, and the page.
struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look

    private var position: NavPosition { appearance.navPosition }

    var body: some View {
        VStack(spacing: 0) {
            // With the strip on the right or at the bottom, the window's own buttons get a thin band of their own.
            if position == .right || position == .bottom {
                TitleBand()
            }
            layout {
                if position == .right || position == .bottom {
                    page.frame(maxWidth: .infinity, maxHeight: .infinity)
                    nav
                } else {
                    nav
                    page.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
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
        .overlay(alignment: .top) {
            if case let .full(id) = store.focus, let p = store.project(id) {
                Button { store.focus = .none } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "moon.fill").font(.system(size: 10))
                        Text("Full focus · \(p.name) · ⌃⇧⌘F to leave").type(.caption)
                    }
                    .foregroundStyle(look.muted)
                    .padding(.horizontal, 12).frame(height: 24)
                    .background(look.ink.opacity(0.06), in: UnevenRoundedRectangle(bottomLeadingRadius: 10, bottomTrailingRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
        .animation(.easeOut(duration: Motion.quick), value: store.paletteOpen)
        .animation(.easeOut(duration: Motion.quick), value: store.newSessionPicker)
        .ignoresSafeArea()
    }

    private var layout: AnyLayout {
        switch position {
        case .left: AnyLayout(HStackLayout(spacing: 0))
        case .right: AnyLayout(HStackLayout(spacing: 0))
        case .top, .bottom: AnyLayout(VStackLayout(spacing: 0))
        }
    }

    @ViewBuilder private var nav: some View {
        if case .full = store.focus {
            EmptyView()
        } else if position.isVertical {
            VerticalNav()
        } else {
            HorizontalNav(withWindowButtons: position == .top)
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
            Text(store.windowTitle).type(.caption).foregroundStyle(look.faint).lineLimit(1)
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
