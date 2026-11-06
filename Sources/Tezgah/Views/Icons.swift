import AppKit
import SwiftUI

/// Names and symbols for the programs and agents a session can run.
enum Programs {
    struct Look {
        let symbol: String
        let tint: Color
        let name: String
    }

    static func look(_ program: String?) -> Look {
        switch program?.lowercased() {
        case "claude": Look(symbol: "staroflife.fill", tint: Palette.claude, name: "Claude Code")
        case "codex": Look(symbol: "hexagon", tint: Palette.ink, name: "Codex")
        case "gemini": Look(symbol: "sparkle", tint: Palette.working, name: "Gemini")
        case "grok": Look(symbol: "circle.slash", tint: Palette.ink, name: "Grok")
        case "opencode", "aider", "amp", "cursor-agent", "copilot":
            Look(symbol: "sparkles", tint: Palette.secondary, name: program!.capitalized)
        case "node", "bun", "deno", "npm", "pnpm", "yarn", "npx":
            Look(symbol: "shippingbox", tint: Palette.add, name: program!)
        case "python", "python3", "ipython", "uv":
            Look(symbol: "chevron.left.forwardslash.chevron.right", tint: Palette.working, name: program!)
        case "vim", "nvim", "hx", "nano", "emacs", "micro":
            Look(symbol: "pencil.line", tint: Palette.add, name: program!)
        case "git", "lazygit", "tig": Look(symbol: "arrow.triangle.branch", tint: Palette.claude, name: program!)
        case "ssh", "mosh": Look(symbol: "network", tint: Palette.working, name: program!)
        case "top", "htop", "btop": Look(symbol: "chart.bar.xaxis", tint: Palette.secondary, name: program!)
        case "less", "man", "more": Look(symbol: "doc.text", tint: Palette.secondary, name: program!)
        case "make", "cargo", "swift", "go", "xcodebuild": Look(symbol: "hammer", tint: Palette.secondary, name: program!)
        case "docker": Look(symbol: "cube", tint: Palette.working, name: "docker")
        case let p?: Look(symbol: "apple.terminal", tint: Palette.secondary, name: p)
        case nil: Look(symbol: "apple.terminal", tint: Palette.secondary, name: Shell.programName(Shell.current))
        }
    }

    static func displayName(_ program: String) -> String { look(program).name }
}

/// A program's icon on a small tile, like the tabs in the reference.
struct ProgramIcon: View {
    let program: String?
    var size: CGFloat = 18

    var body: some View {
        let look = Programs.look(program)
        Image(systemName: look.symbol)
            .font(.system(size: size * 0.55, weight: .semibold))
            .foregroundStyle(look.tint)
            .frame(width: size, height: size)
            .background(Palette.subtle, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    }
}

/// A project's icon: its favicon or app icon when it has one, else a monogram.
struct ProjectIconView: View {
    let path: String
    let name: String
    var size: CGFloat = 20

    var body: some View {
        Group {
            if let image = ProjectIcons.image(for: path) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .padding(size * 0.12)
                    .frame(width: size, height: size)
                    .background(Palette.raised, in: RoundedRectangle(cornerRadius: size * 0.26, style: .continuous))
            } else {
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(ProjectIcons.tint(for: name).gradient, in: RoundedRectangle(cornerRadius: size * 0.26, style: .continuous))
            }
        }
        .overlay(RoundedRectangle(cornerRadius: size * 0.26, style: .continuous).strokeBorder(.black.opacity(0.06), lineWidth: 0.5))
    }
}

enum ProjectIcons {
    private static var cache: [String: NSImage?] = [:]

    static let candidates = [
        "icon.png", "logo.png", "logo.svg", "favicon.png", "favicon.ico", "favicon.svg",
        "public/favicon.png", "public/favicon.ico", "public/favicon.svg", "public/icon.png", "public/logo.png", "public/apple-touch-icon.png",
        "static/favicon.png", "static/favicon.ico", "app/favicon.ico", "app/icon.png", "src/app/favicon.ico", "src/app/icon.png",
        "resources/icon.png", "build/icon.png", "assets/icon.png", "docs/icon.png", ".github/logo.png",
    ]

    static func image(for path: String) -> NSImage? {
        if let hit = cache[path] { return hit }
        var found: NSImage?
        for c in candidates {
            let url = URL(fileURLWithPath: path).appendingPathComponent(c)
            if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
               let size = attrs[.size] as? Int, size > 0, size < 2_000_000,
               let image = NSImage(contentsOf: url), image.size.width >= 16 {
                found = image
                break
            }
        }
        cache[path] = found
        return found
    }

    static let tints: [Color] = [
        Color(nsColor: NSColor(hex: 0x2F5FD0)), Color(nsColor: NSColor(hex: 0xD97757)), Color(nsColor: NSColor(hex: 0x2E8B57)),
        Color(nsColor: NSColor(hex: 0x8E44AD)), Color(nsColor: NSColor(hex: 0x1F7A8C)), Color(nsColor: NSColor(hex: 0xB58400)),
        Color(nsColor: NSColor(hex: 0x5C5751)), Color(nsColor: NSColor(hex: 0xC4352B)),
    ]

    static func tint(for name: String) -> Color {
        var h: UInt32 = 2166136261
        for b in name.utf8 { h = (h ^ UInt32(b)) &* 16777619 }
        return tints[Int(h % UInt32(tints.count))]
    }
}
