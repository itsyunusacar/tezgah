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

/// One terminal inside a session. Shells start fresh at launch. `command` is the agent that was
/// running in it ("claude"), started again at launch; `conversation` is the conversation it returns to.
public struct PaneRecord: Codable, Equatable, Sendable {
    public var id: String
    public var cwd: String
    public var command: String?
    public var conversation: String?

    public init(id: String = UUID().uuidString, cwd: String, command: String? = nil, conversation: String? = nil) {
        self.id = id
        self.cwd = cwd
        self.command = command
        self.conversation = conversation
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
    /// The first message it was started with, shown as its name until the agent names its work.
    public var hint: String?

    public init(id: String = UUID().uuidString, projectId: String?, kind: SessionKind = .shell, command: String? = nil,
                cwd: String, layout: LayoutNode, panes: [PaneRecord], focusedPaneId: String? = nil, createdAt: Date = Date(),
                title: String? = nil, hint: String? = nil) {
        self.title = title
        self.hint = hint
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
    /// "session:<id>", "project:<id>" or nil for home. Kept for reference: the app opens on home.
    public var selection: String?
    /// Projects were imported from Tezgah 0.1 (the button is offered once).
    public var importedLegacy: Bool = false

    public init() {}

    enum CodingKeys: String, CodingKey { case version, projects, sessions, selection, importedLegacy }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        // A project that can't be read is dropped, not all of them.
        projects = ((try? c.decode([Lenient<ProjectRecord>].self, forKey: .projects)) ?? []).compactMap(\.value)
        // A session that can't be read is dropped, not the whole file.
        let raw = (try? c.decode([Lenient<SessionRecord>].self, forKey: .sessions)) ?? []
        sessions = raw.compactMap(\.value).map { s in
            // Its layout decides which panes it has: one the file forgot starts in the session's folder,
            // one the layout doesn't show is let go. The session itself is kept.
            var s = s
            let known = Dictionary(s.panes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            s.panes = s.layout.paneIds.map { known[$0] ?? PaneRecord(id: $0, cwd: s.cwd) }
            return s
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

/// Where agents keep their conversations for a folder, so Tezgah can list, resume and trash them.
public enum Conversations {
    /// Claude Code: ~/.claude/projects/<path with every non-alphanumeric character as "-">.
    public static func claudeFolderName(for path: String) -> String {
        String(path.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) && $0.isASCII ? Character($0) : "-" })
    }

    /// A conversation id is safe to put on a command line: letters, digits and dashes.
    public static func validId(_ id: String) -> Bool {
        (8...64).contains(id.utf8.count) && id.utf8.allSatisfy { b in
            (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b == 0x2d
        }
    }

    public struct Summary: Equatable, Sendable {
        /// The name you gave it, else the one Claude gave it, else how it began.
        public var title: String?
        /// Started by a program (SDK, `-p`), not by you in a terminal.
        public var headless: Bool
    }

    /// Reads a conversation's name from its .jsonl lines (the start of the file, and its end when it is long).
    public static func summary(of chunks: [Data]) -> Summary {
        var custom: String?, ai: String?, first: String?, last: String?
        var headless = false
        for chunk in chunks {
            for raw in chunk.split(separator: 0x0a) {
                // Only lines that can name it are decoded; the rest (tool output, API records) can be huge.
                guard let line = String(data: raw, encoding: .utf8) else { continue }
                let naming = line.contains("\"custom-title\"") || line.contains("\"ai-title\"") || line.contains("\"last-prompt\"")
                guard naming || (first == nil && line.contains("\"type\":\"user\"")),
                      let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { continue }
                switch object["type"] as? String {
                case "custom-title": custom = clean(object["customTitle"] as? String) ?? custom
                case "ai-title": ai = clean(object["aiTitle"] as? String) ?? ai
                case "last-prompt": last = clean(object["lastPrompt"] as? String) ?? last
                case "user":
                    if (object["entrypoint"] as? String)?.hasPrefix("sdk") == true { headless = true }
                    guard first == nil, object["isMeta"] as? Bool != true, object["isSidechain"] as? Bool != true,
                          let message = object["message"] as? [String: Any] else { continue }
                    if let text = message["content"] as? String {
                        first = clean(text)
                    } else if let parts = message["content"] as? [[String: Any]] {
                        first = parts.lazy.compactMap { $0["type"] as? String == "text" ? clean($0["text"] as? String) : nil }.first
                    }
                default: break
                }
            }
        }
        return Summary(title: custom ?? ai ?? first ?? last, headless: headless)
    }

    /// One line of plain text; text that is the harness talking (<command-name>…, reminders) is no title.
    public static func clean(_ text: String?) -> String? {
        guard let text else { return nil }
        let line = text.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !line.isEmpty, !line.hasPrefix("<"), !line.hasPrefix("Caveat:") else { return nil }
        return line.count > 120 ? String(line.prefix(120)) + "…" : line
    }
}

/// What a pane starts again with at launch.
public enum Restore {
    /// The commands that start an agent.
    public static let agents: Set<String> = ["claude", "codex", "agy", "grok"]

    /// Only an agent comes back, never the message or the one-off command it was first started with.
    /// Claude Code and Grok return to their conversation by id; one where nothing was said yet (`written`
    /// false: there is nothing on disk to resume) starts under the same id instead. Codex names its own
    /// sessions, so it resumes one Tezgah was told about and otherwise starts fresh. The rest start fresh.
    /// `own`: agents the user added (their first word); they come back with the command they were given.
    public static func command(saved: String?, conversation: String?, written: Bool = true, own: Set<String> = []) -> String? {
        guard let saved, let word = saved.split(separator: " ").first.map(String.init) else { return nil }
        if own.contains(word), !agents.contains(word) { return saved }
        guard agents.contains(word) else { return nil }
        guard let conversation, Conversations.validId(conversation) else { return word }
        switch word {
        case "claude", "grok": return "\(word) \(written ? "--resume" : "--session-id") \(conversation)"
        case "codex": return written ? "codex resume \(conversation)" : word
        default: return word
        }
    }

    /// The agents Tezgah can start under an id of its own choosing, so it knows which conversation to return to.
    public static let namesItsConversation: Set<String> = ["claude", "grok"]

    /// How Tezgah starts such an agent: `claude --session-id <id> '<first message>'`.
    public static func start(_ agent: String, conversation: String, message: String?) -> String {
        "\(agent) --session-id \(conversation)" + (message.map { " " + $0 } ?? "")
    }

    /// How Tezgah starts Claude Code.
    public static func claude(conversation: String, message: String?) -> String {
        start("claude", conversation: conversation, message: message)
    }

    /// "✳ Fix the login bug" → "Fix the login bug": a terminal title an agent set, without its ornaments.
    public static func topic(fromTitle title: String) -> String? {
        let whole = title.trimmingCharacters(in: .whitespaces)
        // A shell's own title is a folder or user@host, not a topic.
        guard !whole.hasPrefix("~"), !whole.hasPrefix("/") else { return nil }
        let t = String(whole.drop { !$0.isLetter && !$0.isNumber }).trimmingCharacters(in: .whitespaces)
        guard t.count >= 3, t.count <= 80, !t.contains("@"), t.contains(" ") || !t.contains("/") else { return nil }
        let plain = t.lowercased()
        if agents.contains(plain) || ["claude code", "codex", "grok", "antigravity", "gemini"].contains(plain) { return nil }
        return t
    }
}
