// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RazzlePresenter",
    platforms: [.macOS(.v13)],
    targets: [
        // Pure, AppKit-free logic: argument parsing, URL building, screen -> window layout.
        .target(name: "RazzleLayout"),
        .executableTarget(name: "RazzlePresenter", dependencies: ["RazzleLayout"]),
        .executableTarget(name: "LayoutSelfTest", dependencies: ["RazzleLayout"]),
    ]
)
