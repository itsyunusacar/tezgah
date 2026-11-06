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

    var status: AgentState? { records.summary }
    /// The agent that reports here ("claude", "codex"), if any.
    var agentApp: String? { records.primary?.app ?? records.last(where: { $0.app != nil })?.app }
    var statusMessage: String? { records.primary?.message ?? records.primary?.title }
    /// 0…100 when the agent reports progress.
    var progress: Int? { records.primary?.progress }

    @ObservationIgnored let session: InMemoryTerminalSession
    @ObservationIgnored private(set) var pty: PTYProcess?
    @ObservationIgnored weak var store: AppStore?
    @ObservationIgnored private var commandTimer: Timer?
    @ObservationIgnored private var pendingCommand: String?
    @ObservationIgnored private var reader: OutputReader?
    @ObservationIgnored private(set) lazy var view: AppTerminalView = makeView()

    init(id: String, sessionId: String, cwd: String, command: String?, store: AppStore) {
        self.id = id
        self.sessionId = sessionId
        self.cwd = cwd
        self.command = command
        self.store = store

        let start = FileManager.default.fileExists(atPath: cwd) ? cwd : NSHomeDirectory()
        let shell = Shell.current
        let process: PTYProcess?
        var failure: String?
        do {
            process = try PTYProcess.spawn(path: shell, args: ["-l"], env: Shell.environment(paneId: id, sessionId: sessionId),
                                           cwd: start, label: id)
        } catch {
            process = nil
            failure = "\(shell): \(error)"
        }
        pty = process
        self.failure = failure
        session = InMemoryTerminalSession(
            write: { data in process?.write(data) },
            resize: { viewport in
                process?.resize(cols: Int(viewport.columns), rows: Int(viewport.rows),
                                widthPixels: Int(viewport.widthPixels), heightPixels: Int(viewport.heightPixels))
            }
        )
        pendingCommand = command
        if let failure {
            session.receive("\r\n  \u{1b}[31mCouldn't start the shell\u{1b}[0m  \(failure)\r\n")
        }
        startReading()
    }

    private func makeView() -> AppTerminalView {
        let v = AppTerminalView(frame: NSRect(x: 0, y: 0, width: 640, height: 400))
        v.controller = TerminalLook.controller
        v.delegate = self
        v.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        v.setAccessibilityLabel("Terminal")
        return v
    }

    // MARK: - Output

    private func startReading() {
        guard let pty else { return }
        let session = self.session
        let reader = OutputReader(pty: pty)
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
        // Type the startup command once the shell has gone quiet after its first output (its prompt).
        guard pendingCommand != nil else { return }
        commandTimer?.invalidate()
        commandTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let command = self.pendingCommand else { return }
                self.pendingCommand = nil
                self.reader?.wantsOutputNotice = false
                self.pty?.write(command + "\n")
                self.commandTimer = nil
            }
        }
    }

    private func apply(_ event: OutputReader.Event) {
        switch event {
        case .probed:
            break
        case let .report(report):
            let before = status
            records = OSC7501.applyOutput(records, report)
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
        let name = pty.foregroundName.map(Shell.programName)
        if name != program { program = name }
        if let dir = pty.shellDirectory, dir != cwd { cwd = dir }
    }

    // MARK: - Actions

    func focus() {
        view.window?.makeFirstResponder(view)
    }

    /// Types text as if pasted (bracketed paste when the program asked for it).
    func paste(_ text: String) {
        _ = view.paste(text: text)
    }

    /// Writes straight to the program, as keystrokes.
    func send(_ text: String) {
        pty?.write(text)
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
        records = records.map { r in
            var r = r
            if r.state == .done { r.state = .idle }
            return r
        }
        statusSince = Date()
        store?.paneStatusChanged(self, from: .done, to: status)
    }
}

extension TerminalPane: TerminalSurfaceTitleDelegate, TerminalSurfaceCloseDelegate, TerminalSurfaceFocusDelegate {
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
    private var probed = false

    init(pty: PTYProcess) {
        self.pty = pty
    }

    /// Called on the reader's serial queue only.
    func scan(_ data: Data) -> [Event] {
        var events: [Event] = []
        for seq in scanner.scan(data) {
            if seq.payload == "?" {
                probed = true
                pty.write(OSC7501.probeReply)
                events.append(.probed)
            } else if probed, let report = OSC7501.parse(seq.payload) {
                events.append(.report(report))
            }
        }
        return events
    }
}

enum Shell {
    static let current: String = {
        if let s = ProcessInfo.processInfo.environment["SHELL"], FileManager.default.isExecutableFile(atPath: s) { return s }
        if let pw = getpwuid(getuid()), let sh = pw.pointee.pw_shell { return String(cString: sh) }
        return "/bin/zsh"
    }()

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
        env["TEZGAH_APP"] = "native-prototype"
        // Launched from Finder, an app's PATH is minimal; the login shell rebuilds it.
        if env["PATH"] == nil { env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin" }
        if env["HOME"] == nil { env["HOME"] = NSHomeDirectory() }
        if env["USER"] == nil { env["USER"] = NSUserName() }
        if env["SHELL"] == nil { env["SHELL"] = current }
        return env
    }
}
