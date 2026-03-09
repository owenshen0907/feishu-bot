import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  static weak var sharedStore: ConsoleStore?

  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.main.async {
      guard let window = NSApp.windows.first else {
        return
      }
      let fixedSize = NSSize(width: 1440, height: 900)
      window.setContentSize(fixedSize)
      window.minSize = fixedSize
      window.maxSize = fixedSize
      window.styleMask.remove(.resizable)
      window.titlebarAppearsTransparent = true
      window.titleVisibility = .hidden
      window.toolbarStyle = .unified
      window.isMovableByWindowBackground = true
      window.standardWindowButton(.zoomButton)?.isEnabled = false
      window.center()
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    AppDelegate.sharedStore?.shutdownOnTerminate()
  }
}

@main
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
    WindowGroup {
      RootConsoleView(store: store)
        .task {
          await store.load()
        }
    }
    .commands {
      CommandGroup(replacing: .newItem) {}
    }
  }
}
