import Foundation

/// A project's git state for its board, read off the main thread.
struct GitSummary: Equatable, Sendable {
    var branch: String?
    var changedFiles: Int
    var added: Int
    var removed: Int
    var files: [FileChange]

    struct FileChange: Equatable, Sendable, Hashable {
        var path: String
        var added: Int?
        var removed: Int?
        var status: String
    }
}

enum Git {
    static func summary(at path: String) async -> GitSummary? {
        await Task.detached(priority: .utility) { () -> GitSummary? in
            guard run(["rev-parse", "--is-inside-work-tree"], in: path)?.trimmingCharacters(in: .whitespacesAndNewlines) == "true" else {
                return nil
            }
            let branch = run(["rev-parse", "--abbrev-ref", "HEAD"], in: path)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let status = run(["status", "--porcelain=v1", "--untracked-files=normal"], in: path) ?? ""
            var files: [GitSummary.FileChange] = []
            for line in status.split(separator: "\n") where line.count > 3 {
                let code = String(line.prefix(2)).trimmingCharacters(in: .whitespaces)
                var p = String(line.dropFirst(3))
                if let arrow = p.range(of: " -> ") { p = String(p[arrow.upperBound...]) }
                files.append(.init(path: p, added: nil, removed: nil, status: code))
            }
            var added = 0, removed = 0
            // Staged and unstaged together, against HEAD (a repository without commits has none).
            let numstat = run(["diff", "--numstat", "HEAD"], in: path) ?? run(["diff", "--numstat"], in: path) ?? ""
            for line in numstat.split(separator: "\n") {
                let parts = line.split(separator: "\t", maxSplits: 2)
                guard parts.count == 3 else { continue }
                let a = Int(parts[0]), r = Int(parts[1])
                added += a ?? 0
                removed += r ?? 0
                var name = String(parts[2])
                if let arrow = name.range(of: " => ") { name = String(name[arrow.upperBound...]).replacingOccurrences(of: "}", with: "") }
                if let i = files.firstIndex(where: { $0.path == name }) {
                    files[i].added = a
                    files[i].removed = r
                }
            }
            return GitSummary(branch: branch == "HEAD" ? "detached" : branch, changedFiles: files.count, added: added, removed: removed, files: files)
        }.value
    }

    /// The branch only, cheap enough for headers.
    static func branch(at path: String) async -> String? {
        await Task.detached(priority: .utility) {
            run(["rev-parse", "--abbrev-ref", "HEAD"], in: path)?.trimmingCharacters(in: .whitespacesAndNewlines)
        }.value
    }

    nonisolated static func run(_ args: [String], in dir: String) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        p.arguments = ["-C", dir, "--no-optional-locks"] + args
        var env = ProcessInfo.processInfo.environment
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["LC_ALL"] = "C"
        p.environment = env
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}
