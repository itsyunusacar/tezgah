import Foundation
import Testing
@testable import TezgahCore

private func b64(_ s: String) -> String { Data(s.utf8).base64EncodedString() }

@Suite struct OSC7501Tests {
    @Test func parsesAFullRecord() {
        let r = OSC7501.parse("state=working:id=agent-1:app=claude:title=\(b64("Fix login")):msg=\(b64("Read src/a.ts"))")
        #expect(r == .record(StatusRecord(id: "agent-1", state: .working, app: "claude", title: "Fix login", message: "Read src/a.ts")))
    }

    @Test func emptyIdIsTheSessionItself() {
        #expect(OSC7501.parse("state=done") == .record(StatusRecord(id: "", state: .done)))
    }

    @Test func kindOnlyWhenBlocked() {
        #expect(OSC7501.parse("state=blocked:kind=permission") == .record(StatusRecord(state: .blocked, kind: .permission)))
        #expect(OSC7501.parse("state=working:kind=permission") == .record(StatusRecord(state: .working)))
        #expect(OSC7501.parse("state=blocked:kind=nonsense") == .record(StatusRecord(state: .blocked)))
    }

    @Test func rejectsUnknownStatesAndBadIds() {
        #expect(OSC7501.parse("state=sleeping") == nil)
        #expect(OSC7501.parse("") == nil)
        #expect(OSC7501.parse("?") == nil)
        #expect(OSC7501.parse("state=idle:id=has space") == nil)
        #expect(OSC7501.parse("state=idle:id=" + String(repeating: "a", count: 33)) == nil)
        #expect(OSC7501.parse("state=idle:id=a/b/c/d/e/f/g/h/i") == nil)
        #expect(OSC7501.parse("state=idle:id=a//b") == nil)
        #expect(OSC7501.parse("state=idle:id=a/b/c/d/e/f/g/h") != nil)
    }

    @Test func rejectsOversizedPayloads() {
        let msg = String(repeating: "A", count: 4100)
        #expect(OSC7501.parse("state=idle:msg=" + msg) == nil)
    }

    @Test func ignoresBadKeysAndApps() {
        #expect(OSC7501.parse("state=idle:APP=claude:app=bad app") == .record(StatusRecord(state: .idle)))
        #expect(OSC7501.parse("state=idle:noequals:x=1") == .record(StatusRecord(state: .idle)))
    }

    @Test func clearReports() {
        #expect(OSC7501.parse("state=clear") == .clear(id: ""))
        #expect(OSC7501.parse("state=clear:id=a") == .clear(id: "a"))
    }

    @Test func decodesPlainTextOnly() {
        // Control characters and bidi overrides become spaces; invalid UTF-8 is dropped.
        let r = OSC7501.parse("state=idle:msg=\(b64("a\u{1b}[31mb\u{202e}c"))")
        #expect(r == .record(StatusRecord(state: .idle, message: "a [31mb c")))
        let bad = Data([0xff, 0xfe]).base64EncodedString()
        #expect(OSC7501.parse("state=idle:msg=\(bad)") == .record(StatusRecord(state: .idle)))
        // Missing padding is accepted, like atob.
        #expect(OSC7501.parse("state=idle:msg=aGk") == .record(StatusRecord(state: .idle, message: "hi")))
    }

    @Test func limitsTitleLength() throws {
        let r = OSC7501.parse("state=idle:title=\(b64(String(repeating: "x", count: 500)))")
        guard case let .record(rec) = r else { Issue.record("no record"); return }
        #expect(rec.title?.count == 192)
    }

    @Test func applyReplacesAndClearsDescendants() {
        var recs: [StatusRecord] = []
        recs = OSC7501.apply(recs, .record(StatusRecord(id: "", state: .working)))
        recs = OSC7501.apply(recs, .record(StatusRecord(id: "a", state: .working)))
        recs = OSC7501.apply(recs, .record(StatusRecord(id: "a/1", state: .blocked)))
        recs = OSC7501.apply(recs, .record(StatusRecord(id: "", state: .done)))
        #expect(recs.map(\.id) == ["a", "a/1", ""])
        #expect(OSC7501.apply(recs, .clear(id: "a")).map(\.id) == [""])
        #expect(OSC7501.apply(recs, .clear(id: "")).isEmpty)
    }

    @Test func outputClearAllKeepsWhatWaitsForYou() {
        let recs = [StatusRecord(id: "", state: .blocked, kind: .permission), StatusRecord(id: "x", state: .working)]
        #expect(OSC7501.applyOutput(recs, .clear(id: "")) == [recs[0]])
    }

    @Test func recordsAreCapped() {
        var recs: [StatusRecord] = []
        for i in 0..<300 { recs = OSC7501.apply(recs, .record(StatusRecord(id: "a\(i)", state: .idle))) }
        #expect(recs.count == 256)
        #expect(recs.first?.id == "a44")
    }

    @Test func summaryPriority() {
        #expect([StatusRecord]().summary == nil)
        #expect([StatusRecord(state: .done), StatusRecord(id: "a", state: .working)].summary == .working)
        #expect([StatusRecord(state: .working), StatusRecord(id: "a", state: .blocked)].summary == .blocked)
        #expect([StatusRecord(state: .error)].summary == .blocked)
        #expect([StatusRecord(state: .idle)].summary == .idle)
    }
}

@Suite struct OSCScannerTests {
    @Test func findsSequencesEndedByBELOrST() {
        var s = OSCScanner()
        let out = s.scan(Array("hi\u{1b}]7501;?\u{07}x\u{1b}]7501;state=done\u{1b}\\y".utf8))
        #expect(out.map(\.payload) == ["?", "state=done"])
    }

    @Test func survivesSplitReads() {
        var s = OSCScanner()
        let bytes = Array("ab\u{1b}]7501;state=working:msg=aGk=\u{07}cd".utf8)
        var found: [OSCScanner.Sequence] = []
        for b in bytes { found += s.scan([b]) }
        #expect(found == [.init(code: 7501, payload: "state=working:msg=aGk=")])
    }

    @Test func ignoresOtherCodesAndCSI() {
        var s = OSCScanner()
        let out = s.scan(Array("\u{1b}[31m\u{1b}]0;title\u{07}\u{1b}]75010;x\u{07}\u{1b}]7501\u{07}".utf8))
        #expect(out.isEmpty)
    }

    @Test func dropsOverlongAndAborted() {
        var s = OSCScanner(limit: 16)
        #expect(s.scan(Array("\u{1b}]7501;\(String(repeating: "a", count: 40))\u{07}".utf8)).isEmpty)
        #expect(s.scan(Array("\u{1b}]7501;state=done\u{18}\u{07}".utf8)).isEmpty)
        #expect(s.scan(Array("\u{1b}]7501;?\u{07}".utf8)).count == 1)
    }
}
