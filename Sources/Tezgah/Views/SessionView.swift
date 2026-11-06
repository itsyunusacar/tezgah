import AppKit
import GhosttyTerminal
import SwiftUI
import TezgahCore

/// A session's panes, split as its layout says.
struct SessionView: View {
    @Environment(AppStore.self) private var store
    let session: Session

    var body: some View {
        LayoutView(session: session, node: session.layout, path: [])
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
            .padding(.top, 2)
    }
}

private struct LayoutView: View {
    @Environment(AppStore.self) private var store
    let session: Session
    let node: LayoutNode
    let path: [Int]

    var body: some View {
        switch node {
        case let .pane(id):
            if let pane = store.panes[id] {
                PaneView(session: session, pane: pane)
            } else {
                Color.clear
            }
        case let .split(axis, children, sizes):
            SplitView(session: session, axis: axis, children: children, sizes: sizes, path: path)
        }
    }
}

private struct SplitView: View {
    @Environment(AppStore.self) private var store
    let session: Session
    let axis: SplitAxis
    let children: [LayoutNode]
    let sizes: [Double]
    let path: [Int]
    @State private var dragStart: [Double]?

    static let gap: CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            let total = (axis == .row ? geo.size.width : geo.size.height) - Self.gap * CGFloat(children.count - 1)
            let layout = axis == .row ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            layout {
                ForEach(Array(children.enumerated()), id: \.offset) { i, child in
                    let length = max(40, total * CGFloat(sizes[safe: i] ?? 0))
                    LayoutView(session: session, node: child, path: path + [i])
                        .frame(width: axis == .row ? length : nil, height: axis == .column ? length : nil)
                    if i < children.count - 1 {
                        divider(index: i, total: total)
                    }
                }
            }
        }
    }

    private func divider(index i: Int, total: CGFloat) -> some View {
        Rectangle()
            .fill(Color.clear)
            .frame(width: axis == .row ? Self.gap : nil, height: axis == .column ? Self.gap : nil)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { (axis == .row ? NSCursor.resizeLeftRight : NSCursor.resizeUpDown).push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { value in
                        let start = dragStart ?? sizes
                        if dragStart == nil { dragStart = sizes }
                        guard total > 0 else { return }
                        let delta = Double((axis == .row ? value.translation.width : value.translation.height) / total)
                        var next = start
                        let pair = start[i] + start[i + 1]
                        let minimum = LayoutNode.minimumFraction
                        next[i] = min(max(start[i] + delta, minimum), pair - minimum)
                        next[i + 1] = pair - next[i]
                        store.resize(session: session, path: path, sizes: next)
                    }
                    .onEnded { _ in dragStart = nil }
            )
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

/// One terminal with its thin header: program, folder, status, split and close.
struct PaneView: View {
    @Environment(AppStore.self) private var store
    let session: Session
    let pane: TerminalPane

    private var isFocused: Bool { session.focusedPaneId == pane.id }
    private var single: Bool { session.layout.paneIds.count == 1 }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Palette.border).frame(height: 1).opacity(0.7)
            TerminalHost(pane: pane)
                .background(Palette.canvas)
        }
        .background(Palette.canvas)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .strokeBorder(isFocused && !single ? Palette.secondary.opacity(0.45) : Palette.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.04), radius: 6, y: 1)
    }

    private var header: some View {
        HStack(spacing: 8) {
            ProgramIcon(program: pane.agentApp ?? pane.program, size: 18)
            Text(name)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(isFocused ? Palette.ink : Palette.secondary)
                .lineLimit(1)
            Text(Paths.tilde(pane.cwd))
                .font(.system(size: 12))
                .foregroundStyle(Palette.tertiary)
                .lineLimit(1)
                .truncationMode(.head)
            if let status = pane.status {
                HStack(spacing: 6) {
                    StatusDot(state: status, size: 7)
                    Text(pane.statusMessage.map { "\(status.label) · \($0)" } ?? status.label)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Palette.status(status))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 2.5)
                .background(Palette.status(status).opacity(0.1), in: Capsule())
                .layoutPriority(-1)
            }
            Spacer(minLength: 8)
            IconButton(symbol: "rectangle.split.2x1", help: "Split Right  ⌘D") {
                store.split(.row, paneId: pane.id)
            }
            IconButton(symbol: "rectangle.split.1x2", help: "Split Down  ⌥⌘D") {
                store.split(.column, paneId: pane.id)
            }
            IconButton(symbol: "xmark", help: "Close Pane  ⌘W", size: 11) {
                store.closePane(pane.id)
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .frame(height: 34)
        .background(Palette.canvas)
        .contentShape(Rectangle())
        .onTapGesture { pane.focus() }
    }

    private var name: String {
        if let app = pane.agentApp { return Programs.displayName(app) }
        if let program = pane.program { return program }
        if !pane.title.isEmpty, pane.title.count < 48, !pane.title.contains("@") { return pane.title }
        return Shell.programName(Shell.current)
    }
}

/// Puts a pane's long-lived terminal view in the SwiftUI hierarchy. The view (and its Ghostty
/// surface, scrollback and pty) outlives this wrapper: SwiftUI may rebuild the wrapper when the
/// layout changes, and the terminal simply moves into the new one.
struct TerminalHost: NSViewRepresentable {
    let pane: TerminalPane

    func makeNSView(context _: Context) -> TerminalContainer {
        let v = TerminalContainer()
        v.attach(pane.view)
        return v
    }

    func updateNSView(_ v: TerminalContainer, context _: Context) {
        v.attach(pane.view)
    }

    static func dismantleNSView(_ v: TerminalContainer, coordinator _: ()) {
        v.detach()
    }
}

final class TerminalContainer: NSView {
    private weak var terminal: AppTerminalView?

    func attach(_ t: AppTerminalView) {
        terminal = t
        if t.superview !== self {
            t.removeFromSuperview()
            t.frame = bounds
            t.autoresizingMask = [.width, .height]
            addSubview(t)
        }
    }

    func detach() {
        if let t = terminal, t.superview === self { t.removeFromSuperview() }
    }

    override func layout() {
        super.layout()
        guard let terminal, terminal.superview === self else { return }
        terminal.frame = bounds
        terminal.fitToSize()
    }
}
