import Foundation
import TezgahCore

extension Durations {
    /// "now", "42s", "6m", "2h 5m", "3d", in the app's language.
    static func local(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds))
        if s < 5 { return String(localized: "now") }
        if s < 60 { return String(localized: "\(s)s") }
        if s < 3600 { return String(localized: "\(s / 60)m") }
        if s < 86400 {
            let m = (s % 3600) / 60
            return m == 0 ? String(localized: "\(s / 3600)h") : String(localized: "\(s / 3600)h \(m)m")
        }
        return String(localized: "\(s / 86400)d")
    }
}
