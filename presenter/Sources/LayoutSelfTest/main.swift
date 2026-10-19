// Framework-free tests for the pure layout logic (the Command Line Tools' swift-testing
// install cannot load its interop dylib). Run: swift run LayoutSelfTest
import Foundation
import CoreGraphics

var failures = 0
var checks = 0
func expect(_ ok: Bool, _ what: String, line: Int = #line) {
    checks += 1
    if !ok { failures += 1; print("FAIL line \(line): \(what)") }
}
import CoreGraphics
import RazzleLayout

private let laptop = CGRect(x: 0, y: 0, width: 1512, height: 982)
private let proj = CGRect(x: 1512, y: 0, width: 1920, height: 1080)

func noScreens() {
    expect(assignWindows(screens: [], single: false, swap: false) == nil, "assignWindows(screens: [], single: false, swap: false) == nil")
}

func oneScreenAudienceOnly() {
    let s = [ScreenInfo(index: 0, frame: laptop, isBuiltin: true)]
    expect(assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 0, speaker: nil), "assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 0, speaker: nil)")
    expect(assignWindows(screens: s, single: false, swap: true) == Assignment(audience: 0, speaker: nil), "assignWindows(screens: s, single: false, swap: true) == Assignment(audience: 0, speaker: nil)")
}

func laptopPlusProjector() {
    let s = [ScreenInfo(index: 0, frame: laptop, isBuiltin: true),
             ScreenInfo(index: 1, frame: proj, isBuiltin: false)]
    expect(assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 1, speaker: 0), "assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 1, speaker: 0)")
    expect(assignWindows(screens: s, single: false, swap: true) == Assignment(audience: 0, speaker: 1), "assignWindows(screens: s, single: false, swap: true) == Assignment(audience: 0, speaker: 1)")
    expect(assignWindows(screens: s, single: true, swap: false) == Assignment(audience: 1, speaker: nil), "assignWindows(screens: s, single: true, swap: false) == Assignment(audience: 1, speaker: nil)")
}

func projectorIsMenuBarScreen() {
    // Speaker stays on the built-in display even when the projector holds the menu bar.
    let s = [ScreenInfo(index: 0, frame: proj, isBuiltin: false),
             ScreenInfo(index: 1, frame: laptop, isBuiltin: true)]
    expect(assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 0, speaker: 1), "assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 0, speaker: 1)")
}

func noBuiltinUsesMenuBarScreenAsMain() {
    let s = [ScreenInfo(index: 0, frame: laptop, isBuiltin: false),
             ScreenInfo(index: 1, frame: proj, isBuiltin: false),
             ScreenInfo(index: 2, frame: proj.offsetBy(dx: 1920, dy: 0), isBuiltin: false)]
    expect(assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 1, speaker: 0), "assignWindows(screens: s, single: false, swap: false) == Assignment(audience: 1, speaker: 0)")
}

func optionsAndURLs() {
    let o = try! Options.parse(["--url", "http://localhost:9000/", "--deck", "talk 1", "--slide", "3", "--swap"])
    expect(o.url == "http://localhost:9000", "o.url == \"http://localhost:9000\"")
    expect(o.swap && !o.single, "o.swap && !o.single")
    expect(o.pageURL(view: "audience")?.absoluteString
            == "http://localhost:9000/#/present?view=audience&deck=talk%201&slide=3", "audience URL")
    expect((try? Options.parse(["--bogus"])) == nil, "(try? Options.parse([\"--bogus\"])) == nil")
}

func screenSpec() {
    let s = parseScreenSpec("0,0,1512,982,builtin;1512,0,1920,1080")
    expect(s?.count == 2, "s?.count == 2")
    expect(s?[0].isBuiltin == true, "s?[0].isBuiltin == true")
    expect(parseScreenSpec("1,2,3") == nil, "parseScreenSpec(\"1,2,3\") == nil")
}

noScreens()
oneScreenAudienceOnly()
laptopPlusProjector()
projectorIsMenuBarScreen()
noBuiltinUsesMenuBarScreenAsMain()
optionsAndURLs()
screenSpec()
print("\(checks) checks, \(failures) failures")
exit(failures == 0 ? 0 : 1)
