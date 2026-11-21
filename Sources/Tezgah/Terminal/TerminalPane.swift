import AppKit
import Foundation
import GhosttyTerminal
import Observation
import TezgahCore

/// One terminal: a login shell on a pty Tezgah owns, drawn by a Ghostty surface.
@Observable
final class TerminalPane: Identifiable {
    let id: String
    let sessionId: String
    var cwd: String
    /// Typed into the shell once it has printed its prompt (an agent, a script).
    var command: String?

    /// What the program in it reports through OSC 7501.
    private(set) var records: [StatusRecord] = []
    private(set) var statusSince = Date()
    /// The window title it set (OSC 0/2).
    private(set) var title = ""
    /// The program in the foreground other than the shell ("node", "vim", "claude").
    private(set) var program: String?
    private(set) var exited = false
    private(set) var focused = false
    /// The shell couldn't start.
    private(set) var failure: String?
    /// The agent Tezgah started here; it comes back after a restart while it is still running.
    private(set) var launched: AgentKind?
    /// The same as the word that starts it ("claude", "cursor-agent"): this also names agents you added yourself.
    private(set) var launchedWord: String?
    /// The agent's conversation (Claude Code reports it), to return to after a restart.
    private(set) var conversation: String?
    /// Whether a program has stayed in the foreground (TezgahCore.AgentLifecycle).
    @ObservationIgnored private var lifecycle = AgentLifecycle()
    private var agentAlive: Bool { lifecycle.alive }
    /// The state of an agent that doesn't report its own, read from what its screen does (TezgahCore.ActivityStatus).
    @ObservationIgnored private var activity = ActivityStatus()
    private(set) var inferred: AgentState?
    /// The agent here speaks for itself (OSC 7501): nothing is guessed about it.
    @ObservationIgnored private var reportsItself = false
    @ObservationIgnored private let typed = Flag()
    /// A pane brought back at launch waits for you to open its session before it starts its agent again:
    /// fifteen saved sessions are not fifteen agents the moment Tezgah opens.
    @ObservationIgnored private var asleep = false
    /// The folder it was meant to start in wasn't there (a disk not connected, a folder renamed): the shell
    /// started at home instead, and home must not be written down as this pane's folder.
    @ObservationIgnored private var displacedFrom: String?
    /// The shell tells Tezgah when it is ready for a command (see AgentHooks.zshenv); until it has, or a
    /// few seconds have passed without a word, nothing is typed into it.
    @ObservationIgnored private var waitsForReady = false
    @ObservationIgnored private var shellReady = false

    var status: AgentState? { records.summary ?? inferred }
    /// The agent here: the one that reports ("claude", "codex"), else the one known to be running.
    var agentApp: String? {
        if agentGone { return nil }
        return records.primary?.app ?? records.last(where: { $0.app != nil })?.app ?? (agentAlive ? agentWord : nil)
    }
    /// The word that starts the agent in this pane, when there is one: started by Tezgah, or typed by you
    /// and recognized by its name.
    var agentWord: String? {
        if let launchedWord { return launchedWord }
        if let program, store?.agentWords.contains(program) == true { return program }
        return nil
    }
    /// The agent whose records these were has left; what it left behind ("done") no longer names a running agent.
    private var agentGone = false
    /// A program is running here that isn't the shell and has stayed (an agent, a dev server).
    var busy: Bool { agentAlive }
    var statusMessage: String? { records.primary?.message ?? records.primary?.title }
    /// Find in the scrollback (⌘F): shown while searching, with Ghostty's match count.
    private(set) var searching = false
    private(set) var searchTotal: Int?
    private(set) var searchSelected: Int?
    /// 0…100 when the agent reports progress.
    var progress: Int? { records.primary?.progress }

    @ObservationIgnored let session: InMemoryTerminalSession
    @ObservationIgnored private(set) var pty: PTYProcess?
    @ObservationIgnored weak var store: AppStore?
    @ObservationIgnored private var commandTimer: Timer?
    @ObservationIgnored private var pendingCommand: String?
    @ObservationIgnored private var reader: OutputReader?
    @ObservationIgnored private(set) lazy var view: AppTerminalView = makeView()

    init(id: String, sessionId: String, cwd: String, command: String?, conversation: String? = nil, asleep: Bool = false, store: AppStore) {
        self.asleep = asleep && command != nil
        self.id = id
        self.sessionId = sessionId
        self.cwd = cwd
        self.command = command
        self.store = store
        self.conversation = conversation
        if let word = command?.split(separator: " ").first.map(String.init), store.agentWords.contains(word) {
            launchedWord = word
            launched = AgentKind.allCases.first { $0.command == word }
        }

        let start = FileManager.default.fileExists(atPath: cwd) ? cwd : NSHomeDirectory()
        if start != cwd { displacedFrom = start }
        let shell = Shell.current
        let process: PTYProcess?
        var failure: String?
        do {
            process = try PTYProcess.spawn(path: shell, args: Shell.arguments, env: Shell.environment(paneId: id, sessionId: sessionId),
                                           cwd: start, label: id)
        } catch {
            process = nil
            failure = "\(shell): \(error)"
        }
        pty = process
        self.failure = failure
        let typed = self.typed
        session = InMemoryTerminalSession(
            write: { data in
                typed.raise()
                KeyLog.note("terminal wrote \(data.count) bytes to pane \(id.prefix(6)) (pty \(process == nil ? "missing" : "there"))")
                process?.write(data)
            },
            resize: { viewport in
                process?.resize(cols: Int(viewport.columns), rows: Int(viewport.rows),
                                widthPixels: Int(viewport.widthPixels), heightPixels: Int(viewport.heightPixels))
            }
        )
        pendingCommand = command
        waitsForReady = process != nil && Shell.integrates
        if waitsForReady {
            // An rc file that never reaches a prompt hook (it replaces the shell, say) must not keep the command waiting for ever.
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
                guard let self, !self.shellReady else { return }
                self.shellReady = true
                if self.pendingCommand != nil, !self.asleep { self.typeCommandSoon() }
            }
        }
        if let failure {
            session.receive("\r\n  \u{1b}[31m\(String(localized: "Couldn't start the shell"))\u{1b}[0m  \(failure)\r\n")
        }
        startReading()
    }

    private func makeView() -> AppTerminalView {
        let v = AppTerminalView(frame: NSRect(x: 0, y: 0, width: 640, height: 400))
        v.controller = TerminalLook.controller
        v.delegate = self
        v.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        v.setAccessibilityLabel(String(localized: "Terminal"))
        return v
    }

    // MARK: - Output

    private func startReading() {
        guard let pty else { return }
        let session = self.session
        let reader = OutputReader(pty: pty, token: Shell.token(for: id))
        reader.wantsOutputNotice = pendingCommand != nil
        self.reader = reader
        pty.start(
            onOutput: { [weak self] data in
                let events = reader.scan(data)
                session.receive(data)
                guard !events.isEmpty || reader.wantsOutputNotice else { return }
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.didOutput()
                    for event in events { self.apply(event) }
                }
            },
            onExit: { [weak self] code in
                session.finish(exitCode: UInt32(bitPattern: code), runtimeMilliseconds: UInt64(Date().timeIntervalSince(pty.started) * 1000))
                Task { @MainActor [weak self] in self?.didExit(code: code) }
            }
        )
    }

    private func didOutput() {
        // Type the startup command once the shell has gone quiet after its first output (its prompt);
        // a shell that says when it is ready (zsh, through Tezgah's integration) is waited for instead.
        guard pendingCommand != nil, !asleep, shellReady || !waitsForReady else { return }
        typeCommandSoon()
    }

    /// You came to this pane's session: its agent starts now.
    func wake() {
        guard asleep else { return }
        asleep = false
        if pendingCommand != nil, shellReady || !waitsForReady { typeCommandSoon() }
    }

    private func typeCommandSoon(after delay: Double = 0.15) {
        commandTimer?.invalidate()
        commandTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let command = self.pendingCommand else { return }
                self.pendingCommand = nil
                self.reader?.wantsOutputNotice = false
                // A trailing "\u{0}" marks a command to type but not run (install commands wait for Enter).
                self.typed.raise()
                if command.hasSuffix("\u{0}") {
                    self.pty?.write(String(command.dropLast()))
                } else {
                    self.pty?.write(command + "\n")
                }
                self.commandTimer = nil
            }
        }
    }

    private func apply(_ event: OutputReader.Event) {
        switch event {
        case .probed:
            break
        case .ready:
            shellReady = true
            if pendingCommand != nil, !asleep { typeCommandSoon(after: 0.03) }
        case let .report(report):
            let before = status
            agentGone = false
            // It speaks for itself from here on.
            reportsItself = true
            inferred = nil
            records = OSC7501.applyOutput(records, report)
            if case let .record(r) = report, let c = r.conversation, c != conversation {
                conversation = c
                store?.scheduleSave()
            }
            let after = status
            if before != after {
                statusSince = Date()
                store?.paneStatusChanged(self, from: before, to: after)
            }
        }
    }

    private func didExit(code: Int32) {
        exited = true
        let before = status
        records = []
        if before != nil { store?.paneStatusChanged(self, from: before, to: nil) }
        store?.paneExited(self, code: code)
    }

    // MARK: - Polling (foreground program, directory)

    func poll() {
        guard let pty, !exited else { return }
        let foreground = pty.foreground
        // A passing error says nothing about what is running.
        if foreground == .unknown { return }
        var name: String?
        if case let .program(raw) = foreground { name = Shell.programName(raw) }
        if name != program { program = name }
        if let dir = pty.shellDirectory, dir != cwd {
            // Still where it was put for want of its own folder: the saved folder stays.
            if dir == displacedFrom { } else {
                displacedFrom = nil
                cwd = dir
                store?.scheduleSave()
            }
        }
        let bytes = reader?.takeBytes() ?? 0
        let wasTyped = typed.lower()
        // Nothing has been started here yet (the command waits for the prompt, or for you).
        guard pendingCommand == nil else { return }
        switch lifecycle.look(programRunning: name != nil, expecting: launchedWord != nil) {
        case .ended: agentEnded()
        case .started: store?.scheduleSave()
        case .none: break
        }
        // An agent that says nothing about itself: its state is read from what its screen does.
        guard agentAlive, !reportsItself, agentWord != nil else { return }
        let before = status
        if activity.look(bytes: bytes, typed: wasTyped, asks: { ActivityStatus.asks(self.viewportText() ?? "") }) {
            inferred = activity.state
            statusSince = Date()
            store?.paneStatusChanged(self, from: before, to: status)
        }
    }

    /// The project's folder moved: this pane's saved folder follows it.
    func moved(from old: String, to new: String) {
        if cwd == old { cwd = new } else if cwd.hasPrefix(old + "/") { cwd = new + cwd.dropFirst(old.count) }
    }

    /// The shell is back at its prompt and stayed there: whatever ran is gone. Nothing is brought back
    /// at the next launch, and a state it left behind ("waiting for you") no longer speaks for anyone.
    private func agentEnded() {
        let before = status
        // Read before it is forgotten: what it leaves behind keeps only a finished turn.
        let finished = inferred == .done
        if launchedWord != nil || conversation != nil {
            launched = nil
            launchedWord = nil
            conversation = nil
            store?.scheduleSave()
        }
        agentGone = true
        reportsItself = false
        activity.reset()
        inferred = nil
        records = records.filter { $0.state == .done }
        _ = finished
        if before != status {
            statusSince = Date()
            store?.paneStatusChanged(self, from: before, to: status)
        }
    }

    /// The agent to start again in this pane at the next launch, if one is running in it.
    var agentToRestore: AgentKind? { launched ?? (agentAlive ? AgentKind(program: agentApp) : nil) }

    /// The same as the word that starts it, which also covers agents you added yourself.
    var wordToRestore: String? {
        if let launchedWord { return launchedWord }
        guard agentAlive else { return nil }
        return AgentKind(program: agentApp)?.command ?? agentWord
    }

    // MARK: - Actions

    func focus() {
        guard let window = view.window else {
            KeyLog.note("focus: pane \(id.prefix(6)) is not in a window yet")
            return
        }
        // The keyboard goes to the key window: a terminal that is given the focus while its window isn't key
        // (a system panel or an alert just closed) would look focused and hear nothing.
        if NSApp.isActive, NSApp.modalWindow == nil, window.isVisible, !window.isKeyWindow {
            KeyLog.note("focus: window was not key; making it key")
            window.makeKey()
        }
        let took = window.makeFirstResponder(view)
        if !took { KeyLog.note("focus: pane \(id.prefix(6)) could not take the keyboard") }
    }

    /// Types text as if pasted (bracketed paste when the program asked for it).
    func paste(_ text: String) {
        _ = view.paste(text: text)
    }

    /// Writes straight to the program, as keystrokes.
    func send(_ text: String) {
        typed.raise()
        pty?.write(text)
    }

    /// Bumped each time ⌘F is pressed, so an open find bar takes the cursor again.
    private(set) var findRequests = 0

    func startFind() {
        findRequests += 1
        searching = true
        _ = view.performBindingAction("start_search")
    }

    func find(_ needle: String) {
        _ = view.performBindingAction(needle.isEmpty ? "search:" : "search:\(needle)")
    }

    func findNext(_ forward: Bool = true) {
        _ = view.performBindingAction(forward ? "navigate_search:next" : "navigate_search:previous")
    }

    func endFind() {
        _ = view.performBindingAction("end_search")
        searching = false
        searchTotal = nil
        searchSelected = nil
        focus()
    }

    func clearScreen() {
        _ = view.performBindingAction("clear_screen")
    }

    func viewportText() -> String? {
        session.readViewportText()
    }

    func terminate() {
        commandTimer?.invalidate()
        pty?.terminate()
    }

    /// The user looked: a finished agent's "done" stops asking for attention.
    func acknowledge() {
        guard status == .done else { return }
        if records.isEmpty, inferred == .done {
            activity.acknowledge()
            inferred = activity.state
            statusSince = Date()
            store?.paneStatusChanged(self, from: .done, to: status)
            return
        }
        records = records.map { r in
            var r = r
            if r.state == .done { r.state = .idle }
            return r
        }
        // Its agent has left: nothing remains to say about it.
        if agentGone { records.removeAll { $0.state == .idle } }
        statusSince = Date()
        store?.paneStatusChanged(self, from: .done, to: status)
    }
}

extension TerminalPane: TerminalSurfaceTitleDelegate, TerminalSurfaceCloseDelegate, TerminalSurfaceFocusDelegate, TerminalSurfaceSearchDelegate {
    func terminalDidStartSearch(needle _: String?) { searching = true }
    func terminalDidEndSearch() { searching = false }
    func terminalDidUpdateSearchTotal(_ total: Int?) { searchTotal = total }
    func terminalDidUpdateSearchSelected(_ selected: Int?) { searchSelected = selected }

    func terminalDidChangeTitle(_ title: String) {
        self.title = title
    }

    func terminalDidClose(processAlive _: Bool) {
        if exited { store?.closePane(id) }
    }

    func terminalDidChangeFocus(_ focused: Bool) {
        self.focused = focused
        if focused {
            store?.paneFocused(self)
            acknowledge()
        }
    }
}

/// Watches a pty's output on its reader queue: answers the OSC 7501 probe and passes on reports,
/// only from a pane whose program probed (text that merely passes through, like `cat` of a log, is ignored).
nonisolated final class OutputReader: @unchecked Sendable {
    enum Event: Sendable {
        case probed
        case report(OSCReport)
        /// The shell has read its rc files and is about to show its first prompt (Tezgah's zsh integration says so).
        case ready
    }

    private let pty: PTYProcess
    private let lock = NSLock()
    private var _wantsOutputNotice = false
    /// The pane waits for the shell's first quiet moment to type its command.
    var wantsOutputNotice: Bool {
        get { lock.withLock { _wantsOutputNotice } }
        set { lock.withLock { _wantsOutputNotice = newValue } }
    }
    private var scanner = OSCScanner(codes: [7501])
    private var bytes = 0

    /// What the program has written since this was last asked.
    func takeBytes() -> Int {
        lock.withLock {
            defer { bytes = 0 }
            return bytes
        }
    }
    private var probed = false
    /// Reports carrying this pane's secret come from Tezgah's own agent hooks and need no probe.
    private let token: String

    init(pty: PTYProcess, token: String) {
        self.pty = pty
        self.token = token
    }

    /// Called on the reader's serial queue only.
    func scan(_ data: Data) -> [Event] {
        lock.withLock { bytes += data.count }
        var events: [Event] = []
        for seq in scanner.scan(data) {
            if seq.payload == "?" {
                probed = true
                pty.write(OSC7501.probeReply)
                events.append(.probed)
            } else if seq.payload == "ready=1:token=\(token)" {
                events.append(.ready)
            } else if probed || seq.payload.split(separator: ":").contains(Substring("token=\(token)")),
                      let report = OSC7501.parse(seq.payload) {
                events.append(.report(report))
            }
        }
        return events
    }
}

/// Raised from wherever keys are written to the terminal; lowered by the pane's once-a-second look.
nonisolated final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var up = false
    func raise() { lock.withLock { up = true } }
    func lower() -> Bool {
        lock.withLock {
            defer { up = false }
            return up
        }
    }
}

enum Shell {
    static let current: String = {
        if let s = ProcessInfo.processInfo.environment["SHELL"], FileManager.default.isExecutableFile(atPath: s) { return s }
        if let pw = getpwuid(getuid()), let sh = pw.pointee.pw_shell { return String(cString: sh) }
        return "/bin/zsh"
    }()

    /// A login shell. fish is also told, after its own configuration, to put Tezgah's folder first on the
    /// PATH and to say when its first prompt is up (the same two things AgentHooks.zshenv does for zsh).
    static var arguments: [String] {
        guard programName(current) == "fish" else { return ["-l"] }
        return ["-l", "-C", #"""
        if test -n "$TEZGAH_BIN"; set -gx PATH $TEZGAH_BIN (string match -v -- $TEZGAH_BIN $PATH); end
        function __tezgah_ready --on-event fish_prompt; printf '\e]7501;ready=1:token=%s\a' $TEZGAH_PANE_TOKEN; functions -e __tezgah_ready; end
        """#]
    }

    /// bash has no file of ours to read first, so the same two things ride on PROMPT_COMMAND (kept in
    /// front of the user's own, when their profile adds to it rather than replacing it).
    static let bashPrompt = #"[ "${PATH%%:*}" = "$TEZGAH_BIN" ] || PATH="$TEZGAH_BIN:${PATH//"$TEZGAH_BIN":/}"; [ -n "$__tezgah_ready" ] || { __tezgah_ready=1; printf '\033]7501;ready=1:token=%s\007' "$TEZGAH_PANE_TOKEN"; }"#

    /// The shell is zsh and Tezgah's integration file is in place.
    static var integrates: Bool {
        guard programName(current) == "zsh", let dir = AgentHooks.zshDirectory else { return false }
        return FileManager.default.fileExists(atPath: dir.appendingPathComponent(".zshenv").path)
    }

    static let shells: Set<String> = ["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "xonsh", "elvish", "pwsh", "login"]

    /// "-zsh", "/bin/bash" → "zsh", "bash"
    static func programName(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("-") { s.removeFirst() }
        return (s as NSString).lastPathComponent.lowercased()
    }

    /// Another terminal's (or tmux's) identity, inherited when Tezgah was started from one.
    static let foreign: Set<String> = [
        "TMUX", "TMUX_PANE", "STY", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "LC_TERMINAL", "LC_TERMINAL_VERSION",
        "WT_SESSION", "WT_PROFILE_ID", "TERMINAL_EMULATOR", "VTE_VERSION", "WINDOWID", "TERMINFO", "COLUMNS", "LINES",
    ]
    static let foreignPrefixes = ["VSCODE_", "ITERM_", "KITTY_", "WEZTERM_", "GHOSTTY_", "ALACRITTY_", "KONSOLE_", "CLAUDE_CODE_", "TEZGAH_", "XPC_", "__CF", "OS_ACTIVITY"]

    nonisolated(unsafe) private static var tokens: [String: String] = [:]
    nonisolated private static let tokenLock = NSLock()

    /// A per-pane secret that Tezgah's hooks put in their reports.
    nonisolated static func token(for paneId: String) -> String {
        tokenLock.withLock {
            if let t = tokens[paneId] { return t }
            let t = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16).lowercased()
            tokens[paneId] = String(t)
            return String(t)
        }
    }

    /// The app's environment minus markers that would confuse programs started here, plus ours.
    static func environment(paneId: String, sessionId: String) -> [String: String] {
        var env: [String: String] = [:]
        for (k, v) in ProcessInfo.processInfo.environment {
            if foreign.contains(k) || k == "CLAUDECODE" || k == "NODE_OPTIONS" || foreignPrefixes.contains(where: k.hasPrefix) { continue }
            env[k] = v
        }
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["TERM_PROGRAM"] = "Tezgah"
        env["TERM_PROGRAM_VERSION"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        // foreground;background as ANSI color numbers, for vim, less and others.
        env["COLORFGBG"] = TerminalLook.isDark ? "15;0" : "0;15"
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }
        env["TEZGAH_PANE_ID"] = paneId
        env["TEZGAH_SESSION_ID"] = sessionId
        env["TEZGAH_APP"] = "native"
        env["TEZGAH_PANE_TOKEN"] = token(for: paneId)
        // Tezgah's shims (claude, codex) come first, so agents started here report their state.
        if let bin = AgentHooks.binDirectory?.path {
            env["TEZGAH_BIN"] = bin
            env["PATH"] = [bin, env["PATH"]].compactMap { $0 }.joined(separator: ":")
        }
        // zsh reads Tezgah's .zshenv first, which hands ZDOTDIR back and reads the user's own files (AgentHooks.zshenv).
        if integrates, let zsh = AgentHooks.zshDirectory?.path {
            if let own = env["ZDOTDIR"] { env["TEZGAH_ZDOTDIR"] = own }
            env["ZDOTDIR"] = zsh
        }
        if programName(current) == "bash", env["TEZGAH_BIN"] != nil {
            env["PROMPT_COMMAND"] = [bashPrompt, env["PROMPT_COMMAND"]].compactMap { $0 }.joined(separator: "; ")
        }
        // Launched from Finder, an app's PATH is minimal; the login shell rebuilds it.
        if env["PATH"] == nil { env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin" }
        if env["HOME"] == nil { env["HOME"] = NSHomeDirectory() }
        if env["USER"] == nil { env["USER"] = NSUserName() }
        if env["SHELL"] == nil { env["SHELL"] = current }
        return env
    }
}
