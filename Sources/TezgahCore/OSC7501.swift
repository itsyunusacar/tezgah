import Foundation

// OSC 7501: programs such as Claude Code report what they are doing.
//   ESC ] 7501 ; state=working:id=agent-1:app=claude:title=<b64>:msg=<b64> BEL
// `?` asks whether the terminal understands it; the terminal answers `ESC ] 7501 ; ? BEL`
// so the program starts reporting. `state=clear` removes a record (an empty id clears all).
// A port of the Electron app's src/renderer/src/osc.ts, same limits and rules.

public enum AgentState: String, Codable, Sendable, CaseIterable {
    case idle, working, done, blocked, error
}

public enum BlockKind: String, Codable, Sendable {
    case permission, question, auth
}

public struct StatusRecord: Equatable, Sendable, Codable {
    /// "" is the session itself; other ids are its subagents ("a/b").
    public var id: String
    public var state: AgentState
    public var kind: BlockKind?
    public var app: String?
    public var title: String?
    public var message: String?

    public init(id: String = "", state: AgentState, kind: BlockKind? = nil, app: String? = nil, title: String? = nil, message: String? = nil) {
        self.id = id
        self.state = state
        self.kind = kind
        self.app = app
        self.title = title
        self.message = message
    }
}

public enum OSCReport: Equatable, Sendable {
    case clear(id: String)
    case record(StatusRecord)
}

public enum OSC7501 {
    /// The terminal's answer to a `?` probe.
    public static let probeReply: [UInt8] = Array("\u{1b}]7501;?\u{07}".utf8)
    public static let maxPayload = 4087
    public static let maxRecords = 256

    public static func parse(_ data: String) -> OSCReport? {
        if data.utf16.count > maxPayload { return nil }
        var fields: [String: String] = [:]
        for pair in data.split(separator: ":", omittingEmptySubsequences: false) {
            guard let eq = pair.firstIndex(of: "=") else { continue }
            let key = pair[..<eq].trimmingCharacters(in: .whitespaces)
            let value = pair[pair.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            guard isKey(key) else { continue }
            if key == "id", !validId(value) { return nil }
            fields[key] = value
        }
        let id = fields["id"] ?? ""
        if fields["state"] == "clear" { return .clear(id: id) }
        guard let raw = fields["state"], let state = AgentState(rawValue: raw) else { return nil }
        let kind = state == .blocked ? fields["kind"].flatMap(BlockKind.init(rawValue:)) : nil
        var app: String?
        if let a = fields["app"], isToken(a, max: 32) { app = a }
        return .record(StatusRecord(
            id: id,
            state: state,
            kind: kind,
            app: app,
            title: fields["title"].flatMap { $0.isEmpty ? nil : decode($0, limit: 192) },
            message: fields["msg"].flatMap { $0.isEmpty ? nil : decode($0, limit: 2048) }
        ))
    }

    /// Applies a report to a pane's records. Clearing an id also clears its descendants.
    public static func apply(_ records: [StatusRecord], _ report: OSCReport) -> [StatusRecord] {
        switch report {
        case let .clear(id):
            if id.isEmpty { return [] }
            return records.filter { $0.id != id && !$0.id.hasPrefix(id + "/") }
        case let .record(record):
            var next = records.filter { $0.id != record.id }
            next.append(record)
            return Array(next.suffix(maxRecords))
        }
    }

    /// Applies a report that came from a pane's output. Any program's output can carry one,
    /// so clearing everything keeps what is waiting for you (a permission prompt goes when
    /// you answer it or the pane exits).
    public static func applyOutput(_ records: [StatusRecord], _ report: OSCReport) -> [StatusRecord] {
        if case let .clear(id) = report, id.isEmpty {
            return records.filter { $0.state == .blocked }
        }
        return apply(records, report)
    }

    // MARK: - Helpers

    static func isKey(_ s: String) -> Bool {
        (1...16).contains(s.utf8.count) && s.utf8.allSatisfy { $0 >= 0x61 && $0 <= 0x7a }
    }

    /// `^[A-Za-z0-9_.+-]{1,max}$`
    static func isToken(_ s: Substring, max: Int) -> Bool {
        (1...max).contains(s.utf8.count) && s.utf8.allSatisfy { b in
            (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)
                || b == 0x5f || b == 0x2e || b == 0x2b || b == 0x2d
        }
    }

    static func isToken(_ s: String, max: Int) -> Bool { isToken(Substring(s), max: max) }

    static func validId(_ id: String) -> Bool {
        let parts = id.split(separator: "/", omittingEmptySubsequences: false)
        return id.utf16.count <= 128 && parts.count <= 8 && parts.allSatisfy { isToken($0, max: 32) }
    }

    /// Base64 → strict UTF-8 → plain text (control characters and bidi overrides become spaces).
    static func decode(_ b64: String, limit: Int) -> String? {
        var s = b64
        // atob accepts missing padding; Foundation does not.
        switch s.utf8.count % 4 {
        case 1: return nil
        case 2: s += "=="
        case 3: s += "="
        default: break
        }
        guard let data = Data(base64Encoded: s),
              let text = String(data: data, encoding: .utf8) else { return nil }
        var out = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            out.append(isUnsafe(scalar) ? " " : scalar)
        }
        // JS slices UTF-16 code units; keep whole characters within that budget.
        var result = ""
        var used = 0
        for ch in String(out) {
            let n = ch.utf16.count
            if used + n > limit { break }
            result.append(ch)
            used += n
        }
        return result
    }

    static func isUnsafe(_ s: Unicode.Scalar) -> Bool {
        let v = s.value
        return v <= 0x1f || (v >= 0x7f && v <= 0x9f) || v == 0x200e || v == 0x200f
            || (v >= 0x202a && v <= 0x202e) || (v >= 0x2066 && v <= 0x2069)
    }
}

public extension Array where Element == StatusRecord {
    /// The one state that speaks for a pane: what needs you first, then work, then results.
    var summary: AgentState? {
        if isEmpty { return nil }
        if contains(where: { $0.state == .blocked || $0.state == .error }) { return .blocked }
        if contains(where: { $0.state == .working }) { return .working }
        if contains(where: { $0.state == .done }) { return .done }
        return .idle
    }

    /// The session's own record ("" id) or the most recent one.
    var primary: StatusRecord? {
        first(where: { $0.id.isEmpty }) ?? last
    }
}
