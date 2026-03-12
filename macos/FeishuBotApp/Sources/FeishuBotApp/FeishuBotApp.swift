import AppKit
import SwiftUI

struct AppWindowLayout {
  let targetContentSize: NSSize
  let minimumContentSize: NSSize
  let maximumContentSize: NSSize
  let center: Bool
  let resizable: Bool
}

enum AppWindowController {
  private static let onboardingSize = NSSize(width: 500, height: 400)
  private static let consoleDefaultSize = NSSize(width: 760, height: 420)
  private static let consoleMinimumSize = NSSize(width: 680, height: 380)
  private static let sheetMinimumSize = NSSize(width: 520, height: 320)
  private static let consoleMaximumHeight: CGFloat = 620
  private static let horizontalMargin: CGFloat = 88
  private static let verticalMargin: CGFloat = 84
  private static let windowFrameDefaultsPrefix = "NSWindow Frame "

  static var onboardingDefaultSize: CGSize {
    CGSize(width: onboardingSize.width, height: onboardingSize.height)
  }

  static var consoleDefaultCGSize: CGSize {
    CGSize(width: consoleDefaultSize.width, height: consoleDefaultSize.height)
  }

  @MainActor
  static func currentSheetCGSize(idealWidth: CGFloat, idealHeight: CGFloat) -> CGSize {
    let idealSize = NSSize(width: idealWidth, height: idealHeight)
    let visibleFrame = NSApp.keyWindow?.screen?.visibleFrame
      ?? NSApp.mainWindow?.screen?.visibleFrame
      ?? NSApp.windows.first?.screen?.visibleFrame
      ?? NSScreen.main?.visibleFrame
      ?? .zero
    let resolvedSize = sheetContentSize(idealSize: idealSize, visibleFrame: visibleFrame)
    return CGSize(width: resolvedSize.width, height: resolvedSize.height)
  }

  static func resetPersistedWindowFrames(userDefaults: UserDefaults = .standard) {
    for key in userDefaults.dictionaryRepresentation().keys where key.hasPrefix(windowFrameDefaultsPrefix) {
      userDefaults.removeObject(forKey: key)
    }
  }

  static func apply(for mode: AppMode) {
    DispatchQueue.main.async {
      guard let window = NSApp.windows.first else {
        return
      }

      let visibleFrame = normalizedVisibleFrame(
        window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero,
        chromeHeight: max(window.frame.height - window.contentLayoutRect.height, 0)
      )
      let chromeHeight = max(window.frame.height - window.contentLayoutRect.height, 0)
      let layout = layout(
        for: mode,
        visibleFrame: visibleFrame,
        chromeHeight: chromeHeight
      )

      window.contentMinSize = layout.minimumContentSize
      window.contentMaxSize = layout.maximumContentSize
      if layout.resizable {
        window.styleMask.insert(.resizable)
      } else {
        window.styleMask.remove(.resizable)
      }
      window.standardWindowButton(.zoomButton)?.isEnabled = layout.resizable
      setWindowFrame(window, contentSize: layout.targetContentSize, visibleFrame: visibleFrame, center: layout.center)
    }
  }

  static func layout(
    for mode: AppMode,
    visibleFrame: NSRect,
    chromeHeight: CGFloat
  ) -> AppWindowLayout {
    let maximumContentSize = resolvedMaximumContentSize(visibleFrame: visibleFrame, chromeHeight: chromeHeight)

    switch mode {
    case .onboarding:
      let targetSize = NSSize(
        width: min(onboardingSize.width, maximumContentSize.width),
        height: min(onboardingSize.height, maximumContentSize.height)
      )
      return AppWindowLayout(
        targetContentSize: targetSize,
        minimumContentSize: targetSize,
        maximumContentSize: targetSize,
        center: true,
        resizable: false
      )
    case .console:
      let minimumContentSize = NSSize(
        width: min(consoleMinimumSize.width, maximumContentSize.width),
        height: min(consoleMinimumSize.height, maximumContentSize.height)
      )
      let preferredSize = NSSize(
        width: min(consoleDefaultSize.width, maximumContentSize.width),
        height: min(consoleDefaultSize.height, maximumContentSize.height)
      )

      return AppWindowLayout(
        targetContentSize: preferredSize,
        minimumContentSize: minimumContentSize,
        maximumContentSize: maximumContentSize,
        center: false,
        resizable: true
      )
    }
  }

  static func sheetContentSize(idealSize: NSSize, visibleFrame: NSRect) -> NSSize {
    guard visibleFrame.width > 0, visibleFrame.height > 0 else {
      return idealSize
    }

    let maximumContentSize = NSSize(
      width: max(visibleFrame.width - horizontalMargin, sheetMinimumSize.width),
      height: max(visibleFrame.height - verticalMargin, sheetMinimumSize.height)
    )

    return NSSize(
      width: min(idealSize.width, maximumContentSize.width),
      height: min(idealSize.height, maximumContentSize.height)
    )
  }

  @MainActor
  private static func setWindowFrame(
    _ window: NSWindow,
    contentSize: NSSize,
    visibleFrame: NSRect,
    center: Bool
  ) {
    var frameSize = window.frameRect(forContentRect: NSRect(origin: .zero, size: contentSize)).size
    frameSize.width = min(frameSize.width, visibleFrame.width)
    frameSize.height = min(frameSize.height, visibleFrame.height)
    var nextFrame = window.frame
    nextFrame.size = frameSize

    if center || nextFrame.width <= 0 || nextFrame.height <= 0 {
      nextFrame.origin.x = visibleFrame.midX - (nextFrame.width / 2)
      nextFrame.origin.y = visibleFrame.midY - (nextFrame.height / 2)
    }

    if nextFrame.maxX > visibleFrame.maxX {
      nextFrame.origin.x = visibleFrame.maxX - nextFrame.width
    }
    if nextFrame.minX < visibleFrame.minX {
      nextFrame.origin.x = visibleFrame.minX
    }
    if nextFrame.maxY > visibleFrame.maxY {
      nextFrame.origin.y = visibleFrame.maxY - nextFrame.height
    }
    if nextFrame.minY < visibleFrame.minY {
      nextFrame.origin.y = visibleFrame.minY
    }

    window.setFrame(nextFrame, display: true, animate: false)
  }

  private static func normalizedVisibleFrame(_ visibleFrame: NSRect, chromeHeight: CGFloat) -> NSRect {
    if visibleFrame.width > 0, visibleFrame.height > 0 {
      return visibleFrame
    }

    let fallbackWidth = max(onboardingSize.width, consoleDefaultSize.width) + horizontalMargin
    let fallbackHeight = min(max(onboardingSize.height, consoleDefaultSize.height), consoleMaximumHeight) + chromeHeight + verticalMargin
    return NSRect(origin: .zero, size: NSSize(width: fallbackWidth, height: fallbackHeight))
  }

  private static func resolvedMaximumContentSize(visibleFrame: NSRect, chromeHeight: CGFloat) -> NSSize {
    NSSize(
      width: max(visibleFrame.width - horizontalMargin, 0),
      height: max(min(visibleFrame.height - chromeHeight - verticalMargin, consoleMaximumHeight), 0)
    )
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  static weak var sharedStore: ConsoleStore?

  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.main.async {
      guard let window = NSApp.windows.first else {
        return
      }
      window.backgroundColor = .windowBackgroundColor
      window.isRestorable = false
      window.disableSnapshotRestoration()
      window.titlebarAppearsTransparent = true
      window.titleVisibility = .hidden
      window.toolbarStyle = .unified
      window.isMovableByWindowBackground = true
      AppWindowController.apply(for: .onboarding)
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    AppDelegate.sharedStore?.shutdownOnTerminate()
  }
}

struct FeishuBotApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var store: ConsoleStore

  init() {
    let runtimeHome = ConsolePaths.runtimeHome()
    try? FileManager.default.createDirectory(at: runtimeHome, withIntermediateDirectories: true, attributes: nil)
    guard let bridge = try? BridgeClient(runtimeHome: runtimeHome) else {
      fatalError("Unable to locate the desktop bridge runtime. Run `pnpm build` before launching the native app.")
    }
    let supervisor = BackendSupervisor(bridge: bridge)
    let store = ConsoleStore(bridge: bridge, supervisor: supervisor)
    _store = StateObject(wrappedValue: store)
    AppDelegate.sharedStore = store
  }

  var body: some Scene {
    configuredWindowGroup
  }

  private var configuredWindowGroup: some Scene {
    WindowGroup {
      RootConsoleView(store: store)
        .task {
          await store.load()
        }
        .onAppear {
          AppWindowController.apply(for: store.appMode)
        }
        .onChange(of: store.appMode) { _, newValue in
          AppWindowController.apply(for: newValue)
        }
    }
    .defaultSize(width: AppWindowController.onboardingDefaultSize.width, height: AppWindowController.onboardingDefaultSize.height)
    .windowResizability(.contentMinSize)
    .commands {
      CommandGroup(replacing: .newItem) {}
    }
  }
}
