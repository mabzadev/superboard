// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SuperBoard",
    platforms: [.iOS(.v13)],
    products: [
        .library(name: "SuperBoard", targets: ["SuperBoard"]),
    ],
    targets: [
        .target(
            name: "SuperBoard",
            path: "sdks/ios/Sources/SuperBoard",
            resources: [
                .process("controllers/MessagesViewController.xib"),
                .process("controllers/MessageDetailsViewController.xib"),
                .process("view/MessageTableViewCell.xib"),
            ]
        ),
        .testTarget(
            name: "SuperBoardTests",
            dependencies: ["SuperBoard"],
            path: "tests/checks/sdks/ios"
        ),
    ]
)
