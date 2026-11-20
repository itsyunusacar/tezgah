import XCTest
@testable import TezgahCore

final class AgentLifecycleTests: XCTestCase {
    func testAPromptsHelperIsNotAnAgent() {
        var l = AgentLifecycle()
        // starship or git in the foreground for one look, then the prompt again
        XCTAssertEqual(l.look(programRunning: true, expecting: false), .none)
        XCTAssertEqual(l.look(programRunning: false, expecting: false), .none)
        XCTAssertFalse(l.alive)
        XCTAssertEqual(l.look(programRunning: false, expecting: false), .none)
    }

    func testAnAgentStartsStaysAndEnds() {
        var l = AgentLifecycle()
        XCTAssertEqual(l.look(programRunning: true, expecting: true), .none)
        XCTAssertEqual(l.look(programRunning: true, expecting: true), .started)
        XCTAssertTrue(l.alive)
        XCTAssertEqual(l.look(programRunning: true, expecting: true), .none)
        // one look at the prompt is not the end (a subcommand between two looks)
        XCTAssertEqual(l.look(programRunning: false, expecting: false), .none)
        XCTAssertEqual(l.look(programRunning: false, expecting: false), .ended)
        XCTAssertFalse(l.alive)
    }

    func testAnAgentThatNeverCameUpIsGivenUpOnceAndNotSooner() {
        var l = AgentLifecycle()
        var events: [AgentLifecycle.Event] = []
        for _ in 0 ..< 20 { events.append(l.look(programRunning: false, expecting: true)) }
        XCTAssertEqual(events.firstIndex(of: .ended), 14)
        XCTAssertEqual(events.filter { $0 == .ended }.count, 1)
        // a plain shell that nobody expects anything of never "ends"
        var shell = AgentLifecycle()
        for _ in 0 ..< 40 { XCTAssertEqual(shell.look(programRunning: false, expecting: false), .none) }
    }
}

final class ActivityStatusTests: XCTestCase {
    func testWorkingThenDone() {
        var a = ActivityStatus()
        XCTAssertFalse(a.look(bytes: 900, typed: false, asks: { false }))
        XCTAssertTrue(a.look(bytes: 900, typed: false, asks: { false }))
        XCTAssertEqual(a.state, .working)
        XCTAssertFalse(a.look(bytes: 0, typed: false, asks: { false }))
        XCTAssertFalse(a.look(bytes: 20, typed: false, asks: { false }))
        XCTAssertTrue(a.look(bytes: 0, typed: false, asks: { false }))
        XCTAssertEqual(a.state, .done)
        a.acknowledge()
        XCTAssertEqual(a.state, .idle)
    }

    func testWorkingThenAQuestion() {
        var a = ActivityStatus()
        for _ in 0 ..< 3 { _ = a.look(bytes: 500, typed: false, asks: { true }) }
        for _ in 0 ..< 3 { _ = a.look(bytes: 0, typed: false, asks: { true }) }
        XCTAssertEqual(a.state, .blocked)
        // answering it clears it; the work that follows shows as work again
        XCTAssertTrue(a.look(bytes: 30, typed: true, asks: { true }))
        XCTAssertEqual(a.state, .idle)
        _ = a.look(bytes: 700, typed: false, asks: { false })
        _ = a.look(bytes: 700, typed: false, asks: { false })
        XCTAssertEqual(a.state, .working)
    }

    func testYourOwnTypingIsNotWork() {
        var a = ActivityStatus()
        for _ in 0 ..< 10 { _ = a.look(bytes: 400, typed: true, asks: { false }) }
        XCTAssertNil(a.state)
        // a pause in the stream is not the end of the work
        _ = a.look(bytes: 400, typed: false, asks: { false })
        _ = a.look(bytes: 400, typed: false, asks: { false })
        _ = a.look(bytes: 0, typed: false, asks: { false })
        _ = a.look(bytes: 400, typed: false, asks: { false })
        XCTAssertEqual(a.state, .working)
    }

    func testReadingAQuestionOffTheScreen() {
        XCTAssertTrue(ActivityStatus.asks("Edit src/app.ts\n\nDo you want to make this edit?\n❯ 1. Yes\n  2. No"))
        XCTAssertTrue(ActivityStatus.asks("Run `rm -rf build`? (y/n)"))
        XCTAssertTrue(ActivityStatus.asks("Allow this command to run?"))
        XCTAssertFalse(ActivityStatus.asks("Done. 3 files changed.\n\n> "))
        XCTAssertFalse(ActivityStatus.asks(""))
        // answered, with the work it led to below it
        XCTAssertFalse(ActivityStatus.asks("Do you want to apply this change? (y/n) y\n* Applying, 39 more lines\nAll done."))
        XCTAssertTrue(ActivityStatus.asks("Bash(npm test)\n\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again\n  3. No\n\nEsc to cancel"))
        // a question far up the screen, long answered, doesn't count
        XCTAssertFalse(ActivityStatus.asks("Allow this? (y/n)\n" + (1 ... 20).map { "line \($0)" }.joined(separator: "\n")))
    }
}
