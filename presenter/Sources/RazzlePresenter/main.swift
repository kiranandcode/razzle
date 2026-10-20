import AppKit
import RazzleLayout

let options: Options
do {
    options = try Options.parse(Array(CommandLine.arguments.dropFirst()))
} catch {
    FileHandle.standardError.write("razzle-presenter: \(error)\n".data(using: .utf8)!)
    FileHandle.standardError.write(
        "usage: Razzle Presenter [--url http://localhost:7878] [--deck <id>] [--slide <n>] [--single] [--swap] [--dry-run-layout [x,y,w,h[,builtin];...]]\n"
            .data(using: .utf8)!)
    exit(2)
}

if options.dryRunLayout {
    func show(_ name: String, _ screens: [ScreenInfo]) {
        print("== \(name)")
        for s in screens {
            print("   screen \(s.index): \(Int(s.frame.minX)),\(Int(s.frame.minY)) \(Int(s.frame.width))x\(Int(s.frame.height))\(s.isBuiltin ? " builtin" : "")")
        }
        for (single, swap) in [(false, false), (false, true), (true, false), (true, true)] {
            let a = assignWindows(screens: screens, single: single, swap: swap)
            let tag = [single ? "--single" : nil, swap ? "--swap" : nil].compactMap { $0 }.joined(separator: " ")
            print("   \(tag.isEmpty ? "(default)" : tag): \(a.map(\.description) ?? "no windows")")
        }
    }
    if let spec = options.dryRunScreens {
        guard let screens = parseScreenSpec(spec) else {
            FileHandle.standardError.write("bad screen spec: \(spec)\n".data(using: .utf8)!)
            exit(2)
        }
        show("custom", screens)
    } else {
        for (name, screens) in sampleScreenSets { show(name, screens) }
    }
    exit(0)
}

let app = NSApplication.shared
// No arguments of our own: started from Finder or by a razzle-presenter:// link
let ownArgs = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-psn_") && !$0.hasPrefix("-NS") && !$0.hasPrefix("-Apple") }
let delegate = AppDelegate(options: options, awaitLink: ownArgs.isEmpty)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
