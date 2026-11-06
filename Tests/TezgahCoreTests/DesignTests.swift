import Testing
@testable import TezgahCore

@Suite struct DesignTests {
    @Test func everyThemeIsReadable() {
        for t in Themes.all {
            #expect(t.foreground.contrast(with: t.background) >= 7, "\(t.id) text")
            #expect(t.muted.contrast(with: t.background) >= 4.5, "\(t.id) muted")
            for (name, c) in [("red", t.red), ("green", t.green), ("yellow", t.yellow), ("blue", t.blue),
                              ("magenta", t.magenta), ("cyan", t.cyan)] {
                #expect(c.contrast(with: t.background) >= 4.5, "\(t.id) \(name) \(c)")
            }
        }
    }

    @Test func themesAreBalanced() {
        #expect(Themes.all.count == 16)
        #expect(Themes.all.filter { $0.kind == .light }.count == 8)
        #expect(Set(Themes.all.map(\.id)).count == Themes.all.count)
        #expect(Themes.theme(Themes.defaultLight)?.kind == .light)
        #expect(Themes.theme(Themes.defaultDark)?.kind == .dark)
        #expect(Themes.all.allSatisfy { $0.ansi.count == 16 })
    }

    @Test func surfacesStepTheRightWay() {
        let paper = Themes.theme("kagit")!
        #expect(paper.base.luminance < paper.raised.luminance)
        let night = Themes.theme("gece")!
        #expect(night.raised.luminance > night.base.luminance)
    }

    @Test func stateColoursAreReadableOnPaperAndNight() {
        let paper = Themes.theme("kagit")!.background, night = Themes.theme("gece")!.background
        for f in [StateColors.working, StateColors.waiting, StateColors.done, StateColors.failed] {
            #expect(f(false).contrast(with: paper) >= 4.5)
            #expect(f(true).contrast(with: night) >= 4.5)
        }
    }

    @Test func measuresSitOnTheGrid() {
        for s in Grid.Space.all { #expect(s.truncatingRemainder(dividingBy: Grid.unit) == 0) }
        for t in TypeScale.allCases { #expect(t.lineHeight.truncatingRemainder(dividingBy: Grid.unit) == 0, "\(t)") }
        #expect(Grid.Radius.inner(outer: 16, padding: 8) == 8)
        #expect(Grid.Paper.small == 4 * 6 && Grid.Paper.big == 16 * 6)
    }

    @Test func mixingAndContrastAreSane() {
        #expect(RGB(0x000000).contrast(with: RGB(0xFFFFFF)) > 20.9)
        #expect(RGB(0x000000).mixed(with: RGB(0xFFFFFF), 0.5) == RGB(0x808080))
        #expect(RGB(0xFDFCFC).description == "#FDFCFC")
    }
}

@Suite struct ConversationsTests {
    @Test func claudeFolderNamesMatchClaudeCode() {
        #expect(Conversations.claudeFolderName(for: "/Users/yunusacar/Project/ai_studio") == "-Users-yunusacar-Project-ai-studio")
        #expect(Conversations.claudeFolderName(for: "/private/tmp/a.b c") == "-private-tmp-a-b-c")
        #expect(Conversations.claudeFolderName(for: "/Users/x/Projeler/çalışma") == "-Users-x-Projeler--al--ma")
    }
}
