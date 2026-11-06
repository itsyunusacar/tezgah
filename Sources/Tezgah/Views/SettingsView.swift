import AppKit
import SwiftUI
import TezgahCore

/// Settings: a searchable window with eleven sections, in the app's own look.
struct SettingsView: View {
    @Environment(\.look) private var look
    @State private var section: Section = {
        let s = Section(rawValue: UserDefaults.standard.string(forKey: "settings.section") ?? "") ?? .appearance
        UserDefaults.standard.removeObject(forKey: "settings.section")
        return s
    }()
    @State private var query = ""

    enum Section: String, CaseIterable, Identifiable {
        case general, appearance, terminal, panes, agents, notifications, keyboard, accessibility, privacy, updates, advanced
        var id: String { rawValue }

        var title: LocalizedStringKey {
            switch self {
            case .general: "General"
            case .appearance: "Appearance"
            case .terminal: "Terminal"
            case .panes: "Panes"
            case .agents: "Agents"
            case .notifications: "Notifications"
            case .keyboard: "Keyboard"
            case .accessibility: "Accessibility"
            case .privacy: "Privacy & Permissions"
            case .updates: "Updates"
            case .advanced: "Advanced"
            }
        }

        var symbol: String {
            switch self {
            case .general: "gearshape"
            case .appearance: "circle.lefthalf.filled"
            case .terminal: "terminal"
            case .panes: "rectangle.split.2x1"
            case .agents: "sparkle"
            case .notifications: "bell"
            case .keyboard: "keyboard"
            case .accessibility: "accessibility"
            case .privacy: "hand.raised"
            case .updates: "arrow.triangle.2.circlepath"
            case .advanced: "chevron.left.forwardslash.chevron.right"
            }
        }

        /// Words a search finds this section by.
        var keywords: String {
            switch self {
            case .general: "language dil startup açılış shell kabuk folder klasör default terminal varsayılan finder"
            case .appearance: "theme tema dark karanlık light aydınlık accent vurgu navigation gezinme position konum"
            case .terminal: "font yazı size boyut cursor imleç blink ligature copy kopyala"
            case .panes: "split böl focus odak border kenarlık"
            case .agents: "claude codex antigravity grok hooks report durum"
            case .notifications: "notification bildirim sound ses badge rozet"
            case .keyboard: "shortcut kısayol keys tuş"
            case .accessibility: "motion hareket contrast kontrast voiceover"
            case .privacy: "permission izin screen ekran recording kayıt debug hata"
            case .updates: "update güncelleme version sürüm beta"
            case .advanced: "reset sıfırla folder klasör onboarding kurulum"
            }
        }
    }

    private var visible: [Section] {
        guard !query.isEmpty else { return Section.allCases }
        return Section.allCases.filter { CommandPalette.matches(String(localized: String.LocalizationValue($0.rawValue)) + " " + $0.keywords, query) }
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Spacer().frame(height: 28)
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(look.muted)
                    TextField("Search settings", text: $query).textFieldStyle(.plain).font(Typeface.sans(13))
                }
                .padding(.horizontal, 10).frame(height: 30)
                .background(look.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                VStack(spacing: 2) {
                    ForEach(visible) { s in
                        Button { section = s } label: {
                            HStack(spacing: 10) {
                                Image(systemName: s.symbol).font(.system(size: 13)).frame(width: 18)
                                Text(s.title).type(.body, section == s ? .medium : .regular)
                                Spacer()
                            }
                            .foregroundStyle(section == s ? look.ink : look.soft)
                            .padding(.horizontal, 8).frame(height: 30)
                            .background {
                                if section == s {
                                    RoundedRectangle(cornerRadius: 7).fill(look.raised)
                                        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(look.line))
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer()
                HStack(spacing: 8) {
                    TezgahMark(width: 14, color: look.faint)
                    Text("Tezgah \(Bundle.main.shortVersion) beta").type(.caption, mono: true).foregroundStyle(look.faint)
                }
                .padding(.horizontal, 8)
            }
            .padding(.horizontal, 12).padding(.bottom, 16)
            .frame(width: 232)

            VStack(alignment: .leading, spacing: 0) {
                Text(section.title).type(.lead, .semibold).foregroundStyle(look.ink).frame(height: 52).padding(.horizontal, 32)
                ScrollView {
                    VStack(alignment: .leading, spacing: Grid.Space.s6) { content }
                        .padding(.horizontal, 32).padding(.bottom, 32)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(look.base)
        .ignoresSafeArea()
        .onChange(of: query) { if let first = visible.first, !visible.contains(section) { section = first } }
    }

    @ViewBuilder private var content: some View {
        switch section {
        case .general: GeneralSettings()
        case .appearance: AppearanceSettings()
        case .terminal: TerminalSettingsView()
        case .panes: PaneSettings()
        case .agents: AgentSettings()
        case .notifications: NotificationSettings()
        case .keyboard: KeyboardSettings()
        case .accessibility: AccessibilitySettings()
        case .privacy: PrivacySettings()
        case .updates: UpdateSettings()
        case .advanced: AdvancedSettings()
        }
    }
}

extension Bundle {
    var shortVersion: String { object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0" }
}

// MARK: - Building blocks

struct SettingsGroup<Content: View>: View {
    let title: LocalizedStringKey
    var note: LocalizedStringKey? = nil
    @ViewBuilder var content: Content
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).type(.body, .semibold).foregroundStyle(look.ink).padding(.horizontal, 4)
            VStack(spacing: 0) { content }
                .background(look.raised, in: RoundedRectangle(cornerRadius: Grid.Radius.card))
                .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(look.line))
            if let note { Text(note).type(.caption).foregroundStyle(look.muted).padding(.horizontal, 4) }
        }
    }
}

struct SettingsRow<Control: View>: View {
    let title: LocalizedStringKey
    var detail: LocalizedStringKey? = nil
    var last = false
    @ViewBuilder var control: Control
    @Environment(\.look) private var look

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).type(.body).foregroundStyle(look.ink)
                    if let detail { Text(detail).type(.caption).foregroundStyle(look.muted) }
                }
                Spacer(minLength: 12)
                control
            }
            .padding(.horizontal, 16).padding(.vertical, 10).frame(minHeight: 52)
            if !last { Rectangle().fill(look.line.opacity(0.6)).frame(height: 1).padding(.leading, 16) }
        }
    }
}

private struct Switch: View {
    let key: String
    var initial = true
    var onChange: () -> Void = {}
    @AppStorage private var value: Bool
    @Environment(\.look) private var look

    init(_ key: String, initial: Bool = true, onChange: @escaping () -> Void = {}) {
        self.key = key
        self.initial = initial
        self.onChange = onChange
        _value = AppStorage(wrappedValue: initial, key)
    }

    var body: some View {
        Toggle("", isOn: $value).toggleStyle(.switch).labelsHidden().controlSize(.small).tint(look.ink)
            .onChange(of: value) { onChange() }
    }
}

// MARK: - Sections

private struct AppearanceSettings: View {
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look

    var body: some View {
        @Bindable var a = appearance
        SettingsGroup(title: "Theme") {
            SettingsRow(title: "Appearance") {
                Picker("", selection: $a.mode) {
                    Text("Light").tag(Appearance.Mode.light)
                    Text("Dark").tag(Appearance.Mode.dark)
                    Text("System").tag(Appearance.Mode.system)
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            ThemeGallery(kind: .light, selection: $a.lightTheme)
            SettingsRow(title: "Separate theme for dark mode", detail: "When the system turns dark, the dark theme below is used") {
                Toggle("", isOn: $a.separateDarkTheme).toggleStyle(.switch).labelsHidden().controlSize(.small).tint(look.ink)
            }
            if a.separateDarkTheme { ThemeGallery(kind: .dark, selection: $a.darkTheme) }
            SettingsRow(title: "Accent colour", detail: "Buttons, selection and focus rings. System follows macOS.", last: true) {
                HStack(spacing: 10) {
                    ForEach(AccentSpec.all) { acc in
                        Button { a.accent = acc.id } label: {
                            Circle()
                                .fill(acc.color.map { AnyShapeStyle(Color($0)) } ?? AnyShapeStyle(AngularGradient(colors: [.blue, .purple, .red, .orange, .green, .blue], center: .center)))
                                .frame(width: 20, height: 20)
                                .overlay(Circle().strokeBorder(Color.black.opacity(0.12)))
                                .padding(2)
                                .overlay(Circle().strokeBorder(a.accent == acc.id ? look.ink : .clear, lineWidth: 1.5))
                        }
                        .buttonStyle(.plain)
                        .help(Text(Locale.current.language.languageCode?.identifier == "tr" ? acc.nameTR : acc.nameEN))
                        .accessibilityLabel(Text(Locale.current.language.languageCode?.identifier == "tr" ? acc.nameTR : acc.nameEN))
                    }
                }
            }
        }
        SettingsGroup(title: "Layout") {
            SettingsRow(title: "Navigation position", detail: "The projects and sessions strip", last: true) {
                Picker("", selection: $a.navPosition) {
                    ForEach(NavPosition.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
        }
    }
}

/// Every theme of one kind as small terminal previews; ours have our own names.
private struct ThemeGallery: View {
    let kind: ThemeSpec.Kind
    @Binding var selection: String
    @Environment(\.look) private var look

    var body: some View {
        let themes = Themes.all.filter { $0.kind == kind }
        VStack(alignment: .leading, spacing: 8) {
            Text(kind == .light ? "Light themes" : "Dark themes").type(.caption, .medium).foregroundStyle(look.muted)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                ForEach(themes) { t in
                    Button { selection = t.id } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            VStack(alignment: .leading, spacing: 4) {
                                Capsule().fill(Color(t.foreground)).frame(width: 52, height: 4)
                                Capsule().fill(Color(t.green)).frame(width: 34, height: 4)
                                Capsule().fill(Color(t.blue)).frame(width: 44, height: 4)
                                HStack(spacing: 3) {
                                    ForEach([t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan], id: \.self) { c in
                                        RoundedRectangle(cornerRadius: 2).fill(Color(c)).frame(width: 9, height: 9)
                                    }
                                }
                                .padding(.top, 4)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
                            .background(Color(t.background), in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(selection == t.id ? look.ink : look.line, lineWidth: selection == t.id ? 2 : 1))
                            Text(Locale.current.language.languageCode?.identifier == "tr" ? t.nameTR : t.nameEN)
                                .type(.caption, selection == t.id ? .semibold : .regular).foregroundStyle(look.ink)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selection == t.id ? .isSelected : [])
                }
            }
        }
        .padding(16)
        .overlay(alignment: .bottom) { Rectangle().fill(look.line.opacity(0.6)).frame(height: 1).padding(.leading, 16) }
    }
}

private struct GeneralSettings: View {
    @Environment(\.look) private var look
    var body: some View {
        SettingsGroup(title: "Language and startup") {
            SettingsRow(title: "Language", detail: "Takes effect when Tezgah reopens") { LanguagePicker() }
            SettingsRow(title: "Restore the last workspace", detail: "Projects, sessions and panes as you left them", last: true) { Switch("general.restore") }
        }
        SettingsGroup(title: "With macOS") {
            SettingsRow(title: "“Open in Tezgah” in Finder", detail: "When you right-click a folder", last: true) {
                Switch("finder.enabled") { if UserDefaults.standard.bool(forKey: "finder.enabled") { FinderService.install() } }
            }
        }
    }
}

private struct TerminalSettingsView: View {
    @AppStorage("terminal.fontSize") private var fontSize = 13.0
    @AppStorage("terminal.cursor") private var cursor = "block"
    @Environment(Appearance.self) private var appearance

    var body: some View {
        SettingsGroup(title: "Text") {
            SettingsRow(title: "Font", detail: "Geist Mono") { EmptyView() }
            SettingsRow(title: "Size") {
                Stepper(value: $fontSize, in: 10 ... 24) { Text("\(Int(fontSize)) pt").type(.body, mono: true) }
                    .onChange(of: fontSize) { TerminalLook.apply(appearance) }
            }
            SettingsRow(title: "Ligatures", detail: "=> and != join into one sign", last: true) {
                Switch("terminal.ligatures") { TerminalLook.apply(appearance) }
            }
        }
        SettingsGroup(title: "Cursor") {
            SettingsRow(title: "Shape") {
                Picker("", selection: $cursor) {
                    Text("Block").tag("block"); Text("Bar").tag("bar"); Text("Underline").tag("underline")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                .onChange(of: cursor) { TerminalLook.apply(appearance) }
            }
            SettingsRow(title: "Blink", detail: "Stops when Reduce Motion is on", last: true) { Switch("terminal.blink") { TerminalLook.apply(appearance) } }
        }
        SettingsGroup(title: "Behaviour") {
            SettingsRow(title: "Copy on select", last: true) { Switch("terminal.copyOnSelect", initial: false) { TerminalLook.apply(appearance) } }
        }
    }
}

private struct PaneSettings: View {
    var body: some View {
        SettingsGroup(title: "Panes", note: "Rules that open panels by agent state, and floating panels, come in 0.2.") {
            SettingsRow(title: "Border on the focused pane") { Switch("panes.focusBorder") }
            SettingsRow(title: "Show pane headers", last: true) { Switch("panes.headers") }
        }
    }
}

private struct AgentSettings: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look

    var body: some View {
        SettingsGroup(title: "Agents on this Mac", note: "With Report status on, Tezgah starts the agent with a small hook for that run only; your agent's own settings are never changed.") {
            ForEach(Array(store.installedAgents.enumerated()), id: \.element.id) { i, a in
                SettingsRow(title: LocalizedStringKey(a.kind.name), detail: LocalizedStringKey([Paths.tilde(a.path), a.version].compactMap { $0 }.joined(separator: " · ")),
                            last: i == store.installedAgents.count - 1) {
                    HStack(spacing: 10) {
                        AgentLogo(kind: a.kind, size: 16)
                        Text("Report status").type(.caption).foregroundStyle(look.muted)
                        Switch("agents.report.\(a.kind.rawValue)") { AgentHooks.install() }
                    }
                }
            }
            if store.installedAgents.isEmpty {
                SettingsRow(title: "No agents found", detail: "Install one from the new session picker (⌘T)", last: true) { EmptyView() }
            }
        }
        .onAppear { store.refreshAgents() }
    }
}

private struct NotificationSettings: View {
    var body: some View {
        SettingsGroup(title: "By kind") {
            SettingsRow(title: "Waiting for you", detail: "Notification and sound") { Switch("notify.waiting") }
            SettingsRow(title: "Done", detail: "Notification, no sound") { Switch("notify.done") }
            SettingsRow(title: "Dock badge", detail: "How many agents wait for you", last: true) { Switch("notify.badge") }
        }
    }
}

private struct KeyboardSettings: View {
    @Environment(\.look) private var look
    private let rows: [(LocalizedStringKey, String)] = [
        ("New session", "⌘T"), ("New terminal", "⌘N"), ("Open folder", "⌘O"), ("Close session", "⌘W"),
        ("Split right", "⌘D"), ("Split down", "⇧⌘D"), ("Next pane", "⌘]"), ("Search everything", "⌘K"),
        ("Quick switch", "⌘P"), ("Home", "⇧⌘H"), ("Settings", "⌘,"),
    ]

    var body: some View {
        SettingsGroup(title: "Shortcuts", note: "Editing shortcuts comes in 0.3.") {
            ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                SettingsRow(title: r.0, last: i == rows.count - 1) {
                    Text(r.1).type(.body, .medium, mono: true).foregroundStyle(look.ink)
                        .padding(.horizontal, 8).frame(height: 24)
                        .background(look.base, in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(look.line))
                }
            }
        }
    }
}

private struct AccessibilitySettings: View {
    var body: some View {
        SettingsGroup(title: "Seeing", note: "Tezgah follows your system settings: Reduce Motion stops blinking and sliding; Increase Contrast darkens lines. States are never shown by colour alone.") {
            SettingsRow(title: "Reduce Motion", detail: "System Settings › Accessibility › Display") {
                Button("Open…") { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Accessibility-Settings.extension?Display")!) }
                    .buttonStyle(TZButtonStyle(small: true))
            }
            SettingsRow(title: "Announce state changes", detail: "VoiceOver reads “codex is waiting for you”", last: true) { Switch("a11y.announce") }
        }
    }
}

private struct PrivacySettings: View {
    @Environment(Permissions.self) private var permissions
    @Environment(\.look) private var look

    var body: some View {
        SettingsGroup(title: "Permissions", note: "Click one to open its page in System Settings.") {
            row("Notifications", permissions.notifications) { permissions.requestNotifications() }
            row("Screen Recording", permissions.screenRecording) { SystemSettings.open(.screenRecording) }
            row("“Open in Tezgah” in Finder", permissions.finderAction, last: true) { permissions.installFinderAction() }
        }
        .onAppear { permissions.refresh() }
        SettingsGroup(title: "Data") {
            SettingsRow(title: "Tezgah sends nothing anywhere", detail: "No analytics, no ads, no account") { EmptyView() }
            SettingsRow(title: "Reporting a problem", detail: "Version, macOS and recent errors; nothing personal", last: true) {
                Button("Copy Debug Info") {
                    let info = "Tezgah \(Bundle.main.shortVersion) · macOS \(ProcessInfo.processInfo.operatingSystemVersionString) · \(Bundle.main.bundleIdentifier ?? "")"
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(info, forType: .string)
                    AppActions.toast(String(localized: "Copied"))
                }
                .buttonStyle(TZButtonStyle(small: true))
            }
        }
    }

    private func row(_ title: LocalizedStringKey, _ state: Permissions.State, last: Bool = false, action: @escaping () -> Void) -> some View {
        SettingsRow(title: title, last: last) {
            if state == .granted {
                HStack(spacing: 6) { DoneCheck(size: 16); Text("Granted").type(.caption, .medium).foregroundStyle(look.done) }
            } else {
                Button("Give…", action: action).buttonStyle(TZButtonStyle(small: true))
            }
        }
    }
}

private struct UpdateSettings: View {
    @Environment(\.look) private var look
    var body: some View {
        HStack(spacing: 16) {
            TezgahMark(width: 40)
            VStack(alignment: .leading, spacing: 0) {
                Text("Tezgah \(Bundle.main.shortVersion) beta").type(.lead, .semibold).foregroundStyle(look.ink)
                Text("Updates arrive with the first public build.").type(.caption).foregroundStyle(look.muted)
            }
            Spacer()
        }
        .padding(16)
        .card(look)
        SettingsGroup(title: "Updates") {
            SettingsRow(title: "Download automatically") { Switch("updates.auto") }
            SettingsRow(title: "Install", detail: "Open terminals don't close", last: true) {
                Text("When you quit").type(.body).foregroundStyle(look.soft)
            }
        }
    }
}

private struct AdvancedSettings: View {
    @Environment(\.look) private var look
    var body: some View {
        SettingsGroup(title: "Files") {
            SettingsRow(title: "Settings and data folder", detail: LocalizedStringKey(Paths.tilde(Persistence.defaultDirectory.path))) {
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([Persistence.defaultDirectory]) }
                    .buttonStyle(TZButtonStyle(small: true))
            }
            SettingsRow(title: "Run the first-run setup again", detail: "Next time Tezgah opens", last: true) {
                Button("Reset") { UserDefaults.standard.set(false, forKey: "onboarding.done"); AppActions.toast(String(localized: "Setup will run next time")) }
                    .buttonStyle(TZButtonStyle(small: true))
            }
        }
    }
}

/// The app's own language, independent of the system's: Sistem, Türkçe or English.
private struct LanguagePicker: View {
    @State private var choice: String = {
        (UserDefaults.standard.persistentDomain(forName: Bundle.main.bundleIdentifier ?? "")?["AppleLanguages"] as? [String])?.first ?? "system"
    }()

    var body: some View {
        Picker("", selection: $choice) {
            Text("System").tag("system")
            Text("Türkçe").tag("tr")
            Text("English").tag("en")
        }
        .pickerStyle(.segmented).labelsHidden().fixedSize()
        .onChange(of: choice) {
            if choice == "system" {
                UserDefaults.standard.removeObject(forKey: "AppleLanguages")
            } else {
                UserDefaults.standard.set([choice], forKey: "AppleLanguages")
            }
            AppActions.toast(String(localized: "Takes effect when Tezgah reopens"))
        }
    }
}
