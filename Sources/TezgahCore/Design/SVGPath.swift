import Foundation

/// Reads SVG path data (the `d` attribute) into absolute moves, lines, cubic curves and closes, so
/// logos can be drawn natively at any size. Quadratic curves and arcs become cubics.
public enum SVGPath {
    public enum Segment: Equatable, Sendable {
        case move(Double, Double)
        case line(Double, Double)
        case cubic(c1x: Double, c1y: Double, c2x: Double, c2y: Double, x: Double, y: Double)
        case close
    }

    public static func parse(_ d: String) -> [Segment] {
        var tokens = Tokenizer(d)
        var out: [Segment] = []
        var cx = 0.0, cy = 0.0, sx = 0.0, sy = 0.0
        var lastCubic: (Double, Double)?, lastQuad: (Double, Double)?
        var cmd: Character = " "

        while let next = tokens.peekCommand() ?? (cmd == " " ? nil : cmd) {
            if tokens.peekCommand() != nil { cmd = tokens.nextCommand()! } else { cmd = next }
            let rel = cmd.isLowercase
            func p() -> Double? { tokens.number() }
            func pt() -> (Double, Double)? {
                guard let x = p(), let y = p() else { return nil }
                return rel ? (cx + x, cy + y) : (x, y)
            }
            var progressed = false
            switch cmd.lowercased().first! {
            case "m":
                guard let (x, y) = pt() else { break }
                out.append(.move(x, y)); (cx, cy, sx, sy) = (x, y, x, y); progressed = true
                cmd = rel ? "l" : "L"
                lastCubic = nil; lastQuad = nil
            case "l":
                guard let (x, y) = pt() else { break }
                out.append(.line(x, y)); (cx, cy) = (x, y); progressed = true
                lastCubic = nil; lastQuad = nil
            case "h":
                guard let v = p() else { break }
                cx = rel ? cx + v : v; out.append(.line(cx, cy)); progressed = true
                lastCubic = nil; lastQuad = nil
            case "v":
                guard let v = p() else { break }
                cy = rel ? cy + v : v; out.append(.line(cx, cy)); progressed = true
                lastCubic = nil; lastQuad = nil
            case "c":
                guard let a = pt(), let b = pt(), let e = pt() else { break }
                out.append(.cubic(c1x: a.0, c1y: a.1, c2x: b.0, c2y: b.1, x: e.0, y: e.1))
                lastCubic = b; lastQuad = nil; (cx, cy) = e; progressed = true
            case "s":
                guard let b = pt(), let e = pt() else { break }
                let a = lastCubic.map { (2 * cx - $0.0, 2 * cy - $0.1) } ?? (cx, cy)
                out.append(.cubic(c1x: a.0, c1y: a.1, c2x: b.0, c2y: b.1, x: e.0, y: e.1))
                lastCubic = b; lastQuad = nil; (cx, cy) = e; progressed = true
            case "q":
                guard let q = pt(), let e = pt() else { break }
                out.append(quad(from: (cx, cy), q, e)); lastQuad = q; lastCubic = nil; (cx, cy) = e; progressed = true
            case "t":
                guard let e = pt() else { break }
                let q = lastQuad.map { (2 * cx - $0.0, 2 * cy - $0.1) } ?? (cx, cy)
                out.append(quad(from: (cx, cy), q, e)); lastQuad = q; lastCubic = nil; (cx, cy) = e; progressed = true
            case "a":
                guard let rx = p(), let ry = p(), let rot = p(), let large = tokens.flag(), let sweep = tokens.flag(),
                      let e = pt() else { break }
                out += arc(from: (cx, cy), to: e, rx: rx, ry: ry, rotation: rot, large: large, sweep: sweep)
                (cx, cy) = e; lastCubic = nil; lastQuad = nil; progressed = true
            case "z":
                out.append(.close); (cx, cy) = (sx, sy); lastCubic = nil; lastQuad = nil
                cmd = " "; progressed = true
            default:
                break
            }
            if !progressed { break }
        }
        return out
    }

    private static func quad(from s: (Double, Double), _ q: (Double, Double), _ e: (Double, Double)) -> Segment {
        .cubic(c1x: s.0 + 2.0 / 3 * (q.0 - s.0), c1y: s.1 + 2.0 / 3 * (q.1 - s.1),
               c2x: e.0 + 2.0 / 3 * (q.0 - e.0), c2y: e.1 + 2.0 / 3 * (q.1 - e.1), x: e.0, y: e.1)
    }

    /// Endpoint arc to cubic Béziers (SVG spec, appendix F.6).
    private static func arc(from p0: (Double, Double), to p1: (Double, Double), rx rxIn: Double, ry ryIn: Double,
                            rotation: Double, large: Bool, sweep: Bool) -> [Segment] {
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 || (p0.0 == p1.0 && p0.1 == p1.1) { return [.line(p1.0, p1.1)] }
        let phi = rotation * .pi / 180, cosP = cos(phi), sinP = sin(phi)
        let dx = (p0.0 - p1.0) / 2, dy = (p0.1 - p1.1) / 2
        let x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coef = sqrt(max(0, num / den))
        if large == sweep { coef = -coef }
        let cxp = coef * rx * y1 / ry, cyp = -coef * ry * x1 / rx
        let cx = cosP * cxp - sinP * cyp + (p0.0 + p1.0) / 2
        let cy = sinP * cxp + cosP * cyp + (p0.1 + p1.1) / 2
        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let t1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
        var dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
        if !sweep && dt > 0 { dt -= 2 * .pi } else if sweep && dt < 0 { dt += 2 * .pi }
        let n = max(1, Int(ceil(abs(dt) / (.pi / 2))))
        let step = dt / Double(n)
        let k = 4.0 / 3 * tan(step / 4)
        var out: [Segment] = []
        var t = t1
        for _ in 0 ..< n {
            let (c1, s1, c2, s2) = (cos(t), sin(t), cos(t + step), sin(t + step))
            func map(_ x: Double, _ y: Double) -> (Double, Double) {
                (cx + rx * x * cosP - ry * y * sinP, cy + rx * x * sinP + ry * y * cosP)
            }
            let a = map(c1 - k * s1, s1 + k * c1), b = map(c2 + k * s2, s2 - k * c2), e = map(c2, s2)
            out.append(.cubic(c1x: a.0, c1y: a.1, c2x: b.0, c2y: b.1, x: e.0, y: e.1))
            t += step
        }
        return out
    }

    private struct Tokenizer {
        let s: [Character]
        var i = 0
        init(_ d: String) { s = Array(d) }

        mutating func skip() { while i < s.count, s[i] == " " || s[i] == "," || s[i].isNewline || s[i] == "\t" { i += 1 } }

        mutating func peekCommand() -> Character? {
            skip()
            guard i < s.count, s[i].isLetter, s[i] != "e", s[i] != "E" else { return nil }
            return s[i]
        }

        mutating func nextCommand() -> Character? {
            guard let c = peekCommand() else { return nil }
            i += 1
            return c
        }

        /// Arc flags may be written without separators ("a1 1 0 011 1").
        mutating func flag() -> Bool? {
            skip()
            guard i < s.count, s[i] == "0" || s[i] == "1" else { return nil }
            defer { i += 1 }
            return s[i] == "1"
        }

        mutating func number() -> Double? {
            skip()
            let start = i
            if i < s.count, s[i] == "-" || s[i] == "+" { i += 1 }
            var dot = false, digits = false
            while i < s.count {
                let c = s[i]
                if c.isNumber { digits = true; i += 1 } else if c == ".", !dot { dot = true; i += 1 } else { break }
            }
            if digits, i < s.count, s[i] == "e" || s[i] == "E" {
                i += 1
                if i < s.count, s[i] == "-" || s[i] == "+" { i += 1 }
                while i < s.count, s[i].isNumber { i += 1 }
            }
            guard digits else { i = start; return nil }
            return Double(String(s[start ..< i]))
        }
    }
}
