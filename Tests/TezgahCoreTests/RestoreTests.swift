import XCTest
@testable import TezgahCore

final class RestoreTests: XCTestCase {
    func testOnlyAnAgentComesBack() {
        XCTAssertNil(Restore.command(saved: nil, conversation: nil))
        XCTAssertNil(Restore.command(saved: "npm run dev", conversation: nil))
        XCTAssertNil(Restore.command(saved: "clear; echo hi\ncurl -fsSL https://x.ai/cli/install.sh | bash\u{0}", conversation: nil))
        XCTAssertEqual(Restore.command(saved: "codex 'fix the tests'", conversation: nil), "codex")
    }

    func testTheFirstMessageIsNotSentAgain() {
        XCTAssertEqual(Restore.command(saved: "claude 'add a dark mode'", conversation: nil), "claude")
    }

    func testClaudeReturnsToItsConversation() {
        let id = "11edbc8a-c6ea-4445-b58e-283b0bb9c9ea"
        XCTAssertEqual(Restore.command(saved: "claude", conversation: id), "claude --resume \(id)")
        XCTAssertEqual(Restore.command(saved: "claude --resume \(id)", conversation: id), "claude --resume \(id)")
        // Nothing was said in it yet: no file to resume, so it starts under the same id.
        XCTAssertEqual(Restore.command(saved: "claude --session-id \(id) 'hi'", conversation: id, written: false), "claude --session-id \(id)")
        XCTAssertEqual(Restore.claude(conversation: id, message: "'fix it'"), "claude --session-id \(id) 'fix it'")
        XCTAssertEqual(Restore.claude(conversation: id, message: nil), "claude --session-id \(id)")
        // Grok works the same way; Codex resumes a session it named, and can't be started under one of ours.
        XCTAssertEqual(Restore.command(saved: "grok", conversation: id), "grok --resume \(id)")
        XCTAssertEqual(Restore.command(saved: "grok", conversation: id, written: false), "grok --session-id \(id)")
        XCTAssertEqual(Restore.start("grok", conversation: id, message: "'hi'"), "grok --session-id \(id) 'hi'")
        XCTAssertEqual(Restore.command(saved: "codex", conversation: id), "codex resume \(id)")
        XCTAssertEqual(Restore.command(saved: "codex", conversation: id, written: false), "codex")
        XCTAssertEqual(Restore.command(saved: "agy", conversation: id), "agy")
        // An agent you added yourself comes back with the command you gave it; anything else still doesn't.
        XCTAssertEqual(Restore.command(saved: "cursor-agent --model fast", conversation: nil, own: ["cursor-agent"]), "cursor-agent --model fast")
        XCTAssertNil(Restore.command(saved: "cursor-agent --model fast", conversation: nil))
        // An id that isn't one never reaches the command line.
        XCTAssertEqual(Restore.command(saved: "claude", conversation: "x; rm -rf ~"), "claude")
    }

    func testTopicFromATerminalTitle() {
        XCTAssertEqual(Restore.topic(fromTitle: "✳ Fix the login bug"), "Fix the login bug")
        XCTAssertEqual(Restore.topic(fromTitle: "⠂ Refactor CI/CD pipeline"), "Refactor CI/CD pipeline")
        XCTAssertNil(Restore.topic(fromTitle: "✳ Claude Code"))
        XCTAssertNil(Restore.topic(fromTitle: "claude"))
        XCTAssertNil(Restore.topic(fromTitle: "yunus@mac:~/Project/tezgah"))
        XCTAssertNil(Restore.topic(fromTitle: "~/Project/tezgah"))
        XCTAssertNil(Restore.topic(fromTitle: "Project/tezgah"))
        XCTAssertNil(Restore.topic(fromTitle: ""))
    }

    func testAReportCarriesTheConversation() {
        let id = "11edbc8a-c6ea-4445-b58e-283b0bb9c9ea"
        guard case let .record(r)? = OSC7501.parse("state=idle:app=claude:sid=\(id):msg=:token=abc") else { return XCTFail() }
        XCTAssertEqual(r.conversation, id)
        XCTAssertEqual(r.state, .idle)
        guard case let .record(bad)? = OSC7501.parse("state=working:sid=$(reboot)") else { return XCTFail() }
        XCTAssertNil(bad.conversation)
    }

    func testAnOldWorkspaceStillLoads() throws {
        let json = """
        {"version":1,"projects":[{"id":"p","name":"x","path":"/tmp/x"}],
         "sessions":[{"id":"s","projectId":"p","kind":"agent","command":"claude 'hello'","cwd":"/tmp/x",
                      "layout":{"type":"pane","paneId":"a"},"panes":[{"id":"a","cwd":"/tmp/x","command":"claude 'hello'"}],"createdAt":"2026-11-06T10:00:00Z"},
                     {"id":"t","kind":"shell","cwd":"/tmp","layout":{"type":"split","dir":"row","children":[{"type":"pane","paneId":"b"},{"type":"pane","paneId":"c"}],"sizes":[0.5,0.5]},
                      "panes":[{"id":"b","cwd":"/tmp/b"},{"id":"zombie","cwd":"/tmp"}],"createdAt":"2026-11-06T10:00:00Z"}],
         "selection":"terminals"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let file = try decoder.decode(WorkspaceFile.self, from: Data(json.utf8))
        XCTAssertEqual(file.projects.count, 1)
        XCTAssertEqual(file.sessions.map(\.id), ["s", "t"])
        XCTAssertNil(file.sessions[0].hint)
        XCTAssertNil(file.sessions[0].panes.first?.conversation)
        XCTAssertEqual(Restore.command(saved: file.sessions[0].panes[0].command, conversation: nil), "claude")
        // A session whose panes and layout disagree is mended, not dropped.
        XCTAssertEqual(file.sessions[1].panes.map(\.id), ["b", "c"])
        XCTAssertEqual(file.sessions[1].panes[0].cwd, "/tmp/b")
        XCTAssertEqual(file.sessions[1].panes[1].cwd, "/tmp")
    }
}

final class DamagedFileTests: XCTestCase {
    func testOneBadProjectDoesNotTakeTheOthersWithIt() throws {
        let json = #"{"version":1,"projects":[{"id":"a","name":"a","path":"/a"},{"id":"b","name":7},{"id":"c","name":"c","path":"/c"}],"sessions":[]}"#
        let file = try JSONDecoder().decode(WorkspaceFile.self, from: Data(json.utf8))
        XCTAssertEqual(file.projects.map(\.id), ["a", "c"])
    }

    func testANodeKeepsItsKeyWhenItsNeighbourLeaves() {
        let three = LayoutNode.split(.row, [.pane("a"), .pane("b"), .pane("c")], [1.0 / 3, 1.0 / 3, 1.0 / 3])
        guard case let .split(_, before, _) = three, case let .split(_, after, _)? = three.removing("a") else { return XCTFail() }
        XCTAssertEqual(before.map(\.key), ["a", "b", "c"])
        XCTAssertEqual(after.map(\.key), ["b", "c"])
    }
}

final class CrowdedLayoutTests: XCTestCase {
    func testANewPaneTakesAnEqualShare() {
        var l = LayoutNode.pane("1")
        for i in 2 ... 6 { l = l.splitting("\(i - 1)", axis: .row, newId: "\(i)") }
        guard case let .split(_, children, sizes) = l else { return XCTFail() }
        XCTAssertEqual(children.count, 6)
        for s in sizes { XCTAssertEqual(s, 1.0 / 6, accuracy: 0.0001) }
        XCTAssertEqual(l.smallestShare.width, 1.0 / 6, accuracy: 0.0001)
        XCTAssertEqual(l.smallestShare.height, 1, accuracy: 0.0001)
    }

    func testGrid() {
        let ids = (1 ... 8).map(String.init)
        let g = LayoutNode.grid(ids, columns: 3)
        XCTAssertEqual(g.paneIds, ids)
        guard case let .split(.column, rows, sizes) = g else { return XCTFail() }
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(sizes, [1.0 / 3, 1.0 / 3, 1.0 / 3])
        XCTAssertEqual(rows[2].paneIds, ["7", "8"])
        XCTAssertEqual(g.smallestShare.width, 1.0 / 3, accuracy: 0.0001)
        XCTAssertEqual(LayoutNode.grid(["a"], columns: 3), .pane("a"))
        XCTAssertEqual(LayoutNode.grid(["a", "b"], columns: 3), .split(.row, [.pane("a"), .pane("b")], [0.5, 0.5]))
    }

    func testSliversFromAnOldFileAreEvenedOut() {
        let old = LayoutNode.split(.row, [.pane("a"), .pane("b"), .pane("c"), .pane("d"), .pane("e")], [0.5, 0.25, 0.125, 0.0625, 0.0625])
        XCTAssertEqual(old.repaired, .split(.row, [.pane("a"), .pane("b"), .pane("c"), .pane("d"), .pane("e")], [0.2, 0.2, 0.2, 0.2, 0.2]))
        let fine = LayoutNode.split(.row, [.pane("a"), .pane("b")], [0.7, 0.3])
        XCTAssertEqual(fine.repaired, fine)
    }
}

final class ConversationSummaryTests: XCTestCase {
    private func lines(_ objects: [String]) -> [Data] { [Data(objects.joined(separator: "\n").utf8)] }

    func testNamePrefersYoursThenClaudesThenTheFirstMessage() {
        let user = #"{"type":"user","message":{"role":"user","content":"make the header sticky\nand blue"},"sessionId":"a"}"#
        let ai = #"{"type":"ai-title","aiTitle":"Sticky header","sessionId":"a"}"#
        let custom = #"{"type":"custom-title","customTitle":"Header work","sessionId":"a"}"#
        XCTAssertEqual(Conversations.summary(of: lines([user])).title, "make the header sticky")
        XCTAssertEqual(Conversations.summary(of: lines([user, ai])).title, "Sticky header")
        XCTAssertEqual(Conversations.summary(of: lines([user, ai, custom])).title, "Header work")
    }

    func testHarnessTextIsNotAName() {
        let meta = #"{"type":"user","isMeta":true,"message":{"content":"Caveat: the messages below were generated"}}"#
        let command = #"{"type":"user","message":{"content":"<command-name>/model</command-name>"}}"#
        let real = #"{"type":"user","message":{"content":[{"type":"text","text":"<system-reminder>x</system-reminder>"},{"type":"text","text":"bu klasör ne?"}]}}"#
        XCTAssertEqual(Conversations.summary(of: lines([meta, command, real])).title, "bu klasör ne?")
        XCTAssertNil(Conversations.summary(of: lines([meta])).title)
    }

    func testRunsAProgramStartedAreMarked() {
        let sdk = #"{"type":"user","entrypoint":"sdk-cli","message":{"content":"You are the Boss"}}"#
        XCTAssertTrue(Conversations.summary(of: lines([sdk])).headless)
        XCTAssertFalse(Conversations.summary(of: lines([#"{"type":"user","message":{"content":"hi there"}}"#])).headless)
    }

    func testBrokenLinesAreSkipped() {
        let chunks = [Data("not json\n{\"type\":\"ai-title\",\"aiTitle\":\"Kept\"}\n{\"type\":\"ai-ti".utf8)]
        XCTAssertEqual(Conversations.summary(of: chunks).title, "Kept")
    }

    func testFolderName() {
        XCTAssertEqual(Conversations.claudeFolderName(for: "/Users/me/Project/tezgah-mac"), "-Users-me-Project-tezgah-mac")
    }
}
