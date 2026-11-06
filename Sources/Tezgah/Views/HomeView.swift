import SwiftUI
import TezgahCore

/// Home: who waits for you, who is working, recent projects. (Filled in step 2.)
struct HomeView: View {
    @Environment(\.look) private var look

    var body: some View {
        ZStack {
            look.base
            PaperGrid().clipShape(RoundedRectangle(cornerRadius: Grid.Radius.card, style: .continuous))
            VStack(spacing: Grid.Space.s4) {
                TezgahMark(width: 56, blinking: true)
                Text("Home").type(.title3, .semibold).foregroundStyle(look.ink)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: Grid.Radius.card, style: .continuous).strokeBorder(look.line))
        .padding(Grid.Space.s2)
    }
}

/// A project's board. (Filled in step 2.)
struct BoardView: View {
    @Environment(\.look) private var look
    let project: ProjectRecord

    var body: some View {
        VStack(spacing: Grid.Space.s3) {
            Monogram(name: project.name, size: 44, active: true)
            Text(project.name).type(.title2, .semibold).foregroundStyle(look.ink)
            Text(Paths.tilde(project.path)).type(.caption, mono: true).foregroundStyle(look.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .card(look)
        .padding(Grid.Space.s2)
    }
}
