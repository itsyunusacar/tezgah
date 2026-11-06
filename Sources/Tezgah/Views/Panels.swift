import AppKit
import SwiftUI
import TezgahCore
import UserNotifications

// MARK: - Notifications panel

/// The side panel the bell opens: delete one, clear all, filter, read.
struct NotificationsPanel: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @State private var filter: Filter = .all
    @State private var hover: UUID?

    enum Filter: CaseIterable { case all, waiting, done, failed }

    var body: some View {
        let items = store.notifications.filter(matches)
        VStack(spacing: 0) {
            HStack {
                Text("Notifications").type(.body, .semibold).foregroundStyle(look.ink)
                if store.unreadNotifications > 0 {
                    Text("\(store.unreadNotifications) new").type(.caption, mono: true).foregroundStyle(look.faint)
                }
                Spacer()
                IconButton(symbol: "xmark", label: "Close Panel", size: 12) { store.notificationsOpen = false }
            }
            .padding(.leading, 16).padding(.trailing, 8).frame(height: 44)
            Rectangle().fill(look.line).frame(height: 1)

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 4) {
                    ForEach(Filter.allCases, id: \.self) { f in
                        Button { filter = f } label: {
                            Text(title(f)).type(.caption, .medium)
                                .foregroundStyle(filter == f ? Color(look.theme.background) : look.soft)
                                .padding(.horizontal, 10).frame(height: 26)
                                .background(filter == f ? look.ink : look.selected, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack {
                    Spacer()
                    Button("Mark All Read") { store.markAllRead() }.buttonStyle(.plain).type(.caption).foregroundStyle(look.soft)
                        .disabled(store.unreadNotifications == 0)
                }
            }
            .padding(16)
            Rectangle().fill(look.line).frame(height: 1)

            if items.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "bell").font(.system(size: 28, weight: .light)).foregroundStyle(look.faint)
                    Text("No notifications").type(.lead, .semibold).foregroundStyle(look.ink)
                    Text("When an agent waits for you or finishes its work, it shows up here.").type(.caption).foregroundStyle(look.muted)
                        .multilineTextAlignment(.center)
                }
                .padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(items) { n in row(n) }
                    }
                    .padding(8)
                }
            }

            Rectangle().fill(look.line).frame(height: 1)
            HStack {
                Text("Older than 30 days are removed automatically").type(.caption).foregroundStyle(look.faint)
                Spacer()
                Button("Clear All") { store.notifications.removeAll() }.buttonStyle(TZButtonStyle(small: true))
                    .disabled(store.notifications.isEmpty)
            }
            .padding(.horizontal, 16).frame(height: 44)
            .background(look.base)
        }
        .frame(width: 380)
        .card(look)
        .onKeyPress(.escape) { store.notificationsOpen = false; return .handled }
    }

    private func row(_ n: AppNotification) -> some View {
        let session = store.session(n.sessionId)
        return HStack(alignment: .top, spacing: 10) {
            Circle().fill(n.read ? .clear : look.ink).frame(width: 6, height: 6).padding(.top, 13)
            LogoTile(program: n.app, size: 28)
            VStack(alignment: .leading, spacing: 0) {
                Text(n.message ?? defaultText(n.state)).type(.body, n.read ? .regular : .semibold).foregroundStyle(look.ink).lineLimit(2)
                (Text(stateWord(n.state)).foregroundStyle(stateColor(n.state)) +
                    Text(" · \(n.app ?? "") · \(store.project(session?.projectId)?.name ?? String(localized: "Terminal"))").foregroundStyle(look.muted))
                    .type(.caption).lineLimit(1)
            }
            Spacer(minLength: 4)
            if hover == n.id {
                Button { store.notifications.removeAll { $0.id == n.id } } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundStyle(look.soft)
                        .frame(width: 22, height: 22).background(look.selected, in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain).accessibilityLabel(Text("Delete"))
            } else {
                Text(n.date.formatted(date: .omitted, time: .shortened)).type(.caption, mono: true).foregroundStyle(look.faint)
            }
        }
        .padding(10)
        .background(hover == n.id ? look.base : .clear, in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
        .onHover { hover = $0 ? n.id : (hover == n.id ? nil : hover) }
        .onTapGesture {
            store.markRead(n.id)
            if session != nil { store.open(session: n.sessionId, pane: n.paneId) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: Text("Delete")) { store.notifications.removeAll { $0.id == n.id } }
    }

    private func matches(_ n: AppNotification) -> Bool {
        switch filter {
        case .all: true
        case .waiting: n.state == .blocked
        case .done: n.state == .done
        case .failed: n.state == .error
        }
    }

    private func title(_ f: Filter) -> LocalizedStringKey {
        switch f {
        case .all: "All"
        case .waiting: "Waiting for you"
        case .done: "Done"
        case .failed: "Errors"
        }
    }

    private func stateWord(_ s: AgentState) -> LocalizedStringKey {
        switch s {
        case .blocked: "Waiting for you"
        case .done: "Done"
        case .error: "Error"
        default: ""
        }
    }

    private func stateColor(_ s: AgentState) -> Color { s == .done ? look.done : s == .error ? look.failed : look.waiting }

    private func defaultText(_ s: AgentState) -> String {
        s == .done ? String(localized: "Finished its work") : String(localized: "Waiting for your answer")
    }
}

extension AppStore {
    func markRead(_ id: UUID) {
        if let i = notifications.firstIndex(where: { $0.id == id }) { notifications[i].read = true }
    }

    func markAllRead() {
        for i in notifications.indices { notifications[i].read = true }
    }

    /// Sessions that wait for the user, most urgent first.
    var waitingSessions: [Session] { sessions.filter { [.blocked, .error].contains(status(of: $0)) } }
    var workingSessions: [Session] { sessions.filter { status(of: $0) == .working } }
}

/// System notifications for "waiting for you" and "done", when you aren't looking.
enum SystemNotices {
    static func post(title: String, body: String, sessionId: String, sound: Bool) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.userInfo = ["session": sessionId]
        if sound { content.sound = .default }
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

// MARK: - Menu bar

/// The menu bar item: the mark, its cursor blinking while agents work and an orange dot when one waits.
@MainActor
final class MenuBarController: NSObject {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private let store: AppStore
    private var timer: Timer?
    private var blinkOn = true

    init(store: AppStore, appearance: Appearance) {
        self.store = store
        super.init()
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView:
            LookProvider { MenuBarPopover(close: { [weak self] in self?.popover.performClose(nil) }) }
                .environment(store).environment(appearance))
        item.button?.target = self
        item.button?.action = #selector(toggle)
        item.button?.setAccessibilityLabel("Tezgah")
        timer = Timer.scheduledTimer(withTimeInterval: Motion.blink / 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        tick()
    }

    @objc private func toggle() {
        if popover.isShown { popover.performClose(nil); return }
        guard let button = item.button else { return }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    private func tick() {
        let working = !store.workingSessions.isEmpty
        let waiting = !store.waitingSessions.isEmpty
        let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        blinkOn = working && !reduce ? !blinkOn : true
        item.button?.image = Self.icon(cursor: blinkOn, dot: waiting)
        item.button?.setAccessibilityValue(waiting ? "an agent is waiting for you" : working ? "agents working" : "")
        let badge = UserDefaults.standard.object(forKey: "notify.badge") as? Bool ?? true
        NSApp.dockTile.badgeLabel = waiting && badge ? "\(store.waitingSessions.count)" : nil
    }

    /// The mark as a template image (follows the menu bar's colour); the waiting dot is drawn in orange.
    static func icon(cursor: Bool, dot: Bool) -> NSImage {
        let size = NSSize(width: 20, height: 16)
        let image = NSImage(size: size, flipped: true) { rect in
            let s = 17.0 / MarkGeometry.viewBox.width
            let ox = (rect.width - 17) / 2 - MarkGeometry.viewBox.x * s, oy = (rect.height - MarkGeometry.viewBox.height * s) / 2 - MarkGeometry.viewBox.y * s
            func r(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ rad: Double) -> NSBezierPath {
                NSBezierPath(roundedRect: NSRect(x: ox + x * s, y: oy + y * s, width: w * s, height: h * s), xRadius: rad * s, yRadius: rad * s)
            }
            NSColor.black.setFill()
            let t = MarkGeometry.top
            r(t.x, t.y, t.width, t.height, t.radius).fill()
            for l in MarkGeometry.legs { r(l.x, l.y, l.width, l.height, l.radius).fill() }
            if cursor {
                let c = MarkGeometry.cursor
                r(c.x, c.y, c.width, c.height, c.radius).fill()
            }
            return true
        }
        guard dot else {
            image.isTemplate = true
            return image
        }
        // With the dot the image can't be a template; draw the mark in the menu bar's text colour instead.
        let tinted = NSImage(size: size, flipped: false) { rect in
            image.draw(in: rect)
            NSColor.labelColor.set()
            rect.fill(using: .sourceAtop)
            NSColor(StateColors.waiting(dark: false)).setFill()
            NSBezierPath(ovalIn: NSRect(x: rect.maxX - 6, y: rect.maxY - 6, width: 6, height: 6)).fill()
            return true
        }
        tinted.isTemplate = false
        return tinted
    }
}

struct MenuBarPopover: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TezgahMark(width: 20)
                Text("Tezgah").type(.lead, .semibold).foregroundStyle(look.ink)
                Spacer()
                Text(summary).type(.caption, mono: true).foregroundStyle(look.muted)
            }
            .padding(.horizontal, 10).padding(.top, 8)

            ForEach(store.waitingSessions) { s in
                let lead = store.leadPane(of: s)
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        WaitingBlock(size: 12)
                        Text("WAITING FOR YOU").type(.caption, .medium, mono: true).foregroundStyle(look.waiting)
                    }
                    HStack(spacing: 12) {
                        LogoTile(program: store.icon(of: s), size: 28)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(lead?.statusMessage ?? String(localized: "Waiting for your answer")).type(.body, .semibold).foregroundStyle(look.ink).lineLimit(2)
                            Text("\(AgentKind(program: store.icon(of: s))?.command ?? "") · \(store.project(s.projectId)?.name ?? String(localized: "Terminal"))")
                                .type(.caption).foregroundStyle(look.muted)
                        }
                    }
                    HStack {
                        Spacer()
                        Button("Show") { show(s.id, pane: lead?.id) }.buttonStyle(TZButtonStyle(kind: .primary, small: true))
                    }
                }
                .padding(12)
                .background(look.waiting.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(look.waiting.opacity(0.35)))
            }

            section("WORKING", store.workingSessions)
            section("DONE", store.sessions.filter { store.status(of: $0) == .done })
            if store.sessions.isEmpty {
                Text("No sessions yet.").type(.body).foregroundStyle(look.muted).padding(.horizontal, 10)
            }

            Rectangle().fill(look.line).frame(height: 1).padding(.horizontal, -8)
            menuRow("Open Tezgah", "") { NSApp.activate(); NSApp.windows.first { $0.isVisible || $0.isMiniaturized }?.makeKeyAndOrderFront(nil); close() }
            menuRow("Settings…", "⌘,") { NSApp.activate(); AppActions.openSettings(); close() }
            menuRow("Quit Tezgah", "⌘Q") { NSApp.terminate(nil) }
        }
        .padding(8)
        .frame(width: 360)
        .background(look.raised)
    }

    private var summary: String {
        let w = store.workingSessions.count, b = store.waitingSessions.count
        return String(localized: "\(w) working · \(b) waiting")
    }

    @ViewBuilder private func section(_ title: String, _ sessions: [Session]) -> some View {
        if !sessions.isEmpty {
            Text(LocalizedStringKey(title)).type(.caption, .medium, mono: true).foregroundStyle(look.muted).padding(.horizontal, 10).padding(.top, 4)
            ForEach(sessions) { s in
                Button { show(s.id, pane: nil) } label: {
                    HStack(spacing: 12) {
                        LogoTile(program: store.icon(of: s), size: 28)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(store.leadPane(of: s)?.statusMessage ?? store.sessionTitle(s)).type(.body, .medium).foregroundStyle(look.ink).lineLimit(1)
                            Text("\(AgentKind(program: store.icon(of: s))?.command ?? "") · \(store.project(s.projectId)?.name ?? String(localized: "Terminal"))")
                                .type(.caption).foregroundStyle(look.muted)
                        }
                        Spacer()
                        StateMark(state: store.status(of: s))
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func menuRow(_ title: LocalizedStringKey, _ keys: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack { Text(title).type(.body).foregroundStyle(look.ink); Spacer(); KeyHint(keys: keys) }
                .padding(.horizontal, 10).frame(height: 30).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func show(_ id: String, pane: String?) {
        NSApp.activate()
        store.open(session: id, pane: pane)
        NSApp.windows.first { $0.contentViewController is NSHostingController<AnyView> || $0.title == "Tezgah" }?.makeKeyAndOrderFront(nil)
        close()
    }
}
