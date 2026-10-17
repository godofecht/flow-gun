// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GardenANE",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "garden-ane", targets: ["GardenANE"])],
    targets: [
        .executableTarget(name: "GardenANE"),
        .testTarget(name: "GardenANETests", dependencies: ["GardenANE"])
    ]
)
