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

/// The first-run window: five pages on squared paper.
struct OnboardingView: View {
    @Environment(Onboarding.self) private var flow
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            look.raised
            PaperGrid()
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
            if flow.step > 0 {
                StepBars(step: flow.step).padding(.top, 20).padding(.trailing, 24)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(.timingCurve(0.2, 0, 0, 1, duration: Motion.page), value: flow.step)
        .ignoresSafeArea()
    }
}

private struct StepBars: View {
    let step: Int
    @Environment(\.look) private var look
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0 ..< Onboarding.pages, id: \.self) { i in
                Capsule().fill(i <= step ? look.ink : look.line).frame(width: i == step ? 32 : 16, height: 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Step \(step + 1) of \(Onboarding.pages)"))
    }
}

private struct PageLabel: View {
    let text: String
    @Environment(\.look) private var look
    var body: some View {
        Text(text).type(.body, .medium, mono: true).tracking(0.5).foregroundStyle(look.muted)
    }
}

private struct PageHeading: View {
    let label: String
    let title: LocalizedStringKey
    let text: LocalizedStringKey
    @Environment(\.look) private var look

    var body: some View {
        VStack(alignment: .leading, spacing: Grid.Space.s4) {
            PageLabel(text: label)
            Text(title).type(.display, .semibold).foregroundStyle(look.ink).accessibilityAddTraits(.isHeader)
            Text(text).type(.lead).foregroundStyle(look.muted).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct PageButtons: View {
    var primary: LocalizedStringKey = "Continue"
    var secondary: LocalizedStringKey? = nil
    var showBack = true
    var onSecondary: (() -> Void)?
    @Environment(Onboarding.self) private var flow

    var body: some View {
        HStack {
            if showBack {
                Button("Back") { flow.back() }.buttonStyle(TZButtonStyle(kind: .plain)).keyboardShortcut(.cancelAction)
            }
            Spacer()
            if let secondary {
                Button(secondary) { onSecondary?() ?? flow.next() }.buttonStyle(TZButtonStyle())
            }
            Button(primary) { flow.next() }.buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
        }
    }
}

// MARK: - 01 Welcome

/// The mark on the grid with its measures drawn in: 1 unit = 6 pt, so the squares are 4 and 16 units.
struct MeasuredMark: View {
    var showMeasures = true
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            // viewBox 8 13 84 76 at 6 pt per unit.
            TezgahMark(width: 68 * 6, blinking: true)
                .offset(x: (16 - 8) * 6, y: (23 - 13) * 6)
            if showMeasures {
                Canvas { ctx, _ in
                    func u(_ v: Double) -> Double { v * 6 }
                    let ink = look.muted.opacity(0.9)
                    var p = Path()
                    // 68 across the bottom, 12 at the top's edge, 18 beside the cursor.
                    p.move(to: CGPoint(x: u(8), y: u(71))); p.addLine(to: CGPoint(x: u(76), y: u(71)))
                    p.move(to: CGPoint(x: u(8), y: u(70))); p.addLine(to: CGPoint(x: u(8), y: u(72)))
                    p.move(to: CGPoint(x: u(76), y: u(70))); p.addLine(to: CGPoint(x: u(76), y: u(72)))
                    p.move(to: CGPoint(x: u(80), y: u(32))); p.addLine(to: CGPoint(x: u(80), y: u(44)))
                    p.move(to: CGPoint(x: u(79), y: u(32))); p.addLine(to: CGPoint(x: u(81), y: u(32)))
                    p.move(to: CGPoint(x: u(79), y: u(44))); p.addLine(to: CGPoint(x: u(81), y: u(44)))
                    p.move(to: CGPoint(x: u(35), y: u(10))); p.addLine(to: CGPoint(x: u(35), y: u(28)))
                    p.move(to: CGPoint(x: u(34), y: u(10))); p.addLine(to: CGPoint(x: u(36), y: u(10)))
                    p.move(to: CGPoint(x: u(34), y: u(28))); p.addLine(to: CGPoint(x: u(36), y: u(28)))
                    ctx.stroke(p, with: .color(ink), lineWidth: 1)
                    var dash = Path()
                    dash.move(to: CGPoint(x: u(8), y: u(4))); dash.addLine(to: CGPoint(x: u(8), y: u(30)))
                    dash.move(to: CGPoint(x: u(76), y: u(4))); dash.addLine(to: CGPoint(x: u(76), y: u(30)))
                    ctx.stroke(dash, with: .color(ink.opacity(0.6)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    let font = Typeface.mono(11)
                    ctx.draw(Text("68").font(font).foregroundStyle(ink), at: CGPoint(x: u(42), y: u(73.3)))
                    ctx.draw(Text("12").font(font).foregroundStyle(ink), at: CGPoint(x: u(82.5), y: u(38)))
                    ctx.draw(Text("18").font(font).foregroundStyle(ink), at: CGPoint(x: u(37.5), y: u(19)))
                }
                .frame(width: 84 * 6, height: 76 * 6)
                .mask(alignment: .leading) {
                    Rectangle().frame(width: drawn || reduceMotion ? 84 * 6 : 0)
                }
                .accessibilityHidden(true)
            }
        }
        .frame(width: 84 * 6, height: 76 * 6, alignment: .topLeading)
        .onAppear { withAnimation(.timingCurve(0.2, 0, 0, 1, duration: 1.2).delay(0.2)) { drawn = true } }
    }
}

private struct WelcomePage: View {
    @Environment(Onboarding.self) private var flow
    @Environment(\.look) private var look

    var body: some View {
        ZStack(alignment: .topLeading) {
            MeasuredMark().offset(x: 48, y: 120)
            Text("1 unit = 6 pt · square = 4 units").type(.caption, mono: true).foregroundStyle(look.muted).offset(x: 96, y: 648)

            VStack(alignment: .leading, spacing: Grid.Space.s6) {
                PageLabel(text: "TEZGAH · 0.1 BETA")
                Text("Welcome to\nTezgah.").type(.poster, .semibold).foregroundStyle(look.ink).accessibilityAddTraits(.isHeader)
                Text("A terminal for your agents, a hub for your projects. Five steps and you're ready.")
                    .type(.title3).foregroundStyle(look.muted).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: Grid.Space.s3) {
                    Button { flow.next() } label: {
                        HStack(spacing: 12) { Text("Start"); Text("↩").type(.caption, mono: true).opacity(0.6) }
                    }
                    .buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
                    Button("Skip Setup") { flow.finish() }.buttonStyle(TZButtonStyle())
                }
                .padding(.top, Grid.Space.s6)
            }
            .frame(width: 504, alignment: .leading)
            .offset(x: 624, y: 168)

            HStack(alignment: .top, spacing: 8) {
                ForEach(Array(["Hello", "Appearance", "Permissions", "Agents", "Ready"].enumerated()), id: \.offset) { i, t in
                    VStack(alignment: .leading, spacing: 8) {
                        Capsule().fill(i == 0 ? look.ink : look.line).frame(height: 4)
                        HStack(spacing: 4) {
                            Text(String(format: "%02d", i + 1)).type(.caption, .medium, mono: true)
                            Text(LocalizedStringKey(t)).type(.caption, i == 0 ? .medium : .regular)
                        }
                        .foregroundStyle(i == 0 ? look.ink : look.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(width: 504)
            .offset(x: 624, y: 648)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - 02 Appearance

private struct AppearancePage: View {
    @Environment(Appearance.self) private var appearance
    @Environment(\.look) private var look
    @AppStorage("terminal.fontSize") private var fontSize = 13.0

    var body: some View {
        @Bindable var appearance = appearance
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: Grid.Space.s8) {
                PageHeading(label: "02 · APPEARANCE", title: "Make it yours.", text: "You can change all of this later in Settings.")

                VStack(alignment: .leading, spacing: Grid.Space.s2) {
                    Text("Theme").type(.body, .medium).foregroundStyle(look.ink)
                    Picker("Theme", selection: $appearance.mode) {
                        Text("Light").tag(Appearance.Mode.light)
                        Text("Dark").tag(Appearance.Mode.dark)
                        Text("System").tag(Appearance.Mode.system)
                    }
                    .pickerStyle(.segmented).labelsHidden()
                }

                VStack(alignment: .leading, spacing: Grid.Space.s2) {
                    Text("Where should the projects strip sit?").type(.body, .medium).foregroundStyle(look.ink)
                    HStack(spacing: Grid.Space.s2) {
                        ForEach(NavPosition.allCases) { p in
                            PositionTile(position: p, selected: appearance.navPosition == p) { appearance.navPosition = p }
                        }
                    }
                }

                HStack {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Terminal text").type(.body, .medium).foregroundStyle(look.ink)
                        Text("Geist Mono · \(Int(fontSize)) pt").type(.caption, mono: true).foregroundStyle(look.muted)
                    }
                    Spacer()
                    Button("A−") { fontSize = max(11, fontSize - 1) }.buttonStyle(TZButtonStyle()).accessibilityLabel(Text("Smaller text"))
                    Button("A+") { fontSize = min(18, fontSize + 1) }.buttonStyle(TZButtonStyle()).accessibilityLabel(Text("Bigger text"))
                }
            }
            .frame(width: 456, alignment: .leading)
            .offset(x: 48, y: 72)

            NavPreview(position: appearance.navPosition, fontSize: fontSize)
                .frame(width: 576, height: 480)
                .offset(x: 576, y: 96)
            Text("Preview · changes as you choose").type(.caption, mono: true).foregroundStyle(look.muted).offset(x: 576, y: 592)

            PageButtons().frame(width: 1104).offset(x: 48, y: 680)
        }
    }
}

private struct PositionTile: View {
    let position: NavPosition
    let selected: Bool
    let action: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        Button(action: action) {
            VStack(spacing: Grid.Space.s2) {
                ZStack(alignment: alignment) {
                    RoundedRectangle(cornerRadius: 6).strokeBorder(look.muted, lineWidth: 1.5).frame(width: 64, height: 48)
                    RoundedRectangle(cornerRadius: 2).fill(look.ink)
                        .frame(width: position.isVertical ? 12 : 56, height: position.isVertical ? 40 : 7)
                        .padding(4)
                }
                .frame(width: 64, height: 48)
                Text(position.title).type(.body, .medium).foregroundStyle(look.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 96)
            .background(look.raised, in: RoundedRectangle(cornerRadius: Grid.Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(selected ? look.ink : look.line, lineWidth: selected ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var alignment: Alignment {
        switch position {
        case .left: .leading
        case .right: .trailing
        case .top: .top
        case .bottom: .bottom
        }
    }
}

private struct NavPreview: View {
    let position: NavPosition
    let fontSize: Double
    @Environment(\.look) private var look

    var body: some View {
        let layout = position.isVertical ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
        layout {
            if position == .left || position == .top { bar }
            VStack(alignment: .leading, spacing: 4) {
                Text("~/Project/tezgah-mac").foregroundStyle(look.muted)
                Text("❯ claude").foregroundStyle(look.ink)
                Text("  Hi! What shall we work on?").foregroundStyle(look.muted)
                HStack(spacing: 0) {
                    Text("❯ ").foregroundStyle(look.ink)
                    Rectangle().fill(look.ink).frame(width: fontSize * 0.6, height: fontSize * 1.2)
                }
            }
            .font(Typeface.mono(fontSize))
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            if position == .right || position == .bottom { bar }
        }
        .background(look.raised)
        .clipShape(RoundedRectangle(cornerRadius: Grid.Radius.window, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Grid.Radius.window, style: .continuous).strokeBorder(look.line))
        .shadow(color: .black.opacity(0.12), radius: 20, y: 8)
        .accessibilityHidden(true)
    }

    private var bar: some View {
        let tabs = Group {
            tab(.claude, "claude", active: true)
            tab(.codex, "codex", active: false)
        }
        return Group {
            if position.isVertical {
                VStack(alignment: .leading, spacing: 4) { tabs; Spacer() }.padding(8).frame(width: 160)
            } else {
                HStack(spacing: 4) { tabs; Spacer() }.padding(8).frame(height: 44)
            }
        }
        .background(look.base)
    }

    private func tab(_ kind: AgentKind, _ name: String, active: Bool) -> some View {
        HStack(spacing: 8) { AgentLogo(kind: kind, size: 12); Text(name).type(.body, active ? .medium : .regular) }
            .foregroundStyle(active ? look.ink : look.muted)
            .padding(.horizontal, 10).frame(height: 28)
            .background(active ? look.raised : .clear, in: RoundedRectangle(cornerRadius: 6))
    }
}

// MARK: - 03 Permissions

private struct PermissionsPage: View {
    @Environment(Permissions.self) private var permissions
    @Environment(Onboarding.self) private var flow
    @Environment(\.look) private var look

    var body: some View {
        let allGranted = permissions.notifications == .granted && permissions.screenRecording == .granted && permissions.finderAction == .granted
        ZStack(alignment: .topLeading) {
            PageHeading(label: "03 · PERMISSIONS", title: "Three permissions, one drag.",
                        text: "Click one and System Settings opens on its page. Each card ticks itself when the permission arrives.")
                .frame(width: 480, alignment: .leading)
                .offset(x: 48, y: 72)

            VStack(spacing: Grid.Space.s2) {
                PermissionCard(symbol: "bell", title: "Notifications", detail: "Tells you when an agent waits for you",
                               state: permissions.notifications) { permissions.requestNotifications() }
                PermissionCard(symbol: "rectangle.on.rectangle", title: "Screen Recording", detail: "To show simulators and windows in a pane",
                               state: permissions.screenRecording) { permissions.openScreenRecordingSettings(); WindowPlacement.makeRoomForSettings() }
                PermissionCard(symbol: "folder", title: "“Open in Tezgah” in Finder", detail: "When you right-click a folder",
                               state: permissions.finderAction) { permissions.installFinderAction() }
            }
            .frame(width: 480)
            .offset(x: 48, y: 280)

            DragAppIcon().frame(width: 480, height: 104).offset(x: 48, y: 504)

            HStack {
                Button("Back") { flow.back() }.buttonStyle(TZButtonStyle(kind: .plain))
                Spacer()
                if allGranted {
                    Button("Continue") { flow.next() }.buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
                } else {
                    Button("Later") { flow.next() }.buttonStyle(TZButtonStyle()).keyboardShortcut(.defaultAction)
                }
            }
            .frame(width: 480)
            .offset(x: 48, y: 680)
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
    let symbol: String
    let title: LocalizedStringKey
    let detail: LocalizedStringKey
    let state: Permissions.State
    let action: () -> Void
    @Environment(\.look) private var look

    var body: some View {
        Button(action: action) {
            HStack(spacing: Grid.Space.s4) {
                Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(active ? Color(look.theme.background) : look.ink)
                    .frame(width: 32, height: 32)
                    .background(active ? look.ink : look.base, in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).type(.body, .medium).foregroundStyle(look.ink)
                    Text(detail).type(.caption).foregroundStyle(look.muted)
                }
                Spacer()
                trailing
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(look.faint)
            }
            .padding(.horizontal, Grid.Space.s4)
            .frame(height: 64)
            .background(look.raised, in: RoundedRectangle(cornerRadius: Grid.Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(active ? look.ink : look.line, lineWidth: active ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityValue(Text(stateText))
    }

    private var active: Bool { state == .needsRelaunch }

    @ViewBuilder private var trailing: some View {
        switch state {
        case .granted:
            HStack(spacing: 8) { Text("Granted").type(.caption, .medium).foregroundStyle(look.done); DoneCheck(size: 22) }
        case .needsRelaunch:
            Button("Reopen Tezgah") { Relauncher.relaunch() }.buttonStyle(TZButtonStyle(kind: .primary, small: true))
        case .denied:
            Text("Turned off").type(.caption).foregroundStyle(look.failed)
        case .unknown:
            Text("Open").type(.caption).foregroundStyle(look.muted)
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var lift = false

    var body: some View {
        HStack(spacing: Grid.Space.s6) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable().frame(width: 64, height: 64)
                .shadow(color: .black.opacity(0.25), radius: 8, y: 6)
                .offset(y: lift ? -4 : 0)
                .onDrag { NSItemProvider(contentsOf: Bundle.main.bundleURL) ?? NSItemProvider() }
                .accessibilityLabel(Text("Tezgah app icon, drag it into the list"))
            VStack(alignment: .leading, spacing: 4) {
                Text("Hold the icon, drop it in the list").type(.lead, .semibold).foregroundStyle(look.ink)
                Text("Screen & System Audio Recording · open Tezgah").type(.body).foregroundStyle(look.soft)
            }
            Spacer()
        }
        .padding(.horizontal, Grid.Space.s6)
        .frame(maxHeight: .infinity)
        .background(look.base, in: RoundedRectangle(cornerRadius: Grid.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(look.ink, style: StrokeStyle(lineWidth: 1.5, dash: [6, 6])))
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { lift = true }
        }
    }
}

enum WindowPlacement {
    static var onboardingWindow: NSWindow? { NSApp.windows.first { $0.contentViewController is NSHostingController<AnyView> || $0.title == NSLocalizedString("Welcome to Tezgah", comment: "window") } }

    /// On the permissions page the first-run window narrows to the right half, so System Settings has the left.
    static func narrowToRight() {
        guard let w = onboardingWindow, let screen = w.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let width = 576.0, height = w.frame.height
        let x = area.midX + max(Grid.Space.s6, (area.width / 2 - width) / 2)
        w.setFrame(NSRect(x: min(x, area.maxX - width - Grid.Space.s6), y: area.midY - height / 2, width: width, height: height),
                   display: true, animate: true)
    }

    static func restoreOnboarding() {
        guard let w = onboardingWindow, let screen = w.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let size = NSSize(width: 1200, height: w.frame.height)
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
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: Grid.Space.s6) {
                PageHeading(label: "04 · AGENTS", title: title,
                            text: "To know when an agent is working or waiting for you, Tezgah adds a small hook to it. Nothing else in the agent's settings changes; you can remove it any time.")
                VStack(alignment: .leading, spacing: Grid.Space.s3) {
                    Text("In the strip it looks like this").type(.body, .medium).foregroundStyle(look.ink)
                    sample(.claude, "claude · working", .working)
                    sample(.codex, "codex · waiting for you", .blocked)
                    sample(.antigravity, "antigravity · done", .done)
                }
                .padding(Grid.Space.s4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(look.base, in: RoundedRectangle(cornerRadius: Grid.Radius.card))
                .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(look.line))
            }
            .frame(width: 432, alignment: .leading)
            .offset(x: 48, y: 72)

            VStack(spacing: Grid.Space.s2) {
                if let found {
                    ForEach(found) { AgentRow(found: $0) }
                    OtherToolRow()
                    let missing = AgentKind.allCases.filter { k in !found.contains { $0.kind == k } }
                    if !missing.isEmpty {
                        Text("Not found: \(missing.map(\.name).formatted(.list(type: .and))). Tezgah notices when you install one.")
                            .type(.caption).foregroundStyle(look.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    }
                } else {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 80)
                    Text("Looking for agents…").type(.caption).foregroundStyle(look.muted)
                }
            }
            .frame(width: 576)
            .offset(x: 576, y: 96)

            PageButtons().frame(width: 1104).offset(x: 48, y: 680)
        }
        .task { found = await AgentDetector.detect() }
    }

    private var title: LocalizedStringKey {
        switch found?.count {
        case nil: "Looking for agents."
        case 0?: "No agents yet."
        case 1?: "I found one agent."
        case let n?: "I found \(n) agents."
        }
    }

    private func sample(_ kind: AgentKind, _ text: LocalizedStringKey, _ state: AgentState) -> some View {
        HStack(spacing: 8) {
            Circle().fill(Color(RGB(kind == .claude ? 0xD97757 : kind == .antigravity ? 0x3186FF : 0x0C0B0A))).frame(width: 8, height: 8)
            AgentLogo(kind: kind, size: 14)
            Text(text).type(.body).foregroundStyle(state == .blocked ? look.waiting : look.soft)
            Spacer()
            StateMark(state: state)
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
        HStack(spacing: Grid.Space.s4) {
            AgentLogo(kind: found.kind, size: 24)
                .frame(width: 40, height: 40)
                .background(look.raised, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(look.line))
            VStack(alignment: .leading, spacing: 0) {
                Text(found.kind.name).type(.lead, .medium).foregroundStyle(look.ink)
                Text([Paths.tilde(found.path), found.version].compactMap { $0 }.joined(separator: " · "))
                    .type(.caption, mono: true).foregroundStyle(look.muted)
            }
            Spacer()
            Toggle("Report status", isOn: $reports).toggleStyle(.switch).controlSize(.small).tint(look.ink)
                .onChange(of: reports) { AgentHooks.install() }
        }
        .padding(.horizontal, 20)
        .frame(height: 80)
        .background(look.raised, in: RoundedRectangle(cornerRadius: Grid.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(look.line))
    }
}

private struct OtherToolRow: View {
    @Environment(\.look) private var look
    var body: some View {
        HStack(spacing: Grid.Space.s4) {
            Image(systemName: "plus").frame(width: 40, height: 40)
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(look.muted, lineWidth: 1.5))
            VStack(alignment: .leading, spacing: 0) {
                Text("Another tool").type(.lead, .medium).foregroundStyle(look.ink)
                Text("Type its command; Tezgah treats it as an agent too").type(.caption).foregroundStyle(look.muted)
            }
            Spacer()
            Button("Add") {}.buttonStyle(TZButtonStyle())
        }
        .padding(.horizontal, 20)
        .frame(height: 80)
        .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(look.muted, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
    }
}

// MARK: - 05 Ready

private struct ReadyPage: View {
    @Environment(Onboarding.self) private var flow
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @State private var folders: [URL] = []

    var body: some View {
        ZStack(alignment: .topLeading) {
            TezgahMark(width: 68 * 6, blinking: true).offset(x: 48 + 8 * 6, y: 120 + 10 * 6)
            Text("setup complete · 5 / 5").type(.caption, mono: true).foregroundStyle(look.muted).offset(x: 96, y: 648)

            VStack(alignment: .leading, spacing: Grid.Space.s6) {
                PageLabel(text: "05 · READY")
                Text("Tezgah\nis ready.").type(.poster, .semibold).foregroundStyle(look.ink).accessibilityAddTraits(.isHeader)
                if !folders.isEmpty {
                    Text("Open your first project. These are the folders you worked in last:").type(.lead).foregroundStyle(look.muted)
                    VStack(spacing: 0) {
                        ForEach(Array(folders.prefix(3).enumerated()), id: \.offset) { i, url in
                            Button { open(url) } label: {
                                HStack {
                                    Text(url.lastPathComponent).type(.body, .medium).foregroundStyle(look.ink)
                                    Spacer()
                                    Text(Paths.tilde(url.deletingLastPathComponent().path)).type(.caption, mono: true).foregroundStyle(look.muted)
                                }
                                .padding(.horizontal, Grid.Space.s4).frame(height: 48).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if i < min(folders.count, 3) - 1 { Rectangle().fill(look.line).frame(height: 1) }
                        }
                    }
                    .background(look.raised, in: RoundedRectangle(cornerRadius: Grid.Radius.card))
                    .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card).strokeBorder(look.line))
                } else {
                    Text("Open your first project.").type(.lead).foregroundStyle(look.muted)
                }
                HStack(spacing: Grid.Space.s3) {
                    Button { flow.finish(); AppActions.openFolder() } label: {
                        HStack(spacing: 12) { Text("Choose Folder"); Text("⌘O").type(.caption, mono: true).opacity(0.6) }
                    }
                    .buttonStyle(TZButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
                    Button("Empty Terminal") { flow.finish(); _ = store.newSession(projectId: nil) }.buttonStyle(TZButtonStyle())
                }
            }
            .frame(width: 504, alignment: .leading)
            .offset(x: 624, y: 96)

            HStack(spacing: 8) {
                shortcut("⌘T", "New session")
                shortcut("⌘D", "Split")
                shortcut("⌘K", "Search everything")
                shortcut("⇧⌘F", "Focus mode")
            }
            .frame(width: 504)
            .offset(x: 624, y: 640)
        }
        .task { folders = RecentFolders.find() }
    }

    private func shortcut(_ keys: String, _ title: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(keys).type(.body, .medium, mono: true).foregroundStyle(look.ink)
            Text(title).type(.caption).foregroundStyle(look.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func open(_ url: URL) {
        let p = store.addProject(path: url.path)
        flow.finish()
        store.openProject(p.id)
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
