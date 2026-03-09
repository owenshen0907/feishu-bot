import Foundation

enum AppMode: String {
  case onboarding
  case console
}

enum OnboardingStep: Int, CaseIterable, Identifiable {
  case feishu
  case model
  case complete

  var id: Int { rawValue }

  var title: String {
    switch self {
    case .feishu: return "飞书接入"
    case .model: return "模型接入"
    case .complete: return "完成"
    }
  }

  var subtitle: String {
    switch self {
    case .feishu: return "填写机器人上线所需凭据"
    case .model: return "连接默认模型供应商"
    case .complete: return "确认基础接入并进入正式控制台"
    }
  }

  var symbol: String {
    switch self {
    case .feishu: return "message.badge"
    case .model: return "cpu"
    case .complete: return "checkmark.seal"
    }
  }
}

enum ConsoleSection: String, CaseIterable, Identifiable, Codable {
  case abilities
  case groups
  case users
  case system

  var id: String { rawValue }

  var title: String {
    switch self {
    case .abilities: return "能力配置"
    case .groups: return "群组"
    case .users: return "用户"
    case .system: return "系统设置"
    }
  }

  var subtitle: String {
    switch self {
    case .abilities: return "先完成全局接入和开关，再分配消费权限"
    case .groups: return "管理群组规则与可消费能力"
    case .users: return "管理用户规则，用户配置覆盖群组配置"
    case .system: return "运行状态、目录与后台操作"
    }
  }

  var symbol: String {
    switch self {
    case .abilities: return "switch.2"
    case .groups: return "person.3"
    case .users: return "person.crop.circle"
    case .system: return "gearshape"
    }
  }
}

enum FeishuTestReceiveType: String, CaseIterable, Identifiable, Codable {
  case chatID = "chat_id"
  case openID = "open_id"
  case userID = "user_id"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .chatID: return "chat_id"
    case .openID: return "open_id"
    case .userID: return "user_id"
    }
  }

  var placeholder: String {
    switch self {
    case .chatID: return "oc_xxx 或群 chat_id"
    case .openID: return "ou_xxx 或 open_id"
    case .userID: return "user_xxx 或 user_id"
    }
  }
}

enum RuleKind: String, Identifiable, CaseIterable {
  case groups
  case users

  var id: String { rawValue }

  var title: String {
    switch self {
    case .groups: return "群组"
    case .users: return "用户"
    }
  }

  var placeholder: String {
    switch self {
    case .groups: return "搜索群组 ID 或备注"
    case .users: return "搜索用户 ID 或备注"
    }
  }

  var emptyTitle: String {
    switch self {
    case .groups: return "还没有群组规则"
    case .users: return "还没有用户规则"
    }
  }

  var addTitle: String {
    switch self {
    case .groups: return "新增群组"
    case .users: return "新增用户"
    }
  }

  var overrideMessage: String? {
    switch self {
    case .groups: return nil
    case .users: return "当用户规则与群组规则同时命中时，以用户配置为准。"
    }
  }
}

enum AbilityKind: String, Identifiable, CaseIterable {
  case smartkit
  case webSearch
  case voiceReply
  case vision

  var id: String { rawValue }

  var title: String {
    switch self {
    case .smartkit: return "SmartKit"
    case .webSearch: return "联网搜索"
    case .voiceReply: return "语音回复"
    case .vision: return "视觉理解"
    }
  }

  var description: String {
    switch self {
    case .smartkit: return "接入 SmartKit 后，可把日志诊断能力授权给指定群组和用户。"
    case .webSearch: return "联网搜索需要先配置 Brave Search，再决定哪些对象可以消费。"
    case .voiceReply: return "语音回复复用当前模型接入，只在全局开启后才允许分配。"
    case .vision: return "视觉理解依赖模型接入，开启后才可在权限页分配。"
    }
  }

  var capabilityID: String { rawValue }
}

enum ActiveSheet: Identifiable {
  case advancedModel
  case advancedRuntime
  case abilityDetail(AbilityKind)

  var id: String {
    switch self {
    case .advancedModel: return "advanced-model"
    case .advancedRuntime: return "advanced-runtime"
    case .abilityDetail(let ability): return "ability-\(ability.rawValue)"
    }
  }
}

struct BridgeBootstrap: Codable {
  var runtimeHome: String
  var envPath: String
  var settingsPath: String
  var env: [String: String]
  var settings: ConsoleSettings
  var docs: BridgeDocs
  var catalogs: Catalogs
  var onboarding: OnboardingState
  var restartRequired: Bool
}

struct BridgeDocs: Codable {
  var stepApiKey: String
  var braveSearch: String
}

struct Catalogs: Codable {
  var providers: [CatalogProvider]
  var capabilities: [CatalogCapability]
  var braveEndpoint: String
}

struct CatalogProvider: Codable, Identifiable, Hashable {
  var id: String
  var name: String
  var baseUrl: String
  var chatModel: String
  var visionModel: String
  var ttsModel: String
}

struct CatalogCapability: Codable, Identifiable, Hashable {
  var id: String
  var label: String
  var configured: Bool
  var enabled: Bool
  var assignable: Bool
  var message: String
}

struct OnboardingState: Codable {
  struct Missing: Codable {
    var feishuAppId: Bool
    var feishuAppSecret: Bool
    var llmApiKey: Bool
  }

  var complete: Bool
  var missing: Missing
}

struct ConsoleSettings: Codable, Equatable {
  var version: Int = 2
  var permissions: PermissionsSettings = .init()
  var ui: ConsoleUIState = .init()
}

struct ConsoleUIState: Codable, Equatable {
  var onboardingCompleted: Bool = false
  var lastVisitedSection: ConsoleSection = .abilities
  var feishuTestReceiveId: String = ""
  var feishuTestReceiveIdType: FeishuTestReceiveType = .chatID
}

struct PermissionsSettings: Codable, Equatable {
  var defaultMode: String = "allow"
  var groups: [ConsoleRule] = []
  var users: [ConsoleRule] = []
}

struct ConsoleRule: Codable, Equatable, Hashable, Identifiable {
  var id: String = ""
  var name: String = ""
  var mode: String = "allow"
  var note: String = ""
  var capabilities: RuleCapabilities = .init()

  var displayName: String {
    if !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return name
    }
    if !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return id
    }
    return "未命名规则"
  }
}

struct RuleCapabilities: Codable, Equatable, Hashable {
  var chat: Bool = true
  var smartkit: Bool = true
  var webSearch: Bool = true
  var voiceReply: Bool = true
  var vision: Bool = true
}

struct HealthProbe: Codable {
  var ok: Bool
  var health: HealthPayload?
  var error: String?
  var target: String?
}

struct HealthPayload: Codable {
  var profile: String?
  var dbPath: String?
  var features: [String: HealthFeature]?
  var llm: HealthLLM?
  var abilities: HealthAbilities?
  var nextSteps: [String]?
}

struct HealthFeature: Codable {
  var configured: Bool?
  var active: Bool?
  var state: String?
  var message: String?
}

struct HealthLLM: Codable {
  var provider: String?
  var model: String?
  var visionModel: String?
  var ttsModel: String?
}

struct HealthAbilities: Codable {
  var webSearchEnabled: Bool?
  var voiceReplyEnabled: Bool?
  var visionEnabled: Bool?
  var braveSearchConfigured: Bool?
}

struct SavePayload: Codable {
  var env: [String: String]
  var settings: ConsoleSettings
}

struct FeishuTestMessagePayload: Codable {
  var receiveId: String
  var receiveIdType: FeishuTestReceiveType
}

struct FeishuTestMessageResult: Codable {
  var receiveIdType: String
  var receiveId: String
  var messageId: String
}

struct BridgeEnvelope<Result: Decodable>: Decodable {
  var ok: Bool
  var result: Result?
  var error: String?
}

enum StepValidation {
  static func canContinue(step: OnboardingStep, env: [String: String]) -> Bool {
    switch step {
    case .feishu:
      return !(env["FEISHU_APP_ID"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !(env["FEISHU_APP_SECRET"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    case .model:
      return !(env["BOT_LLM_API_KEY"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    case .complete:
      return true
    }
  }

  static func message(step: OnboardingStep, env: [String: String]) -> String? {
    guard !canContinue(step: step, env: env) else {
      return nil
    }
    switch step {
    case .feishu:
      return "继续之前，请填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET。"
    case .model:
      return "继续之前，请填写 BOT_LLM_API_KEY。"
    case .complete:
      return nil
    }
  }
}

extension PermissionsSettings {
  func rules(for kind: RuleKind) -> [ConsoleRule] {
    switch kind {
    case .groups: return groups
    case .users: return users
    }
  }

  mutating func setRules(_ rules: [ConsoleRule], for kind: RuleKind) {
    switch kind {
    case .groups:
      groups = rules
    case .users:
      users = rules
    }
  }
}

extension RuleCapabilities {
  func value(for capabilityID: String) -> Bool {
    switch capabilityID {
    case "chat": return chat
    case "smartkit": return smartkit
    case "webSearch": return webSearch
    case "voiceReply": return voiceReply
    case "vision": return vision
    default: return false
    }
  }

  mutating func setValue(_ value: Bool, for capabilityID: String) {
    switch capabilityID {
    case "chat":
      chat = value
    case "smartkit":
      smartkit = value
    case "webSearch":
      webSearch = value
    case "voiceReply":
      voiceReply = value
    case "vision":
      vision = value
    default:
      break
    }
  }
}
