import AppKit
import UniformTypeIdentifiers

/// Making Tezgah the terminal macOS opens: shell scripts (.command, .sh, executables) and ssh:// links.
enum DefaultTerminal {
    static let types: [UTType] = [UTType("com.apple.terminal.shell-script"), UTType("public.shell-script"), .unixExecutable].compactMap { $0 }

    /// Default only when everything Make Default sets still points here.
    static var isDefault: Bool {
        let me = Bundle.main.bundleURL.standardizedFileURL
        let typesHere = types.allSatisfy { NSWorkspace.shared.urlForApplication(toOpen: $0)?.standardizedFileURL == me }
        let ssh = URL(string: "ssh://localhost").flatMap { NSWorkspace.shared.urlForApplication(toOpen: $0) }?.standardizedFileURL == me
        return typesHere && ssh
    }

    /// Development builds never take over the user's defaults.
    static var canChange: Bool { FinderService.isRealBuild }

    static func makeDefault() async {
        guard canChange else { return }
        let me = Bundle.main.bundleURL
        for t in types { try? await NSWorkspace.shared.setDefaultApplication(at: me, toOpen: t) }
        try? await NSWorkspace.shared.setDefaultApplication(at: me, toOpenURLsWithScheme: "ssh")
    }
}

extension AppStore {
    /// Something macOS handed to Tezgah: a folder opens as a project, a script runs in a new tab, ssh:// connects.
    /// What arrives is typed into a shell, so nothing with a control character in it (which would act as a key
    /// press: Ctrl-C, Return) is typed at all, and an ssh target can't pass itself off as an option.
    func handleOpen(_ url: URL) {
        func typeable(_ s: String) -> Bool { !s.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7f } }
        if url.scheme == "ssh" {
            let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_:[]%")
            guard let host = url.host, !host.isEmpty, !host.hasPrefix("-"), host.unicodeScalars.allSatisfy(allowed.contains),
                  url.user.map({ !$0.isEmpty && !$0.hasPrefix("-") && $0.unicodeScalars.allSatisfy(allowed.contains) }) ?? true else {
                AppActions.toast(String(localized: "That ssh link can't be opened"))
                return
            }
            let target = url.user.map { "\($0)@\(host)" } ?? host
            let port = url.port.map { " -p \($0)" } ?? ""
            _ = newSession(projectId: nil, command: "ssh\(port) -- \(shellQuoted(target))")
            return
        }
        guard url.isFileURL, typeable(url.path) else { return }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { return }
        if isDir.boolValue {
            let p = addProject(path: url.path)
            checkFolders()
            openProject(p.id)
        } else {
            let folder = url.deletingLastPathComponent().path
            // The project the file is in: its folder or one below it ("/app-v2" is not inside "/app"), the deepest one.
            let project = projects.filter { folder == $0.path || folder.hasPrefix($0.path + "/") }.max { $0.path.count < $1.path.count }
            // A script without its execute bit still runs.
            let run = FileManager.default.isExecutableFile(atPath: url.path) ? shellQuoted(url.path) : "/bin/sh \(shellQuoted(url.path))"
            _ = newSession(projectId: project?.id, command: "cd \(shellQuoted(folder)) && \(run)")
        }
    }
}
