import Foundation
import TezgahCore

/// workspace.json in ~/Library/Application Support/Tezgah Dev (or `--workspace <dir>`), written atomically.
/// A file that is there but can't be read is never written over; the copy from the start
/// of the session is kept as workspace.json.bak.
final class Persistence {
    let directory: URL
    private var file: URL { directory.appendingPathComponent("workspace.json") }
    /// The file is there but couldn't be read. Nothing is saved over it until `startFresh()`.
    private(set) var unreadable = false
    private var blocked: Bool { unreadable }
    private var backedUp = false
    var fileURL: URL { file }

    init(directory: URL) {
        self.directory = directory
    }

    /// Each build keeps its own: "Tezgah Dev" for the debug build; the release build's folder is "Tezgah",
    /// where Tezgah 0.1 keeps its workspace.json too, so this one lives in a folder of its own inside it.
    static var defaultDirectory: URL {
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Tezgah"
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(name, isDirectory: true)
        return name == "Tezgah" ? base.appendingPathComponent("mac", isDirectory: true) : base
    }

    /// Sets the unreadable file aside under another name (it is kept) so saving can begin again.
    func startFresh() {
        let stamp = Date().formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false)).replacingOccurrences(of: ":", with: "")
        try? FileManager.default.moveItem(at: file, to: directory.appendingPathComponent("workspace-unreadable-\(stamp).json"))
        unreadable = false
    }

    func load() -> WorkspaceFile? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        do {
            let data = try Data(contentsOf: file)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(WorkspaceFile.self, from: data)
        } catch {
            NSLog("tezgah: workspace.json can't be read (%@); not saving over it", "\(error)")
            unreadable = true
            return nil
        }
    }

    func save(_ workspace: WorkspaceFile) {
        guard !blocked else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if !backedUp, FileManager.default.fileExists(atPath: file.path) {
                let bak = directory.appendingPathComponent("workspace.json.bak")
                try? FileManager.default.removeItem(at: bak)
                try? FileManager.default.copyItem(at: file, to: bak)
                backedUp = true
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(workspace).write(to: file, options: .atomic)
        } catch {
            NSLog("tezgah: can't save workspace.json: %@", "\(error)")
        }
    }
}
