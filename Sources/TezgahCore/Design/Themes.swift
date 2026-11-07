import Foundation

/// An sRGB colour as 0xRRGGBB, with the arithmetic the design system needs (mixing, contrast).
public struct RGB: Hashable, Sendable, CustomStringConvertible {
    public let hex: UInt32

    public init(_ hex: UInt32) { self.hex = hex }

    public var r: Double { Double((hex >> 16) & 0xFF) / 255 }
    public var g: Double { Double((hex >> 8) & 0xFF) / 255 }
    public var b: Double { Double(hex & 0xFF) / 255 }

    public var description: String { String(format: "#%06X", hex) }

    /// WCAG relative luminance.
    public var luminance: Double {
        func lin(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    /// WCAG contrast ratio against another colour, 1…21.
    public func contrast(with other: RGB) -> Double {
        let (a, b) = (luminance, other.luminance)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    /// `amount` of the way from this colour to `other` (0 = self, 1 = other).
    public func mixed(with other: RGB, _ amount: Double) -> RGB {
        func ch(_ a: Double, _ b: Double) -> UInt32 { UInt32((a + (b - a) * amount) * 255 + 0.5) }
        return RGB(ch(r, other.r) << 16 | ch(g, other.g) << 8 | ch(b, other.b))
    }
}

/// Everything a theme decides: the app's surfaces and text, and the terminal's colours.
///
/// Names are ours (Turkish workshop and nature words, translated by meaning in English). Imported
/// themes keep their own names.
public struct ThemeSpec: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable { case light, dark }

    public let id: String
    /// Display names; the app picks one by language.
    public let nameTR: String
    public let nameEN: String
    public let kind: Kind
    /// The terminal and card background.
    public let background: RGB
    public let foreground: RGB
    /// Secondary text: prompts, paths, hints.
    public let muted: RGB
    public let red: RGB, green: RGB, yellow: RGB, blue: RGB, magenta: RGB, cyan: RGB

    public init(id: String, tr: String, en: String, kind: Kind, background: UInt32, foreground: UInt32, muted: UInt32,
                red: UInt32, green: UInt32, yellow: UInt32, blue: UInt32, magenta: UInt32, cyan: UInt32) {
        self.id = id
        nameTR = tr
        nameEN = en
        self.kind = kind
        self.background = RGB(background)
        self.foreground = RGB(foreground)
        self.muted = RGB(muted)
        self.red = RGB(red)
        self.green = RGB(green)
        self.yellow = RGB(yellow)
        self.blue = RGB(blue)
        self.magenta = RGB(magenta)
        self.cyan = RGB(cyan)
    }

    public var isDark: Bool { kind == .dark }

    // MARK: Surfaces, derived so every theme gets the same structure

    /// The window behind the navigation and the cards. Light themes sit a step darker than their
    /// cards; dark themes keep the background and lift the cards instead.
    public var base: RGB { isDark ? background : background.mixed(with: foreground, 0.035) }
    /// Terminals, cards, sheets.
    public var raised: RGB { isDark ? background.mixed(with: foreground, 0.05) : background }
    /// Hairlines between rows and around cards.
    public var line: RGB { raised.mixed(with: foreground, isDark ? 0.12 : 0.09) }
    /// Selected rows and pressed controls.
    public var selected: RGB { base.mixed(with: foreground, isDark ? 0.1 : 0.05) }

    /// The 16 ANSI colours, normal then bright.
    public var ansi: [RGB] {
        let black = isDark ? background.mixed(with: foreground, 0.2) : foreground.mixed(with: background, 0.15)
        let white = isDark ? foreground.mixed(with: background, 0.15) : background.mixed(with: foreground, 0.2)
        let normal = [black, red, green, yellow, blue, magenta, cyan, white]
        let bright = normal.map { $0.mixed(with: isDark ? RGB(0xFFFFFF) : RGB(0x000000), 0.12) }
        return normal + bright
    }
}

public enum Themes {
    public static let all: [ThemeSpec] = [
        // Light
        ThemeSpec(id: "kagit", tr: "Kâğıt", en: "Paper", kind: .light, background: 0xFDFCFC, foreground: 0x0C0B0A, muted: 0x6F6963,
                  red: 0xC4352B, green: 0x2A7A4D, yellow: 0xA65508, blue: 0x2F5FD0, magenta: 0x9B3D8F, cyan: 0x1F7A85),
        ThemeSpec(id: "talas", tr: "Talaş", en: "Sawdust", kind: .light, background: 0xF6EFE3, foreground: 0x2B2118, muted: 0x6E5F4E,
                  red: 0xB23A2E, green: 0x477024, yellow: 0x8F6200, blue: 0x2E5E9E, magenta: 0x8E4585, cyan: 0x256E6C),
        ThemeSpec(id: "mese", tr: "Meşe", en: "Oak", kind: .light, background: 0xEDE2CF, foreground: 0x33261A, muted: 0x63533F,
                  red: 0xA03E2B, green: 0x4A6623, yellow: 0x7A5300, blue: 0x34578A, magenta: 0x7C4A76, cyan: 0x2F6460),
        ThemeSpec(id: "sis", tr: "Sis", en: "Mist", kind: .light, background: 0xEEF0F2, foreground: 0x1F2328, muted: 0x5E6670,
                  red: 0xB5373B, green: 0x2F7A4A, yellow: 0x875E00, blue: 0x3559B7, magenta: 0x8A4BA8, cyan: 0x236B79),
        ThemeSpec(id: "cini", tr: "Çini", en: "Iznik", kind: .light, background: 0xF3F6FB, foreground: 0x10243E, muted: 0x55657C,
                  red: 0xC2412D, green: 0x1E7A5A, yellow: 0x8F5F00, blue: 0x1F4FB5, magenta: 0x7A3FA0, cyan: 0x0F6F8F),
        ThemeSpec(id: "lale", tr: "Lale", en: "Tulip", kind: .light, background: 0xFBF1F2, foreground: 0x2E1A1F, muted: 0x71585E,
                  red: 0xB8323F, green: 0x3F7A45, yellow: 0x8F5C00, blue: 0x3B5BAA, magenta: 0xA1307A, cyan: 0x2C7380),
        ThemeSpec(id: "kum", tr: "Kum", en: "Sand", kind: .light, background: 0xF2ECDF, foreground: 0x2A2620, muted: 0x665E52,
                  red: 0xA9412B, green: 0x4E7432, yellow: 0x8A6000, blue: 0x3A5B95, magenta: 0x83508A, cyan: 0x33736F),
        ThemeSpec(id: "kirec", tr: "Kireç", en: "Chalk", kind: .light, background: 0xFFFFFF, foreground: 0x000000, muted: 0x3D3D3D,
                  red: 0xB00020, green: 0x006B2D, yellow: 0x7A4F00, blue: 0x0033B3, magenta: 0x8A0F7A, cyan: 0x005F6B),
        // Dark
        ThemeSpec(id: "gece", tr: "Gece", en: "Night", kind: .dark, background: 0x0C0B0A, foreground: 0xF5F3F1, muted: 0xA8A29A,
                  red: 0xF07A6E, green: 0x5CC48A, yellow: 0xF0A04B, blue: 0x7A9CF0, magenta: 0xD38BD1, cyan: 0x5CC2C9),
        ThemeSpec(id: "ceviz", tr: "Ceviz", en: "Walnut", kind: .dark, background: 0x1E1712, foreground: 0xEADFD2, muted: 0xA89A8A,
                  red: 0xE8806A, green: 0x9CC27A, yellow: 0xE7B35C, blue: 0x8AA9E0, magenta: 0xD49AC4, cyan: 0x7CC2B8),
        ThemeSpec(id: "komur", tr: "Kömür", en: "Charcoal", kind: .dark, background: 0x1B1C1E, foreground: 0xE6E6E3, muted: 0x9A9C9F,
                  red: 0xEE7B72, green: 0x7DC98F, yellow: 0xE6B95C, blue: 0x82A6EE, magenta: 0xC99BE0, cyan: 0x6CC4CF),
        ThemeSpec(id: "lacivert", tr: "Lacivert", en: "Navy", kind: .dark, background: 0x0F1A2E, foreground: 0xDCE6F5, muted: 0x8D9BB3,
                  red: 0xF2837A, green: 0x6FCF97, yellow: 0xF2C26B, blue: 0x82AAFF, magenta: 0xC792EA, cyan: 0x6BD5E0),
        ThemeSpec(id: "zeytinlik", tr: "Zeytinlik", en: "Olive Grove", kind: .dark, background: 0x1A1D14, foreground: 0xE4E6D6, muted: 0x9EA38C,
                  red: 0xE88A6D, green: 0xA8CC6A, yellow: 0xE5C25C, blue: 0x8FB0D9, magenta: 0xC7A0C9, cyan: 0x86C7B2),
        ThemeSpec(id: "pas", tr: "Pas", en: "Rust", kind: .dark, background: 0x24140F, foreground: 0xF1DED5, muted: 0xB39A8F,
                  red: 0xF28B6E, green: 0xA5C77C, yellow: 0xF0B45C, blue: 0x93A8E0, magenta: 0xE19AC0, cyan: 0x86C4BC),
        ThemeSpec(id: "gurup", tr: "Gurup", en: "Dusk", kind: .dark, background: 0x1D1626, foreground: 0xECE3F2, muted: 0xA99BB5,
                  red: 0xF28A8A, green: 0x8CD39B, yellow: 0xF2C27A, blue: 0x9AA8F5, magenta: 0xE3A0E8, cyan: 0x7FD0D6),
        ThemeSpec(id: "murekkep", tr: "Mürekkep", en: "Ink", kind: .dark, background: 0x000000, foreground: 0xFFFFFF, muted: 0xBDBDBD,
                  red: 0xFF6B6B, green: 0x5CFF8A, yellow: 0xFFD24D, blue: 0x6EA8FF, magenta: 0xFF7AE5, cyan: 0x4DF0FF),
    ]

    public static let defaultLight = "kagit"
    public static let defaultDark = "gece"

    public static func theme(_ id: String) -> ThemeSpec? { all.first { $0.id == id } }
}

/// The accent for buttons, selection and focus rings. `system` follows the macOS accent colour.
public struct AccentSpec: Identifiable, Hashable, Sendable {
    public let id: String
    public let nameTR: String
    public let nameEN: String
    /// nil for the system accent.
    public let color: RGB?

    public static let all: [AccentSpec] = [
        AccentSpec(id: "sky", nameTR: "Gök", nameEN: "Sky", color: RGB(0x2C5A9C)),
        AccentSpec(id: "system", nameTR: "Sistem", nameEN: "System", color: nil),
        AccentSpec(id: "ink", nameTR: "Mürekkep", nameEN: "Ink", color: RGB(0x0C0B0A)),
        AccentSpec(id: "navy", nameTR: "Lacivert", nameEN: "Navy", color: RGB(0x2F5FD0)),
        AccentSpec(id: "pine", nameTR: "Çam", nameEN: "Pine", color: RGB(0x2A7A4D)),
        AccentSpec(id: "turquoise", nameTR: "Turkuaz", nameEN: "Turquoise", color: RGB(0x0F766E)),
        AccentSpec(id: "brick", nameTR: "Kiremit", nameEN: "Brick", color: RGB(0xC2410C)),
        AccentSpec(id: "saffron", nameTR: "Safran", nameEN: "Saffron", color: RGB(0xC98A00)),
        AccentSpec(id: "tulip", nameTR: "Lale", nameEN: "Tulip", color: RGB(0xC2185B)),
        AccentSpec(id: "plum", nameTR: "Erik", nameEN: "Plum", color: RGB(0x6B4FA0)),
    ]
}

/// Agent state colours. Colour never carries meaning alone: each state also has a mark and a name.
/// Waiting is the deep sky blue of the logo's cursor ("the cursor waits for you"); working is a lighter,
/// calmer blue. Done and failed keep the colours everyone reads the same way.
public enum StateColors {
    public static func working(dark: Bool) -> RGB { RGB(dark ? 0x6F93C9 : 0x5B85C0) }
    public static func waiting(dark: Bool) -> RGB { RGB(dark ? 0xA9C8F0 : 0x2C5A9C) }
    public static func done(dark: Bool) -> RGB { RGB(dark ? 0x5CC48A : 0x2A7A4D) }
    public static func failed(dark: Bool) -> RGB { RGB(dark ? 0xF07A6E : 0xC4352B) }
}

/// The app's own surfaces, apart from the terminal theme: paper by day, a blue-black night.
public struct ChromePalette: Sendable {
    public let paper: RGB, raised: RGB, sunken: RGB, bar: RGB
    public let ink: RGB, muted: RGB, faint: RGB, line: RGB, hairline: RGB
    /// Selection fill and its edge; the blue of links, focus and selected text.
    public let tint: RGB, tintLine: RGB, blue: RGB
    /// The squared paper's lines (drawn with `gridAlpha`).
    public let grid: RGB
    /// The sky, top to horizon.
    public let sky: [(RGB, Double)]

    public static let day = ChromePalette(
        paper: RGB(0xFBFAF8), raised: RGB(0xFFFFFF), sunken: RGB(0xF3F1ED), bar: RGB(0xF4F2EE),
        ink: RGB(0x15171C), muted: RGB(0x5D6169), faint: RGB(0x8B9099), line: RGB(0xE4E1DC), hairline: RGB(0xEEEBE6),
        tint: RGB(0xE8EFF8), tintLine: RGB(0xC5D5EC), blue: RGB(0x2C5A9C), grid: RGB(0x2C5A9C),
        sky: [(RGB(0x26498A), 0), (RGB(0x3F6DB0), 0.34), (RGB(0x86AADB), 0.66), (RGB(0xA9C3E6), 0.86), (RGB(0xBFD3EE), 1)])

    public static let night = ChromePalette(
        paper: RGB(0x0F141D), raised: RGB(0x161C27), sunken: RGB(0x0B0F16), bar: RGB(0x0C1018),
        ink: RGB(0xECEFF4), muted: RGB(0x98A1B0), faint: RGB(0x6C7585), line: RGB(0x232B38), hairline: RGB(0x1B222D),
        tint: RGB(0x16243A), tintLine: RGB(0x2A4266), blue: RGB(0x9DBDEA), grid: RGB(0x8CAFE6),
        sky: [(RGB(0x060A14), 0), (RGB(0x0C1730), 0.38), (RGB(0x1A3160), 0.72), (RGB(0x2E4E86), 0.9), (RGB(0x3B5D95), 1)])

    public static func of(dark: Bool) -> ChromePalette { dark ? night : day }
}
