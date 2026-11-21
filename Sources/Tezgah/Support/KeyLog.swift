import AppKit
import Foundation

/// A short trace of where key presses get to (the app's key monitor, the terminal, the pty), kept in
/// memory so that "typing doesn't arrive" can be looked into after the fact: Help › Copy Keyboard
/// Diagnostics. Never what was typed: only modifier flags, byte counts, and which window and view had
/// the keyboard. `--keylog` also writes it to keys.log beside workspace.json.
nonisolated enum KeyLog {
    static let toFile = ProcessInfo.processInfo.arguments.contains("--keylog")
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handle: FileHandle?
    nonisolated(unsafe) private static var recent: [String] = []
    static let url = Persistence.defaultDirectory.appendingPathComponent("keys.log")

    static func note(_ line: @autoclosure () -> String) {
        let stamp = Date().formatted(.dateTime.hour().minute().second().secondFraction(.fractional(2)))
        let text = stamp + " " + line()
        lock.withLock {
            recent.append(text)
            if recent.count > 300 { recent.removeFirst(recent.count - 300) }
            guard toFile else { return }
            if handle == nil {
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                FileManager.default.createFile(atPath: url.path, contents: nil)
                handle = try? FileHandle(forWritingTo: url)
            }
            handle?.write(Data((text + "\n").utf8))
        }
    }

    /// The last few hundred notes, oldest first.
    static var report: String { lock.withLock { recent.joined(separator: "\n") } }
}
