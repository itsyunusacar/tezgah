import Foundation
import TezgahCore

/// workspace.json in ~/Library/Application Support/Tezgah Prototype, written atomically.
/// A file that is there but can't be read is never written over; the copy from the start
/// of the session is kept as workspace.json.bak.
final class Persistence {
    let directory: URL
    private var file: URL { directory.appendingPathComponent("workspace.json") }
    private var blocked = false
    private var backedUp = false

    init(directory: URL) {
        self.directory = directory
    }

    static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Tezgah Dev", isDirectory: true)
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
            blocked = true
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
