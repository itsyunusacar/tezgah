import Foundation

/// A folder you work in. Sessions live under it.
public struct ProjectRecord: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var path: String
    public var lastOpened: Date?

    public init(id: String = UUID().uuidString, name: String, path: String, lastOpened: Date? = nil) {
        self.id = id
        self.name = name
        self.path = path
        self.lastOpened = lastOpened
    }
}

/// One terminal inside a session. Shells start fresh at launch; `command` is typed in again.
public struct PaneRecord: Codable, Equatable, Sendable {
    public var id: String
    public var cwd: String
    public var command: String?

    public init(id: String = UUID().uuidString, cwd: String, command: String? = nil) {
        self.id = id
        self.cwd = cwd
        self.command = command
    }
}

public enum SessionKind: String, Codable, Sendable {
    /// A login shell.
    case shell
    /// A shell that starts an agent (claude, codex, gemini…) with `command`.
    case agent
}

public struct SessionRecord: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    /// nil: a terminal of its own, in Terminals.
    public var projectId: String?
    public var kind: SessionKind
    public var command: String?
    public var cwd: String
    public var layout: LayoutNode
    public var panes: [PaneRecord]
    public var focusedPaneId: String?
    public var createdAt: Date
    /// A name the user gave it; nil shows the program's.
    public var title: String?

    public init(id: String = UUID().uuidString, projectId: String?, kind: SessionKind = .shell, command: String? = nil,
                cwd: String, layout: LayoutNode, panes: [PaneRecord], focusedPaneId: String? = nil, createdAt: Date = Date(),
                title: String? = nil) {
        self.title = title
        self.id = id
        self.projectId = projectId
        self.kind = kind
        self.command = command
        self.cwd = cwd
        self.layout = layout
        self.panes = panes
        self.focusedPaneId = focusedPaneId
        self.createdAt = createdAt
    }
}

public struct WorkspaceFile: Codable, Equatable, Sendable {
    public var version: Int = 1
    public var projects: [ProjectRecord] = []
    public var sessions: [SessionRecord] = []
    /// "session:<id>", "project:<id>", "terminals", … or nil for the welcome page.
    public var selection: String?
    /// Projects were imported from Tezgah 0.1 (the button is offered once).
    public var importedLegacy: Bool = false

    public init() {}

    enum CodingKeys: String, CodingKey { case version, projects, sessions, selection, importedLegacy }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        projects = (try? c.decode([ProjectRecord].self, forKey: .projects)) ?? []
        // A session that can't be read is dropped, not the whole file.
        let raw = (try? c.decode([Lenient<SessionRecord>].self, forKey: .sessions)) ?? []
        sessions = raw.compactMap(\.value).filter { s in
            // Its layout and panes must agree.
            Set(s.layout.paneIds) == Set(s.panes.map(\.id))
        }
        selection = try? c.decode(String.self, forKey: .selection)
        importedLegacy = (try? c.decode(Bool.self, forKey: .importedLegacy)) ?? false
    }
}

struct Lenient<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: any Decoder) throws {
        value = try? T(from: decoder)
    }
}

/// Tezgah 0.1's workspace.json, read only for its projects.
public enum LegacyImport {
    struct File: Decodable {
        struct Project: Decodable {
            var name: String?
            var path: String?
        }
        var projects: [Project]?
    }

    public static func projects(from data: Data) -> [(name: String, path: String)] {
        guard let file = try? JSONDecoder().decode(File.self, from: data) else { return [] }
        return (file.projects ?? []).compactMap { p in
            guard let path = p.path, !path.isEmpty else { return nil }
            let name = p.name.flatMap { $0.isEmpty ? nil : $0 } ?? URL(fileURLWithPath: path).lastPathComponent
            return (name, path)
        }
    }
}

public enum Durations {
    /// "now", "42s", "6m", "2h 5m", "3d".
    public static func short(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds))
        if s < 5 { return "now" }
        if s < 60 { return "\(s)s" }
        if s < 3600 { return "\(s / 60)m" }
        if s < 86400 {
            let m = (s % 3600) / 60
            return m == 0 ? "\(s / 3600)h" : "\(s / 3600)h \(m)m"
        }
        return "\(s / 86400)d"
    }
}

public enum Paths {
    /// /Users/me/x → ~/x
    public static func tilde(_ path: String, home: String = NSHomeDirectory()) -> String {
        if path == home { return "~" }
        if path.hasPrefix(home + "/") { return "~" + path.dropFirst(home.count) }
        return path
    }
}

/// Where agents keep their conversations for a folder, so Tezgah can list and trash them.
public enum Conversations {
    /// Claude Code: ~/.claude/projects/<path with every non-alphanumeric character as "-">.
    public static func claudeFolderName(for path: String) -> String {
        String(path.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) && $0.isASCII ? Character($0) : "-" })
    }
}
