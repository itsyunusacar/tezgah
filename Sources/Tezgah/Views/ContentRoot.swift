import AppKit
import SwiftUI
import TezgahCore

/// The window's right side: the tab strip on top, then the selected page.
struct ContentRoot: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(spacing: 0) {
            TopBar()
            page
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Palette.well)
        .overlay(alignment: .bottom) {
            if let toast = store.toast {
                Text(toast)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 9)
                    .background(.regularMaterial, in: Capsule())
                    .overlay(Capsule().strokeBorder(Palette.border, lineWidth: 0.5))
                    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                    .padding(.bottom, 22)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: store.toast)
        .ignoresSafeArea()
    }

    @ViewBuilder private var page: some View {
        switch store.selection {
        case .welcome:
            WelcomeView()
        case .agents:
            AgentsView()
        case .notifications:
            NotificationsView()
        case .settings:
            SettingsView()
        case .terminals:
            TerminalsEmptyView()
        case let .project(id):
            if let p = store.project(id) { DashboardView(project: p).id(p.id) } else { WelcomeView() }
        case let .session(id):
            if let s = store.session(id) { SessionView(session: s).id(s.id) } else { WelcomeView() }
        }
    }
}

/// Tabs for the sessions of the project (or the terminals) you are in.
struct TopBar: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(spacing: 6) {
            if let context = store.tabContext {
                if case let .project(id) = context, let p = store.project(id) {
                    TabChip(selected: store.selection == .project(id), closable: false, help: "Board — \(p.name)",
                            action: { store.selection = .project(id) }) {
                        Image(systemName: "square.grid.2x2")
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(Palette.secondary)
                            .frame(width: 18, height: 18)
                        Text("Board").font(.system(size: 12.5, weight: .medium))
                    }
                    .fixedSize()
                }
                ForEach(Array(store.tabSessions.enumerated()), id: \.element.id) { i, s in
                    SessionTab(session: s, index: i)
                }
                Button { AppActions.newSessionHere() } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Palette.secondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("New Session  ⌘T")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(height: 50)
        .frame(maxWidth: .infinity)
        .background(WindowDragArea())
    }
}

struct SessionTab: View {
    @Environment(AppStore.self) private var store
    let session: Session
    let index: Int

    var body: some View {
        let status = store.status(of: session)
        TabChip(selected: store.selection == .session(session.id), closable: true,
                help: index < 9 ? "⌘\(index + 1)" : "", action: { store.open(session: session.id) },
                close: { store.closeSession(session.id) }) {
            ProgramIcon(program: store.icon(of: session), size: 20)
            Text(store.sessionTitle(session))
                .font(.system(size: 12.5, weight: .medium))
                .lineLimit(1)
            Text(store.sessionSubtitle(session))
                .font(.system(size: 12))
                .foregroundStyle(Palette.tertiary)
                .lineLimit(1)
                .truncationMode(.head)
            if let status {
                StatusDot(state: status, size: 7)
            }
        }
        .frame(maxWidth: 260)
    }
}

struct TabChip<Label: View>: View {
    let selected: Bool
    let closable: Bool
    var help: String = ""
    let action: () -> Void
    var close: (() -> Void)?
    @ViewBuilder var label: Label
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 7) {
            label
            if closable {
                Button { close?() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Palette.secondary)
                        .frame(width: 16, height: 16)
                        .background(Palette.subtle.opacity(hovering ? 1 : 0), in: Circle())
                }
                .buttonStyle(.plain)
                .opacity(hovering || selected ? 1 : 0)
                .help("Close Session  ⇧⌘W")
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, closable ? 6 : 10)
        .frame(height: 32)
        .foregroundStyle(selected ? Palette.ink : Palette.secondary)
        .background {
            if selected {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Palette.raised)
                    .shadow(color: .black.opacity(0.07), radius: 3, y: 1)
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Palette.border, lineWidth: 0.5))
            } else if hovering {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Palette.hover)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: action)
        .onHover { hovering = $0 }
        .help(help)
    }
}

/// Empty bar space moves the window, like a title bar; a double click zooms it.
struct WindowDragArea: NSViewRepresentable {
    final class DragView: NSView {
        override var mouseDownCanMoveWindow: Bool { true }
        override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 {
                window?.performZoom(nil)
            } else {
                window?.performDrag(with: event)
            }
        }
    }

    func makeNSView(context _: Context) -> DragView { DragView() }
    func updateNSView(_: DragView, context _: Context) {}
}

struct TerminalsEmptyView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "apple.terminal").font(.system(size: 30, weight: .light)).foregroundStyle(Palette.tertiary)
            Text("Terminals of their own").font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.ink)
            Text("A shell in your home folder, outside any project.")
                .font(.system(size: 13)).foregroundStyle(Palette.secondary)
            Button { store.newSession(projectId: nil) } label: {
                HStack(spacing: 8) { Text("New Terminal"); KeyCap(keys: "⌘N") }
            }
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
