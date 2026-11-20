import Darwin
import Foundation

/// A program on a pseudo-terminal Tezgah owns: its output is read here (so OSC 7501 can be
/// seen and answered) and handed to the Ghostty surface; keystrokes come back to `write`.
nonisolated final class PTYProcess: @unchecked Sendable {
    let pid: pid_t
    let fd: Int32
    let started = Date()

    private let readQueue: DispatchQueue
    private let writeQueue: DispatchQueue
    private var readSource: (any DispatchSourceRead)?
    private var exitSource: (any DispatchSourceProcess)?
    private let lock = NSLock()
    private var closed = false

    private init(pid: pid_t, fd: Int32, label: String) {
        self.pid = pid
        self.fd = fd
        readQueue = DispatchQueue(label: "tezgah.pty.read.\(label)", qos: .userInteractive)
        writeQueue = DispatchQueue(label: "tezgah.pty.write.\(label)", qos: .userInteractive)
    }

    struct SpawnError: Error, CustomStringConvertible {
        let errno: Int32
        var description: String { String(cString: strerror(errno)) }
    }

    static func spawn(path: String, args: [String], env: [String: String], cwd: String,
                      cols: UInt16 = 80, rows: UInt16 = 24, label: String) throws -> PTYProcess {
        let argv = ([path] + args).map { strdup($0) } + [nil]
        let envp = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer {
            argv.forEach { free($0) }
            envp.forEach { free($0) }
        }
        var master: Int32 = -1
        let pid = argv.withUnsafeBufferPointer { a in
            envp.withUnsafeBufferPointer { e in
                tz_pty_spawn(path, a.baseAddress, e.baseAddress, cwd, cols, rows, &master)
            }
        }
        guard pid > 0 else { throw SpawnError(errno: errno) }
        // Reads drain until EAGAIN; a stray grandchild holding the terminal must not block us.
        let flags = fcntl(master, F_GETFL)
        _ = fcntl(master, F_SETFL, flags | O_NONBLOCK)
        return PTYProcess(pid: pid, fd: master, label: label)
    }

    /// `onOutput` runs on the reader's serial queue, in order; `onExit` once, after the last output.
    func start(onOutput: @escaping @Sendable (Data) -> Void, onExit: @escaping @Sendable (Int32) -> Void) {
        let read = DispatchSource.makeReadSource(fileDescriptor: fd, queue: readQueue)
        read.setEventHandler { [weak self] in
            guard let self else { return }
            if self.drain(onOutput) { read.cancel() }
        }
        let exit = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: readQueue)
        exit.setEventHandler { [weak self] in
            guard let self else { return }
            // Only while the descriptor is still ours: once closed its number may belong to another pane.
            self.lock.lock()
            let open = !self.closed
            self.lock.unlock()
            if open { _ = self.drain(onOutput) }
            var status: Int32 = 0
            waitpid(self.pid, &status, 0)
            let code: Int32 = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
            exit.cancel()
            self.readSource?.cancel()
            onExit(code)
        }
        read.setCancelHandler { [self] in
            lock.lock()
            closed = true
            lock.unlock()
            // After any write already under way (writes run on this queue, one at a time) and never during
            // a resize: the descriptor's number can be handed to another pane the moment it is closed.
            writeQueue.async { [self] in
                lock.lock()
                close(fd)
                lock.unlock()
            }
        }
        readSource = read
        exitSource = exit
        read.resume()
        exit.resume()
    }

    /// Reads what's there. True at end of file.
    private func drain(_ onOutput: @Sendable (Data) -> Void) -> Bool {
        var buffer = [UInt8](repeating: 0, count: 65536)
        while true {
            let n = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if n > 0 {
                onOutput(Data(buffer[0..<n]))
                if n < buffer.count { return false }
            } else if n == 0 {
                return true
            } else {
                if errno == EINTR { continue }
                return errno != EAGAIN
            }
        }
    }

    func write(_ data: Data) {
        guard !data.isEmpty else { return }
        writeQueue.async { [self] in
            lock.lock()
            let isClosed = closed
            lock.unlock()
            if isClosed { return }
            data.withUnsafeBytes { raw in
                guard var p = raw.baseAddress else { return }
                var left = raw.count
                while left > 0 {
                    let n = Darwin.write(fd, p, left)
                    if n > 0 {
                        p += n
                        left -= n
                    } else if n < 0 && (errno == EAGAIN || errno == EINTR) {
                        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
                        _ = poll(&pfd, 1, 50)
                    } else {
                        return
                    }
                }
            }
        }
    }

    func write(_ bytes: [UInt8]) { write(Data(bytes)) }
    func write(_ text: String) { write(Data(text.utf8)) }

    func resize(cols: Int, rows: Int, widthPixels: Int = 0, heightPixels: Int = 0) {
        let c = UInt16(clamping: max(2, cols)), r = UInt16(clamping: max(2, rows))
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        _ = tz_pty_resize(fd, c, r, UInt16(clamping: widthPixels), UInt16(clamping: heightPixels))
    }

    enum Foreground: Equatable {
        /// The terminal couldn't say (a passing error): nothing is concluded from it.
        case unknown
        /// The shell is at its prompt.
        case shell
        /// A program other than the shell ("node", "vim", "claude").
        case program(String)
    }

    var foreground: Foreground {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return .unknown }
        let group = tz_pty_foreground(fd)
        guard group > 0 else { return .unknown }
        if group == pid { return .shell }
        return Self.name(of: group).map(Foreground.program) ?? .unknown
    }

    /// The shell's working directory.
    var shellDirectory: String? {
        var info = proc_vnodepathinfo()
        let size = Int32(MemoryLayout<proc_vnodepathinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return nil }
        return withUnsafePointer(to: &info.pvi_cdir.vip_path) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) { String(cString: $0) }
        }
    }

    static func name(of pid: pid_t) -> String? {
        var buf = [CChar](repeating: 0, count: 256)
        let n = proc_name(pid, &buf, UInt32(buf.count))
        guard n > 0 else { return nil }
        return String(decoding: buf.prefix(Int(n)).map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    /// Ends the program and everything it started on this terminal.
    func terminate() {
        lock.lock()
        let wasClosed = closed
        closed = true
        lock.unlock()
        guard !wasClosed else { return }
        let group = tz_pty_foreground(fd)
        if group > 0 { kill(-group, SIGHUP) }
        kill(-pid, SIGHUP)
        kill(pid, SIGHUP)
        readQueue.async { [self] in
            readSource?.cancel()
            // The exit source reaps the shell; give a stubborn one a moment, then insist.
            readQueue.asyncAfter(deadline: .now() + 2) { [self] in
                if kill(pid, 0) == 0 { kill(pid, SIGKILL) }
            }
        }
    }
}
