import AppKit
import Foundation
import TezgahCore

/// A conversation an agent keeps for a project's folder.
nonisolated struct ConversationInfo: Identifiable, Equatable, Sendable {
    /// The agent's own id for it: `claude --resume <id>`, `grok --resume <id>`, `codex resume <id>` return to it.
    let id: String
    let title: String
    let modified: Date
    /// Where it is kept (a file, or for Grok a folder).
    let url: URL
    var agent: AgentKind = .claude
}

/// Claude Code's conversations for a folder, newest first, read off the main thread.
nonisolated enum ConversationList {
    private struct Cached {
        let modified: Date
        let size: Int
        let summary: Conversations.Summary
    }

    nonisolated(unsafe) private static var cache: [String: Cached] = [:]
    private static let lock = NSLock()

    static func folder(for path: String) -> URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/projects")
            .appendingPathComponent(Conversations.claudeFolderName(for: path))
    }

    static func claude(for path: String, limit: Int = 60) async -> [ConversationInfo] {
        await Task.detached(priority: .utility) { () -> [ConversationInfo] in
            let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
            let files = ((try? FileManager.default.contentsOfDirectory(at: folder(for: path), includingPropertiesForKeys: keys)) ?? [])
                .filter { $0.pathExtension == "jsonl" }
                .compactMap { url -> (URL, Date, Int)? in
                    guard let v = try? url.resourceValues(forKeys: Set(keys)), let d = v.contentModificationDate else { return nil }
                    return (url, d, v.fileSize ?? 0)
                }
                .sorted { $0.1 > $1.1 }
            var out: [ConversationInfo] = []
            for (url, modified, size) in files {
                if out.count >= limit { break }
                let id = url.deletingPathExtension().lastPathComponent
                guard Conversations.validId(id), size > 0 else { continue }
                let s = summary(url, modified: modified, size: size)
                // Runs a program started (SDK, scripts) aren't conversations you'd come back to.
                guard !s.headless, let title = s.title else { continue }
                out.append(ConversationInfo(id: id, title: title, modified: modified, url: url))
            }
            return out
        }.value
    }

    static func file(_ id: String, in directory: String) -> URL {
        folder(for: directory).appendingPathComponent(id + ".jsonl")
    }

    /// A conversation that has been written down can be returned to; one that never got a message can't.
    static func exists(_ id: String, in directory: String) -> Bool {
        Conversations.validId(id) && FileManager.default.fileExists(atPath: file(id, in: directory).path)
    }

    /// The same question for whichever agent the pane runs.
    static func exists(_ id: String, in directory: String, agent: String?) -> Bool {
        guard Conversations.validId(id) else { return false }
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        switch agent {
        case "grok":
            // ~/.grok/sessions/<the folder, percent-encoded>/<id>/
            let root = home.appendingPathComponent(".grok/sessions")
            return ((try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [])
                .contains { fm.fileExists(atPath: $0.appendingPathComponent(id).path) }
        case "codex":
            // ~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl
            let files = fm.enumerator(at: home.appendingPathComponent(".codex/sessions"), includingPropertiesForKeys: nil)?.allObjects ?? []
            return files.contains { ($0 as? URL)?.lastPathComponent.contains(id) == true }
        default:
            return exists(id, in: directory)
        }
    }

    /// What a conversation is called, for the session that has it open.
    static func title(of id: String, in directory: String) async -> String? {
        await Task.detached(priority: .utility) { () -> String? in
            let url = file(id, in: directory)
            guard Conversations.validId(id),
                  let v = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
                  let modified = v.contentModificationDate else { return nil }
            return summary(url, modified: modified, size: v.fileSize ?? 0).title
        }.value
    }

    /// Every agent's conversations for a folder, newest first.
    static func all(for path: String, limit: Int = 60) async -> [ConversationInfo] {
        async let a = claude(for: path, limit: limit)
        async let b = grok(for: path, limit: limit)
        async let c = codex(for: path, limit: limit)
        return Array((await a + b + c).sorted { $0.modified > $1.modified }.prefix(limit))
    }

    /// Grok keeps each session in a folder of its own, under one named after the working directory:
    /// ~/.grok/sessions/<the path, percent-encoded>/<id>/summary.json
    static func grok(for path: String, limit: Int = 60) async -> [ConversationInfo] {
        await Task.detached(priority: .utility) { () -> [ConversationInfo] in
            let fm = FileManager.default
            var allowed = CharacterSet.alphanumerics
            allowed.insert(charactersIn: "-._~")
            guard let name = path.addingPercentEncoding(withAllowedCharacters: allowed) else { return [] }
            let group = fm.homeDirectoryForCurrentUser.appendingPathComponent(".grok/sessions").appendingPathComponent(name)
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var out: [ConversationInfo] = []
            for dir in (try? fm.contentsOfDirectory(at: group, includingPropertiesForKeys: nil)) ?? [] {
                let id = dir.lastPathComponent
                guard Conversations.validId(id),
                      let data = try? Data(contentsOf: dir.appendingPathComponent("summary.json")),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let json = Optional(json) else { continue }
                let summary = (json["session_summary"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                // One that was opened and closed without a word (it holds only Grok's own opening lines) isn't worth listing.
                if summary == nil, (json["num_chat_messages"] as? Int ?? 0) <= 2 { continue }
                let title = summary ?? "Grok"
                let stamp = (json["updated_at"] as? String).flatMap { s -> Date? in
                    // Grok writes microseconds; the formatter reads milliseconds.
                    iso.date(from: s.replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression))
                }
                let modified = stamp ?? ((try? dir.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast)
                out.append(ConversationInfo(id: id, title: title, modified: modified, url: dir, agent: .grok))
            }
            return Array(out.sorted { $0.modified > $1.modified }.prefix(limit))
        }.value
    }

    /// Codex keeps one file per session by date, with the folder it ran in on its first line:
    /// ~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl
    static func codex(for path: String, limit: Int = 60) async -> [ConversationInfo] {
        await Task.detached(priority: .utility) { () -> [ConversationInfo] in
            let fm = FileManager.default
            let root = fm.homeDirectoryForCurrentUser.appendingPathComponent(".codex/sessions")
            let files = (fm.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey])?.allObjects ?? [])
                .compactMap { $0 as? URL }
                .filter { $0.pathExtension == "jsonl" && $0.lastPathComponent.hasPrefix("rollout-") }
                .map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast) }
            var out: [ConversationInfo] = []
            // The newest few hundred: enough for any one folder, without reading years of history.
            for (url, modified) in files.sorted(by: { $0.1 > $1.1 }).prefix(400) {
                if out.count >= limit { break }
                guard let handle = try? FileHandle(forReadingFrom: url) else { continue }
                let head = (try? handle.read(upToCount: 256 * 1024)) ?? Data()
                try? handle.close()
                var id: String?, cwd: String?, first: String?
                for raw in head.split(separator: 0x0a).prefix(200) {
                    guard let line = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { continue }
                    let payload = line["payload"] as? [String: Any] ?? line
                    if id == nil, let v = payload["id"] as? String, Conversations.validId(v) { id = v }
                    if cwd == nil, let v = payload["cwd"] as? String { cwd = v }
                    if first == nil, payload["role"] as? String == "user", let parts = payload["content"] as? [[String: Any]] {
                        first = parts.lazy.compactMap { Conversations.clean($0["text"] as? String) }.first
                    }
                    if id != nil, cwd != nil, first != nil { break }
                }
                guard let id, cwd == path else { continue }
                out.append(ConversationInfo(id: id, title: first ?? "Codex", modified: modified, url: url, agent: .codex))
            }
            return out
        }.value
    }

    /// The file's name for itself, read from its first and last stretch and remembered until it changes.
    private static func summary(_ url: URL, modified: Date, size: Int) -> Conversations.Summary {
        let key = url.path
        if let c = lock.withLock({ cache[key] }), c.modified == modified, c.size == size { return c.summary }
        var chunks: [Data] = []
        if let handle = try? FileHandle(forReadingFrom: url) {
            defer { try? handle.close() }
            let head = 384 * 1024, tail = 256 * 1024
            if let d = try? handle.read(upToCount: head) { chunks.append(d) }
            if size > head + tail, (try? handle.seek(toOffset: UInt64(size - tail))) != nil, let d = try? handle.read(upToCount: tail) {
                // The first line of the tail is cut off; drop it.
                chunks.append(d.firstIndex(of: 0x0a).map { d[d.index(after: $0)...] }.map { Data($0) } ?? Data())
            } else if size > head, !chunks.isEmpty, (try? handle.seek(toOffset: UInt64(head))) != nil, let d = try? handle.readToEnd() {
                chunks[chunks.count - 1].append(d)
            }
        }
        let s = Conversations.summary(of: chunks)
        lock.withLock { cache[key] = Cached(modified: modified, size: size, summary: s) }
        return s
    }
}

extension AppStore {
    /// The conversations open in a pane right now.
    var openConversations: Set<String> {
        Set(panes.values.filter { !$0.exited }.compactMap(\.conversation))
    }

    /// Returns to a conversation: the session that has it open, else a new one in its project.
    func resume(_ conversation: ConversationInfo, in projectId: String) {
        if let pane = panes.values.first(where: { $0.conversation == conversation.id && !$0.exited }) {
            open(session: pane.sessionId, pane: pane.id)
            return
        }
        guard let command = Restore.command(saved: conversation.agent.command, conversation: conversation.id, written: true) else { return }
        lastAgent = conversation.agent
        newSession(projectId: projectId, command: command, kind: .agent, hint: conversation.title, conversation: conversation.id)
    }

    /// Sessions take the name of the conversation in them, the same one the project's board lists.
    func refreshConversationTitles() {
        // Claude Code's are the ones Tezgah can read a name from.
        let open = panes.values.filter { $0.agentToRestore == .claude }.compactMap { p in p.conversation.map { ($0, p.cwd) } }
        guard !open.isEmpty else {
            if !conversationTitles.isEmpty { conversationTitles = [:] }
            return
        }
        Task {
            var titles: [String: String] = [:]
            for (id, directory) in open {
                if let t = await ConversationList.title(of: id, in: directory) { titles[id] = t }
            }
            if titles != conversationTitles { conversationTitles = titles }
        }
    }

    /// The bell. A strip floating over the page steps aside first: the panel would open underneath it.
    func toggleNotifications() {
        if !notificationsOpen, sidebarOpen, sidebarByHover || !sidebarStaysOpen() { sidebarOpen = false }
        notificationsOpen.toggle()
    }

    /// The next agent that waits for you, after the one you're looking at (⌘J).
    func openNextWaiting() {
        let waiting = waitingSessions
        guard !waiting.isEmpty else { return NSSound.beep() }
        let here = currentSession.flatMap { c in waiting.firstIndex { $0.id == c.id } } ?? -1
        let next = waiting[(here + 1) % waiting.count]
        open(session: next.id, pane: leadPane(of: next)?.id)
    }
}
