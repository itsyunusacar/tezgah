import AppKit
import SwiftUI
import TezgahCore

/// The Electron app's warm neutrals, light and dark.
enum Palette {
    static func dynamic(_ light: UInt32, _ dark: UInt32, alpha: CGFloat = 1) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light, alpha: alpha)
        })
    }

    static let canvas = dynamic(0xFDFCFC, 0x0E0D0C)
    static let well = dynamic(0xF3F1EE, 0x161514)
    static let raised = dynamic(0xFFFFFF, 0x1C1B1A)
    static let subtle = dynamic(0xEBE8E4, 0x262422)
    static let hover = dynamic(0xEDEAE6, 0x22201F)
    static let border = dynamic(0xE5E1DC, 0x2B2927)
    static let ink = dynamic(0x0C0B0A, 0xF5F3F1)
    static let secondary = dynamic(0x6B665F, 0xA59F97)
    static let tertiary = dynamic(0x8A847C, 0x6B665F)
    static let working = dynamic(0x2F5FD0, 0x7FA6F5)
    static let waiting = dynamic(0xD9730D, 0xF5A524)
    static let done = dynamic(0x2E8B57, 0x46C27A)
    static let failed = dynamic(0xC4352B, 0xFF6369)
    static let add = dynamic(0x2E7D46, 0x63C174)
    static let del = dynamic(0xC4352B, 0xFF6369)
    static let claude = dynamic(0xD97757, 0xE08B6D)

    static func status(_ s: AgentState?) -> Color {
        switch s {
        case .working: working
        case .blocked, .error: waiting
        case .done: done
        case .idle, nil: tertiary
        }
    }
}

extension AgentState {
    var label: String {
        switch self {
        case .working: "working"
        case .blocked: "needs you"
        case .error: "error"
        case .done: "done"
        case .idle: "idle"
        }
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
                  blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
}

enum Fonts {
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if NSFont(name: "GeistMono-Regular", size: size) != nil {
            return .custom(weight == .regular ? "GeistMono-Regular" : "GeistMono-Medium", size: size)
        }
        return .system(size: size, weight: weight, design: .monospaced)
    }
}

/// A rounded panel for the board and lists.
struct Card<Content: View>: View {
    var padding: CGFloat = 18
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(Palette.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.03), radius: 8, y: 2)
    }
}

struct CardTitle: View {
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.secondary)
            if let detail { Text(detail).font(.system(size: 13)).foregroundStyle(Palette.tertiary) }
            Spacer(minLength: 0)
        }
    }
}

/// The status dot: working blue, needs you orange, done green, idle grey.
struct StatusDot: View {
    let state: AgentState?
    var size: CGFloat = 8
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(Palette.status(state))
            .frame(width: size, height: size)
            .overlay {
                if state == .blocked || state == .error {
                    Circle().stroke(Palette.waiting.opacity(pulse ? 0 : 0.5), lineWidth: 2)
                        .scaleEffect(pulse ? 2.2 : 1)
                }
            }
            .opacity(state == .working && !reduceMotion ? (pulse ? 0.45 : 1) : 1)
            .onAppear { animate() }
            .onChange(of: state) { animate() }
            .accessibilityLabel(state?.label ?? "no agent")
    }

    private func animate() {
        pulse = false
        guard !reduceMotion, state == .working || state == .blocked else { return }
        withAnimation(.easeInOut(duration: state == .working ? 1.1 : 1.4).repeatForever(autoreverses: state == .working)) {
            pulse = true
        }
    }
}

/// Plain, borderless icon button for headers.
struct IconButton: View {
    let symbol: String
    let help: String
    var size: CGFloat = 12
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .medium))
                .foregroundStyle(hovering ? Palette.ink : Palette.secondary)
                .frame(width: 24, height: 22)
                .background(hovering ? Palette.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

/// A key cap like ⌘N.
struct KeyCap: View {
    let keys: String
    var body: some View {
        Text(keys)
            .font(Fonts.mono(11))
            .foregroundStyle(Palette.tertiary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Palette.subtle.opacity(0.7), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}
