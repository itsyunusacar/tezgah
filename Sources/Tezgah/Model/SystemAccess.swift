import AppKit
import CoreGraphics
import Foundation
import Observation
import UserNotifications

/// The permissions Tezgah asks for, read live so the first-run page can tick them off by itself.
@Observable
final class Permissions {
    enum State: Equatable { case unknown, granted, denied, needsRelaunch }

    var notifications: State = .unknown
    var screenRecording: State = .unknown
    var finderAction: State = .unknown

    @ObservationIgnored private var timer: Timer?
    /// Set once the user has dragged the icon or opened the settings page for screen recording.
    @ObservationIgnored var screenRecordingRequested = false

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
        // macOS only applies a new screen recording grant after the app restarts; until then the
        // check still says no, so once the user has acted we offer to reopen.
        let screen: State = CGPreflightScreenCaptureAccess() ? .granted : (screenRecordingRequested ? .needsRelaunch : .unknown)
        if screenRecording != screen { screenRecording = screen }
        let finder: State = FinderService.isInstalled ? .granted : .unknown
        if finderAction != finder { finderAction = finder }
    }

    func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            DispatchQueue.main.async { self.refresh() }
        }
    }

    /// Opens System Settings on the screen recording list and moves Tezgah aside to make room.
    func openScreenRecordingSettings() {
        screenRecordingRequested = true
        _ = CGRequestScreenCaptureAccess()
        SystemSettings.open(.screenRecording)
    }

    func installFinderAction() {
        FinderService.install()
        refresh()
    }
}

enum SystemSettings {
    enum Pane: String {
        case screenRecording = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        case notifications = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        case accessibility = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    }

    static func open(_ pane: Pane) {
        if let url = URL(string: pane.rawValue) { NSWorkspace.shared.open(url) }
    }
}

/// Reopens Tezgah (after a screen recording grant). The first-run page remembers where it was.
enum Relauncher {
    static func relaunch() {
        let path = Bundle.main.bundlePath
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "sleep 0.6; /usr/bin/open \"$0\"", path]
        try? task.run()
        NSApp.terminate(nil)
    }
}

/// "Open in Tezgah" on folders in Finder: a service in ~/Library/Services. Development builds only
/// pretend, so they never touch the user's real Services.
enum FinderService {
    static var isRealBuild: Bool { Bundle.main.bundleIdentifier?.hasSuffix(".dev") == false }
    private static let devFlag = "finder.devInstalled"

    static var serviceURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Services/Open in Tezgah.workflow")
    }

    static var isInstalled: Bool {
        isRealBuild ? FileManager.default.fileExists(atPath: serviceURL.path) : UserDefaults.standard.bool(forKey: devFlag)
    }

    static func install() {
        guard isRealBuild else {
            UserDefaults.standard.set(true, forKey: devFlag)
            return
        }
        // The real service is written in 0.1's Finder step (ported from the Electron app's finder.ts).
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
        let lines: [(String, String, String?)] = await Task.detached(priority: .utility) { () -> [(String, String, String?)] in
            let commands = kinds.map(\.1).joined(separator: " ")
            // The first real install on PATH; shims inside app bundles (Tezgah's own bin folder) don't count.
            let script = "for c in \(commands); do for p in $(which -a $c 2>/dev/null); do case $p in *.app/Contents/*) ;; /*) echo \"$c=$p\"; break;; esac; done; done"
            guard let out = run(shell, ["-l", "-c", script], timeout: 6) else { return [] }
            var found: [(String, String, String?)] = []
            for line in out.split(separator: "\n") {
                let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
                guard parts.count == 2, parts[1].hasPrefix("/") else { continue }
                // `--version` only prints; it never starts a session or calls an API.
                let raw = run(parts[1], ["--version"], timeout: 4)
                found.append((parts[0], parts[1], raw.flatMap(version(from:))))
            }
            return found
        }.value
        return lines.compactMap { cmd, path, version in
            kinds.first { $0.1 == cmd }.map { Found(kind: $0.0, path: path, version: version) }
        }
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
        do { try p.run() } catch { return nil }
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning, Date() < deadline { usleep(20000) }
        if p.isRunning { p.terminate(); return nil }
        return String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    }
}
