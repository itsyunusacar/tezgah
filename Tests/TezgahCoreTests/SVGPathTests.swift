import Testing
@testable import TezgahCore

@Suite struct SVGPathTests {
    @Test func relativeAndAbsoluteCommands() {
        let s = SVGPath.parse("M10 10 l5 0 h5 v5 L0 0 z")
        #expect(s == [.move(10, 10), .line(15, 10), .line(20, 10), .line(20, 15), .line(0, 0), .close])
    }

    @Test func implicitRepeatsAndPackedNumbers() {
        // After a move, extra pairs are lines; "-.5" and ".5.5" pack numbers without spaces.
        let s = SVGPath.parse("m1 1 2 2-.5.5")
        #expect(s == [.move(1, 1), .line(3, 3), .line(2.5, 3.5)])
    }

    @Test func cubicAndSmoothCubic() {
        let s = SVGPath.parse("M0 0 C1 1 2 2 3 3 S5 5 6 6")
        #expect(s.count == 3)
        if case let .cubic(c1x, c1y, _, _, x, y) = s[2] {
            #expect(c1x == 4 && c1y == 4 && x == 6 && y == 6)
        } else { Issue.record("not a cubic") }
    }

    @Test func arcsEndWhereTheySay() {
        let s = SVGPath.parse("M0 0 a5 5 0 0 1 10 0")
        guard case let .cubic(_, _, _, _, x, y)? = s.last else { Issue.record("no arc"); return }
        #expect(abs(x - 10) < 1e-9 && abs(y) < 1e-9)
    }

    @Test func realLogosParse() {
        // The start of the Claude and Gemini marks from the logo set.
        #expect(SVGPath.parse("m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486z").count == 7)
        #expect(SVGPath.parse("M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68").count == 3)
    }
}
