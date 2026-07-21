// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "OpenGrow",
    platforms: [
           .iOS(.v13)
       ],
    products: [
        // Products define the executables and libraries a package produces, making them visible to other packages.
        .library(
            name: "OpenGrow",
            targets: ["OpenGrow"]),
    ],
    targets: [
        // Targets are the basic building blocks of a package, defining a module or a test suite.
        // Targets can depend on other targets in this package and products from dependencies.
        .target(
            name: "OpenGrow",
            resources: [
                .process("controllers/MessagesViewController.xib"),
                .process("controllers/MessageDetailsViewController.xib"),
                .process("view/MessageTableViewCell.xib"),
            ]),
        .testTarget(
            name: "mbzadevsTests",
            dependencies: ["OpenGrow"]),
    ],
    swiftLanguageVersions: [.v5]
)
