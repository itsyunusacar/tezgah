import AppKit
import SwiftUI
import TezgahCore

// MARK: - Colour

extension Color {
    init(_ rgb: RGB, opacity: Double = 1) {
        self.init(.sRGB, red: rgb.r, green: rgb.g, blue: rgb.b, opacity: opacity)
    }
}

extension NSColor {
    convenience init(_ rgb: RGB, alpha: CGFloat = 1) {
        self.init(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: alpha)
    }
}

/// Where the projects-and-sessions strip sits.
enum NavPosition: String, CaseIterable, Identifiable {
    case left, right, top, bottom
    var id: String { rawValue }
    var isVertical: Bool { self == .left || self == .right }

    var title: LocalizedStringKey {
        switch self {
        case .left: "Left"
        case .right: "Right"
        case .top: "Top"
        case .bottom: "Bottom"
        }
    }
}

/// The look the user chose: themes for light and dark, the accent, the strip's position. Saved in
/// the app's defaults; every view reads the resolved colours through `Look`.
@Observable
final class Appearance {
    enum Mode: String, CaseIterable { case light, dark, system }

    var mode: Mode { didSet { save() } }
    var lightTheme: String { didSet { save() } }
    var darkTheme: String { didSet { save() } }
    /// When off, the light theme is used in dark mode too.
    var separateDarkTheme: Bool { didSet { save() } }
    var accent: String { didSet { save() } }
    var navPosition: NavPosition { didSet { save() } }

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        mode = Mode(rawValue: defaults.string(forKey: "appearance.mode") ?? "") ?? .system
        lightTheme = defaults.string(forKey: "appearance.light") ?? Themes.defaultLight
        darkTheme = defaults.string(forKey: "appearance.dark") ?? Themes.defaultDark
        separateDarkTheme = defaults.object(forKey: "appearance.separate") as? Bool ?? true
        accent = defaults.string(forKey: "appearance.accent") ?? "system"
        navPosition = NavPosition(rawValue: defaults.string(forKey: "appearance.nav") ?? "") ?? .left
    }

    private func save() {
        defaults.set(mode.rawValue, forKey: "appearance.mode")
        defaults.set(lightTheme, forKey: "appearance.light")
        defaults.set(darkTheme, forKey: "appearance.dark")
        defaults.set(separateDarkTheme, forKey: "appearance.separate")
        defaults.set(accent, forKey: "appearance.accent")
        defaults.set(navPosition.rawValue, forKey: "appearance.nav")
        NSApp.appearance = nsAppearance
        TerminalLook.apply(self)
    }

    var nsAppearance: NSAppearance? {
        switch mode {
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        case .system: nil
        }
    }

    func theme(dark: Bool) -> ThemeSpec {
        let id = dark && separateDarkTheme ? darkTheme : lightTheme
        return Themes.theme(id) ?? Themes.theme(dark ? Themes.defaultDark : Themes.defaultLight)!
    }

    func look(dark: Bool) -> Look { Look(theme: theme(dark: dark), accent: AccentSpec.all.first { $0.id == accent }) }
}

/// Resolved colours for one theme. Views take it from the environment.
struct Look {
    let theme: ThemeSpec
    let accentSpec: AccentSpec?

    init(theme: ThemeSpec, accent: AccentSpec? = nil) {
        self.theme = theme
        accentSpec = accent
    }

    var dark: Bool { theme.isDark }
    var base: Color { Color(theme.base) }
    var raised: Color { Color(theme.raised) }
    var line: Color { Color(theme.line) }
    var selected: Color { Color(theme.selected) }
    var ink: Color { Color(theme.foreground) }
    var muted: Color { Color(theme.muted) }
    /// Between ink and muted: body text that isn't the focus.
    var soft: Color { Color(theme.foreground.mixed(with: theme.muted, 0.55)) }
    /// Placeholders, counters, hints that may be fainter than 4.5:1 only at 11 pt and with words nearby.
    var faint: Color { Color(theme.muted.mixed(with: theme.background, 0.25)) }

    var accent: Color {
        if let c = accentSpec?.color { return Color(dark && c.luminance < 0.05 ? theme.foreground : c) }
        return Color(nsColor: .controlAccentColor)
    }

    /// The text colour on a filled accent.
    var onAccent: Color {
        guard let c = accentSpec?.color else { return .white }
        let fill = dark && c.luminance < 0.05 ? theme.foreground : c
        return fill.contrast(with: RGB(0xFFFFFF)) >= fill.contrast(with: RGB(0x0C0B0A)) ? .white : Color(RGB(0x0C0B0A))
    }

    /// Primary buttons are ink on paper (the brand is black and white); the accent is for selection and focus.
    var primary: Color { ink }
    var onPrimary: Color { Color(theme.background) }

    var working: Color { Color(StateColors.working(dark: dark)) }
    var waiting: Color { Color(StateColors.waiting(dark: dark)) }
    var done: Color { Color(StateColors.done(dark: dark)) }
    var failed: Color { Color(StateColors.failed(dark: dark)) }

    func state(_ s: AgentState?) -> Color {
        switch s {
        case .working: working
        case .blocked, .error: waiting
        case .done: done
        case .idle, nil: muted
        }
    }

    static let paper = Look(theme: Themes.theme(Themes.defaultLight)!)
}

private struct LookKey: EnvironmentKey {
    static let defaultValue = Look.paper
}

extension EnvironmentValues {
    var look: Look {
        get { self[LookKey.self] }
        set { self[LookKey.self] = newValue }
    }
}

/// Resolves the look for the current light/dark scheme and hands it down.
struct LookProvider<Content: View>: View {
    @Environment(Appearance.self) private var appearance
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder var content: Content

    var body: some View {
        content.environment(\.look, appearance.look(dark: scheme == .dark))
    }
}

// MARK: - Type

enum Typeface {
    static func sans(_ size: Double, _ weight: Font.Weight = .regular) -> Font {
        let name = switch weight {
        case .semibold, .bold, .heavy, .black: "Geist-SemiBold"
        case .medium: "Geist-Medium"
        default: "Geist-Regular"
        }
        return NSFont(name: name, size: size) != nil ? .custom(name, fixedSize: size) : .system(size: size, weight: weight)
    }

    static func mono(_ size: Double, _ weight: Font.Weight = .regular) -> Font {
        let name = weight == .regular ? "GeistMono-Regular" : "GeistMono-Medium"
        return NSFont(name: name, size: size) != nil ? .custom(name, fixedSize: size) : .system(size: size, weight: weight, design: .monospaced)
    }
}

extension View {
    /// Sets text on the type scale: size, line height snapped to the grid, tracking.
    func type(_ step: TypeScale, _ weight: Font.Weight = .regular, mono: Bool = false) -> some View {
        let font = mono ? Typeface.mono(step.size, weight) : Typeface.sans(step.size, weight)
        // SwiftUI's line spacing is added to the font's natural height (≈1.2 × size for Geist).
        let spacing = max(0, step.lineHeight - step.size * 1.2)
        return self.font(font).lineSpacing(spacing).tracking(step.tracking * step.size)
    }
}

// MARK: - Surfaces

extension View {
    /// A raised card: the theme's card colour, a hairline, a soft shadow.
    func card(_ look: Look, radius: Double = Grid.Radius.card, ring: Color? = nil, ringWidth: Double = 1) -> some View {
        background(look.raised, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(ring ?? look.line, lineWidth: ringWidth))
            .shadow(color: .black.opacity(look.dark ? 0.2 : 0.05), radius: 2, y: 1)
    }
}

/// Squared paper: 24 pt squares with a stronger line every 96 pt, as on the onboarding pages.
struct PaperGrid: View {
    @Environment(\.look) private var look
    var small: Double = Grid.Paper.small
    var big: Double = Grid.Paper.big
    var strength: Double = 1

    var body: some View {
        Canvas { ctx, size in
            let minor = look.ink.opacity((look.dark ? 0.05 : 0.045) * strength)
            let major = look.ink.opacity((look.dark ? 0.09 : 0.09) * strength)
            var x = 0.0
            while x <= size.width {
                let isMajor = x.truncatingRemainder(dividingBy: big) == 0
                ctx.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .color(isMajor ? major : minor))
                x += small
            }
            var y = 0.0
            while y <= size.height {
                let isMajor = y.truncatingRemainder(dividingBy: big) == 0
                ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(isMajor ? major : minor))
                y += small
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Controls

struct TZButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, plain, danger }
    var kind: Kind = .secondary
    var small = false
    @Environment(\.look) private var look
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let h: Double = small ? 28 : 32
        configuration.label
            .type(small ? .caption : .body, .medium)
            .padding(.horizontal, small ? 10 : 12)
            .frame(height: h)
            .foregroundStyle(fg)
            .background(bg(pressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: Grid.Radius.control, style: .continuous))
            .overlay {
                if kind == .secondary {
                    RoundedRectangle(cornerRadius: Grid.Radius.control, style: .continuous).strokeBorder(look.line, lineWidth: 1)
                }
            }
            .opacity(enabled ? 1 : 0.45)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: Motion.quick), value: configuration.isPressed)
    }

    private var fg: Color {
        switch kind {
        case .primary: look.onPrimary
        case .danger: .white
        case .secondary: look.ink
        case .plain: look.muted
        }
    }

    private func bg(pressed: Bool) -> Color {
        switch kind {
        case .primary: look.primary.opacity(pressed ? 0.85 : 1)
        case .danger: look.failed.opacity(pressed ? 0.85 : 1)
        case .secondary: pressed ? look.selected : look.raised
        case .plain: pressed ? look.selected : .clear
        }
    }
}

/// A small icon-only button with a VoiceOver label and a tooltip.
struct IconButton: View {
    let symbol: String
    let label: LocalizedStringKey
    var size: Double = 14
    var badge = false
    let action: () -> Void
    @Environment(\.look) private var look
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .regular))
                .foregroundStyle(look.muted)
                .frame(width: 28, height: 28)
                .background(hover ? look.selected : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if badge {
                        Circle().fill(look.waiting).frame(width: 6, height: 6).padding(5)
                    }
                }
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(Text(label))
        .accessibilityLabel(Text(label))
    }
}

/// A keyboard shortcut shown as text, e.g. "⌘K".
struct KeyHint: View {
    let keys: String
    @Environment(\.look) private var look
    var body: some View {
        Text(keys).type(.caption, .medium, mono: true).foregroundStyle(look.faint).accessibilityHidden(true)
    }
}
