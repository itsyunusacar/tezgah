import Foundation
import Testing
@testable import TezgahCore

@Suite struct LayoutTests {
    @Test func splitAPaneMakesATwoWaySplit() {
        let l = LayoutNode.pane("a").splitting("a", axis: .row, newId: "b")
        #expect(l == .split(.row, [.pane("a"), .pane("b")], [0.5, 0.5]))
    }

    @Test func splittingTheSameWayJoinsTheParent() {
        let l = LayoutNode.pane("a").splitting("a", axis: .row, newId: "b").splitting("a", axis: .row, newId: "c")
        #expect(l == .split(.row, [.pane("a"), .pane("c"), .pane("b")], [0.25, 0.25, 0.5]))
    }

    @Test func splittingTheOtherWayNests() {
        let l = LayoutNode.pane("a").splitting("a", axis: .row, newId: "b").splitting("b", axis: .column, newId: "c")
        #expect(l == .split(.row, [.pane("a"), .split(.column, [.pane("b"), .pane("c")], [0.5, 0.5])], [0.5, 0.5]))
        #expect(l.paneIds == ["a", "b", "c"])
        #expect(l.contains("c") && !l.contains("z"))
    }

    @Test func splittingAnUnknownPaneChangesNothing() {
        let l = LayoutNode.pane("a")
        #expect(l.splitting("z", axis: .row, newId: "b") == l)
    }

    @Test func removingCollapsesAndRenormalizes() {
        let l = LayoutNode.pane("a").splitting("a", axis: .row, newId: "b").splitting("b", axis: .column, newId: "c")
        #expect(l.removing("c") == .split(.row, [.pane("a"), .pane("b")], [0.5, 0.5]))
        #expect(l.removing("a") == .split(.column, [.pane("b"), .pane("c")], [0.5, 0.5]))
        #expect(LayoutNode.pane("a").removing("a") == nil)
        let three = LayoutNode.split(.row, [.pane("a"), .pane("b"), .pane("c")], [0.5, 0.25, 0.25])
        #expect(three.removing("a") == .split(.row, [.pane("b"), .pane("c")], [0.5, 0.5]))
    }

    @Test func neighborAfterClose() {
        let l = LayoutNode.split(.row, [.pane("a"), .pane("b"), .pane("c")], [1, 1, 1])
        #expect(l.neighbor(of: "a") == "b")
        #expect(l.neighbor(of: "c") == "b")
        #expect(LayoutNode.pane("a").neighbor(of: "a") == nil)
    }

    @Test func resizingClampsAndNormalizes() {
        let l = LayoutNode.split(.row, [.pane("a"), .split(.column, [.pane("b"), .pane("c")], [0.5, 0.5])], [0.5, 0.5])
        let r = l.resizing(at: [1], sizes: [0.0, 1.0])
        guard case let .split(_, children, _) = r, case let .split(_, _, sizes) = children[1] else {
            Issue.record("shape changed"); return
        }
        #expect(abs(sizes.reduce(0, +) - 1) < 1e-9)
        #expect(sizes[0] > 0.07)
        #expect(l.resizing(at: [], sizes: [1, 3]) == .split(.row, [.pane("a"), .split(.column, [.pane("b"), .pane("c")], [0.5, 0.5])], [0.25, 0.75]))
    }

    @Test func codableRoundTripInTheElectronShape() throws {
        let l = LayoutNode.pane("a").splitting("a", axis: .row, newId: "b").splitting("b", axis: .column, newId: "c")
        let data = try JSONEncoder().encode(l)
        let json = try #require(String(data: data, encoding: .utf8))
        #expect(json.contains("\"type\":\"split\"") && json.contains("\"paneId\":\"a\""))
        #expect(try JSONDecoder().decode(LayoutNode.self, from: data) == l)
    }

    @Test func decodingRepairsBadSizes() throws {
        let json = #"{"type":"split","dir":"column","children":[{"type":"pane","paneId":"a"},{"type":"pane","paneId":"b"}],"sizes":[3]}"#
        let l = try JSONDecoder().decode(LayoutNode.self, from: Data(json.utf8))
        #expect(l == .split(.column, [.pane("a"), .pane("b")], [0.5, 0.5]))
        let single = #"{"type":"split","dir":"row","children":[{"type":"pane","paneId":"a"}],"sizes":[1]}"#
        #expect(try JSONDecoder().decode(LayoutNode.self, from: Data(single.utf8)) == .pane("a"))
    }
}

@Suite struct WorkspaceTests {
    @Test func dropsSessionsWhoseLayoutAndPanesDisagree() throws {
        var w = WorkspaceFile()
        w.sessions = [
            SessionRecord(projectId: nil, cwd: "/", layout: .pane("a"), panes: [PaneRecord(id: "a", cwd: "/")]),
            SessionRecord(projectId: nil, cwd: "/", layout: .pane("b"), panes: [PaneRecord(id: "c", cwd: "/")]),
        ]
        let back = try JSONDecoder().decode(WorkspaceFile.self, from: JSONEncoder().encode(w))
        #expect(back.sessions.count == 1)
    }

    @Test func legacyImportReadsProjectsOnly() {
        let json = #"{"projects":[{"id":"1","name":"tezgah","path":"/x/tezgah","worktrees":false},{"id":"2","path":"/y/web"},{"id":"3","name":"nopath"}],"sessions":[{"id":"s"}]}"#
        let p = LegacyImport.projects(from: Data(json.utf8))
        #expect(p.map(\.name) == ["tezgah", "web"])
        #expect(p.map(\.path) == ["/x/tezgah", "/y/web"])
        #expect(LegacyImport.projects(from: Data("nope".utf8)).isEmpty)
    }

    @Test func durationsAndPaths() {
        #expect(Durations.short(2) == "now")
        #expect(Durations.short(42) == "42s")
        #expect(Durations.short(360) == "6m")
        #expect(Durations.short(7500) == "2h 5m")
        #expect(Paths.tilde("/Users/me/x", home: "/Users/me") == "~/x")
        #expect(Paths.tilde("/Users/meme", home: "/Users/me") == "/Users/meme")
    }
}
