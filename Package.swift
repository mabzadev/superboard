// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenGrow",
    platforms: [.iOS(.v13)],
    products: [
        .library(name: "OpenGrow", targets: ["OpenGrow"]),
    ],
    targets: [
        .target(
            name: "OpenGrow",
            path: "sdks/ios/Sources/OpenGrow",
            resources: [
                .process("controllers/MessagesViewController.xib"),
                .process("controllers/MessageDetailsViewController.xib"),
                .process("view/MessageTableViewCell.xib"),
            ]
        ),
        .testTarget(
            name: "OpenGrowTests",
            dependencies: ["OpenGrow"],
            path: "sdks/ios/Tests/opengrow-iosTests"
        ),
    ]
)
