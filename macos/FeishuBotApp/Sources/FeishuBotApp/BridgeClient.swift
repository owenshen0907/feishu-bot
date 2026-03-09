import Foundation

enum BridgeClientError: LocalizedError {
  case runtimeNotFound
  case invalidResponse
  case processFailure(String)

  var errorDescription: String? {
    switch self {
    case .runtimeNotFound:
      return "未找到 Node bridge 运行时。请先执行 pnpm build，或使用打包后的 .app。"
    case .invalidResponse:
      return "bridge 返回了无法解析的数据。"
    case .processFailure(let message):
      return message
    }
  }
}

struct RuntimePaths {
  var executableURL: URL
  var argumentsPrefix: [String]
  var bridgeScriptURL: URL

  static func resolve() throws -> RuntimePaths {
    if
      let resourceURL = Bundle.main.resourceURL,
      FileManager.default.fileExists(atPath: resourceURL.appendingPathComponent("backend/dist/desktop-bridge-cli.js").path),
      FileManager.default.fileExists(atPath: resourceURL.appendingPathComponent("bin/node").path)
    {
      return RuntimePaths(
        executableURL: resourceURL.appendingPathComponent("bin/node"),
        argumentsPrefix: [],
        bridgeScriptURL: resourceURL.appendingPathComponent("backend/dist/desktop-bridge-cli.js")
      )
    }

    let fileManager = FileManager.default
    let environment = ProcessInfo.processInfo.environment
    let explicitRoot = environment["FEISHU_BOT_REPO_ROOT"].map(URL.init(fileURLWithPath:))
    let currentDirectory = URL(fileURLWithPath: fileManager.currentDirectoryPath)
    let executableDirectory = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
    let candidates = [explicitRoot, currentDirectory, executableDirectory].compactMap { $0 }

    for candidate in candidates {
      var cursor = candidate
      while cursor.path != "/" {
        let packageURL = cursor.appendingPathComponent("package.json")
        let bridgeURL = cursor.appendingPathComponent("dist/desktop-bridge-cli.js")
        if fileManager.fileExists(atPath: packageURL.path), fileManager.fileExists(atPath: bridgeURL.path) {
          return RuntimePaths(
            executableURL: URL(fileURLWithPath: "/usr/bin/env"),
            argumentsPrefix: ["node"],
            bridgeScriptURL: bridgeURL
          )
        }
        cursor.deleteLastPathComponent()
      }
    }

    throw BridgeClientError.runtimeNotFound
  }
}

actor BridgeClient {
  private let runtimeHome: URL
  private let runtimePaths: RuntimePaths

  init(runtimeHome: URL) throws {
    self.runtimeHome = runtimeHome
    self.runtimePaths = try RuntimePaths.resolve()
  }

  func bootstrap() throws -> BridgeBootstrap {
    try performSync(command: "bootstrap", payload: Optional<SavePayload>.none)
  }

  func saveConfig(env: [String: String], settings: ConsoleSettings) throws -> BridgeBootstrap {
    try performSync(command: "save-config", payload: SavePayload(env: env, settings: settings))
  }

  func restartBackend() throws -> BridgeBootstrap {
    try performSync(command: "restart-backend", payload: Optional<SavePayload>.none)
  }

  func stopBackend() throws {
    let _: StopResponse = try performSync(command: "stop-backend", payload: Optional<SavePayload>.none)
  }

  func health() throws -> HealthProbe {
    try performSync(command: "health", payload: Optional<SavePayload>.none)
  }

  func openConfig() throws -> OpenPathResponse {
    try performSync(command: "open-config", payload: Optional<SavePayload>.none)
  }

  func openData() throws -> OpenPathResponse {
    try performSync(command: "open-data", payload: Optional<SavePayload>.none)
  }

  func sendFeishuTestMessage(receiveId: String, receiveIdType: FeishuTestReceiveType) throws -> FeishuTestMessageResult {
    try performSync(
      command: "send-test-message",
      payload: FeishuTestMessagePayload(receiveId: receiveId, receiveIdType: receiveIdType)
    )
  }

  private func performSync<Payload: Encodable, Result: Decodable>(command: String, payload: Payload?) throws -> Result {
    let process = Process()
    process.executableURL = runtimePaths.executableURL
    let requestData = try JSONEncoder().encode(CommandEnvelope(command: command, payload: payload))
    let requestString = String(decoding: requestData, as: UTF8.self)
    process.arguments = runtimePaths.argumentsPrefix + [runtimePaths.bridgeScriptURL.path, requestString]

    var environment = ProcessInfo.processInfo.environment
    environment["FEISHU_BOT_HOME"] = runtimeHome.path
    process.environment = environment

    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe
    try process.run()
    process.waitUntilExit()

    let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
    let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()

    if process.terminationStatus != 0 {
      if
        let failed = try? JSONDecoder().decode(FailureEnvelope.self, from: errorData),
        let message = failed.error
      {
        throw BridgeClientError.processFailure(message)
      }
      let fallback = String(decoding: errorData, as: UTF8.self)
      throw BridgeClientError.processFailure(fallback.isEmpty ? "bridge 进程执行失败。" : fallback)
    }

    let envelope = try JSONDecoder().decode(BridgeEnvelope<Result>.self, from: outputData)
    guard envelope.ok, let result = envelope.result else {
      throw BridgeClientError.processFailure(envelope.error ?? BridgeClientError.invalidResponse.localizedDescription)
    }
    return result
  }
}

struct OpenPathResponse: Decodable {
  var path: String
}

struct StopResponse: Decodable {
  var stopped: Bool
}

private struct CommandEnvelope<Payload: Encodable>: Encodable {
  var command: String
  var payload: Payload?
}

private struct FailureEnvelope: Decodable {
  var ok: Bool
  var error: String?
}

enum ConsolePaths {
  static func runtimeHome() -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSTemporaryDirectory())
    return base.appendingPathComponent("Feishu Bot", isDirectory: true)
  }
}
