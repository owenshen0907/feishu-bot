// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "FeishuBotApp",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .executable(
      name: "FeishuBotApp",
      targets: ["FeishuBotApp"]
    )
  ],
  targets: [
    .executableTarget(
      name: "FeishuBotApp",
      path: "Sources/FeishuBotApp"
    ),
    .testTarget(
      name: "FeishuBotAppTests",
      dependencies: ["FeishuBotApp"],
      path: "Tests/FeishuBotAppTests"
    )
  ]
)
