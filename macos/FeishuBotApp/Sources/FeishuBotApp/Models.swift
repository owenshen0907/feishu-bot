import Foundation

enum AppMode: String {
  case onboarding
  case console
}

enum OnboardingStep: Int, CaseIterable, Identifiable {
  case feishu
  case model

  var id: Int { rawValue }

  var title: String {
    switch self {
    case .feishu: return "飞书接入"
    case .model: return "模型接入"
    }
  }

  var subtitle: String {
    switch self {
    case .feishu: return "填写机器人上线所需凭据并测试连接"
    case .model: return "连接默认模型供应商并完成基础接入"
    }
  }

  var symbol: String {
    switch self {
    case .feishu: return "message.badge"
    case .model: return "cpu"
    }
  }
}

enum ConsoleSection: String, CaseIterable, Identifiable, Codable {
  case thread
  case abilities
  case groups
  case users
  case system

  var id: String { rawValue }

  var title: String {
    switch self {
    case .thread: return "线程"
    case .abilities: return "能力配置"
    case .groups: return "群聊会话"
    case .users: return "私聊会话"
    case .system: return "系统设置"
    }
  }

  var subtitle: String {
    switch self {
    case .thread: return "查看最近和 Feishu Bot 互动过的会话"
    case .abilities: return "先完成全局接入和开关，再给对象分配能力"
    case .groups: return "群聊队列默认展示最近对话；对象能力配置改到独立 sheet 里管理"
    case .users: return "用户队列默认展示最近对话；对象能力配置改到独立 sheet 里管理"
    case .system: return "运行状态、目录与后台操作"
    }
  }

  var sidebarHint: String {
    switch self {
    case .thread: return "全部会话"
    case .abilities: return "全局开关"
    case .groups: return "群聊队列"
    case .users: return "私聊队列"
    case .system: return "运行设置"
    }
  }

  var symbol: String {
    switch self {
    case .thread: return "bubble.left.and.bubble.right"
    case .abilities: return "slider.horizontal.3"
    case .groups: return "person.2.crop.square.stack"
    case .users: return "person.crop.square"
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
    case .users: return "当用户和群组都配了能力时，以用户配置为准。"
    }
  }
}

enum AbilityKind: String, Identifiable, CaseIterable {
  case diagnosticHttp
  case webSearch
  case voiceReply
  case vision

  var id: String { rawValue }

  var symbolName: String {
    switch self {
    case .diagnosticHttp: return "puzzlepiece.extension"
    case .webSearch: return "globe"
    case .voiceReply: return "waveform.badge.mic"
    case .vision: return "eye.fill"
    }
  }

  var title: String {
    switch self {
    case .diagnosticHttp: return "自定义 HTTP 组件"
    case .webSearch: return "联网搜索"
    case .voiceReply: return "语音回复"
    case .vision: return "视觉理解"
    }
  }

  var description: String {
    switch self {
    case .diagnosticHttp: return "这类能力不会作为内置组件默认出现；只有你自己配置了名字、用途和地址后，才会进入可分配能力列表。"
    case .webSearch: return "联网搜索需要先配置 Brave Search，再决定哪些对象可以消费。"
    case .voiceReply: return "语音回复复用当前模型接入，只在全局开启后才允许分配。"
    case .vision: return "视觉理解依赖模型接入，开启后才可在权限页分配。"
    }
  }

  var defaultHelpDescription: String {
    switch self {
    case .diagnosticHttp:
      return "根据你配置的组件卡片描述自动展示。"
    case .webSearch:
      return "需要公开网页信息时，可以联网搜索后再整理给用户。"
    case .voiceReply:
      return "支持把回答整理成语音结果返回。"
    case .vision:
      return "可以结合图片内容一起理解问题并给出说明。"
    }
  }

  var helpDescriptionPlaceholder: String {
    switch self {
    case .diagnosticHttp:
      return ""
    case .webSearch:
      return "例如：需要公开网页信息时，可以联网搜索后再整理给用户。"
    case .voiceReply:
      return "例如：支持把回答整理成语音结果返回。"
    case .vision:
      return "例如：可以结合图片内容一起理解问题并给出说明。"
    }
  }

  var globalToggleEnvKey: String? {
    switch self {
    case .diagnosticHttp:
      return nil
    case .webSearch:
      return "BOT_CAPABILITY_WEB_SEARCH"
    case .voiceReply:
      return "BOT_CAPABILITY_VOICE_REPLY"
    case .vision:
      return "BOT_CAPABILITY_VISION"
    }
  }

  var enabledHint: String {
    "打开后，这项能力就会出现在群组 / 用户 / 对话页的授权卡片里。"
  }

  var disabledHint: String {
    switch self {
    case .diagnosticHttp:
      return "先补齐组件地址与鉴权信息，才能打开总开关。"
    case .webSearch:
      return "先填好 Brave Search API Key，才能打开总开关。"
    case .voiceReply:
      return "先确认语音模型可用，再打开总开关。"
    case .vision:
      return "先确认视觉模型可用，再打开总开关。"
    }
  }

  var capabilityID: String { rawValue }
}

enum HelpCapabilityOrderMode: String, CaseIterable, Identifiable, Codable {
  case builtinFirst = "builtin_first"
  case componentFirst = "component_first"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .builtinFirst: return "内置优先"
    case .componentFirst: return "组件优先"
    }
  }

  var subtitle: String {
    switch self {
    case .builtinFirst:
      return "先展示普通聊天、联网搜索等内置能力，再展示你自定义的组件。"
    case .componentFirst:
      return "先展示你自己接入的自定义组件，再补上普通聊天、联网搜索等内置能力。"
    }
  }
}

enum ActiveSheet: Identifiable {
  case advancedModel
  case advancedRuntime
  case abilityDetail(AbilityKind)
  case ruleManager(RuleKind)
  case threadPermissions(String)

  var id: String {
    switch self {
    case .advancedModel: return "advanced-model"
    case .advancedRuntime: return "advanced-runtime"
    case .abilityDetail(let ability): return "ability-\(ability.rawValue)"
    case .ruleManager(let kind): return "rule-manager-\(kind.rawValue)"
    case .threadPermissions(let sessionID): return "thread-permissions-\(sessionID)"
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
  var components: ConsoleComponents = .init()
  var capabilityCards: CapabilityCardSettings = .init()
  var feedback: FeedbackSettings = .init()
  var help: HelpContentSettings?
  var ui: ConsoleUIState = .init()

  private enum CodingKeys: String, CodingKey {
    case version
    case permissions
    case components
    case capabilityCards
    case feedback
    case help
    case ui
  }

  init() {}

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 2
    permissions = try container.decodeIfPresent(PermissionsSettings.self, forKey: .permissions) ?? .init()
    components = try container.decodeIfPresent(ConsoleComponents.self, forKey: .components) ?? .init()
    capabilityCards = try container.decodeIfPresent(CapabilityCardSettings.self, forKey: .capabilityCards) ?? .init()
    feedback = try container.decodeIfPresent(FeedbackSettings.self, forKey: .feedback) ?? .init()
    help = try container.decodeIfPresent(HelpContentSettings.self, forKey: .help)
    ui = try container.decodeIfPresent(ConsoleUIState.self, forKey: .ui) ?? .init()
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(version, forKey: .version)
    try container.encode(permissions, forKey: .permissions)
    try container.encode(components, forKey: .components)
    try container.encode(capabilityCards, forKey: .capabilityCards)
    try container.encode(feedback, forKey: .feedback)
    try container.encodeIfPresent(help, forKey: .help)
    try container.encode(ui, forKey: .ui)
  }
}

struct ConsoleComponents: Codable, Equatable {
  var diagnosticHttp: [DiagnosticHttpComponentConfig] = []

  private enum CodingKeys: String, CodingKey {
    case diagnosticHttp
  }

  init() {}

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let arrayValue = try container.decodeIfPresent([DiagnosticHttpComponentConfig].self, forKey: .diagnosticHttp) {
      diagnosticHttp = arrayValue
      return
    }
    if let singleValue = try container.decodeIfPresent(DiagnosticHttpComponentConfig.self, forKey: .diagnosticHttp) {
      diagnosticHttp = [singleValue]
      return
    }
    diagnosticHttp = []
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(diagnosticHttp, forKey: .diagnosticHttp)
  }
}

struct CapabilityCardSettings: Codable, Equatable {
  var webSearch: CapabilityCardTextSettings = .init()
  var voiceReply: CapabilityCardTextSettings = .init()
  var vision: CapabilityCardTextSettings = .init()
}

struct CapabilityCardTextSettings: Codable, Equatable, Hashable {
  var helpDescription: String = ""
}

struct FeedbackSettings: Codable, Equatable {
  var processingReaction: ProcessingReactionSettings = .init()
}

struct ProcessingReactionSettings: Codable, Equatable, Hashable {
  var enabled: Bool = true
  var emoji: String = "OnIt"

  var resolvedEmoji: String {
    let trimmed = emoji.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "OnIt" : trimmed
  }
}

struct DiagnosticHttpComponentConfig: Codable, Equatable, Hashable {
  var id: String = UUID().uuidString.lowercased()
  var name: String = ""
  var enabled: Bool = false
  var command: String = ""
  var summary: String = ""
  var usageDescription: String = ""
  var examplePrompts: [String] = []
  var baseUrl: String = ""
  var token: String = ""
  var caller: String = "feishu-bot"
  var timeoutMs: Int = 20000

  private enum CodingKeys: String, CodingKey {
    case id
    case name
    case enabled
    case command
    case summary
    case usageDescription
    case examplePrompts
    case baseUrl
    case token
    case caller
    case timeoutMs
  }

  init() {}

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString.lowercased()
    name = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
    enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
    command = try container.decodeIfPresent(String.self, forKey: .command) ?? ""
    summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
    usageDescription = try container.decodeIfPresent(String.self, forKey: .usageDescription) ?? ""
    examplePrompts = try container.decodeIfPresent([String].self, forKey: .examplePrompts) ?? []
    baseUrl = try container.decodeIfPresent(String.self, forKey: .baseUrl) ?? ""
    token = try container.decodeIfPresent(String.self, forKey: .token) ?? ""
    caller = try container.decodeIfPresent(String.self, forKey: .caller) ?? "feishu-bot"
    timeoutMs = try container.decodeIfPresent(Int.self, forKey: .timeoutMs) ?? 20000
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(name, forKey: .name)
    try container.encode(enabled, forKey: .enabled)
    try container.encode(command, forKey: .command)
    try container.encode(summary, forKey: .summary)
    try container.encode(usageDescription, forKey: .usageDescription)
    try container.encode(examplePrompts, forKey: .examplePrompts)
    try container.encode(baseUrl, forKey: .baseUrl)
    try container.encode(token, forKey: .token)
    try container.encode(caller, forKey: .caller)
    try container.encode(timeoutMs, forKey: .timeoutMs)
  }

  var isConfigured: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !usageDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !examplePrompts.isEmpty ||
      !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var displayName: String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "未命名组件" : trimmed
  }

  var capabilityID: String {
    "component:\(id.trimmingCharacters(in: .whitespacesAndNewlines))"
  }

  var normalizedCommand: String {
    command
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "/", with: "")
      .lowercased()
      .filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
  }

  var commandLabel: String {
    let trimmed = normalizedCommand
    return trimmed.isEmpty ? "" : "/\(trimmed)"
  }
}

struct HelpContentSettings: Codable, Equatable, Hashable {
  var title: String = ""
  var summary: String = ""
  var newCommandDescription: String = ""
  var capabilityOrderMode: HelpCapabilityOrderMode = .builtinFirst
  var examplePrompts: [String] = []
  var notes: [String] = []

  private enum CodingKeys: String, CodingKey {
    case title
    case summary
    case newCommandDescription
    case capabilityOrderMode
    case examplePrompts
    case notes
  }

  static let defaultTitle = "Feishu 诊断助手"
  static let defaultSummary = "你可以先把它当作一个会聊天的飞书助手来用；当对象被开通了对应能力后，/help 会自动把这些能力的说明一起带出来。"
  static let defaultNewCommandDescription = "开启一个新话题，并清空当前用户的聊天上下文。"
  static let defaultCapabilityOrderMode: HelpCapabilityOrderMode = .builtinFirst
  static let defaultExamplePrompts = [
    "查下 trace 7f8e9a0b1234",
    "帮我看 uid 123456",
    "帮我梳理一下这个需求的实现思路",
    "展开原因",
    "再查过去 1h"
  ]
  static let defaultNotes = [
    "私聊里如果消息没有匹配到排障命令，会自动进入聊天模式。",
    "安全：排障结果只展示脱敏摘要；聊天记忆按用户隔离。"
  ]

  static let defaults = HelpContentSettings(
    title: defaultTitle,
    summary: defaultSummary,
    newCommandDescription: defaultNewCommandDescription,
    capabilityOrderMode: defaultCapabilityOrderMode,
    examplePrompts: defaultExamplePrompts,
    notes: defaultNotes
  )

  init() {}

  init(
    title: String = "",
    summary: String = "",
    newCommandDescription: String = "",
    capabilityOrderMode: HelpCapabilityOrderMode = .builtinFirst,
    examplePrompts: [String] = [],
    notes: [String] = []
  ) {
    self.title = title
    self.summary = summary
    self.newCommandDescription = newCommandDescription
    self.capabilityOrderMode = capabilityOrderMode
    self.examplePrompts = examplePrompts
    self.notes = notes
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
    summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
    newCommandDescription = try container.decodeIfPresent(String.self, forKey: .newCommandDescription) ?? ""
    capabilityOrderMode = try container.decodeIfPresent(HelpCapabilityOrderMode.self, forKey: .capabilityOrderMode) ?? .builtinFirst
    examplePrompts = try container.decodeIfPresent([String].self, forKey: .examplePrompts) ?? []
    notes = try container.decodeIfPresent([String].self, forKey: .notes) ?? []
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(title, forKey: .title)
    try container.encode(summary, forKey: .summary)
    try container.encode(newCommandDescription, forKey: .newCommandDescription)
    try container.encode(capabilityOrderMode, forKey: .capabilityOrderMode)
    try container.encode(examplePrompts, forKey: .examplePrompts)
    try container.encode(notes, forKey: .notes)
  }

  var isConfigured: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      !newCommandDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
      capabilityOrderMode != Self.defaultCapabilityOrderMode ||
      !examplePrompts.isEmpty ||
      !notes.isEmpty
  }

  var resolvedWithDefaults: HelpContentSettings {
    HelpContentSettings(
      title: title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Self.defaultTitle : title,
      summary: summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Self.defaultSummary : summary,
      newCommandDescription: newCommandDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Self.defaultNewCommandDescription : newCommandDescription,
      capabilityOrderMode: capabilityOrderMode,
      examplePrompts: examplePrompts.isEmpty ? Self.defaultExamplePrompts : examplePrompts,
      notes: notes.isEmpty ? Self.defaultNotes : notes
    )
  }
}

struct ConsoleUIState: Codable, Equatable {
  var onboardingCompleted: Bool = false
  var lastVisitedSection: ConsoleSection = .thread
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
  var diagnosticHttp: Bool = false
  var customComponents: [String: Bool] = [:]
  var webSearch: Bool = false
  var voiceReply: Bool = false
  var vision: Bool = false

  private enum CodingKeys: String, CodingKey {
    case chat
    case diagnosticHttp
    case smartkit
    case customComponents
    case webSearch
    case voiceReply
    case vision
  }

  init() {}

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    chat = try container.decodeIfPresent(Bool.self, forKey: .chat) ?? true
    diagnosticHttp =
      try container.decodeIfPresent(Bool.self, forKey: .diagnosticHttp) ??
      (try container.decodeIfPresent(Bool.self, forKey: .smartkit)) ??
      false
    customComponents = try container.decodeIfPresent([String: Bool].self, forKey: .customComponents) ?? [:]
    webSearch = try container.decodeIfPresent(Bool.self, forKey: .webSearch) ?? false
    voiceReply = try container.decodeIfPresent(Bool.self, forKey: .voiceReply) ?? false
    vision = try container.decodeIfPresent(Bool.self, forKey: .vision) ?? false
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(chat, forKey: .chat)
    try container.encode(diagnosticHttp, forKey: .diagnosticHttp)
    try container.encode(customComponents, forKey: .customComponents)
    try container.encode(webSearch, forKey: .webSearch)
    try container.encode(voiceReply, forKey: .voiceReply)
    try container.encode(vision, forKey: .vision)
  }
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

struct ConnectivityTestResult: Codable {
  var kind: String
  var title: String
  var detail: String
}

struct PolishCopyPayload: Codable {
  var env: [String: String]
  var text: String
  var purpose: String
}

struct PolishCopyResult: Codable {
  var text: String
}

struct DiagnosticComponentImportPayload: Codable {
  var text: String
}

struct DiagnosticComponentConnectivityPayload: Codable {
  var component: DiagnosticHttpComponentConfig
}

struct DiagnosticComponentImportResult: Codable {
  var kind: String
  var title: String
  var detail: String
  var env: [String: String]
  var component: DiagnosticHttpComponentConfig?
}

struct RecentThread: Codable, Identifiable, Hashable {
  var id: String
  var title: String
  var subtitle: String
  var preview: String
  var scope: String
  var status: String
  var requesterId: String
  var chatId: String
  var conversationId: String
  var jobId: String?
  var updatedAt: String

  var iconName: String {
    scope == "group" ? "person.2" : "person.crop.circle"
  }

  var statusLabel: String {
    switch status.lowercased() {
    case "completed":
      return "已完成"
    case "accepted", "running", "processing":
      return "处理中"
    case "failed":
      return "失败"
    default:
      return status.isEmpty ? "已接收" : status
    }
  }

  var updatedAtLabel: String {
    guard let date = parseRecordedDate(updatedAt) else {
      return updatedAt
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.dateFormat = Calendar.current.isDateInToday(date) ? "HH:mm" : "MM-dd HH:mm"
    return formatter.string(from: date)
  }
}

struct ThreadMessage: Codable, Identifiable, Hashable {
  var id: String
  var role: String
  var senderName: String
  var content: String
  var createdAt: String

  var isAssistant: Bool {
    role == "assistant"
  }

  var createdAtLabel: String {
    guard let date = parseRecordedDate(createdAt) else {
      return createdAt
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.dateFormat = Calendar.current.isDateInToday(date) ? "HH:mm" : "MM-dd HH:mm"
    return formatter.string(from: date)
  }
}

private func parseRecordedDate(_ rawValue: String) -> Date? {
  let raw = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !raw.isEmpty else {
    return nil
  }
  if raw.allSatisfy(\.isNumber), let numeric = Double(raw) {
    let seconds = raw.count <= 10 ? numeric : numeric / 1000
    return Date(timeIntervalSince1970: seconds)
  }
  return ISO8601DateFormatter().date(from: raw) ?? DateFormatter.recordedTimestamp.date(from: raw)
}

private extension DateFormatter {
  static let recordedTimestamp: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
    return formatter
  }()
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
      return !(env["BOT_LLM_API_KEY"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !(env["BOT_LLM_MODEL"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !(env["BOT_LLM_BASE_URL"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
      return "继续之前，请填写 BOT_LLM_API_KEY、BOT_LLM_BASE_URL 和 BOT_LLM_MODEL。"
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
    if capabilityID.hasPrefix("component:") {
      let componentID = String(capabilityID.dropFirst("component:".count))
      return customComponents[componentID] ?? diagnosticHttp
    }
    switch capabilityID {
    case "chat": return chat
    case "diagnosticHttp", "smartkit": return diagnosticHttp
    case "webSearch": return webSearch
    case "voiceReply": return voiceReply
    case "vision": return vision
    default: return false
    }
  }

  mutating func setValue(_ value: Bool, for capabilityID: String) {
    if capabilityID.hasPrefix("component:") {
      let componentID = String(capabilityID.dropFirst("component:".count))
      guard !componentID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return
      }
      customComponents[componentID] = value
      return
    }
    switch capabilityID {
    case "chat":
      chat = value
    case "diagnosticHttp", "smartkit":
      diagnosticHttp = value
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
