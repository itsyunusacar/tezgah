import AppKit
import GhosttyTerminal
import TezgahCore

/// Ghostty's configuration for every pane: Geist Mono and the Electron app's palettes.
enum TerminalLook {
    static var isDark: Bool {
        NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }

    static let fontFamily = "Geist Mono"
    static let fontSize: Float = 13

    static let controller: TerminalController = {
        // The user's light and dark themes; changing them in Settings rebuilds the panes' colours.
        let appearance = Appearance()
        let theme = TerminalTheme(light: palette(appearance.theme(dark: false)), dark: palette(appearance.theme(dark: true)))
        return TerminalController(theme: theme) { b in
            b.withFontFamily(fontFamily)
            b.withFontSize(fontSize)
            b.withWindowPaddingX(12)
            b.withWindowPaddingY(8)
            b.withCursorStyle(.block)
            b.withCursorStyleBlink(true)
            b.withCustom("window-padding-balance", "true")
            b.withCustom("adjust-cell-height", "12%")
            b.withCustom("confirm-close-surface", "false")
            b.withCustom("mouse-hide-while-typing", "true")
            b.withCustom("copy-on-select", "false")
            // Tezgah's own shortcuts win over Ghostty's defaults for tabs, windows and splits.
            for key in ["super+t", "super+n", "super+w", "super+shift+w", "super+d", "super+shift+d", "super+alt+d",
                        "super+o", "super+shift+f", "super+shift+t", "super+alt+w", "super+shift+left_bracket",
                        "super+shift+right_bracket", "super+shift+enter", "super+enter", "super+comma", "super+k", "super+l",
                        "super+p", "super+shift+h", "super+shift+n", "super+right_bracket", "super+left_bracket", "super+slash"]
                + (1...9).map({ "super+digit_\($0)" }) + (1...9).map({ "super+\($0)" }) {
                b.withCustom("keybind", "\(key)=unbind")
            }
        }
    }()

    static func palette(_ t: ThemeSpec) -> TerminalConfiguration {
        TerminalConfiguration { b in
            b.withBackground(t.raised.description)
            b.withForeground(t.foreground.description)
            b.withCursorColor(t.foreground.description)
            b.withSelectionBackground(t.raised.mixed(with: t.blue, t.isDark ? 0.35 : 0.18).description)
            b.withMinimumContrast(1.1)
            for (i, c) in t.ansi.enumerated() { b.withPalette(i, color: c.description) }
        }
    }
}

/// Terminal options from Settings, stored in the app's defaults.
enum TerminalSettings {
    static var fontSize: Double { d.object(forKey: "terminal.fontSize") as? Double ?? 13 }
    static var cursor: TerminalCursorStyle { TerminalCursorStyle(rawValue: d.string(forKey: "terminal.cursor") ?? "") ?? .block }
    static var blink: Bool { d.object(forKey: "terminal.blink") as? Bool ?? true }
    static var copyOnSelect: Bool { d.bool(forKey: "terminal.copyOnSelect") }
    static var ligatures: Bool { d.object(forKey: "terminal.ligatures") as? Bool ?? true }
    private static var d: UserDefaults { .standard }
}

extension TerminalLook {
    /// Applies the themes and terminal options to every pane at once, live.
    static func apply(_ appearance: Appearance) {
        controller.setTheme(TerminalTheme(light: palette(appearance.theme(dark: false)), dark: palette(appearance.theme(dark: true))))
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        controller.setTerminalConfiguration(TerminalConfiguration { b in
            b.withFontSize(Float(TerminalSettings.fontSize))
            b.withCursorStyle(TerminalSettings.cursor)
            b.withCursorStyleBlink(TerminalSettings.blink && !reduceMotion)
            b.withCustom("copy-on-select", TerminalSettings.copyOnSelect ? "true" : "false")
            if !TerminalSettings.ligatures { b.withCustom("font-feature", "-calt") }
        })
    }
}
