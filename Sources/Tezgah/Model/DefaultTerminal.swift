import AppKit
import UniformTypeIdentifiers

/// Making Tezgah the terminal macOS opens: shell scripts (.command, .sh, executables) and ssh:// links.
enum DefaultTerminal {
    static let types: [UTType] = [UTType("com.apple.terminal.shell-script"), .unixExecutable].compactMap { $0 }

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
    func handleOpen(_ url: URL) {
        if url.scheme == "ssh" {
            var target = url.host ?? ""
            if let user = url.user { target = "\(user)@\(target)" }
            let port = url.port.map { " -p \($0)" } ?? ""
            _ = newSession(projectId: nil, command: "ssh\(port) \(shellQuoted(target))")
            return
        }
        guard url.isFileURL else { return }
        var isDir: ObjCBool = false
        FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        if isDir.boolValue {
            let p = addProject(path: url.path)
            openProject(p.id)
        } else {
            let folder = url.deletingLastPathComponent().path
            let project = projects.first { folder.hasPrefix($0.path) }
            let s = newSession(projectId: project?.id, command: "cd \(shellQuoted(folder)) && \(shellQuoted(url.path))")
            _ = s
        }
    }
}
