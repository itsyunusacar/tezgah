import AppKit
import Sparkle

/// Updates through Sparkle: signed (EdDSA) zips listed in an appcast on GitHub Releases. Development
/// builds never check, so they can't be replaced by a release.
@MainActor
final class Updates {
    static let shared = Updates()
    private var controller: SPUStandardUpdaterController?

    var enabled: Bool { FinderService.isRealBuild }

    func start() {
        guard enabled, controller == nil else { return }
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        applySettings()
    }

    func checkNow() {
        guard let controller else {
            AppActions.toast(String(localized: "Development builds don't update"))
            return
        }
        controller.checkForUpdates(nil)
    }

    func applySettings() {
        guard let updater = controller?.updater else { return }
        updater.automaticallyDownloadsUpdates = UserDefaults.standard.object(forKey: "updates.auto") as? Bool ?? true
    }
}
