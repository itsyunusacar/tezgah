import SwiftUI
import TezgahCore

/// The opening, once per launch: the window is all sky, the bench rises and its cursor lands on it,
/// then the sky lifts like a curtain to become home's header and the mark walks to its place there.
/// A click skips it. With Reduce Motion it is a still mark that fades.
struct LaunchView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.look) private var look
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var bench = false
    @State private var cursor = false
    @State private var cursorOn = true
    @State private var word = false
    /// The sky has lifted to home's horizon and the mark stands where home keeps it.
    @State private var settled = false
    @State private var gone = false

    private static let centerWidth = 132.0
    /// Where home's header keeps the mark (HomeView.header).
    private static let homeWidth = 92.0
    private static let homeTrailing = 64.0

    var body: some View {
        GeometryReader { geo in
            SkyView()
                .overlay {
                    mark
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: settled ? .bottomTrailing : .center)
                        .padding(.trailing, settled ? Self.homeTrailing : 0)
                }
                .frame(height: settled ? HomeView.horizon : geo.size.height)
                .frame(maxHeight: .infinity, alignment: .top)
        }
        .opacity(gone ? 0 : 1)
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .accessibilityElement()
        .accessibilityLabel(Text("Tezgah"))
        .accessibilityAddTraits(.isImage)
        .task { await play() }
    }

    private var mark: some View {
        let width = settled ? Self.homeWidth : Self.centerWidth
        let height = width * MarkGeometry.viewBox.height / MarkGeometry.viewBox.width
        return ZStack {
            BenchShape().fill(.white)
                .offset(y: bench ? 0 : 28)
                .opacity(bench ? 1 : 0)
            CursorBlockShape().fill(.white)
                .offset(y: cursor ? 0 : -26)
                .opacity(cursor && cursorOn ? 1 : 0)
        }
        .frame(width: width, height: height)
        .overlay(alignment: .bottom) {
            Text("Tezgah")
                .font(Typeface.sans(22, .semibold))
                .foregroundStyle(.white)
                .fixedSize()
                .offset(y: 48)
                .opacity(word ? 1 : 0)
        }
    }

    private func play() async {
        if reduceMotion {
            bench = true
            cursor = true
            word = true
            await pause(0.8)
            finish()
            return
        }
        await pause(0.15)
        withAnimation(.spring(response: 0.55, dampingFraction: 0.78)) { bench = true }
        await pause(0.42)
        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { cursor = true }
        await pause(0.28)
        withAnimation(.easeOut(duration: 0.4)) { word = true }
        await pause(0.34)
        cursorOn = false
        await pause(0.16)
        cursorOn = true
        await pause(0.24)
        withAnimation(.timingCurve(Motion.easeOut.0, Motion.easeOut.1, Motion.easeOut.2, Motion.easeOut.3, duration: 0.7)) {
            settled = true
            word = false
        }
        await pause(0.74)
        finish()
    }

    /// Fades into home (whose header is the same sky and mark) and steps out of the way.
    private func finish() {
        guard !gone else { return }
        withAnimation(.easeOut(duration: 0.2)) { gone = true }
        Task {
            await pause(0.22)
            store.launching = false
        }
    }

    private func pause(_ seconds: Double) async {
        try? await Task.sleep(for: .seconds(seconds))
    }
}
