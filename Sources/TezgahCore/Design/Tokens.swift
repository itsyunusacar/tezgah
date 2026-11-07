import Foundation

/// The measures every screen is built from. One unit is 4 pt; everything else is a multiple.
public enum Grid {
    public static let unit: Double = 4

    /// Spacing steps: 1, 2, 3, 4, 6, 8, 12 and 16 units.
    public enum Space {
        public static let s1 = 4.0, s2 = 8.0, s3 = 12.0, s4 = 16.0, s6 = 24.0, s8 = 32.0, s12 = 48.0, s16 = 64.0
        public static let all = [s1, s2, s3, s4, s6, s8, s12, s16]
    }

    /// Corner radii. Nested corners use outer − padding.
    public enum Radius {
        /// Tags, badges, small marks.
        public static let tag = 4.0
        /// Buttons, fields, rows.
        public static let control = 8.0
        /// Cards, panes, sheets.
        public static let card = 12.0
        /// Windows and the big onboarding panels.
        public static let window = 16.0

        public static func inner(outer: Double, padding: Double) -> Double { max(0, outer - padding) }
    }

    /// Squared paper behind onboarding and empty screens: the logo is drawn at 1 unit = 6 pt, so a small
    /// square is 4 logo units and a big one 16.
    public enum Paper {
        public static let small = 24.0
        public static let big = 96.0
    }
}

/// The type scale. The body is 13 pt like macOS; the biggest title is 28 pt (34 only on the first-run
/// page). Line heights sit on the 4 pt grid.
public enum TypeScale: CaseIterable, Sendable {
    case caption, small, body, lead, title3, title2, title1, display

    public var size: Double {
        switch self {
        case .caption: 11
        case .small: 12
        case .body: 13
        case .lead: 15
        case .title3: 17
        case .title2: 22
        case .title1: 28
        case .display: 34
        }
    }

    public var lineHeight: Double {
        switch self {
        case .caption, .small: 16
        case .body: 20
        case .lead, .title3: 24
        case .title2: 28
        case .title1: 36
        case .display: 40
        }
    }

    /// Big type is set a little tighter.
    public var tracking: Double {
        switch self {
        case .display, .title1: -0.022
        case .title2: -0.015
        case .title3: -0.01
        default: 0
        }
    }
}

/// Durations and curves. Reduce Motion turns movement into fades and stops the blinking.
public enum Motion {
    /// Hover, press, selection.
    public static let quick = 0.12
    /// Panels opening and closing, notifications.
    public static let standard = 0.2
    /// Page transitions: 24 pt slide plus fade.
    public static let page = 0.32
    public static let pageOffset = 24.0
    /// The cursor block's blink period.
    public static let blink = 1.06
    /// cubic-bezier(0.2, 0, 0, 1)
    public static let easeOut = (0.2, 0.0, 0.0, 1.0)
}

/// The Tezgah mark, in logo units: a 68 × 12 top, two 10 × 31 legs, a 13 × 18 cursor block, 3-unit fillets.
public enum MarkGeometry {
    public static let viewBox = (x: 16.0, y: 23.0, width: 68.0, height: 58.0)
    public static let top = (x: 16.0, y: 45.0, width: 68.0, height: 12.0, radius: 3.0)
    public static let legs = [(x: 25.0, y: 50.0, width: 10.0, height: 31.0, radius: 2.0),
                              (x: 65.0, y: 50.0, width: 10.0, height: 31.0, radius: 2.0)]
    public static let cursor = (x: 27.0, y: 23.0, width: 13.0, height: 18.0, radius: 2.0)
    public static let fillet = 3.0
    /// Clear space around the mark equals the top's thickness.
    public static let clearSpace = 12.0
}
