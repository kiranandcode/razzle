import Foundation
import CoreGraphics

/// A display as the layout logic sees it. `index` is the position in `NSScreen.screens`
/// (index 0 is the screen carrying the menu bar).
public struct ScreenInfo: Equatable {
    public var index: Int
    public var frame: CGRect
    public var isBuiltin: Bool

    public init(index: Int, frame: CGRect, isBuiltin: Bool) {
        self.index = index
        self.frame = frame
        self.isBuiltin = isBuiltin
    }
}

/// Which screen (by `ScreenInfo.index`) each role's window goes on. `speaker == nil` means
/// no speaker window.
public struct Assignment: Equatable, CustomStringConvertible {
    public var audience: Int
    public var speaker: Int?

    public init(audience: Int, speaker: Int?) {
        self.audience = audience
        self.speaker = speaker
    }

    public var description: String {
        "audience=\(audience) speaker=\(speaker.map(String.init) ?? "none")"
    }
}

/// The presenter's "main" screen: the built-in (laptop) display if there is one, else the
/// menu-bar screen. This is where the speaker view goes.
public func mainScreenIndex(_ screens: [ScreenInfo]) -> Int? {
    if let b = screens.first(where: { $0.isBuiltin }) { return b.index }
    return screens.first?.index
}

/// Screen frames in, window assignments out.
///
/// - ≥2 screens: audience on the first non-main screen, speaker on the main screen.
/// - 1 screen, or `single`: audience only. With `single` and several screens the audience
///   still prefers the first non-main screen (the projector).
/// - `swap` exchanges the two roles' screens (with one window, it moves the audience to the
///   main screen when there is more than one screen).
public func assignWindows(screens: [ScreenInfo], single: Bool, swap: Bool) -> Assignment? {
    guard let main = mainScreenIndex(screens) else { return nil }
    guard let other = screens.first(where: { $0.index != main })?.index else {
        return Assignment(audience: main, speaker: nil)
    }
    var audience = other
    var speaker = main
    if swap { (audience, speaker) = (speaker, audience) }
    return Assignment(audience: audience, speaker: single ? nil : speaker)
}

/// Parsed command line.
public struct Options: Equatable {
    public var url = "http://localhost:7878"
    public var deck: String?
    public var slide: Int?
    public var single = false
    public var swap = false
    public var dryRunLayout = false
    public var dryRunScreens: String?

    public init() {}

    public static func parse(_ args: [String]) throws -> Options {
        var o = Options()
        var i = 0
        func value(_ flag: String) throws -> String {
            i += 1
            guard i < args.count else { throw OptionError.missingValue(flag) }
            return args[i]
        }
        while i < args.count {
            let a = args[i]
            switch a {
            case "--url": o.url = try value(a)
            case "--deck": o.deck = try value(a)
            case "--slide":
                let v = try value(a)
                guard let n = Int(v) else { throw OptionError.badValue(a, v) }
                o.slide = n
            case "--single": o.single = true
            case "--swap": o.swap = true
            case "--dry-run-layout":
                o.dryRunLayout = true
                // Optional screen spec: "x,y,w,h[,builtin];x,y,w,h;..."
                if i + 1 < args.count, !args[i + 1].hasPrefix("--") {
                    o.dryRunScreens = args[i + 1]
                    i += 1
                }
            default:
                // Ignore arguments macOS may inject (e.g. -NSDocumentRevisionsDebugMode, -psn_*).
                if a.hasPrefix("-psn_") || a.hasPrefix("-NS") || a.hasPrefix("-Apple") {
                    if a.hasPrefix("-NS") || a.hasPrefix("-Apple") { i += 1 }
                } else {
                    throw OptionError.unknown(a)
                }
            }
            i += 1
        }
        while o.url.hasSuffix("/") { o.url.removeLast() }
        return o
    }

    public func pageURL(view: String) -> URL? {
        var q = "view=\(view)"
        if let d = deck {
            let enc = d.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=#+"))) ?? d
            q += "&deck=\(enc)"
        }
        if let s = slide { q += "&slide=\(s)" }
        return URL(string: "\(url)/#/present?\(q)")
    }
}

public enum OptionError: Error, CustomStringConvertible {
    case missingValue(String), badValue(String, String), unknown(String)
    public var description: String {
        switch self {
        case .missingValue(let f): return "missing value for \(f)"
        case .badValue(let f, let v): return "bad value for \(f): \(v)"
        case .unknown(let a): return "unknown argument: \(a)"
        }
    }
}

/// Parse "x,y,w,h[,builtin];..." into fake screens for `--dry-run-layout`.
public func parseScreenSpec(_ spec: String) -> [ScreenInfo]? {
    var out: [ScreenInfo] = []
    for (i, part) in spec.split(separator: ";").enumerated() {
        let f = part.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard f.count == 4 || f.count == 5 else { return nil }
        let nums = f.prefix(4).compactMap(Double.init)
        guard nums.count == 4 else { return nil }
        let builtin = f.count == 5 && f[4] == "builtin"
        if f.count == 5 && !builtin { return nil }
        out.append(ScreenInfo(index: i, frame: CGRect(x: nums[0], y: nums[1], width: nums[2], height: nums[3]),
                              isBuiltin: builtin))
    }
    return out
}

/// Built-in scenarios printed by `--dry-run-layout` with no spec.
public let sampleScreenSets: [(String, [ScreenInfo])] = [
    ("no screens", []),
    ("laptop only", [ScreenInfo(index: 0, frame: CGRect(x: 0, y: 0, width: 1512, height: 982), isBuiltin: true)]),
    ("laptop (menu bar) + projector", [
        ScreenInfo(index: 0, frame: CGRect(x: 0, y: 0, width: 1512, height: 982), isBuiltin: true),
        ScreenInfo(index: 1, frame: CGRect(x: 1512, y: 0, width: 1920, height: 1080), isBuiltin: false),
    ]),
    ("projector holds the menu bar, laptop second", [
        ScreenInfo(index: 0, frame: CGRect(x: 0, y: 0, width: 1920, height: 1080), isBuiltin: false),
        ScreenInfo(index: 1, frame: CGRect(x: -1512, y: 0, width: 1512, height: 982), isBuiltin: true),
    ]),
    ("desktop: two externals, no built-in", [
        ScreenInfo(index: 0, frame: CGRect(x: 0, y: 0, width: 2560, height: 1440), isBuiltin: false),
        ScreenInfo(index: 1, frame: CGRect(x: 2560, y: 0, width: 1920, height: 1080), isBuiltin: false),
    ]),
    ("laptop + two externals", [
        ScreenInfo(index: 0, frame: CGRect(x: 0, y: 0, width: 1512, height: 982), isBuiltin: true),
        ScreenInfo(index: 1, frame: CGRect(x: 1512, y: 0, width: 1920, height: 1080), isBuiltin: false),
        ScreenInfo(index: 2, frame: CGRect(x: -2560, y: 0, width: 2560, height: 1440), isBuiltin: false),
    ]),
]
