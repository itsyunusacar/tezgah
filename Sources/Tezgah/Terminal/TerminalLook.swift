import AppKit
import GhosttyTerminal

/// Ghostty's configuration for every pane: Geist Mono and the Electron app's palettes.
enum TerminalLook {
    static var isDark: Bool {
        NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }

    static let fontFamily = "Geist Mono"
    static let fontSize: Float = 13

    static let controller: TerminalController = {
        let theme = TerminalTheme(
            light: palette(
                background: "#FDFCFC", foreground: "#1A1918", cursor: "#0C0B0A", selection: "#DCE6FB",
                normal: ["#1A1918", "#C4352B", "#2E7D46", "#946200", "#2F5FD0", "#8E44AD", "#1F7A8C", "#8F8981"],
                bright: ["#5C5751", "#E5484D", "#3A9A5B", "#B58400", "#4B7BEC", "#A35BC2", "#2C96A8", "#6B665F"],
                contrast: 1.6
            ),
            dark: palette(
                background: "#0E0D0C", foreground: "#EDEAE6", cursor: "#F5F3F1", selection: "#2A3550",
                normal: ["#1A1918", "#E5484D", "#46A758", "#E2B93B", "#5B8DEF", "#B57EDC", "#4CC3D9", "#C9C3BB"],
                bright: ["#5C5751", "#FF6369", "#63C174", "#F1CB5B", "#7FA6F5", "#CB9EEA", "#74D4E6", "#FFFFFF"],
                contrast: 1
            )
        )
        return TerminalController(theme: theme) { b in
            b.withFontFamily(fontFamily)
            b.withFontSize(fontSize)
            b.withWindowPaddingX(12)
            b.withWindowPaddingY(8)
            b.withCursorStyle(.bar)
            b.withCursorStyleBlink(true)
            b.withCustom("window-padding-balance", "true")
            b.withCustom("adjust-cell-height", "12%")
            b.withCustom("confirm-close-surface", "false")
            b.withCustom("mouse-hide-while-typing", "true")
            b.withCustom("copy-on-select", "false")
            // Tezgah's own shortcuts win over Ghostty's defaults for tabs, windows and splits.
            for key in ["super+t", "super+n", "super+w", "super+shift+w", "super+d", "super+shift+d", "super+alt+d",
                        "super+o", "super+shift+f", "super+shift+t", "super+alt+w", "super+shift+left_bracket",
                        "super+shift+right_bracket", "super+shift+enter", "super+enter", "super+comma"]
                + (1...9).map({ "super+digit_\($0)" }) + (1...9).map({ "super+\($0)" }) {
                b.withCustom("keybind", "\(key)=unbind")
            }
        }
    }()

    private static func palette(background: String, foreground: String, cursor: String, selection: String,
                                normal: [String], bright: [String], contrast: Double) -> TerminalConfiguration {
        TerminalConfiguration { b in
            b.withBackground(background)
            b.withForeground(foreground)
            b.withCursorColor(cursor)
            b.withSelectionBackground(selection)
            b.withMinimumContrast(contrast)
            for (i, c) in normal.enumerated() { b.withPalette(i, color: c) }
            for (i, c) in bright.enumerated() { b.withPalette(i + 8, color: c) }
        }
    }
}
