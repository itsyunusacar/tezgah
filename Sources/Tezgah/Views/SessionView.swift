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
            .padding(Grid.Space.s2)
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

/// One terminal in a raised card with a quiet header: program, folder, state. Split and close show on hover.
struct PaneView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let session: Session
    let pane: TerminalPane
    @State private var hover = false

    private var isFocused: Bool { session.focusedPaneId == pane.id }
    private var single: Bool { session.layout.paneIds.count == 1 }
    private var waiting: Bool { pane.status == .blocked || pane.status == .error }

    var body: some View {
        VStack(spacing: 0) {
            header
            TerminalHost(pane: pane)
        }
        .background(look.raised)
        .clipShape(RoundedRectangle(cornerRadius: Grid.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Grid.Radius.card, style: .continuous)
                .strokeBorder(waiting ? look.waiting : isFocused && !single ? look.muted.opacity(0.5) : look.line,
                              lineWidth: waiting ? 1.5 : 1)
        )
        .shadow(color: .black.opacity(look.dark ? 0.2 : 0.05), radius: 2, y: 1)
        .onHover { hover = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(name) pane"))
    }

    private var header: some View {
        HStack(spacing: 8) {
            ProgramMark(program: pane.agentApp ?? pane.program, size: 12)
            Text(name).type(.caption).foregroundStyle(isFocused ? look.ink : look.soft).lineLimit(1)
            Text(Paths.tilde(pane.cwd)).type(.caption).foregroundStyle(look.faint).lineLimit(1).truncationMode(.head)
            Spacer(minLength: 8)
            if hover {
                IconButton(symbol: "rectangle.split.2x1", label: "Split Right  ⌘D", size: 12) { store.split(.row, paneId: pane.id) }
                IconButton(symbol: "rectangle.split.1x2", label: "Split Down  ⇧⌘D", size: 12) { store.split(.column, paneId: pane.id) }
                IconButton(symbol: "xmark", label: "Close Pane  ⌘W", size: 11) { store.closePane(pane.id) }
            }
            if let status = pane.status, status != .idle {
                if waiting {
                    Text("waiting for you").type(.caption, .medium).foregroundStyle(look.waiting)
                }
                StateMark(state: status, size: 12)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .frame(height: 32)
        .contentShape(Rectangle())
        .onTapGesture { pane.focus() }
    }

    private var name: String {
        if let kind = AgentKind(program: pane.agentApp ?? pane.program) { return kind.command }
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
        // Only take the terminal if nobody holds it: during a layout change the old container may still
        // be updated for a moment, and taking it back there would leave the new place empty.
        if pane.view.superview == nil { v.attach(pane.view) }
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
