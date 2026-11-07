import AppKit
import SwiftUI
import TezgahCore

/// Where the first run stands. Saved, so reopening after a permission grant lands on the same page.
@Observable
final class Onboarding {
    static let pages = 5
    var step: Int { didSet { UserDefaults.standard.set(step, forKey: "onboarding.step") } }
    var forward = true
    @ObservationIgnored var onFinish: () -> Void = {}

    static var isDone: Bool { UserDefaults.standard.bool(forKey: "onboarding.done") }

    init() { step = min(UserDefaults.standard.integer(forKey: "onboarding.step"), Self.pages - 1) }

    func next() {
        forward = true
        if step < Self.pages - 1 { step += 1 } else { finish() }
    }

    func back() {
        forward = false
        if step > 0 { step -= 1 }
    }

    func finish() {
        UserDefaults.standard.set(true, forKey: "onboarding.done")
        UserDefaults.standard.removeObject(forKey: "onboarding.step")
        onFinish()
    }
}

/// The first-run window: five pages under the sky. The horizon drops after the first page and rises
/// again on the last; the bench always stands on it.
struct OnboardingView: View {
    static let size = CGSize(width: 880, height: 600)
    @Environment(Onboarding.self) private var flow
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            look.base
            Group {
                switch flow.step {
                case 0: WelcomePage()
                case 1: AppearancePage()
                case 2: PermissionsPage()
                case 3: AgentsPage()
                default: ReadyPage()
                }
            }
            .id(flow.step)
            .transition(reduceMotion ? .opacity : .asymmetric(
                insertion: .offset(x: flow.forward ? Motion.pageOffset : -Motion.pageOffset).combined(with: .opacity),
                removal: .opacity))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(.timingCurve(0.2, 0, 0, 1, duration: Motion.page), value: flow.step)
        .ignoresSafeArea()
    }
}

/// A page: sky down to `horizon`, squared paper below, the bench on the horizon (centred or at the left).
private struct Page<Content: View>: View {
    var horizon: Double
    var bench: Double
    var centred = false
    @ViewBuilder var content: Content
    @Environment(\.look) private var look

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                SkyView().frame(height: horizon)
                PaperGrid().background(look.base)
            }
            TezgahMark(width: bench, color: .white, blinking: true)
                .frame(maxWidth: .infinity, alignment: centred ? .center : .leading)
                .padding(.leading, centred ? 0 : Grid.Space.s12)
                .frame(height: horizon, alignment: .bottom)
            content
        }
    }
}

private struct StepDots: View {
    let step: Int
    @Environment(\.look) private var look
    var body: some View {
        HStack(spacing: 6) {
            ForEach(0 ..< Onboarding.pages, id: \.self) { i in
                Capsule().fill(i <= step ? look.accent : look.line).frame(width: i == step ? 18 : 6, height: 6)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Step \(step + 1) of \(Onboarding.pages)"))
    }
}

private struct Heading: View {
    let title: LocalizedStringKey
    let text: LocalizedStringKey
    var centred = false
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: centred ? .center : .leading, spacing: 6) {
            Text(title).type(.title2, .semibold).foregroundStyle(look.ink).accessibilityAddTraits(.isHeader)
            Text(text).type(.body).foregroundStyle(look.muted).fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(centred ? .center : .leading)
        }
    }
}

/// Dots on the left, Back and Continue on the right.
private struct Footer: View {
    var primary: LocalizedStringKey = "Continue"
    var showBack = true
    @Environment(Onboarding.self) private var flow

    var body: some View {
        HStack {
            StepDots(step: flow.step)
            Spacer()
            if showBack {
                Button("Back") { flow.back() }.buttonStyle(TZButtonStyle(kind: .plain)).keyboardShortcut(.cancelAction)
            }
            Button(primary) { flow.next() }.buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, Grid.Space.s12)
        .padding(.bottom, 28)
        .frame(maxHeight: .infinity, alignment: .bottom)
    }
}

// MARK: - 01 Welcome

private struct WelcomePage: View {
    @Environment(Onboarding.self) private var flow
    @Environment(\.look) private var look

    var body: some View {
        Page(horizon: 300, bench: 132, centred: true) {
            VStack(spacing: 0) {
                Spacer().frame(height: 300 + 40)
                Text("Welcome to Tezgah").type(.title1, .semibold).foregroundStyle(look.ink).accessibilityAddTraits(.isHeader)
                Text("Run your coding agents from one window and see at once which one is waiting for you.")
                    .type(.lead).foregroundStyle(look.muted).multilineTextAlignment(.center)
                    .frame(maxWidth: 440).padding(.top, 8)
                HStack(spacing: 10) {
                    Button("Start") { flow.next() }.buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
                    Button("Skip Setup") { flow.finish() }.buttonStyle(TZButtonStyle())
                }
                .padding(.top, 24)
                Spacer()
                StepDots(step: 0).padding(.bottom, 30)
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - 02 Appearance

private struct AppearancePage: View {
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look
    @AppStorage("terminal.fontSize") private var fontSize = 13.0

    private let lightThemes = ["kagit", "talas", "cini", "sis"]
    private let darkThemes = ["gece", "lacivert", "ceviz", "gurup"]

    var body: some View {
        @Bindable var appearance = appearance
        Page(horizon: 120, bench: 64) {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 120 + 28)
                Heading(title: "How should it look?", text: "The app's mode and the terminal's theme. All of it can change later in Settings.")
                Text("App").type(.body, .medium).foregroundStyle(look.ink).padding(.top, 22)
                HStack(spacing: 16) {
                    ModeCard(mode: .light, selected: appearance.mode == .light) { appearance.mode = .light }
                    ModeCard(mode: .dark, selected: appearance.mode == .dark) { appearance.mode = .dark }
                    ModeCard(mode: .system, selected: appearance.mode == .system) { appearance.mode = .system }
                }
                .padding(.top, 8)
                Text("Terminal").type(.body, .medium).foregroundStyle(look.ink).padding(.top, 20)
                HStack(spacing: 10) {
                    ForEach(lightThemes + darkThemes, id: \.self) { id in
                        if let t = Themes.theme(id) {
                            ThemeChip(theme: t, selected: (t.isDark ? appearance.darkTheme : appearance.lightTheme) == id && t.isDark == look.dark) {
                                if t.isDark { appearance.darkTheme = id } else { appearance.lightTheme = id }
                            }
                        }
                    }
                }
                .padding(.top, 8)
                HStack(spacing: 14) {
                    Text("Text size").type(.body, .medium).foregroundStyle(look.ink)
                    Picker("Text size", selection: $fontSize) {
                        ForEach([12.0, 13, 14, 16], id: \.self) { Text("\(Int($0))").tag($0) }
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                    Text("Projects strip").type(.body, .medium).foregroundStyle(look.ink).padding(.leading, 12)
                    Picker("Projects strip", selection: $appearance.navPosition) {
                        ForEach(NavPosition.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                }
                .padding(.top, 22)
            }
            .padding(.horizontal, Grid.Space.s12)
            Footer()
        }
    }
}

/// A tiny window in light, dark or both.
private struct ModeCard: View {
    let mode: Appearance.Mode
    let selected: Bool
    let action: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                preview
                    .frame(width: 112, height: 70)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(selected ? look.accent : look.line, lineWidth: selected ? 2 : 1))
                    .background(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(selected ? look.focusRing : .clear, lineWidth: 3).padding(-2))
                Text(name).type(.small, selected ? .medium : .regular).foregroundStyle(selected ? look.accent : look.muted)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var name: LocalizedStringKey {
        switch mode { case .light: "Light"; case .dark: "Dark"; case .system: "System" }
    }

    @ViewBuilder private var preview: some View {
        switch mode {
        case .light: mini(.day)
        case .dark: mini(.night)
        case .system:
            HStack(spacing: 0) { mini(.day); mini(.night) }
        }
    }

    private func mini(_ c: ChromePalette) -> some View {
        HStack(spacing: 0) {
            Color(c.bar).frame(width: mode == .system ? 14 : 28)
            VStack(alignment: .leading, spacing: 5) {
                Capsule().fill(Color(c.line)).frame(width: 40, height: 5)
                Capsule().fill(Color(c.blue)).frame(width: 26, height: 5)
            }
            .padding(8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(c.paper))
        }
    }
}

private struct ThemeChip: View {
    let theme: ThemeSpec
    let selected: Bool
    let action: () -> Void
    @Environment(\.look) private var look
    private var themeName: String { Locale.current.language.languageCode?.identifier == "tr" ? theme.nameTR : theme.nameEN }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 5) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("~ ❯ claude").foregroundStyle(Color(theme.foreground))
                    Text("…").foregroundStyle(Color(theme.muted))
                }
                .font(Typeface.mono(10))
                .padding(.horizontal, 7)
                .frame(width: 80, height: 42, alignment: .leading)
                .background(Color(theme.background), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(selected ? look.accent : look.line, lineWidth: selected ? 2 : 1))
                Text(themeName).type(.small, selected ? .medium : .regular).foregroundStyle(selected ? look.accent : look.muted)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(themeName))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - 03 Permissions

private struct PermissionsPage: View {
    @Environment(Permissions.self) private var permissions
    @Environment(Onboarding.self) private var flow
    @Environment(\.look) private var look

    var body: some View {
        let allGranted = permissions.notifications == .granted && permissions.screenRecording == .granted && permissions.finderAction == .granted
        Page(horizon: 112, bench: 52) {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 112 + 22)
                Heading(title: "A few permissions", text: "Click one and System Settings opens on its page, on the left.")
                VStack(spacing: 8) {
                    PermissionCard(title: "Notifications", detail: "Tells you when an agent waits for you",
                                   state: permissions.notifications) { permissions.requestNotifications() }
                    PermissionCard(title: "Screen Recording", detail: "To show simulators and windows in a pane",
                                   state: permissions.screenRecording) { permissions.openScreenRecordingSettings(); WindowPlacement.makeRoomForSettings() }
                    PermissionCard(title: "“Open in Tezgah” in Finder", detail: "When you right-click a folder",
                                   state: permissions.finderAction) { permissions.installFinderAction() }
                }
                .padding(.top, 16)
                if permissions.screenRecording != .granted { DragAppIcon().padding(.top, 10) }
            }
            .padding(.horizontal, 32)
            Footer(primary: allGranted ? "Continue" : "Later").padding(.horizontal, -16)
        }
        .onAppear {
            permissions.startWatching()
            WindowPlacement.narrowToRight()
        }
        .onDisappear {
            permissions.stopWatching()
            WindowPlacement.restoreOnboarding()
        }
        .onChange(of: allGranted) { _, now in
            if now { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { if flow.step == 2 { flow.next() } } }
        }
    }
}

private struct PermissionCard: View {
    let title: LocalizedStringKey
    let detail: LocalizedStringKey
    let state: Permissions.State
    let action: () -> Void
    @Environment(\.look) private var look
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).type(.body, .medium).foregroundStyle(look.ink)
                    Text(detail).type(.small).foregroundStyle(look.muted)
                }
                Spacer(minLength: 8)
                trailing
            }
            .padding(.horizontal, 14)
            .frame(height: 54)
            .background(active ? look.selected : look.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(active ? look.selectedEdge : hover ? look.muted.opacity(0.4) : look.line))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityValue(Text(stateText))
    }

    private var active: Bool { state == .needsRelaunch }

    @ViewBuilder private var trailing: some View {
        switch state {
        case .granted:
            HStack(spacing: 5) { DoneCheck(size: 13); Text("Granted").type(.small, .medium) }.foregroundStyle(look.done)
        case .needsRelaunch:
            Button("Reopen Tezgah") { Relauncher.relaunch() }.buttonStyle(TZButtonStyle(kind: .primary, small: true))
        case .denied:
            Text("Turned off").type(.small).foregroundStyle(look.failed)
        case .unknown:
            Text("Open").type(.small, .medium).foregroundStyle(look.ink)
        }
    }

    private var stateText: LocalizedStringKey {
        switch state {
        case .granted: "granted"
        case .needsRelaunch: "granted, reopen Tezgah to apply"
        case .denied: "turned off"
        case .unknown: "not yet"
        }
    }
}

/// The app's own icon, draggable into System Settings' list.
private struct DragAppIcon: View {
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 12) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable().frame(width: 36, height: 36)
                .onDrag { NSItemProvider(contentsOf: Bundle.main.bundleURL) ?? NSItemProvider() }
                .accessibilityLabel(Text("Tezgah app icon, drag it into the list"))
            VStack(alignment: .leading, spacing: 0) {
                Text("Hold the icon, drop it in the list").type(.body, .medium).foregroundStyle(look.ink)
                Text("Screen & System Audio Recording · open Tezgah").type(.small).foregroundStyle(look.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .frame(height: 56)
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(look.line, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
    }
}

enum WindowPlacement {
    static var onboardingWindow: NSWindow? { NSApp.windows.first { $0.contentViewController is NSHostingController<AnyView> || $0.title == NSLocalizedString("Welcome to Tezgah", comment: "window") } }

    /// On the permissions page the first-run window narrows to the right half, so System Settings has the left.
    static func narrowToRight() {
        guard let w = onboardingWindow, let screen = w.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let width = 460.0, height = w.frame.height
        let x = area.midX + max(Grid.Space.s6, (area.width / 2 - width) / 2)
        w.setFrame(NSRect(x: min(x, area.maxX - width - Grid.Space.s6), y: area.midY - height / 2, width: width, height: height),
                   display: true, animate: true)
    }

    static func restoreOnboarding() {
        guard let w = onboardingWindow, let screen = w.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let size = NSSize(width: OnboardingView.size.width, height: w.frame.height)
        w.setFrame(NSRect(x: area.midX - size.width / 2, y: area.midY - size.height / 2, width: size.width, height: size.height),
                   display: true, animate: true)
    }

    /// Before System Settings opens: make sure Tezgah sits on the right.
    static func makeRoomForSettings() { narrowToRight() }
}

// MARK: - 04 Agents

private struct AgentsPage: View {
    @Environment(\.look) private var look
    @State private var found: [AgentDetector.Found]?

    var body: some View {
        Page(horizon: 120, bench: 64) {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 120 + 28)
                Heading(title: title, text: "Turn on notifications and Tezgah tells you when an agent waits for you or finishes. It adds a small hook; nothing else in the agent changes.")
                VStack(spacing: 8) {
                    if let found {
                        ForEach(found) { AgentRow(found: $0) }
                        ForEach(AgentKind.allCases.filter { k in !found.contains { $0.kind == k } }) { MissingAgentRow(kind: $0) }
                    } else {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 80)
                    }
                }
                .padding(.top, 18)
                Text("Install types the official command into a new tab; you press Enter.")
                    .type(.small).foregroundStyle(look.muted).padding(.top, 8)
            }
            .padding(.horizontal, Grid.Space.s12)
            Footer()
        }
        .task { found = await AgentDetector.detect() }
    }

    private var title: LocalizedStringKey {
        switch found?.count {
        case nil: "Looking for agents"
        case 0?: "No agents yet"
        default: "We found your agents"
        }
    }
}

private struct AgentRow: View {
    let found: AgentDetector.Found
    @Environment(\.look) private var look
    @AppStorage private var reports: Bool

    init(found: AgentDetector.Found) {
        self.found = found
        _reports = AppStorage(wrappedValue: true, "agents.report.\(found.kind.rawValue)")
    }

    var body: some View {
        HStack(spacing: 12) {
            AgentLogo(kind: found.kind, size: 20)
            VStack(alignment: .leading, spacing: 0) {
                Text(found.kind.name).type(.body, .medium).foregroundStyle(look.ink)
                HStack(spacing: 8) {
                    Text(found.kind.command).type(.small, mono: true).foregroundStyle(look.muted)
                    if let v = found.version { Text(v).type(.small).foregroundStyle(look.faint) }
                }
            }
            Spacer()
            Text("Notifications").type(.small).foregroundStyle(look.muted)
            Toggle("Notifications", isOn: $reports).toggleStyle(.switch).controlSize(.small).labelsHidden().tint(look.accent)
                .onChange(of: reports) { AgentHooks.install() }
        }
        .padding(.horizontal, 14)
        .frame(height: 52)
        .background(look.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(look.line))
    }
}

private struct MissingAgentRow: View {
    let kind: AgentKind
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    var body: some View {
        HStack(spacing: 12) {
            AgentLogo(kind: kind, size: 20).opacity(0.55)
            VStack(alignment: .leading, spacing: 0) {
                Text(kind.name).type(.body, .medium).foregroundStyle(look.soft)
                HStack(spacing: 8) {
                    Text(kind.command).type(.small, mono: true).foregroundStyle(look.muted)
                    Text("not installed").type(.small).foregroundStyle(look.faint)
                }
            }
            Spacer()
            Button("Website") { NSWorkspace.shared.open(AgentCatalog.site(kind)) }.buttonStyle(TZButtonStyle(kind: .plain, small: true))
            Button("Install") { store.typeInstallCommand(for: kind) }.buttonStyle(TZButtonStyle(small: true))
        }
        .padding(.horizontal, 14)
        .frame(height: 52)
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(look.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

// MARK: - 05 Ready

private struct ReadyPage: View {
    @Environment(Onboarding.self) private var flow
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @State private var folders: [URL] = []

    var body: some View {
        Page(horizon: 200, bench: 88, centred: true) {
            VStack(spacing: 0) {
                Spacer().frame(height: 200 + 30)
                Heading(title: "You're ready", text: "Open a project folder and start your first agent.", centred: true)
                HStack(spacing: 8) {
                    Button { flow.finish(); AppActions.openFolder() } label: {
                        HStack(spacing: 8) { Text("Open Project"); Text("⌘O").type(.caption).opacity(0.6) }
                    }
                    .buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
                    Button("Empty Terminal") { flow.finish(); _ = store.newSession(projectId: nil) }.buttonStyle(TZButtonStyle())
                }
                .padding(.top, 18)
                if !folders.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Recent folders").type(.small, .medium).foregroundStyle(look.muted).padding(.leading, 10).padding(.bottom, 4)
                        ForEach(Array(folders.prefix(3).enumerated()), id: \.offset) { _, url in
                            FolderRow(url: url) { open(url) }
                        }
                    }
                    .frame(width: 420)
                    .padding(.top, 22)
                }
                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
        .task { folders = RecentFolders.find() }
    }

    private func open(_ url: URL) {
        let p = store.addProject(path: url.path)
        flow.finish()
        store.openProject(p.id)
    }
}

private struct FolderRow: View {
    let url: URL
    let action: () -> Void
    @Environment(\.look) private var look
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "folder").font(.system(size: 13)).foregroundStyle(hover ? look.accent : look.muted)
                Text(url.lastPathComponent).type(.body, .medium).foregroundStyle(look.ink)
                Text(Paths.tilde(url.deletingLastPathComponent().path)).type(.small).foregroundStyle(look.faint)
                Spacer()
                if hover { Text("↩").type(.small).foregroundStyle(look.faint) }
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(hover ? look.selected : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// Git folders the user touched lately, in the usual places, for the last first-run page.
enum RecentFolders {
    static func find() -> [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let roots = ["Project", "Projects", "Projeler", "Developer", "Code", "src", "GitHub"].map { home.appendingPathComponent($0) }
        var found: [(URL, Date)] = []
        for root in roots {
            guard let items = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey],
                                                                            options: .skipsHiddenFiles) else { continue }
            for url in items where FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path) {
                let date = (try? url.appendingPathComponent(".git").resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                found.append((url, date))
            }
        }
        return found.sorted { $0.1 > $1.1 }.map(\.0)
    }
}
