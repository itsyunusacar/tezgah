import AppKit
import CoreGraphics
import Foundation
import Observation
import UserNotifications

/// The permissions Tezgah asks for, read live so the first-run page can tick them off by itself.
@Observable
final class Permissions {
    enum State: Equatable { case unknown, granted, denied }

    var notifications: State = .unknown
    var finderAction: State = .unknown

    @ObservationIgnored private var timer: Timer?

    func startWatching() {
        refresh()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
    }

    func stopWatching() {
        timer?.invalidate()
        timer = nil
    }

    func refresh() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let s: State = switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: .granted
            case .denied: .denied
            default: .unknown
            }
            DispatchQueue.main.async { if self.notifications != s { self.notifications = s } }
        }
        let finder: State = FinderService.isInstalled ? .granted : .unknown
        if finderAction != finder { finderAction = finder }
    }

    func requestNotifications() {
        // macOS asks only once: after a "no", the switch is in System Settings.
        if notifications == .denied {
            SystemSettings.open(.notifications)
            return
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            DispatchQueue.main.async { self.refresh() }
        }
    }

    func installFinderAction() {
        UserDefaults.standard.set(true, forKey: "finder.enabled")
        FinderService.install()
        refresh()
    }
}

enum SystemSettings {
    enum Pane: String {
        case notifications = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        case accessibility = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    }

    static func open(_ pane: Pane) {
        if let url = URL(string: pane.rawValue) { NSWorkspace.shared.open(url) }
    }
}

/// Finds the agents on this Mac through the user's login shell, the way a terminal would.
enum AgentDetector {
    struct Found: Identifiable, Equatable {
        let kind: AgentKind
        let path: String
        let version: String?
        var id: String { kind.rawValue }
    }

    static func detect() async -> [Found] {
        let kinds = AgentKind.allCases.map { ($0, $0.command) }
        let shell = Shell.current
        let own = AgentHooks.binDirectory?.path
        let lines: [(String, String, String?)] = await Task.detached(priority: .utility) { () -> [(String, String, String?)] in
            let folders = searchPath(shell: shell)
            var found: [(String, String, String?)] = []
            for (_, command) in kinds {
                // The first real install on the PATH; Tezgah's own shims and ones inside app bundles don't count.
                guard let path = folders.lazy
                    .filter({ $0 != own && !$0.contains(".app/Contents/") })
                    .map({ $0 + "/" + command })
                    .first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { continue }
                // `--version` only prints; it never starts a session or calls an API.
                found.append((command, path, run(path, ["--version"], timeout: 4).flatMap(version(from:))))
            }
            return found
        }.value
        return lines.compactMap { cmd, path, version in
            kinds.first { $0.1 == cmd }.map { Found(kind: $0.0, path: path, version: version) }
        }
    }

    /// The folders a terminal would look in. Installers add theirs in the shell's rc file (`.zshrc`), which
    /// only an interactive shell reads, so that is asked first; a login shell is the fallback, and the usual
    /// places come last in case the shell says nothing (an rc file that waits for input, an unusual shell).
    nonisolated static func searchPath(shell: String) -> [String] {
        let marker = "__TEZGAH_PATH__"
        let script = "printf '%s%s%s\\n' '\(marker)' \"$PATH\" '\(marker)'"
        var folders: [String] = []
        for flags in [["-l", "-i", "-c"], ["-l", "-c"]] {
            guard let out = run(shell, flags + [script], timeout: 8),
                  let start = out.range(of: marker),
                  let end = out.range(of: marker, range: start.upperBound ..< out.endIndex) else { continue }
            folders = out[start.upperBound ..< end.lowerBound].split(separator: ":").map(String.init)
            if !folders.isEmpty { break }
        }
        let home = NSHomeDirectory()
        folders += ["\(home)/.local/bin", "\(home)/.grok/bin", "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.npm-global/bin",
                    "\(home)/.bun/bin", "\(home)/.cargo/bin", "\(home)/bin", "/usr/bin", "/bin"]
        var seen = Set<String>()
        return folders.filter { $0.hasPrefix("/") && seen.insert($0).inserted }
    }

    nonisolated static func version(from text: String) -> String? {
        let pattern = /(\d+\.\d+(?:\.\d+)?)/
        return text.firstMatch(of: pattern).map { String($0.1) }
    }

    nonisolated static func run(_ path: String, _ args: [String], timeout: Double) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let out = Pipe()
        p.standardOutput = out
        p.standardError = out
        p.standardInput = FileHandle.nullDevice
        // Read as it comes: a chatty rc file fills the pipe and the shell would wait on us forever.
        let lock = NSLock()
        nonisolated(unsafe) var data = Data()
        out.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if !chunk.isEmpty { lock.withLock { data.append(chunk) } }
        }
        defer { out.fileHandleForReading.readabilityHandler = nil }
        do { try p.run() } catch { return nil }
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning, Date() < deadline { usleep(20000) }
        if p.isRunning {
            // An interactive shell shrugs off SIGTERM.
            p.terminate()
            usleep(100_000)
            if p.isRunning { kill(p.processIdentifier, SIGKILL) }
            return nil
        }
        usleep(20000)
        let rest = (try? out.fileHandleForReading.readToEnd()) ?? nil
        return lock.withLock { String(decoding: data + (rest ?? Data()), as: UTF8.self) }
    }
}
