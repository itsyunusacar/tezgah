import AppKit
import SwiftUI
import TezgahCore

// MARK: - Agents: install commands and where they live

/// The official ways to install each agent, checked by hand and shipped with the app (never fetched).
/// Install commands are typed into a new terminal tab and wait for Enter; Tezgah never runs them itself.
enum AgentCatalog {
    static func site(_ kind: AgentKind) -> URL {
        switch kind {
        case .claude: URL(string: "https://claude.com/claude-code")!
        case .codex: URL(string: "https://developers.openai.com/codex/cli")!
        case .antigravity: URL(string: "https://antigravity.google")!
        case .grok: URL(string: "https://x.ai/cli")!
        }
    }

    static func installCommand(_ kind: AgentKind) -> String {
        switch kind {
        case .claude: "curl -fsSL https://claude.ai/install.sh | bash"
        case .codex: hasBrew ? "brew install --cask codex" : "npm install -g @openai/codex"
        case .antigravity: "curl -fsSL https://antigravity.google/install.sh | bash"
        case .grok: "curl -fsSL https://x.ai/cli/install.sh | bash"
        }
    }

    static var hasBrew: Bool {
        ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].contains { FileManager.default.isExecutableFile(atPath: $0) }
    }
}

extension AppStore {
    /// Opens a terminal tab with the install command typed, not run.
    func typeInstallCommand(for kind: AgentKind) {
        let comment = "# \(kind.name) · " + String(localized: "official install command. Press Enter to run it, or close the tab.")
        let line = "clear; echo '\(comment.replacingOccurrences(of: "'", with: ""))'\n" + AgentCatalog.installCommand(kind) + "\u{0}"
        _ = newSession(projectId: nil, command: line, kind: .shell)
    }
}

/// Puts text in single quotes for the shell.
func shellQuoted(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

// MARK: - A Spotlight-like sheet

struct SheetFrame<Content: View>: View {
    let width: Double
    let onDismiss: () -> Void
    @ViewBuilder var content: Content
    @Environment(\.look) private var look

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(look.dark ? 0.35 : 0.16)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)
                .accessibilityHidden(true)
            VStack(spacing: 0) { content }
                .frame(width: width)
                .background(look.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(look.line))
                .shadow(color: .black.opacity(0.24), radius: 32, y: 16)
                .padding(.top, 140)
                .accessibilityAddTraits(.isModal)
        }
        .onKeyPress(.escape) { onDismiss(); return .handled }
        .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
    }
}

// MARK: - New session

struct NewSessionSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let projectId: String?
    @State private var message = ""
    @State private var selected = 0
    @State private var placement: SplitAxis? = nil
    @FocusState private var focused: Bool

    private enum Choice: Equatable { case agent(AgentKind), terminal }

    private var choices: [Choice] { store.installedAgents.map { .agent($0.kind) } + [.terminal] }
    private var missing: [AgentKind] { AgentKind.allCases.filter { k in !store.installedAgents.contains { $0.kind == k } } }

    var body: some View {
        SheetFrame(width: 560, onDismiss: close) {
            HStack(spacing: 12) {
                if let p = store.project(projectId) {
                    HStack(spacing: 6) {
                        Monogram(name: p.name, size: 16, active: true)
                        Text(p.name).type(.caption, .medium).foregroundStyle(look.ink)
                    }
                    .padding(.leading, 4).padding(.trailing, 8).frame(height: 24)
                    .background(look.base, in: RoundedRectangle(cornerRadius: 6))
                }
                TextField(placeholder, text: $message)
                    .textFieldStyle(.plain)
                    .font(Typeface.sans(16))
                    .foregroundStyle(look.ink)
                    .focused($focused)
                    .onSubmit(start)
            }
            .padding(.horizontal, 18).frame(height: 56)
            Rectangle().fill(look.line).frame(height: 1)

            VStack(spacing: 2) {
                ForEach(Array(choices.enumerated()), id: \.offset) { i, c in
                    Button { selected = i; start() } label: { row(c, index: i) }.buttonStyle(.plain)
                }
            }
            .padding(8)

            if !missing.isEmpty {
                Rectangle().fill(look.line).frame(height: 1)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Not installed").type(.caption).foregroundStyle(look.faint).padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 2)
                    ForEach(missing) { kind in
                        HStack(spacing: 12) {
                            AgentLogo(kind: kind, size: 18, faded: true).frame(width: 20)
                            Text(kind.name).type(.body).foregroundStyle(look.muted)
                            Spacer()
                            Button("Website") { NSWorkspace.shared.open(AgentCatalog.site(kind)) }
                                .buttonStyle(.plain).type(.caption).foregroundStyle(look.soft)
                            Button("Install") { close(); store.typeInstallCommand(for: kind) }
                                .buttonStyle(TZButtonStyle(small: true))
                        }
                        .padding(.horizontal, 12).frame(height: 36)
                    }
                }
                .padding(.horizontal, 8).padding(.bottom, 8)
            }

            HStack(spacing: 4) {
                Menu {
                    Button("New Tab") { placement = nil }
                    Button("Split Right") { placement = .row }
                    Button("Split Down") { placement = .column }
                } label: { chip(placementName) }
                .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
                    .disabled(store.currentSession == nil)
                chip(Paths.tilde(store.project(projectId)?.path ?? NSHomeDirectory()))
                Spacer()
                HStack(spacing: 6) {
                    Text(ctaTitle).type(.caption).foregroundStyle(look.soft)
                    Text("↩").type(.caption, .medium, mono: true).foregroundStyle(look.muted)
                        .padding(.horizontal, 5).background(look.raised, in: RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(look.line))
                }
            }
            .padding(.horizontal, 10).frame(height: 40)
            .background(look.base)
        }
        .onAppear { focused = true }
        .onKeyPress(.downArrow) { selected = min(selected + 1, choices.count - 1); return .handled }
        .onKeyPress(.upArrow) { selected = max(selected - 1, 0); return .handled }
        .onKeyPress(characters: .decimalDigits, phases: .down) { press in
            guard press.modifiers.contains(.command), let n = Int(press.characters), (1 ... choices.count).contains(n) else { return .ignored }
            selected = n - 1
            start()
            return .handled
        }
    }

    private var placeholder: LocalizedStringKey {
        choices.indices.contains(selected) && choices[selected] == .terminal ? "Command to run when it opens (optional)" : "First message (optional)"
    }

    private var placementName: LocalizedStringKey {
        switch placement {
        case nil: "New Tab"
        case .row?: "Split Right"
        case .column?: "Split Down"
        }
    }

    private var ctaTitle: String {
        guard choices.indices.contains(selected) else { return "" }
        switch choices[selected] {
        case let .agent(k): return String(localized: "Start \(k.name)")
        case .terminal: return String(localized: "Open Terminal")
        }
    }

    private func row(_ c: Choice, index i: Int) -> some View {
        HStack(spacing: 12) {
            Group {
                switch c {
                case let .agent(k): AgentLogo(kind: k, size: 18)
                case .terminal: Image(systemName: "chevron.forward.2").font(.system(size: 12, weight: .semibold)).foregroundStyle(look.ink)
                }
            }
            .frame(width: 20)
            Text(name(c)).type(.body, .medium).foregroundStyle(look.ink)
            Text(detail(c)).type(.caption).foregroundStyle(look.faint)
            Spacer()
            Text(i == selected ? "↩" : "⌘\(i + 1)").type(.caption, .medium, mono: true).foregroundStyle(look.faint)
        }
        .padding(.horizontal, 12).frame(height: 40)
        .background(i == selected ? look.selected : .clear, in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .onHover { if $0 { selected = i } }
    }

    private func name(_ c: Choice) -> String {
        switch c {
        case let .agent(k): k.name
        case .terminal: String(localized: "Terminal")
        }
    }

    private func detail(_ c: Choice) -> String {
        switch c {
        case let .agent(k): k == store.lastAgent ? String(localized: "last used") : ""
        case .terminal: Shell.programName(Shell.current)
        }
    }

    private func chip(_ text: some StringProtocol) -> some View { chip(LocalizedStringKey(String(text))) }
    private func chip(_ text: LocalizedStringKey) -> some View {
        HStack(spacing: 6) {
            Text(text).type(.caption).foregroundStyle(look.soft).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold)).foregroundStyle(look.faint)
        }
        .padding(.horizontal, 8).frame(height: 26)
    }

    private func start() {
        guard choices.indices.contains(selected) else { return }
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        var command: String?
        var kind = SessionKind.shell
        switch choices[selected] {
        case let .agent(k):
            command = text.isEmpty ? k.command : "\(k.command) \(shellQuoted(text))"
            kind = .agent
            store.lastAgent = k
        case .terminal:
            command = text.isEmpty ? nil : text
        }
        close()
        if let axis = placement, store.currentSession != nil {
            store.split(axis, command: command)
        } else {
            _ = store.newSession(projectId: projectId, command: command, kind: kind)
        }
    }

    private func close() { store.newSessionPicker = nil }
}

// MARK: - ⌘K / ⌘P

struct PaletteItem: Identifiable {
    enum Group: Int { case waiting, recent, sessions, projects, settings, themes, commands }
    let id: String
    let group: Group
    let title: String
    var detail: String = ""
    var keys: String = ""
    var icon: AnyView
    var state: AgentState?
    let run: () -> Void
}

struct CommandPalette: View {
    @Environment(AppStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look
    @State private var query = ""
    @State private var selected = 0
    @FocusState private var focused: Bool

    private var goOnly: Bool { store.paletteScope == .go }

    var body: some View {
        let items = results
        SheetFrame(width: 600, onDismiss: close) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(look.muted)
                if goOnly {
                    Text("Go").type(.caption, .medium).foregroundStyle(look.soft)
                        .padding(.horizontal, 8).frame(height: 22).background(look.selected, in: RoundedRectangle(cornerRadius: 5))
                }
                TextField(goOnly ? "Projects and sessions" : "Search projects, sessions, commands or settings", text: $query)
                    .textFieldStyle(.plain).font(Typeface.sans(16)).foregroundStyle(look.ink)
                    .focused($focused)
                    .onSubmit { run(items) }
                KeyHint(keys: "esc")
            }
            .padding(.horizontal, 18).frame(height: 56)
            Rectangle().fill(look.line).frame(height: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if items.isEmpty {
                        Text("Nothing matches “\(query)”.").type(.body).foregroundStyle(look.muted).padding(16)
                    }
                    ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                        if i == 0 || items[i - 1].group != item.group {
                            Text(groupTitle(item.group)).type(.caption).foregroundStyle(look.faint)
                                .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 4)
                        }
                        Button { selected = i; run(items) } label: { row(item, selected: i == selected) }
                            .buttonStyle(.plain)
                            .onHover { if $0 { selected = i } }
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 6)
            }
            .frame(maxHeight: 420)
            .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 16) {
                Text("↑↓ select").type(.caption).foregroundStyle(look.faint)
                Text("↩ open").type(.caption).foregroundStyle(look.faint)
                Spacer()
                if !goOnly { Text("> commands only").type(.caption).foregroundStyle(look.faint) }
            }
            .padding(.horizontal, 18).frame(height: 32)
            .background(look.base)
        }
        .onAppear { focused = true }
        .onChange(of: query) { selected = 0 }
        .onKeyPress(.downArrow) { selected = min(selected + 1, max(items.count - 1, 0)); return .handled }
        .onKeyPress(.upArrow) { selected = max(selected - 1, 0); return .handled }
    }

    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        HStack(spacing: 12) {
            item.icon.frame(width: 20)
            Text(item.title).type(.body, .medium).foregroundStyle(look.ink).lineLimit(1)
            Text(item.detail).type(.caption).foregroundStyle(look.faint).lineLimit(1)
            Spacer(minLength: 8)
            if let s = item.state { StateMark(state: s) }
            if !item.keys.isEmpty { KeyHint(keys: item.keys) }
        }
        .padding(.horizontal, 12).frame(height: 38)
        .background(selected ? look.selected : .clear, in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
    }

    private func groupTitle(_ g: PaletteItem.Group) -> LocalizedStringKey {
        switch g {
        case .waiting: "Waiting for you"
        case .recent: "Recent"
        case .sessions: "Sessions"
        case .projects: "Projects"
        case .settings: "Settings"
        case .themes: "Themes"
        case .commands: "Commands"
        }
    }

    private var results: [PaletteItem] {
        var q = query.trimmingCharacters(in: .whitespaces)
        let commandsOnly = !goOnly && q.hasPrefix(">")
        if commandsOnly { q = String(q.dropFirst()).trimmingCharacters(in: .whitespaces) }
        var all = commandsOnly ? commands : goOnly ? places : places + settings + commands
        if q.isEmpty {
            if goOnly || commandsOnly { return all }
            // Before typing: who waits, recent places, the commands people use most.
            let waiting = all.filter { $0.group == .waiting }
            let recent = all.filter { $0.group == .sessions || $0.group == .projects }.prefix(5).map {
                PaletteItem(id: "r." + $0.id, group: .recent, title: $0.title, detail: $0.detail, keys: $0.keys, icon: $0.icon, state: $0.state, run: $0.run)
            }
            return waiting + recent + commands.prefix(3)
        }
        all = all.filter { Self.matches($0.title + " " + $0.detail, q) }
        return all.sorted { $0.group.rawValue < $1.group.rawValue }
    }

    /// Case- and accent-insensitive, Turkish dotted/dotless i folded together; every word must appear.
    static func matches(_ text: String, _ query: String) -> Bool {
        func fold(_ s: String) -> String {
            s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "tr")).replacingOccurrences(of: "ı", with: "i")
        }
        let t = fold(text)
        return fold(query).split(separator: " ").allSatisfy { t.contains($0) }
    }

    private var places: [PaletteItem] {
        var out: [PaletteItem] = []
        for s in store.sessions {
            let state = store.status(of: s)
            let waiting = state == .blocked || state == .error
            out.append(PaletteItem(id: "s." + s.id, group: waiting ? .waiting : .sessions, title: store.sessionTitle(s),
                                   detail: store.project(s.projectId)?.name ?? String(localized: "Terminal"),
                                   icon: AnyView(ProgramMark(program: store.icon(of: s), size: 16)), state: state) { store.open(session: s.id) })
        }
        for p in store.recentProjects {
            out.append(PaletteItem(id: "p." + p.id, group: .projects, title: p.name, detail: Paths.tilde(p.path),
                                   icon: AnyView(Monogram(name: p.name, size: 18)), state: store.status(ofProject: p.id)) { store.openProject(p.id) })
        }
        return out
    }

    private var settings: [PaletteItem] {
        var out: [PaletteItem] = []
        let lang = Locale.current.language.languageCode?.identifier == "tr"
        for t in Themes.all {
            out.append(PaletteItem(id: "t." + t.id, group: .themes, title: lang ? t.nameTR : t.nameEN,
                                   detail: t.isDark ? String(localized: "dark theme") : String(localized: "light theme"),
                                   icon: AnyView(RoundedRectangle(cornerRadius: 4).fill(Color(t.background)).frame(width: 14, height: 14)
                                       .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color.black.opacity(0.15))))) {
                if t.isDark { appearance.darkTheme = t.id } else { appearance.lightTheme = t.id }
            })
        }
        for p in NavPosition.allCases {
            out.append(PaletteItem(id: "n." + p.rawValue, group: .settings, title: String(localized: "Navigation: \(String(localized: String.LocalizationValue(p.rawValue.capitalized)))"),
                                   detail: String(localized: "Appearance"), icon: AnyView(Image(systemName: "sidebar.left").foregroundStyle(look.soft))) {
                appearance.navPosition = p
            })
        }
        for m in Appearance.Mode.allCases {
            out.append(PaletteItem(id: "m." + m.rawValue, group: .settings, title: String(localized: "Appearance: \(String(localized: String.LocalizationValue(m.rawValue.capitalized)))"),
                                   detail: String(localized: "Theme"), icon: AnyView(Image(systemName: "circle.lefthalf.filled").foregroundStyle(look.soft))) {
                appearance.mode = m
            })
        }
        return out
    }

    private var commands: [PaletteItem] {
        func cmd(_ id: String, _ title: String, _ keys: String, _ symbol: String, _ run: @escaping () -> Void) -> PaletteItem {
            PaletteItem(id: "c." + id, group: .commands, title: title, keys: keys,
                        icon: AnyView(Image(systemName: symbol).foregroundStyle(look.soft)), run: run)
        }
        return [
            cmd("new", String(localized: "New Session"), "⌘T", "plus") { AppActions.newSessionHere() },
            cmd("split", String(localized: "Split Right"), "⌘D", "rectangle.split.2x1") { store.split(.row) },
            cmd("terminal", String(localized: "New Terminal"), "⌘N", "chevron.forward.2") { _ = store.newSession(projectId: nil) },
            cmd("splitdown", String(localized: "Split Down"), "⇧⌘D", "rectangle.split.1x2") { store.split(.column) },
            cmd("open", String(localized: "Open Folder…"), "⌘O", "folder") { AppActions.openFolder() },
            cmd("home", String(localized: "Home"), "⇧⌘H", "house") { store.selection = .welcome },
            cmd("settings", String(localized: "Settings…"), "⌘,", "gearshape") { store.selection = .settings },
        ]
    }

    private func run(_ items: [PaletteItem]) {
        guard items.indices.contains(selected) else { return }
        let item = items[selected]
        close()
        DispatchQueue.main.async { item.run() }
    }

    private func close() {
        store.paletteOpen = false
        store.paletteScope = .all
    }
}
