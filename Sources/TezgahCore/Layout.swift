import Foundation

public enum SplitAxis: String, Codable, Sendable {
    /// Side by side (split right).
    case row
    /// Stacked (split down).
    case column
}

/// Panes split side by side or stacked, nested. Sizes are fractions that add up to 1.
public indirect enum LayoutNode: Equatable, Sendable {
    case pane(String)
    case split(SplitAxis, [LayoutNode], [Double])

    public static let minimumFraction = 0.08

    /// What stays the same about a node while its neighbours come and go: a pane's id, or a split's panes.
    public var key: String {
        switch self {
        case let .pane(id): id
        case let .split(dir, children, _): dir.rawValue + ":" + children.map(\.key).joined(separator: ",")
        }
    }

    public var paneIds: [String] {
        switch self {
        case let .pane(id): [id]
        case let .split(_, children, _): children.flatMap(\.paneIds)
        }
    }

    public func contains(_ paneId: String) -> Bool {
        switch self {
        case let .pane(id): id == paneId
        case let .split(_, children, _): children.contains { $0.contains(paneId) }
        }
    }

    /// Puts `newId` beside `paneId` (after it). Joins the parent split when it runs the same way and
    /// takes an equal share there (the others give up a little each, so the fifth pane in a row is not
    /// a sliver); otherwise the pane becomes a two-way split.
    public func splitting(_ paneId: String, axis: SplitAxis, newId: String) -> LayoutNode {
        switch self {
        case let .pane(id):
            guard id == paneId else { return self }
            return .split(axis, [.pane(id), .pane(newId)], [0.5, 0.5])
        case let .split(dir, children, sizes):
            if dir == axis, let i = children.firstIndex(of: .pane(paneId)) {
                var c = children
                let n = Double(children.count)
                var s = sizes.map { $0 * n / (n + 1) }
                c.insert(.pane(newId), at: i + 1)
                s.insert(1 / (n + 1), at: i + 1)
                return .split(dir, c, Self.normalized(s))
            }
            return .split(dir, children.map { $0.splitting(paneId, axis: axis, newId: newId) }, sizes)
        }
    }

    /// The layout without `paneId`, or nil when nothing is left. Its share goes to its siblings
    /// and a split left with one child gives way to that child.
    public func removing(_ paneId: String) -> LayoutNode? {
        switch self {
        case let .pane(id):
            return id == paneId ? nil : self
        case let .split(dir, children, sizes):
            var c: [LayoutNode] = []
            var s: [Double] = []
            for (child, size) in zip(children, sizes) {
                if let kept = child.removing(paneId) {
                    c.append(kept)
                    s.append(size)
                }
            }
            if c.isEmpty { return nil }
            if c.count == 1 { return c[0] }
            return .split(dir, c, Self.normalized(s))
        }
    }

    /// The pane to focus after `paneId` closes: its next sibling's first pane, else the previous.
    public func neighbor(of paneId: String) -> String? {
        let ids = paneIds
        guard let i = ids.firstIndex(of: paneId), ids.count > 1 else { return nil }
        return i + 1 < ids.count ? ids[i + 1] : ids[i - 1]
    }

    /// Sets the sizes of the split at `path` (child indexes from the root).
    public func resizing(at path: [Int], sizes newSizes: [Double]) -> LayoutNode {
        guard case let .split(dir, children, sizes) = self else { return self }
        if path.isEmpty {
            guard newSizes.count == sizes.count else { return self }
            let clamped = newSizes.map { max(Self.minimumFraction, $0) }
            return .split(dir, children, Self.normalized(clamped))
        }
        var c = children
        let i = path[0]
        guard c.indices.contains(i) else { return self }
        c[i] = c[i].resizing(at: Array(path.dropFirst()), sizes: newSizes)
        return .split(dir, c, sizes)
    }

    /// Panes in even rows of `columns`, in order: what a crowded session is tidied into.
    public static func grid(_ ids: [String], columns: Int) -> LayoutNode {
        guard let first = ids.first else { return .pane("") }
        guard ids.count > 1 else { return .pane(first) }
        let per = max(1, columns)
        let rows: [LayoutNode] = stride(from: 0, to: ids.count, by: per).map { start in
            let row = Array(ids[start ..< min(start + per, ids.count)])
            return row.count == 1 ? .pane(row[0]) : .split(.row, row.map(LayoutNode.pane), row.map { _ in 1 / Double(row.count) })
        }
        return rows.count == 1 ? rows[0] : .split(.column, rows, rows.map { _ in 1 / Double(rows.count) })
    }

    /// The smallest pane's share of the session's width and of its height.
    public var smallestShare: (width: Double, height: Double) {
        func walk(_ node: LayoutNode, _ w: Double, _ h: Double) -> (Double, Double) {
            guard case let .split(dir, children, sizes) = node else { return (w, h) }
            var out = (w, h)
            for (child, size) in zip(children, sizes) {
                let r = dir == .row ? walk(child, w * size, h) : walk(child, w, h * size)
                out = (min(out.0, r.0), min(out.1, r.1))
            }
            return out
        }
        let r = walk(self, 1, 1)
        return (r.0, r.1)
    }

    /// Fixes sizes that don't match their children, don't add up (a hand-edited file) or leave a
    /// pane a sliver (below what dragging a divider allows).
    public var repaired: LayoutNode {
        switch self {
        case .pane: return self
        case let .split(dir, children, sizes):
            let c = children.map(\.repaired)
            if c.count == 1 { return c[0] }
            let s = sizes.count == c.count && sizes.allSatisfy({ $0 >= Self.minimumFraction * 0.99 && $0.isFinite })
                ? Self.normalized(sizes) : Array(repeating: 1.0 / Double(c.count), count: c.count)
            return .split(dir, c, s)
        }
    }

    static func normalized(_ sizes: [Double]) -> [Double] {
        let total = sizes.reduce(0, +)
        guard total > 0 else { return sizes.map { _ in 1.0 / Double(max(1, sizes.count)) } }
        return sizes.map { $0 / total }
    }
}

// Saved like the Electron app's Layout: {type: "pane", paneId} | {type: "split", dir, children, sizes}.
extension LayoutNode: Codable {
    enum CodingKeys: String, CodingKey { case type, paneId, dir, children, sizes }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "pane":
            self = .pane(try c.decode(String.self, forKey: .paneId))
        case "split":
            let children = try c.decode([LayoutNode].self, forKey: .children)
            let sizes = (try? c.decode([Double].self, forKey: .sizes)) ?? []
            self = LayoutNode.split(try c.decode(SplitAxis.self, forKey: .dir), children, sizes).repaired
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown layout \(other)")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .pane(id):
            try c.encode("pane", forKey: .type)
            try c.encode(id, forKey: .paneId)
        case let .split(dir, children, sizes):
            try c.encode("split", forKey: .type)
            try c.encode(dir, forKey: .dir)
            try c.encode(children, forKey: .children)
            try c.encode(sizes, forKey: .sizes)
        }
    }
}
