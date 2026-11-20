import AppKit
import SwiftUI
import TezgahCore
import UserNotifications

// MARK: - Notifications panel

/// What the bell opens: a small panel under it, as tall as what it has to show. It floats over the
/// page (a click outside closes it) instead of pushing the page aside.
struct NotificationsPanel: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @State private var filter: Filter = .all
    @State private var hover: UUID?

    enum Filter: CaseIterable { case all, waiting, done, failed }

    var body: some View {
        // Only the kinds that have something are offered; with one kind there is nothing to filter.
        let kinds = Filter.allCases.filter { f in f != .all && store.notifications.contains { matches($0, f) } }
        let current = kinds.contains(filter) ? filter : .all
        let items = store.notifications.filter { matches($0, current) }
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                Text("Notifications").type(.body, .semibold).foregroundStyle(look.ink)
                if store.unreadNotifications > 0 {
                    Text("\(store.unreadNotifications)").type(.caption, .medium, mono: true).foregroundStyle(look.accent)
                        .padding(.horizontal, 6).frame(height: 18)
                        .background(look.selected, in: Capsule())
                        .padding(.leading, 6)
                        .accessibilityLabel(Text("\(store.unreadNotifications) new"))
                }
                Spacer()
                if store.unreadNotifications > 0 {
                    IconButton(symbol: "checkmark.circle", label: "Mark All Read", size: 13) { store.markAllRead() }
                }
                if !store.notifications.isEmpty {
                    IconButton(symbol: "trash", label: "Clear All", size: 12) { store.notifications.removeAll() }
                }
                IconButton(symbol: "xmark", label: "Close Panel", size: 11) { store.notificationsOpen = false }
            }
            .padding(.leading, 14).padding(.trailing, 6).frame(height: 42)

            if kinds.count > 1 {
                HStack(spacing: 4) {
                    ForEach([Filter.all] + kinds, id: \.self) { f in
                        Button { filter = f } label: {
                            Text(title(f)).type(.caption, .medium)
                                .foregroundStyle(current == f ? look.accent : look.soft)
                                .padding(.horizontal, 10).frame(height: 24)
                                .background(current == f ? look.selected : .clear, in: Capsule())
                                .overlay(Capsule().strokeBorder(current == f ? look.selectedEdge : .clear))
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.horizontal, 10).padding(.bottom, 8)
            }
            Rectangle().fill(look.line).frame(height: 1)

            if items.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "bell").font(.system(size: 20, weight: .light)).foregroundStyle(look.faint)
                        .padding(.bottom, 2)
                    Text("No notifications").type(.body, .semibold).foregroundStyle(look.ink)
                    Text("When an agent waits for you or finishes its work, it shows up here.").type(.caption).foregroundStyle(look.muted)
                        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 28).padding(.vertical, 26)
                .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(items) { n in row(n) }
                    }
                    .padding(6)
                }
                .frame(maxHeight: min(440, max(120, store.windowHeight - 220)))
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(width: 360)
        .background(look.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(look.line))
        .shadow(color: .black.opacity(look.dark ? 0.5 : 0.16), radius: 24, y: 10)
        .onKeyPress(.escape) { store.notificationsOpen = false; return .handled }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Notifications"))
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
            if session != nil {
                store.notificationsOpen = false
                store.open(session: n.sessionId, pane: n.paneId)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: Text("Delete")) { store.notifications.removeAll { $0.id == n.id } }
    }

    private func matches(_ n: AppNotification, _ filter: Filter) -> Bool {
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
        s == .done ? String(localized: "Finished its work") : s == .error ? String(localized: "Stopped with an error") : String(localized: "Waiting for your answer")
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
    /// The notices on screen for each session, so they go when you've seen it or it closes.
    private static var delivered: [String: [String]] = [:]

    static func post(title: String, body: String, sessionId: String, sound: Bool) {
        let id = UUID().uuidString
        delivered[sessionId, default: []].append(id)
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            // Never asked (setup was skipped): the first notice is the moment to ask.
            if settings.authorizationStatus == .notDetermined {
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    if granted { deliver(id: id, title: title, body: body, sessionId: sessionId, sound: sound) }
                }
            } else {
                deliver(id: id, title: title, body: body, sessionId: sessionId, sound: sound)
            }
        }
    }

    /// Built where it is sent: a request can't cross from the main actor to the settings callback's thread.
    private nonisolated static func deliver(id: String, title: String, body: String, sessionId: String, sound: Bool) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.userInfo = ["session": sessionId]
        if sound { content.sound = .default }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    static func clear(sessionId: String) {
        guard let ids = delivered.removeValue(forKey: sessionId), !ids.isEmpty else { return }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
    }
}

// MARK: - Menu bar

/// The menu bar item: the mark, its cursor blinking while an agent waits for you.
@MainActor
final class MenuBarController: NSObject {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private let store: AppStore
    private var timer: Timer?
    private var blinkOn = true
    private struct Shown: Equatable { var cursor: Bool; var waiting: Bool; var working: Bool; var badge: String? }
    private var last: Shown?

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
        // The cursor blinks only while something waits for you, like the mark in the window's bar.
        blinkOn = waiting && !reduce ? !blinkOn : true
        let badge = UserDefaults.standard.object(forKey: "notify.badge") as? Bool ?? true
        let label = waiting && badge ? "\(store.waitingSessions.count)" : nil
        // Only when something changed: twice a second for ever is a lot of redrawing for a still icon.
        let shown = Shown(cursor: blinkOn, waiting: waiting, working: working, badge: label)
        guard shown != last else { return }
        last = shown
        item.button?.image = Self.icon(cursor: blinkOn, dot: false)
        item.button?.setAccessibilityValue(waiting ? String(localized: "an agent is waiting for you") : working ? String(localized: "agents working") : "")
        NSApp.dockTile.badgeLabel = label
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

            // However many sessions there are, Open, Settings and Quit stay on the screen.
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
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
                }
            }
            .scrollIndicators(.automatic)
            .frame(maxHeight: 420)
            .fixedSize(horizontal: false, vertical: true)

            Rectangle().fill(look.line).frame(height: 1).padding(.horizontal, -8)
            menuRow("Open Tezgah", "") { (NSApp.delegate as? AppDelegate)?.showMainWindow(); close() }
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
        (NSApp.delegate as? AppDelegate)?.showMainWindow()
        store.open(session: id, pane: pane)
        close()
    }
}
