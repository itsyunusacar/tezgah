import Foundation
import TezgahCore

/// "Open in Tezgah" on folders in Finder: an Automator service in ~/Library/Services that runs
/// `open -a` with this copy of Tezgah (rewritten when the app moves). Ported from the Electron app.
/// Development builds only pretend, so they never touch the user's real Services.
enum FinderService {
    static var isRealBuild: Bool { Bundle.main.bundleIdentifier?.hasSuffix(".dev") == false }
    private static let devFlag = "finder.devInstalled"
    static var title: String { String(localized: "Open in Tezgah") }

    static var serviceURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Services/Open in Tezgah.workflow")
    }

    static var isInstalled: Bool {
        isRealBuild ? FileManager.default.fileExists(atPath: serviceURL.path) : UserDefaults.standard.bool(forKey: devFlag)
    }

    private static func xml(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func sh(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    private static func plist(_ body: String) -> String {
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n" + body + "\n</plist>\n"
    }

    static func info(title: String) -> String {
        plist("""
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>\(xml(title))</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.folder</string>
			</array>
		</dict>
	</array>
</dict>
""")
    }

    private static func arg(_ n: Int, _ name: String, _ value: String) -> String {
        """
				<key>\(n)</key>
				<dict>
					<key>default value</key>
					\(value)
					<key>name</key>
					<string>\(name)</string>
					<key>required</key>
					<string>0</string>
					<key>type</key>
					<string>0</string>
					<key>uuid</key>
					<string>\(n)</string>
				</dict>
"""
    }

    static func document(command: String) -> String {
        let finder = "/System/Library/CoreServices/Finder.app"
        let args = [arg(0, "inputMethod", "<integer>0</integer>"), arg(1, "CheckedForUserDefaultShell", "<false/>"),
                    arg(2, "source", "<string></string>"), arg(3, "COMMAND_STRING", "<string></string>"),
                    arg(4, "shell", "<string>/bin/sh</string>")].joined(separator: "\n")
        return plist("""
<dict>
	<key>AMApplicationBuild</key>
	<string>534</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>\(xml(command))</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>6B0C33E2-3F0E-4E57-9A5B-2B7E3A1C9D01</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>6B0C33E2-3F0E-4E57-9A5B-2B7E3A1C9D02</string>
				<key>UUID</key>
				<string>6B0C33E2-3F0E-4E57-9A5B-2B7E3A1C9D03</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
\(args)
				</dict>
				<key>conversionLabel</key>
				<integer>0</integer>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleID</key>
		<string>com.apple.finder</string>
		<key>applicationBundleIDsByPath</key>
		<dict>
			<key>\(finder)</key>
			<string>com.apple.finder</string>
		</dict>
		<key>applicationPath</key>
		<string>\(finder)</string>
		<key>applicationPaths</key>
		<array>
			<string>\(finder)</string>
		</array>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject.folder</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>\(finder)</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject.folder</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
""")
    }

    static func command(appPath: String, bundleId: String) -> String {
        "open -a \(sh(appPath)) \"$@\" || open -b \(sh(bundleId)) \"$@\""
    }

    static func install() {
        guard isRealBuild else {
            UserDefaults.standard.set(true, forKey: devFlag)
            return
        }
        let dir = serviceURL.appendingPathComponent("Contents")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let files = ["Info.plist": info(title: title),
                     "document.wflow": document(command: command(appPath: Bundle.main.bundlePath, bundleId: Bundle.main.bundleIdentifier ?? "dev.tezgah.app"))]
        for (name, text) in files {
            let url = dir.appendingPathComponent(name)
            if (try? String(contentsOf: url, encoding: .utf8)) != text { try? text.write(to: url, atomically: true, encoding: .utf8) }
        }
        enable()
    }

    static func remove() {
        guard isRealBuild else { UserDefaults.standard.set(false, forKey: devFlag); return }
        try? FileManager.default.removeItem(at: serviceURL)
        refresh()
    }

    /// A service macOS has no word on starts switched off in Finder's menu: switch it on once. One the user
    /// turned off in System Settings keeps its entry and is left alone.
    private static func enable() {
        let key = "(null) - \(title) - runWorkflowAsService"
        let export = run("/usr/bin/defaults", ["export", "pbs", "-"]) ?? ""
        if !export.contains("<key>\(xml(key))</key>") {
            _ = run("/usr/bin/defaults", ["write", "pbs", "NSServicesStatus", "-dict-add", key,
                                          "{ \"enabled_context_menu\" = 1; \"enabled_services_menu\" = 1; \"presentation_modes\" = { ContextMenu = 1; ServicesMenu = 1; FinderPreview = 1; TouchBar = 1; }; }"])
        }
        refresh()
    }

    private static func refresh() { _ = run("/System/Library/CoreServices/pbs", ["-update"]) }

    @discardableResult
    private static func run(_ path: String, _ args: [String]) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(decoding: data, as: UTF8.self)
    }
}
