import SwiftUI
import TezgahCore

// MARK: - The Tezgah mark

/// The bench without its cursor block, built from `MarkGeometry` in logo units.
struct BenchShape: Shape, Sendable {
    nonisolated func path(in rect: CGRect) -> Path {
        let vb = MarkGeometry.viewBox
        let s = min(rect.width / vb.width, rect.height / vb.height)
        let ox = rect.minX + (rect.width - vb.width * s) / 2 - vb.x * s
        let oy = rect.minY + (rect.height - vb.height * s) / 2 - vb.y * s
        func r(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect { CGRect(x: ox + x * s, y: oy + y * s, width: w * s, height: h * s) }
        var p = Path()
        let t = MarkGeometry.top
        p.addRoundedRect(in: r(t.x, t.y, t.width, t.height), cornerSize: CGSize(width: t.radius * s, height: t.radius * s))
        for l in MarkGeometry.legs {
            p.addRoundedRect(in: r(l.x, l.y, l.width, l.height), cornerSize: CGSize(width: l.radius * s, height: l.radius * s))
        }
        // Fillets where the legs meet the top: quarter-circle inner corners.
        let f = MarkGeometry.fillet, k = 0.552, bottom = t.y + t.height
        for l in MarkGeometry.legs {
            for (x, dir) in [(l.x, -1.0), (l.x + l.width, 1.0)] {
                var q = Path()
                q.move(to: CGPoint(x: ox + (x + dir * f) * s, y: oy + bottom * s))
                q.addCurve(to: CGPoint(x: ox + x * s, y: oy + (bottom + f) * s),
                           control1: CGPoint(x: ox + (x + dir * f * (1 - k)) * s, y: oy + bottom * s),
                           control2: CGPoint(x: ox + x * s, y: oy + (bottom + f * (1 - k)) * s))
                q.addLine(to: CGPoint(x: ox + x * s, y: oy + bottom * s))
                q.closeSubpath()
                p.addPath(q)
            }
        }
        return p
    }
}

struct CursorBlockShape: Shape, Sendable {
    nonisolated func path(in rect: CGRect) -> Path {
        let vb = MarkGeometry.viewBox
        let s = min(rect.width / vb.width, rect.height / vb.height)
        let ox = rect.minX + (rect.width - vb.width * s) / 2 - vb.x * s
        let oy = rect.minY + (rect.height - vb.height * s) / 2 - vb.y * s
        let c = MarkGeometry.cursor
        return Path(roundedRect: CGRect(x: ox + c.x * s, y: oy + c.y * s, width: c.width * s, height: c.height * s),
                    cornerRadius: c.radius * s)
    }
}

/// The Tezgah mark. The cursor block blinks when asked, unless Reduce Motion is on.
struct TezgahMark: View {
    var width: Double = 24
    var color: Color? = nil
    var cursorColor: Color? = nil
    var blinking = false
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let h = width * MarkGeometry.viewBox.height / MarkGeometry.viewBox.width
        ZStack {
            BenchShape().fill(color ?? look.ink)
            if blinking && !reduceMotion {
                TimelineView(.periodic(from: .now, by: Motion.blink / 2)) { ctx in
                    let on = Int(ctx.date.timeIntervalSinceReferenceDate / (Motion.blink / 2)) % 2 == 0
                    CursorBlockShape().fill(cursorColor ?? color ?? look.ink).opacity(on ? 1 : 0)
                }
            } else {
                CursorBlockShape().fill(cursorColor ?? color ?? look.ink)
            }
        }
        .frame(width: width, height: h)
        .accessibilityLabel(Text("Tezgah"))
    }
}

// MARK: - Agent logos

enum AgentKind: String, CaseIterable, Identifiable {
    case claude, codex, antigravity, grok
    var id: String { rawValue }

    /// The command that starts it.
    var command: String {
        switch self {
        case .claude: "claude"
        case .codex: "codex"
        case .antigravity: "agy"
        case .grok: "grok"
        }
    }

    var name: String {
        switch self {
        case .claude: "Claude Code"
        case .codex: "Codex"
        case .antigravity: "Antigravity CLI"
        case .grok: "Grok Build"
        }
    }

    /// Reads a program or reported app name ("claude", "agy", "gemini", "codex").
    init?(program: String?) {
        switch program?.lowercased() {
        case "claude", "claude-code": self = .claude
        case "codex", "openai": self = .codex
        case "agy", "antigravity", "gemini": self = .antigravity
        case "grok": self = .grok
        default: return nil
        }
    }
}

/// A logo drawn from SVG path data in a 24 × 24 box.
struct SVGShape: Shape, Sendable {
    let segments: [SVGPath.Segment]

    init(_ d: String) { segments = SVGPath.parse(d) }

    nonisolated func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let ox = rect.minX + (rect.width - 24 * s) / 2, oy = rect.minY + (rect.height - 24 * s) / 2
        func pt(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var p = Path()
        for seg in segments {
            switch seg {
            case let .move(x, y): p.move(to: pt(x, y))
            case let .line(x, y): p.addLine(to: pt(x, y))
            case let .cubic(a, b, c, d, x, y): p.addCurve(to: pt(x, y), control1: pt(a, b), control2: pt(c, d))
            case .close: p.closeSubpath()
            }
        }
        return p
    }
}

enum LogoShapes {
    static let claude = SVGShape(LogoPaths.claude)
    static let openAI = SVGShape(LogoPaths.openAI)
    static let grok = SVGShape(LogoPaths.grok)
    static let antigravity = SVGShape(LogoPaths.antigravity)
}

/// An agent's logo in its own colours (ink-coloured marks follow the theme's text colour).
struct AgentLogo: View {
    let kind: AgentKind
    var size: Double = 14
    var faded = false
    @Environment(\.look) private var look

    var body: some View {
        Group {
            switch kind {
            case .claude:
                LogoShapes.claude.fill(Color(RGB(0xD97757)))
            case .codex:
                LogoShapes.openAI.fill(look.ink)
            case .grok:
                LogoShapes.grok.fill(look.ink, style: FillStyle(eoFill: true))
            case .antigravity:
                // Google's four colours sweeping across the arch.
                LogoShapes.antigravity.fill(
                    LinearGradient(stops: [.init(color: Color(RGB(0x3186FF)), location: 0),
                                           .init(color: Color(RGB(0x00B95C)), location: 0.35),
                                           .init(color: Color(RGB(0xFBBC04)), location: 0.65),
                                           .init(color: Color(RGB(0xFC413D)), location: 1)],
                                   startPoint: .bottomLeading, endPoint: .topTrailing))
            }
        }
        .frame(width: size, height: size)
        .saturation(faded ? 0 : 1)
        .opacity(faded ? 0.45 : 1)
        .accessibilityLabel(Text(kind.name))
    }
}

/// What a session shows as its icon: the agent's logo, else a terminal glyph.
struct ProgramMark: View {
    let program: String?
    var size: Double = 14
    @Environment(\.look) private var look

    var body: some View {
        if let kind = AgentKind(program: program) {
            AgentLogo(kind: kind, size: size)
        } else {
            Image(systemName: "chevron.forward.2")
                .font(.system(size: size * 0.7, weight: .semibold))
                .foregroundStyle(look.muted)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - State marks: colour + shape + name, never colour alone

struct Spinner: View {
    var size: Double = 14
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { ctx in
            let angle = reduceMotion ? 0 : ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) * 360
            ZStack {
                Circle().stroke(look.working.opacity(0.18), lineWidth: size / 7)
                Circle().trim(from: 0, to: 0.25).stroke(look.working, style: StrokeStyle(lineWidth: size / 7, lineCap: .round))
                    .rotationEffect(.degrees(angle))
            }
        }
        .frame(width: size * 0.8, height: size * 0.8)
        .frame(width: size, height: size)
    }
}

/// A small block that blinks like the cursor: someone (you) is awaited.
struct WaitingBlock: View {
    var size: Double = 14
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: Motion.blink / 2)) { ctx in
            let on = reduceMotion || Int(ctx.date.timeIntervalSinceReferenceDate / (Motion.blink / 2)) % 2 == 0
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(look.waiting)
                .frame(width: size * 0.57, height: size)
                .opacity(on ? 1 : 0.25)
        }
        .frame(width: size, height: size)
    }
}

struct DoneCheck: View {
    var size: Double = 14
    @Environment(\.look) private var look
    var body: some View {
        ZStack {
            Circle().fill(look.done)
            Image(systemName: "checkmark").font(.system(size: size * 0.55, weight: .bold)).foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

/// The mark for a state, with the state's name for VoiceOver. Idle shows nothing.
struct StateMark: View {
    let state: AgentState?
    var size: Double = 14

    var body: some View {
        Group {
            switch state {
            case .working: Spinner(size: size)
            case .blocked, .error: WaitingBlock(size: size)
            case .done: DoneCheck(size: size)
            case .idle, nil: EmptyView()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(state.map { Text($0.spokenName) } ?? Text(""))
    }
}

extension AgentState {
    var spokenName: LocalizedStringKey {
        switch self {
        case .working: "working"
        case .blocked: "waiting for you"
        case .error: "error"
        case .done: "done"
        case .idle: "idle"
        }
    }
}

/// A project's monogram square.
struct Monogram: View {
    let name: String
    var size: Double = 22
    var active = false
    @Environment(\.look) private var look

    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(Typeface.sans(max(10, size / 2), .semibold))
            .foregroundStyle(active ? Color(look.theme.background) : look.soft)
            .frame(width: size, height: size)
            .background(active ? look.ink : look.ink.opacity(look.dark ? 0.14 : 0.09),
                        in: RoundedRectangle(cornerRadius: max(5, size / 4), style: .continuous))
            .accessibilityHidden(true)
    }
}
