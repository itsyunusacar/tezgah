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

    /// Puts `newId` beside `paneId` (after it). Joins the parent split when it runs the same
    /// way, taking half of the pane's share; otherwise the pane becomes a two-way split.
    public func splitting(_ paneId: String, axis: SplitAxis, newId: String) -> LayoutNode {
        switch self {
        case let .pane(id):
            guard id == paneId else { return self }
            return .split(axis, [.pane(id), .pane(newId)], [0.5, 0.5])
        case let .split(dir, children, sizes):
            if dir == axis, let i = children.firstIndex(of: .pane(paneId)) {
                var c = children, s = sizes
                let half = s[i] / 2
                s[i] = half
                c.insert(.pane(newId), at: i + 1)
                s.insert(half, at: i + 1)
                return .split(dir, c, s)
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

    /// Fixes sizes that don't match their children or don't add up (a hand-edited file).
    public var repaired: LayoutNode {
        switch self {
        case .pane: return self
        case let .split(dir, children, sizes):
            let c = children.map(\.repaired)
            if c.count == 1 { return c[0] }
            let s = sizes.count == c.count && sizes.allSatisfy({ $0 > 0 && $0.isFinite })
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
