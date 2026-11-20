import Foundation

/// Whether an agent is running in a pane, judged from what is in the terminal's foreground, looked at
/// once a second.
public struct AgentLifecycle: Equatable, Sendable {
    /// A program other than the shell has stayed in the foreground (not a prompt's own short-lived helpers).
    public private(set) var alive = false
    private var busy = 0
    private var prompt = 0
    private var sinceStart = 0

    public enum Event: Equatable, Sendable {
        case none
        /// The program has stayed for two looks: it is running.
        case started
        /// The shell is back at its prompt and stayed there: whatever ran is gone.
        case ended
    }

    public init() {}

    /// One look. `programRunning`: something other than the shell is in the foreground. `expecting`: Tezgah
    /// started an agent here and has not seen it yet.
    public mutating func look(programRunning: Bool, expecting: Bool) -> Event {
        sinceStart += 1
        if programRunning {
            // Two looks in a row: a prompt's own helpers (git, starship) come and go between looks.
            busy += 1
            prompt = 0
            if busy >= 2, !alive {
                alive = true
                return .started
            }
            return .none
        }
        prompt += 1
        busy = 0
        if alive, prompt >= 2 {
            alive = false
            return .ended
        }
        // Started and gone again before it was ever seen (not installed, a conversation that is gone, a
        // sign-in error). Fifteen seconds, not three: a shell still reading its rc file has the command
        // waiting in its input.
        if !alive, expecting, sinceStart >= 15, prompt == 15 { return .ended }
        return .none
    }
}

/// What an agent that doesn't report its own state is doing, read from the outside: it is at work while its
/// screen keeps changing by itself, and when that stops it is either asking you something or done.
public struct ActivityStatus: Equatable, Sendable {
    public private(set) var state: AgentState?
    private var active = 0
    private var quiet = 0

    /// Output in one second that counts as the screen changing by itself (a spinner, streamed text), not a blink.
    public static let busyBytes = 160

    public init() {}

    /// One look a second. `bytes`: what the program wrote since the last look. `typed`: you typed since then
    /// (what the screen shows next is your own typing coming back). `asks`: the screen shows a question;
    /// only looked at when work has just stopped. True when the state changed.
    public mutating func look(bytes: Int, typed: Bool, asks: () -> Bool) -> Bool {
        let before = state
        if typed {
            active = 0
            quiet = 0
            // You are answering it, or have seen that it finished.
            if state == .blocked || state == .done { state = .idle }
        } else if bytes >= Self.busyBytes {
            active += 1
            quiet = 0
            if active >= 2 { state = .working }
        } else {
            quiet += 1
            active = 0
            if state == .working, quiet >= 3 { state = asks() ? .blocked : .done }
        }
        return state != before
    }

    /// You looked at it: "done" stops asking for attention.
    public mutating func acknowledge() {
        if state == .done { state = .idle }
    }

    public mutating func reset() {
        self = ActivityStatus()
    }

    /// Whether the bottom of a screen reads like a question waiting for an answer. A question asked in a
    /// line ("Apply? (y/n)") is the last thing on the screen while it waits; one answered a while ago is
    /// further up and no longer counts. A menu of choices keeps a few lines below its question.
    public static func asks(_ screen: String) -> Bool {
        let lines = screen.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        let last = lines.suffix(2).joined(separator: "\n")
        let inLine = ["(y/n)", "[y/n]", "(yes/no)", "[yes/no]", "y/n?", "do you want", "would you like", "allow ", "approve",
                      "proceed?", "continue?", "confirm", "press enter"]
        if inLine.contains(where: { last.contains($0) }) { return true }
        let below = lines.suffix(8).joined(separator: "\n")
        let menu = ["1. yes", "❯ yes", "> yes", "yes, and", "(esc to cancel)", "esc to cancel"]
        return menu.contains { below.contains($0) }
    }
}
