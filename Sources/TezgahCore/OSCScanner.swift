import Foundation

/// Finds OSC sequences (`ESC ] code ; payload` ended by BEL or `ESC \`) in a pty's output
/// stream, across read boundaries. It only watches: the bytes still go to the terminal as they are.
public struct OSCScanner: Sendable {
    public struct Sequence: Equatable, Sendable {
        public var code: Int
        public var payload: String
    }

    enum Phase: Sendable { case ground, escape, osc, oscEscape }

    /// OSC codes to collect; others are skipped without buffering.
    public let codes: Set<Int>
    /// Longer sequences are dropped (OSC 7501 allows 4087 bytes of payload).
    public let limit: Int

    var phase: Phase = .ground
    var buffer: [UInt8] = []
    var overflow = false

    public init(codes: Set<Int> = [7501], limit: Int = 4096 + 16) {
        self.codes = codes
        self.limit = limit
    }

    public mutating func scan<C: Collection>(_ bytes: C) -> [Sequence] where C.Element == UInt8 {
        var found: [Sequence] = []
        for b in bytes {
            switch phase {
            case .ground:
                if b == 0x1b { phase = .escape }
            case .escape:
                if b == 0x5d { // ]
                    phase = .osc
                    buffer.removeAll(keepingCapacity: true)
                    overflow = false
                } else {
                    phase = b == 0x1b ? .escape : .ground
                }
            case .osc:
                switch b {
                case 0x07:
                    finish(into: &found)
                case 0x1b:
                    phase = .oscEscape
                case 0x18, 0x1a: // CAN, SUB abort the sequence
                    phase = .ground
                default:
                    if buffer.count < limit { buffer.append(b) } else { overflow = true }
                }
            case .oscEscape:
                if b == 0x5c { // ST
                    finish(into: &found)
                } else if b == 0x5d {
                    // ESC ] again: a new OSC starts; the unterminated one is dropped.
                    phase = .osc
                    buffer.removeAll(keepingCapacity: true)
                    overflow = false
                } else {
                    phase = .ground
                }
            }
        }
        return found
    }

    mutating func finish(into found: inout [Sequence]) {
        phase = .ground
        defer { buffer.removeAll(keepingCapacity: true) }
        guard !overflow else { return }
        guard let semi = buffer.firstIndex(of: 0x3b) else {
            return
        }
        let digits = buffer[..<semi]
        guard !digits.isEmpty, digits.count <= 5, digits.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }),
              let code = Int(String(decoding: digits, as: UTF8.self)), codes.contains(code) else { return }
        let payload = String(decoding: buffer[(semi + 1)...], as: UTF8.self)
        found.append(Sequence(code: code, payload: payload))
    }
}
