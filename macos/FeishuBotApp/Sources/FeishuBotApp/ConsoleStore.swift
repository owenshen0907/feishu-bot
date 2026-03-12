import Foundation
import SwiftUI

enum ConnectivityCheckState: Equatable {
  case idle
  case running
  case succeeded(String)
  case failed(String)

  var message: String? {
    switch self {
    case .idle, .running:
      return nil
    case .succeeded(let message), .failed(let message):
      return message
    }
  }

  var isSuccess: Bool {
    if case .succeeded = self {
      return true
    }
    return false
  }

  var isRunning: Bool {
    if case .running = self {
      return true
    }
    return false
  }
}

struct QuickCommandPreviewItem: Identifiable, Hashable {
  var id: String { command + "|" + title }
  var command: String
  var title: String
  var description: String
  var status: String?
  var source: QuickCommandPreviewSource
}

enum QuickCommandPreviewSource: Hashable {
  case fixed
  case component

  var title: String {
    switch self {
    case .fixed: return "固定命令"
    case .component: return "组件命令"
    }
  }
}

struct HelpCapabilityPreviewItem: Identifiable, Hashable {
  var id: String { title + "|" + (command ?? "") }
  var title: String
  var description: String
  var command: String?
  var source: HelpCapabilityPreviewSource
}

enum HelpCapabilityPreviewSource: Hashable {
  case builtin
  case component

  var title: String {
    switch self {
    case .builtin: return "内置能力"
    case .component: return "组件能力"
    }
  }
}

@MainActor
final class BackendSupervisor: ObservableObject {
  @Published private(set) var health: HealthProbe?
  @Published private(set) var isRestarting = false

  private let bridge: BridgeClient
  private var sessionStarted = false

  init(bridge: BridgeClient) {
    self.bridge = bridge
  }

  func refreshHealth() async {
    do {
      health = try await bridge.health()
    } catch {
      health = HealthProbe(ok: false, health: nil, error: error.localizedDescription, target: nil)
    }
  }

  func restart() async throws -> BridgeBootstrap {
    isRestarting = true
    defer { isRestarting = false }
    let bootstrap = try await bridge.restartBackend()
    sessionStarted = true
    await refreshHealth()
    return bootstrap
  }

  func shutdownIfNeeded() async {
    guard sessionStarted else {
      return
    }
    try? await bridge.stopBackend()
    sessionStarted = false
  }
}

@MainActor
final class ConsoleStore: ObservableObject {
  @Published private(set) var bootstrap: BridgeBootstrap?
  @Published var draftEnv: [String: String] = [:]
  @Published var draftSettings = ConsoleSettings()
  @Published var appMode: AppMode = .onboarding
  @Published var onboardingStep: OnboardingStep = .feishu
  @Published var consoleSection: ConsoleSection = .thread
  @Published var activeSheet: ActiveSheet?
  @Published var notice = ""
  @Published var errorMessage = ""
  @Published var isLoading = false
  @Published var isSaving = false
  @Published var isSendingTestMessage = false
  @Published var needsRestart = false
  @Published private(set) var feishuConnectivityState: ConnectivityCheckState = .idle
  @Published private(set) var modelConnectivityState: ConnectivityCheckState = .idle
  @Published private(set) var diagnosticComponentConnectivityState: ConnectivityCheckState = .idle
  @Published var diagnosticComponentImportText = ""
  @Published var selectedDiagnosticComponentID: String?
  @Published var diagnosticComponentCommandDraft = ""
  @Published private(set) var recentThreads: [RecentThread] = []
  @Published private(set) var selectedThreadID: String?
  @Published private(set) var selectedThreadMessages: [ThreadMessage] = []
  @Published private(set) var health: HealthProbe?
  @Published private(set) var lastDraftSavedAt: Date?
  @Published private(set) var polishingFieldIDs: Set<String> = []

  let bridge: BridgeClient
  let supervisor: BackendSupervisor

  private var autosaveTask: Task<Void, Never>?
  private var pollingTask: Task<Void, Never>?
  private var isApplyingBootstrap = false
  private var isRerunningOnboarding = false
  private var didEnsureBackendForCurrentLaunch = false
  private var pendingRuleFocus: [RuleKind: String] = [:]

  init(bridge: BridgeClient, supervisor: BackendSupervisor) {
    self.bridge = bridge
    self.supervisor = supervisor
  }

  deinit {
    autosaveTask?.cancel()
    pollingTask?.cancel()
  }

  func load() async {
    isLoading = true
    defer { isLoading = false }
    do {
      let payload = try await bridge.bootstrap()
      applyBootstrap(payload)
      await loadRecentThreads(adoptPrimarySelection: payload.settings.ui.onboardingCompleted)
      await refreshHealth()
      await autoStartBackendIfNeeded()
      startPolling()
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  func refreshHealth() async {
    await supervisor.refreshHealth()
    health = supervisor.health
  }

  func shutdownOnTerminate() {
    Task {
      await supervisor.shutdownIfNeeded()
    }
  }

  func openConfig() {
    Task {
      _ = try? await bridge.openConfig()
    }
  }

  func openData() {
    Task {
      _ = try? await bridge.openData()
    }
  }

  func setFeishuTestReceiveId(_ value: String) {
    draftSettings.ui.feishuTestReceiveId = value
    scheduleAutosave()
  }

  func setFeishuTestReceiveType(_ value: FeishuTestReceiveType) {
    draftSettings.ui.feishuTestReceiveIdType = value
    scheduleAutosave()
  }

  func setEnvValue(_ key: String, value: String) {
    draftEnv[key] = value
    if key == "BOT_LLM_PROVIDER", value == "stepfun" {
      applyProviderPreset()
    }
    invalidateConnectivityState(for: key)
    scheduleAutosave()
  }

  func setBoolEnvValue(_ key: String, value: Bool) {
    draftEnv[key] = value ? "true" : "false"
    scheduleAutosave()
  }

  func importDiagnosticComponentConfig() {
    Task {
      let rawText = diagnosticComponentImportText.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !rawText.isEmpty else {
        diagnosticComponentConnectivityState = .failed("请先粘贴自定义 HTTP 组件的一键配置 JSON。")
        return
      }
      do {
        let result = try await bridge.importDiagnosticComponentConfig(text: rawText)
        if let component = result.component {
          let incoming = normalizedDiagnosticComponent(component)
          if let index = selectedDiagnosticComponentIndex {
            var next = incoming
            next.enabled = draftSettings.components.diagnosticHttp[index].enabled
            draftSettings.components.diagnosticHttp[index] = next
          } else {
            var next = incoming
            next.enabled = false
            draftSettings.components.diagnosticHttp.append(next)
          }
          selectedDiagnosticComponentID = incoming.id
          syncDiagnosticComponentCommandDraft()
        }
        notice = result.title
        errorMessage = ""
        diagnosticComponentConnectivityState = .succeeded(result.detail)
        scheduleAutosave()
      } catch {
        notice = ""
        errorMessage = error.localizedDescription
        diagnosticComponentConnectivityState = .failed(error.localizedDescription)
      }
    }
  }

  func testDiagnosticComponentConnectivity() {
    Task {
      guard let component = selectedDiagnosticComponent, !component.baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        diagnosticComponentConnectivityState = .failed("请先选择一个组件，并填写它的 Base URL。")
        return
      }
      diagnosticComponentConnectivityState = .running
      do {
        let result = try await bridge.testDiagnosticComponentConnectivity(component: component)
        notice = result.title
        errorMessage = ""
        diagnosticComponentConnectivityState = .succeeded(result.detail)
      } catch {
        notice = ""
        errorMessage = error.localizedDescription
        diagnosticComponentConnectivityState = .failed(error.localizedDescription)
      }
    }
  }

  func addDiagnosticComponent() {
    var component = DiagnosticHttpComponentConfig()
    component.enabled = false
    draftSettings.components.diagnosticHttp.append(component)
    selectedDiagnosticComponentID = component.id
    diagnosticComponentCommandDraft = ""
    diagnosticComponentImportText = ""
    diagnosticComponentConnectivityState = .idle
    scheduleAutosave()
  }

  func selectDiagnosticComponent(_ componentID: String) {
    selectedDiagnosticComponentID = componentID
    syncDiagnosticComponentCommandDraft()
    diagnosticComponentConnectivityState = .idle
  }

  func removeDiagnosticComponent() {
    guard let index = selectedDiagnosticComponentIndex else {
      return
    }
    draftSettings.components.diagnosticHttp.remove(at: index)
    if let first = draftSettings.components.diagnosticHttp.first {
      selectedDiagnosticComponentID = first.id
    } else {
      selectedDiagnosticComponentID = nil
    }
    syncDiagnosticComponentCommandDraft()
    diagnosticComponentImportText = ""
    diagnosticComponentConnectivityState = .idle
    scheduleAutosave()
  }

  func setDefaultMode(_ mode: String) {
    draftSettings.permissions.defaultMode = mode
    scheduleAutosave()
  }

  func setRules(_ kind: RuleKind, rules: [ConsoleRule]) {
    draftSettings.permissions.setRules(rules, for: kind)
    scheduleAutosave()
  }

  func updateRule(_ kind: RuleKind, index: Int, rule: ConsoleRule) {
    var rules = draftSettings.permissions.rules(for: kind)
    guard rules.indices.contains(index) else {
      return
    }
    rules[index] = rule
    setRules(kind, rules: rules)
  }

  func addRule(_ kind: RuleKind) -> Int {
    var rules = draftSettings.permissions.rules(for: kind)
    let defaultName = kind == .groups ? "新群组" : "新用户"
    rules.append(ConsoleRule(id: "", name: defaultName, mode: "allow", note: "", capabilities: .init()))
    setRules(kind, rules: rules)
    return max(rules.count - 1, 0)
  }

  func deleteRule(_ kind: RuleKind, index: Int) {
    var rules = draftSettings.permissions.rules(for: kind)
    guard rules.indices.contains(index) else {
      return
    }
    rules.remove(at: index)
    setRules(kind, rules: rules)
  }

  func selectConsoleSection(_ section: ConsoleSection) {
    guard consoleSection != section else {
      return
    }
    consoleSection = section
    if isConversationSection(section) {
      syncSelectedThreadForCurrentSection()
    }
    if isConversationSection(section), let selectedThreadID {
      Task {
        await loadThreadMessages(sessionID: selectedThreadID)
      }
    }
    if section != .thread {
      draftSettings.ui.lastVisitedSection = section
      scheduleAutosave()
    }
  }

  func openRule(for thread: RecentThread) {
    guard let kind = threadRuleKind(for: thread) else {
      return
    }
    guard let (_, index) = ensureThreadRuleIndex(for: thread) else {
      return
    }
    let rules = draftSettings.permissions.rules(for: kind)
    guard rules.indices.contains(index) else {
      return
    }
    pendingRuleFocus[kind] = rules[index].id.trimmingCharacters(in: .whitespacesAndNewlines)
    activeSheet = .ruleManager(kind)
  }

  func openRuleManager(for kind: RuleKind) {
    syncRulesWithRecentThreads(for: kind)
    activeSheet = .ruleManager(kind)
  }

  func selectThread(_ thread: RecentThread, preferredSection: ConsoleSection? = nil) {
    selectedThreadID = thread.id
    consoleSection = preferredSection ?? .thread
    Task {
      await loadThreadMessages(sessionID: thread.id)
    }
  }

  func rerunOnboarding() {
    isRerunningOnboarding = true
    appMode = .onboarding
    onboardingStep = .feishu
    feishuConnectivityState = .idle
    modelConnectivityState = .idle
    notice = ""
    errorMessage = ""
  }

  func previousOnboardingStep() {
    guard let previous = OnboardingStep(rawValue: onboardingStep.rawValue - 1) else {
      return
    }
    onboardingStep = previous
    notice = ""
    errorMessage = ""
  }

  func runOnboardingPrimaryAction() {
    Task {
      await testCurrentOnboardingStep()
    }
  }

  func onboardingState(for step: OnboardingStep) -> ConnectivityCheckState {
    switch step {
    case .feishu:
      return feishuConnectivityState
    case .model:
      return modelConnectivityState
    }
  }

  func testModelConnectivityFromConsole() {
    Task {
      guard StepValidation.canContinue(step: .model, env: draftEnv) else {
        let message = StepValidation.message(step: .model, env: draftEnv) ?? "当前模型配置还不完整。"
        modelConnectivityState = .failed(message)
        notice = ""
        errorMessage = message
        return
      }

      await flushAutosave()
      notice = ""
      errorMessage = ""
      modelConnectivityState = .running

      do {
        let result = try await bridge.testModelConnectivity()
        modelConnectivityState = .succeeded(result.detail)
        notice = result.title
        errorMessage = ""
      } catch {
        let message = error.localizedDescription
        modelConnectivityState = .failed(message)
        notice = ""
        errorMessage = message
      }
    }
  }

  func finishOnboarding() {
    Task {
      guard StepValidation.canContinue(step: .feishu, env: draftEnv) else {
        onboardingStep = .feishu
        errorMessage = StepValidation.message(step: .feishu, env: draftEnv) ?? ""
        return
      }
      guard StepValidation.canContinue(step: .model, env: draftEnv) else {
        onboardingStep = .model
        errorMessage = StepValidation.message(step: .model, env: draftEnv) ?? ""
        return
      }

      draftSettings.ui.onboardingCompleted = true
      draftSettings.ui.lastVisitedSection = .thread
      consoleSection = .thread
      isRerunningOnboarding = false
      appMode = .console
      await saveAndRestart(
        successNotice: "基础接入已完成，机器人已按当前配置启动。",
        failurePrefix: "基础配置已保存，但后台启动失败"
      )
    }
  }

  func applyAndRestart() {
    Task {
      await saveAndRestart(successNotice: "后台已按最新配置启动。")
    }
  }

  func sendFeishuTestMessage() {
    Task {
      let receiveId = draftSettings.ui.feishuTestReceiveId.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !receiveId.isEmpty else {
        errorMessage = "请先填写一个可接收测试消息的 Feishu ID。"
        return
      }
      isSendingTestMessage = true
      defer { isSendingTestMessage = false }
      do {
        let result = try await bridge.sendFeishuTestMessage(
          receiveId: receiveId,
          receiveIdType: draftSettings.ui.feishuTestReceiveIdType
        )
        notice = "测试消息已发送到 \(result.receiveIdType): \(result.receiveId)"
        errorMessage = ""
      } catch {
        notice = ""
        errorMessage = "发送测试消息失败：\(error.localizedDescription)"
      }
    }
  }

  func binding(for key: String, fallback: String = "") -> Binding<String> {
    Binding(
      get: { self.draftEnv[key] ?? fallback },
      set: { self.setEnvValue(key, value: $0) }
    )
  }

  func boolBinding(for key: String) -> Binding<Bool> {
    Binding(
      get: { (self.draftEnv[key] ?? "false").lowercased() == "true" },
      set: { self.setBoolEnvValue(key, value: $0) }
    )
  }

  func abilityEnabledBinding(for kind: AbilityKind) -> Binding<Bool>? {
    guard let key = kind.globalToggleEnvKey else {
      return nil
    }
    return boolBinding(for: key)
  }

  func diagnosticComponentTextBinding(
    get: @escaping (DiagnosticHttpComponentConfig) -> String,
    set: @escaping (inout DiagnosticHttpComponentConfig, String) -> Void
  ) -> Binding<String> {
    Binding(
      get: { self.selectedDiagnosticComponent.map(get) ?? "" },
      set: { newValue in
        self.updateSelectedDiagnosticComponent { component in
          set(&component, newValue)
        }
      }
    )
  }

  func diagnosticComponentTimeoutBinding() -> Binding<String> {
    Binding(
      get: { self.selectedDiagnosticComponent.map { String($0.timeoutMs) } ?? "20000" },
      set: { newValue in
        self.updateSelectedDiagnosticComponent { component in
          let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
          component.timeoutMs = Int(trimmed) ?? 20000
        }
      }
    )
  }

  func diagnosticComponentCommandBinding() -> Binding<String> {
    Binding(
      get: { self.diagnosticComponentCommandDraft },
      set: { newValue in
        self.updateDiagnosticComponentCommandDraft(newValue)
      }
    )
  }

  func capabilityCardDescriptionBinding(for kind: AbilityKind) -> Binding<String>? {
    guard kind != .diagnosticHttp else {
      return nil
    }
    return Binding(
      get: { self.capabilityCardDescription(for: kind) },
      set: { newValue in
        self.setCapabilityCardDescription(newValue, for: kind)
      }
    )
  }

  func helpCapabilityOrderBinding() -> Binding<HelpCapabilityOrderMode> {
    Binding(
      get: { (self.draftSettings.help ?? HelpContentSettings()).capabilityOrderMode },
      set: { newValue in
        var help = self.draftSettings.help ?? HelpContentSettings()
        help.capabilityOrderMode = newValue
        self.draftSettings.help = help.isConfigured ? help : nil
        self.scheduleAutosave()
      }
    )
  }

  func diagnosticComponentEnabledBinding(componentID: String) -> Binding<Bool> {
    Binding(
      get: {
        self.draftSettings.components.diagnosticHttp.first(where: { $0.id == componentID })?.enabled ?? false
      },
      set: { newValue in
        guard let index = self.draftSettings.components.diagnosticHttp.firstIndex(where: { $0.id == componentID }) else {
          return
        }
        self.draftSettings.components.diagnosticHttp[index].enabled = newValue
        self.diagnosticComponentConnectivityState = .idle
        self.scheduleAutosave()
      }
    )
  }

  private func normalizedDiagnosticComponent(_ component: DiagnosticHttpComponentConfig) -> DiagnosticHttpComponentConfig {
    var next = component
    if next.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      next.id = UUID().uuidString.lowercased()
    }
    next.command = next.normalizedCommand
    if next.caller.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      next.caller = "feishu-bot"
    }
    if next.timeoutMs <= 0 {
      next.timeoutMs = 20000
    }
    return next
  }

  private func syncDiagnosticComponentCommandDraft() {
    diagnosticComponentCommandDraft = selectedDiagnosticComponent?.commandLabel ?? ""
  }

  private func normalizeCommandDraft(_ value: String) -> String {
    value
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "/", with: "")
      .lowercased()
      .filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
  }

  private func commandConflictIssue(
    for command: String,
    excluding componentID: String? = nil
  ) -> String? {
    guard !command.isEmpty else {
      return nil
    }
    if reservedComponentCommands.contains(command) {
      return "这个命令和系统保留命令冲突，请换一个。"
    }
    let duplicateCount = diagnosticComponents.filter { component in
      component.id != componentID && component.normalizedCommand == command
    }.count
    if duplicateCount > 0 {
      return "这个命令和其他组件重复了，不能保存。"
    }
    return nil
  }

  private func updateDiagnosticComponentCommandDraft(_ newValue: String) {
    diagnosticComponentCommandDraft = newValue
    guard let component = selectedDiagnosticComponent else {
      return
    }
    let normalized = normalizeCommandDraft(newValue)
    guard let index = selectedDiagnosticComponentIndex, draftSettings.components.diagnosticHttp.indices.contains(index) else {
      return
    }

    if normalized.isEmpty {
      draftSettings.components.diagnosticHttp[index].command = ""
      diagnosticComponentConnectivityState = .idle
      scheduleAutosave()
      return
    }

    guard commandConflictIssue(for: normalized, excluding: component.id) == nil else {
      return
    }

    draftSettings.components.diagnosticHttp[index].command = normalized
    diagnosticComponentConnectivityState = .idle
    scheduleAutosave()
  }

  private func capabilityCardTextSettings(for kind: AbilityKind) -> CapabilityCardTextSettings {
    switch kind {
    case .diagnosticHttp:
      return .init()
    case .webSearch:
      return draftSettings.capabilityCards.webSearch
    case .voiceReply:
      return draftSettings.capabilityCards.voiceReply
    case .vision:
      return draftSettings.capabilityCards.vision
    }
  }

  private func setCapabilityCardDescription(_ value: String, for kind: AbilityKind) {
    switch kind {
    case .diagnosticHttp:
      return
    case .webSearch:
      draftSettings.capabilityCards.webSearch.helpDescription = value
    case .voiceReply:
      draftSettings.capabilityCards.voiceReply.helpDescription = value
    case .vision:
      draftSettings.capabilityCards.vision.helpDescription = value
    }
    scheduleAutosave()
  }

  func capabilityCardDescription(for kind: AbilityKind) -> String {
    let configured = capabilityCardTextSettings(for: kind).helpDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    return configured.isEmpty ? kind.defaultHelpDescription : capabilityCardTextSettings(for: kind).helpDescription
  }

  private func updateSelectedDiagnosticComponent(_ mutate: (inout DiagnosticHttpComponentConfig) -> Void) {
    guard let index = selectedDiagnosticComponentIndex, draftSettings.components.diagnosticHttp.indices.contains(index) else {
      return
    }
    var component = normalizedDiagnosticComponent(draftSettings.components.diagnosticHttp[index])
    mutate(&component)
    component = normalizedDiagnosticComponent(component)
    draftSettings.components.diagnosticHttp[index] = component
    selectedDiagnosticComponentID = component.id
    diagnosticComponentCommandDraft = component.commandLabel
    diagnosticComponentConnectivityState = .idle
    scheduleAutosave()
  }

  func helpContentTextBinding(
    defaultValue: @escaping (HelpContentSettings) -> String,
    get: @escaping (HelpContentSettings) -> String,
    set: @escaping (inout HelpContentSettings, String) -> Void
  ) -> Binding<String> {
    Binding(
      get: {
        let current = self.draftSettings.help ?? HelpContentSettings()
        let value = get(current).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? defaultValue(self.resolvedHelpContent) : get(current)
      },
      set: { newValue in
        var help = self.draftSettings.help ?? HelpContentSettings()
        set(&help, newValue)
        self.draftSettings.help = help.isConfigured ? help : nil
        self.scheduleAutosave()
      }
    )
  }

  func isPolishing(_ fieldID: String) -> Bool {
    polishingFieldIDs.contains(fieldID)
  }

  func polishHelpSummary() {
    let help = draftSettings.help ?? HelpContentSettings()
    let text = help.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? resolvedHelpContent.summary : help.summary
    polishText(fieldID: "help-summary", text: text, purpose: "/help 的通用说明文案") { polished in
      var next = self.draftSettings.help ?? HelpContentSettings()
      next.summary = polished
      self.draftSettings.help = next.isConfigured ? next : nil
      self.scheduleAutosave()
    }
  }

  func polishNewCommandDescription() {
    let help = draftSettings.help ?? HelpContentSettings()
    let text = help.newCommandDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      ? resolvedHelpContent.newCommandDescription
      : help.newCommandDescription
    polishText(fieldID: "help-new-command", text: text, purpose: "/new 命令的说明文案") { polished in
      var next = self.draftSettings.help ?? HelpContentSettings()
      next.newCommandDescription = polished
      self.draftSettings.help = next.isConfigured ? next : nil
      self.scheduleAutosave()
    }
  }

  func polishSelectedDiagnosticComponentSummary() {
    guard let component = selectedDiagnosticComponent else {
      return
    }
    polishText(
      fieldID: "component-summary-\(component.id)",
      text: component.summary,
      purpose: "\(component.displayName) 组件的一句话用途说明"
    ) { polished in
      self.updateSelectedDiagnosticComponent { target in
        target.summary = polished
      }
    }
  }

  func polishSelectedDiagnosticComponentName() {
    guard let component = selectedDiagnosticComponent else {
      return
    }
    polishText(
      fieldID: "component-name-\(component.id)",
      text: component.displayName,
      purpose: "飞书机器人能力卡片里的组件名称"
    ) { polished in
      self.updateSelectedDiagnosticComponent { target in
        target.name = polished
      }
    }
  }

  func polishSelectedDiagnosticComponentUsageDescription() {
    guard let component = selectedDiagnosticComponent else {
      return
    }
    polishText(
      fieldID: "component-usage-\(component.id)",
      text: component.usageDescription,
      purpose: "\(component.displayName) 组件的适用场景和调用提示"
    ) { polished in
      self.updateSelectedDiagnosticComponent { target in
        target.usageDescription = polished
      }
    }
  }

  func polishSelectedDiagnosticComponentExamples() {
    guard let component = selectedDiagnosticComponent else {
      return
    }
    let text = component.examplePrompts.joined(separator: "\n")
    polishText(
      fieldID: "component-examples-\(component.id)",
      text: text,
      purpose: "\(component.displayName) 组件的示例请求，每行一个"
    ) { polished in
      self.updateSelectedDiagnosticComponent { target in
        target.examplePrompts = polished
          .split(whereSeparator: \.isNewline)
          .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
      }
    }
  }

  func polishCapabilityCardDescription(for kind: AbilityKind) {
    let text = capabilityCardDescription(for: kind)
    polishText(
      fieldID: "capability-card-\(kind.rawValue)",
      text: text,
      purpose: "\(kind.title) 在 /help 中展示给用户的能力说明"
    ) { polished in
      self.setCapabilityCardDescription(polished, for: kind)
    }
  }

  func processingReactionEnabledBinding() -> Binding<Bool> {
    Binding(
      get: { self.draftSettings.feedback.processingReaction.enabled },
      set: { newValue in
        self.draftSettings.feedback.processingReaction.enabled = newValue
        self.scheduleAutosave()
      }
    )
  }

  private func polishText(
    fieldID: String,
    text: String,
    purpose: String,
    apply: @escaping (String) -> Void
  ) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      errorMessage = "请先输入要润色的文案。"
      return
    }
    guard !polishingFieldIDs.contains(fieldID) else {
      return
    }
    polishingFieldIDs.insert(fieldID)
    Task {
      do {
        let result = try await bridge.polishCopy(env: draftEnv, text: trimmed, purpose: purpose)
        apply(result.text)
        notice = "已采纳润色结果。"
        errorMessage = ""
      } catch {
        notice = ""
        errorMessage = "文案润色失败：\(error.localizedDescription)"
      }
      polishingFieldIDs.remove(fieldID)
    }
  }

  func processingReactionEmojiBinding() -> Binding<String> {
    Binding(
      get: { self.draftSettings.feedback.processingReaction.emoji },
      set: { newValue in
        self.draftSettings.feedback.processingReaction.emoji = newValue
        self.scheduleAutosave()
      }
    )
  }

  func feishuTestReceiveIdBinding() -> Binding<String> {
    Binding(
      get: { self.draftSettings.ui.feishuTestReceiveId },
      set: { self.setFeishuTestReceiveId($0) }
    )
  }

  func feishuTestReceiveTypeBinding() -> Binding<FeishuTestReceiveType> {
    Binding(
      get: { self.draftSettings.ui.feishuTestReceiveIdType },
      set: { self.setFeishuTestReceiveType($0) }
    )
  }

  func ruleBinding(for kind: RuleKind, index: Int) -> Binding<ConsoleRule> {
    Binding(
      get: {
        self.draftSettings.permissions.rules(for: kind).indices.contains(index)
          ? self.draftSettings.permissions.rules(for: kind)[index]
          : ConsoleRule()
      },
      set: { self.updateRule(kind, index: index, rule: $0) }
    )
  }

  func capabilityBinding(for capabilityID: String, kind: RuleKind, index: Int) -> Binding<Bool> {
    Binding(
      get: {
        let rules = self.draftSettings.permissions.rules(for: kind)
        guard rules.indices.contains(index) else {
          return false
        }
        return rules[index].capabilities.value(for: capabilityID)
      },
      set: { newValue in
        var rules = self.draftSettings.permissions.rules(for: kind)
        guard rules.indices.contains(index) else {
          return
        }
        rules[index].capabilities.setValue(newValue, for: capabilityID)
        self.setRules(kind, rules: rules)
      }
    )
  }

  func rules(for kind: RuleKind) -> [ConsoleRule] {
    draftSettings.permissions.rules(for: kind)
  }

  func recentThreads(for section: ConsoleSection) -> [RecentThread] {
    switch section {
    case .groups:
      return recentThreads.filter { threadRuleKind(for: $0) == .groups }
    case .users:
      return recentThreads.filter { threadRuleKind(for: $0) == .users }
    default:
      return recentThreads
    }
  }

  func selectedThread(for section: ConsoleSection) -> RecentThread? {
    guard let selectedThread else {
      return nil
    }
    let visible = recentThreads(for: section)
    return visible.contains(where: { $0.id == selectedThread.id }) ? selectedThread : visible.first
  }

  func pendingFocusedRuleIdentifier(for kind: RuleKind) -> String? {
    pendingRuleFocus[kind]
  }

  func clearPendingRuleIdentifier(for kind: RuleKind) {
    pendingRuleFocus.removeValue(forKey: kind)
  }

  func syncRulesWithRecentThreads(for kind: RuleKind) {
    var rules = draftSettings.permissions.rules(for: kind)
    var hasChanges = false

    for thread in recentThreads {
      guard threadRuleKind(for: thread) == kind else {
        continue
      }
      let identifier = threadIdentifier(for: thread)
      guard !identifier.isEmpty else {
        continue
      }

      if let index = rules.firstIndex(where: { $0.id.trimmingCharacters(in: .whitespacesAndNewlines) == identifier }) {
        if rules[index].name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          rules[index].name = thread.title
          hasChanges = true
        }
        if rules[index].note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          rules[index].note = thread.subtitle
          hasChanges = true
        }
        continue
      }

      var rule = ConsoleRule()
      rule.id = identifier
      rule.name = thread.title
      rule.mode = "allow"
      rule.note = thread.subtitle
      rules.append(rule)
      hasChanges = true
    }

    if hasChanges {
      setRules(kind, rules: rules)
    }
  }

  func capability(_ id: String) -> CatalogCapability? {
    bootstrap?.catalogs.capabilities.first(where: { $0.id == id })
  }

  func abilityCatalog(for kind: AbilityKind) -> CatalogCapability? {
    capability(kind.capabilityID)
  }

  func threadRuleKind(for thread: RecentThread) -> RuleKind? {
    switch thread.scope.lowercased() {
    case "group":
      return .groups
    case "p2p":
      return .users
    default:
      return nil
    }
  }

  func threadIdentifier(for thread: RecentThread) -> String {
    let raw = threadRuleKind(for: thread) == .groups ? thread.chatId : thread.requesterId
    return raw.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func threadRule(for thread: RecentThread) -> ConsoleRule? {
    guard let (kind, index) = locateThreadRuleIndex(for: thread) else {
      return nil
    }
    let rules = draftSettings.permissions.rules(for: kind)
    guard rules.indices.contains(index) else {
      return nil
    }
    return rules[index]
  }

  func threadRuleDisplayName(for thread: RecentThread) -> String {
    threadRule(for: thread)?.displayName ?? "默认状态（尚未单独配置）"
  }

  func threadCapabilityBinding(for capabilityID: String, thread: RecentThread) -> Binding<Bool> {
    Binding(
      get: { self.threadCapabilityValue(for: capabilityID, thread: thread) },
      set: { newValue in
        self.updateThreadCapability(newValue, capabilityID: capabilityID, thread: thread)
      }
    )
  }

  private func threadCapabilityValue(for capabilityID: String, thread: RecentThread) -> Bool {
    guard let (kind, index) = locateThreadRuleIndex(for: thread) else {
      return capabilityID == "chat"
    }
    let rules = draftSettings.permissions.rules(for: kind)
    guard rules.indices.contains(index) else {
      return false
    }
    return rules[index].capabilities.value(for: capabilityID)
  }

  private func updateThreadCapability(_ value: Bool, capabilityID: String, thread: RecentThread) {
    guard let (kind, index) = ensureThreadRuleIndex(for: thread) else {
      return
    }
    var rules = draftSettings.permissions.rules(for: kind)
    guard rules.indices.contains(index) else {
      return
    }
    rules[index].capabilities.setValue(value, for: capabilityID)
    setRules(kind, rules: rules)
  }

  private func locateThreadRuleIndex(for thread: RecentThread) -> (RuleKind, Int)? {
    guard let kind = threadRuleKind(for: thread) else {
      return nil
    }
    let identifier = threadIdentifier(for: thread)
    guard !identifier.isEmpty else {
      return nil
    }
    let rules = draftSettings.permissions.rules(for: kind)
    guard let index = rules.firstIndex(where: { $0.id.trimmingCharacters(in: .whitespacesAndNewlines) == identifier }) else {
      return nil
    }
    return (kind, index)
  }

  private func ensureThreadRuleIndex(for thread: RecentThread) -> (RuleKind, Int)? {
    if let located = locateThreadRuleIndex(for: thread) {
      return located
    }
    guard let kind = threadRuleKind(for: thread) else {
      return nil
    }
    let identifier = threadIdentifier(for: thread)
    guard !identifier.isEmpty else {
      return nil
    }
    var rules = draftSettings.permissions.rules(for: kind)
    var rule = ConsoleRule()
    rule.id = identifier
    rule.name = thread.title
    rule.mode = draftSettings.permissions.defaultMode
    rule.note = thread.subtitle
    rules.append(rule)
    setRules(kind, rules: rules)
    return (kind, max(rules.count - 1, 0))
  }

  var selectedThread: RecentThread? {
    if let selectedThreadID {
      return recentThreads.first(where: { $0.id == selectedThreadID })
    }
    return recentThreads.first
  }

  var validationMessage: String? {
    guard appMode == .onboarding else {
      return nil
    }
    return StepValidation.message(step: onboardingStep, env: draftEnv)
  }

  var stepProviderName: String {
    bootstrap?.catalogs.providers.first(where: { $0.id == draftEnv["BOT_LLM_PROVIDER"] })?.name ?? (draftEnv["BOT_LLM_PROVIDER"] ?? "未设置")
  }

  var runtimeHomePath: String {
    bootstrap?.runtimeHome ?? ConsolePaths.runtimeHome().path
  }

  var envPath: String {
    bootstrap?.envPath ?? "-"
  }

  var settingsPath: String {
    bootstrap?.settingsPath ?? "-"
  }

  var dataDirectoryPath: String {
    let sessionPath = draftEnv["SESSION_DB_PATH"] ?? "./data/feishu-bot.sqlite"
    if sessionPath == ":memory:" {
      return (runtimeHomePath as NSString).appendingPathComponent("data")
    }
    if sessionPath.hasPrefix("/") {
      return URL(fileURLWithPath: sessionPath).deletingLastPathComponent().path
    }
    let fullPath = (runtimeHomePath as NSString).appendingPathComponent(sessionPath)
    return URL(fileURLWithPath: fullPath).standardizedFileURL.deletingLastPathComponent().path
  }

  var healthSummary: String {
    if let error = health?.error, !error.isEmpty {
      return error
    }
    if let features = health?.health?.features {
      let messages = ["feishu", "diagnosticHttp", "smartkit", "chat"]
        .compactMap { key in features[key]?.message }
        .reduce(into: [String]()) { result, message in
          if !result.contains(message) {
            result.append(message)
          }
        }
      if !messages.isEmpty {
        return messages.joined(separator: " ")
      }
    }
    return "后台尚未返回健康状态。"
  }

  var diagnosticComponents: [DiagnosticHttpComponentConfig] {
    draftSettings.components.diagnosticHttp
  }

  var selectedDiagnosticComponentIndex: Int? {
    guard let selectedDiagnosticComponentID else {
      return diagnosticComponents.isEmpty ? nil : 0
    }
    return diagnosticComponents.firstIndex(where: { $0.id == selectedDiagnosticComponentID }) ?? (diagnosticComponents.isEmpty ? nil : 0)
  }

  var selectedDiagnosticComponent: DiagnosticHttpComponentConfig? {
    guard let index = selectedDiagnosticComponentIndex, diagnosticComponents.indices.contains(index) else {
      return nil
    }
    return diagnosticComponents[index]
  }

  var selectedDiagnosticComponentCatalog: CatalogCapability? {
    guard let component = selectedDiagnosticComponent else {
      return nil
    }
    return capability(component.capabilityID)
  }

  private var reservedComponentCommands: Set<String> {
    [
      "help",
      "new",
      "trace",
      "trace-async",
      "uid",
      "uid-async",
      "job",
      "chat",
      "chat-reset",
      "memory"
    ]
  }

  func diagnosticComponentCommandIssue(for component: DiagnosticHttpComponentConfig) -> String? {
    let command: String
    if selectedDiagnosticComponentID == component.id {
      command = normalizeCommandDraft(diagnosticComponentCommandDraft)
    } else {
      command = component.normalizedCommand
    }
    guard !command.isEmpty else {
      return nil
    }
    return commandConflictIssue(for: command, excluding: component.id)
  }

  func usableCommandLabel(for component: DiagnosticHttpComponentConfig) -> String {
    diagnosticComponentCommandIssue(for: component) == nil ? component.commandLabel : ""
  }

  var hasDiagnosticComponent: Bool {
    !diagnosticComponents.isEmpty
  }

  var diagnosticComponentPanelTitle: String {
    selectedDiagnosticComponent?.displayName ?? "自定义 HTTP 组件"
  }

  var diagnosticComponentPanelDescription: String {
    if let catalog = selectedDiagnosticComponentCatalog, !catalog.message.isEmpty {
      return catalog.message
    }
    let summary = selectedDiagnosticComponent?.summary.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !summary.isEmpty {
      return summary
    }
    return "每个组件都是一条独立能力；只有你自己添加、配置并打开总开关后，它才会出现在群组 / 用户 / 对话页的授权卡片里。"
  }

  var diagnosticComponentExamplesText: String {
    get {
      selectedDiagnosticComponent?.examplePrompts.joined(separator: "\n") ?? ""
    }
    set {
      updateSelectedDiagnosticComponent { component in
        component.examplePrompts = newValue
          .split(whereSeparator: \.isNewline)
          .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
      }
    }
  }

  var resolvedHelpContent: HelpContentSettings {
    (draftSettings.help ?? HelpContentSettings()).resolvedWithDefaults
  }

  var quickCommandPreviewItems: [QuickCommandPreviewItem] {
    var items = [
      QuickCommandPreviewItem(
        command: "/help",
        title: "功能说明",
        description: "展示通用说明，并按对象当前已开通的能力自动拼出功能列表。",
        status: "固定快捷命令",
        source: .fixed
      ),
      QuickCommandPreviewItem(
        command: "/new",
        title: "新话题",
        description: resolvedHelpContent.newCommandDescription,
        status: "固定快捷命令",
        source: .fixed
      )
    ]

    items.append(contentsOf: diagnosticComponents.compactMap { component in
      let command = component.commandLabel
      guard !command.isEmpty else {
        return nil
      }
      let catalog = capability(component.capabilityID)
      let baseDescription = component.summary.isEmpty ? (component.usageDescription.isEmpty ? "还没有填写组件说明。" : component.usageDescription) : component.summary
      let status: String
      let description: String
      if let issue = diagnosticComponentCommandIssue(for: component) {
        status = "不可用"
        description = "\(baseDescription)\n\(issue)"
      } else if catalog?.configured == true {
        status = component.enabled ? "命令已生效" : "总开关未开"
        description = baseDescription
      } else {
        status = "等待接入"
        description = baseDescription
      }
      return QuickCommandPreviewItem(
        command: command,
        title: component.displayName,
        description: description,
        status: status,
        source: .component
      )
    })

    return items
  }

  var helpPreviewCapabilityItems: [HelpCapabilityPreviewItem] {
    var builtinItems: [HelpCapabilityPreviewItem] = []

    if capability("chat")?.enabled == true {
      builtinItems.append(
        HelpCapabilityPreviewItem(
          title: "普通聊天",
          description: "私聊里直接发消息即可继续聊天；上下文会按用户单独记住。",
          command: nil,
          source: .builtin
        )
      )
    }

    if capability("webSearch")?.enabled == true {
      builtinItems.append(
        HelpCapabilityPreviewItem(
          title: "联网搜索",
          description: capabilityCardDescription(for: .webSearch),
          command: nil,
          source: .builtin
        )
      )
    }

    if capability("voiceReply")?.enabled == true {
      builtinItems.append(
        HelpCapabilityPreviewItem(
          title: "语音回复",
          description: capabilityCardDescription(for: .voiceReply),
          command: nil,
          source: .builtin
        )
      )
    }

    if capability("vision")?.enabled == true {
      builtinItems.append(
        HelpCapabilityPreviewItem(
          title: "视觉理解",
          description: capabilityCardDescription(for: .vision),
          command: nil,
          source: .builtin
        )
      )
    }

    let componentItems: [HelpCapabilityPreviewItem] = diagnosticComponents.compactMap { component in
      guard capability(component.capabilityID)?.enabled == true else {
        return nil
      }
      let command = usableCommandLabel(for: component)
      return HelpCapabilityPreviewItem(
        title: component.displayName,
        description: component.summary.isEmpty ? (component.usageDescription.isEmpty ? "这是一项已开通的自定义组件能力。" : component.usageDescription) : component.summary,
        command: command.isEmpty ? nil : command,
        source: .component
      )
    }

    return resolvedHelpContent.capabilityOrderMode == .componentFirst
      ? componentItems + builtinItems
      : builtinItems + componentItems
  }

  var helpExamplesText: String {
    get {
      let prompts = draftSettings.help?.examplePrompts.isEmpty == false
        ? (draftSettings.help?.examplePrompts ?? [])
        : resolvedHelpContent.examplePrompts
      return prompts.joined(separator: "\n")
    }
    set {
      var help = draftSettings.help ?? HelpContentSettings()
      help.examplePrompts = newValue
        .split(whereSeparator: \.isNewline)
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      draftSettings.help = help.isConfigured ? help : nil
      scheduleAutosave()
    }
  }

  var helpNotesText: String {
    get {
      let notes = draftSettings.help?.notes.isEmpty == false
        ? (draftSettings.help?.notes ?? [])
        : resolvedHelpContent.notes
      return notes.joined(separator: "\n")
    }
    set {
      var help = draftSettings.help ?? HelpContentSettings()
      help.notes = newValue
        .split(whereSeparator: \.isNewline)
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      draftSettings.help = help.isConfigured ? help : nil
      scheduleAutosave()
    }
  }

  func resetHelpContent() {
    draftSettings.help = nil
    scheduleAutosave()
  }

  var processingReactionSettings: ProcessingReactionSettings {
    draftSettings.feedback.processingReaction
  }

  var processingReactionSummary: String {
    let emoji = processingReactionSettings.resolvedEmoji
    if processingReactionSettings.enabled {
      return "收到消息后会先点上 \(emoji) 表情，真正开始回复前自动移除。"
    }
    return "已关闭处理中表情，机器人会直接进入处理和回复。"
  }

  func resetProcessingReactionSettings() {
    draftSettings.feedback.processingReaction = ProcessingReactionSettings()
    scheduleAutosave()
  }

  var autosaveStatusText: String {
    if isSaving {
      return "自动保存中..."
    }
    guard let lastDraftSavedAt else {
      return "修改后会自动保存，下一条消息立即生效。"
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.dateFormat = "HH:mm:ss"
    return "已自动保存 \(formatter.string(from: lastDraftSavedAt))，下一条消息立即生效。"
  }

  var contentTitle: String {
    switch appMode {
    case .onboarding:
      return onboardingStep.title
    case .console:
      if consoleSection == .thread {
        return selectedThread?.title ?? ConsoleSection.thread.title
      }
      return consoleSection.title
    }
  }

  var contentSubtitle: String {
    switch appMode {
    case .onboarding:
      return onboardingStep.subtitle
    case .console:
      if consoleSection == .thread {
        return selectedThread?.subtitle ?? ConsoleSection.thread.subtitle
      }
      return consoleSection.subtitle
    }
  }

  var onboardingFooterHint: String {
    if let validationMessage {
      return validationMessage
    }
    switch onboardingStep {
    case .feishu:
      return "点击“测试飞书并继续”后，会直接校验 App ID / Secret 并自动进入下一步。"
    case .model:
      return "点击“测试模型并进入控制台”后，会直接验证模型接口并启动后台。"
    }
  }

  var onboardingPrimaryButtonTitle: String {
    switch onboardingStep {
    case .feishu:
      return feishuConnectivityState.isRunning ? "测试中..." : "测试飞书并继续"
    case .model:
      return modelConnectivityState.isRunning ? "测试中..." : "测试模型并进入控制台"
    }
  }

  var isRunningOnboardingAction: Bool {
    switch onboardingStep {
    case .feishu:
      return feishuConnectivityState.isRunning
    case .model:
      return modelConnectivityState.isRunning
    }
  }

  private func applyBootstrap(_ payload: BridgeBootstrap) {
    let isInitialBootstrap = bootstrap == nil
    isApplyingBootstrap = true
    bootstrap = payload
    draftEnv = payload.env
    draftSettings = payload.settings
    if let selectedDiagnosticComponentID,
       !draftSettings.components.diagnosticHttp.contains(where: { $0.id == selectedDiagnosticComponentID }) {
      self.selectedDiagnosticComponentID = draftSettings.components.diagnosticHttp.first?.id
    } else if self.selectedDiagnosticComponentID == nil {
      self.selectedDiagnosticComponentID = draftSettings.components.diagnosticHttp.first?.id
    }
    syncDiagnosticComponentCommandDraft()
    consoleSection = payload.settings.ui.lastVisitedSection
    if isInitialBootstrap {
      onboardingStep = resolveOnboardingStep(from: payload)
    }
    if isRerunningOnboarding {
      appMode = .onboarding
    } else {
      appMode = payload.settings.ui.onboardingCompleted ? .console : .onboarding
    }
    needsRestart = payload.restartRequired || needsRestart
    isApplyingBootstrap = false
  }

  private func resolveOnboardingStep(from payload: BridgeBootstrap) -> OnboardingStep {
    if payload.onboarding.missing.feishuAppId || payload.onboarding.missing.feishuAppSecret {
      return .feishu
    }
    if payload.onboarding.missing.llmApiKey {
      return .model
    }
    return .model
  }

  private func applyProviderPreset() {
    guard let provider = bootstrap?.catalogs.providers.first(where: { $0.id == "stepfun" }) else {
      return
    }
    draftEnv["BOT_LLM_BASE_URL"] = provider.baseUrl
    draftEnv["BOT_LLM_MODEL"] = provider.chatModel
    draftEnv["BOT_VISION_MODEL"] = provider.visionModel
    draftEnv["BOT_TTS_MODEL"] = provider.ttsModel
  }

  private func scheduleAutosave() {
    guard !isApplyingBootstrap else {
      return
    }
    autosaveTask?.cancel()
    autosaveTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(600))
      guard let self else {
        return
      }
      await self.persistDraft(showSuccess: false)
    }
  }

  private func flushAutosave() async {
    autosaveTask?.cancel()
    autosaveTask = nil
    await persistDraft(showSuccess: false)
  }

  private func testCurrentOnboardingStep() async {
    guard StepValidation.canContinue(step: onboardingStep, env: draftEnv) else {
      let message = StepValidation.message(step: onboardingStep, env: draftEnv) ?? "当前步骤信息还不完整。"
      setConnectivityState(.failed(message), for: onboardingStep)
      notice = ""
      errorMessage = message
      return
    }

    await flushAutosave()
    notice = ""
    errorMessage = ""
    setConnectivityState(.running, for: onboardingStep)

    do {
      let result: ConnectivityTestResult
      switch onboardingStep {
      case .feishu:
        result = try await bridge.testFeishuConnectivity()
      case .model:
        result = try await bridge.testModelConnectivity()
      }

      setConnectivityState(.succeeded(result.detail), for: onboardingStep)
      notice = result.title
      errorMessage = ""

      switch onboardingStep {
      case .feishu:
        onboardingStep = .model
      case .model:
        finishOnboarding()
      }
    } catch {
      let message = error.localizedDescription
      setConnectivityState(.failed(message), for: onboardingStep)
      notice = ""
      errorMessage = message
    }
  }

  private func autoStartBackendIfNeeded() async {
    guard !didEnsureBackendForCurrentLaunch else {
      return
    }
    didEnsureBackendForCurrentLaunch = true
    guard draftSettings.ui.onboardingCompleted else {
      return
    }
    guard hasFeishuCredentials(in: draftEnv) else {
      return
    }

    notice = health?.ok == true
      ? "检测到控制台已更新，正在切换到当前版本的后台..."
      : "检测到基础配置已完成，正在自动启动后台..."
    do {
      let refreshed = try await supervisor.restart()
      applyBootstrap(refreshed)
      await loadRecentThreads(adoptPrimarySelection: false)
      needsRestart = false
      errorMessage = ""
      notice = "后台已自动启动。"
    } catch {
      notice = ""
      errorMessage = "后台自动启动失败：\(error.localizedDescription)"
    }
  }

  private func saveAndRestart(successNotice: String, failurePrefix: String? = nil) async {
    await flushAutosave()
    isSaving = true
    defer { isSaving = false }
    let shouldRestoreThreadSection = consoleSection == .thread
    do {
      let payload = try await bridge.saveConfig(env: draftEnv, settings: draftSettings)
      applyBootstrap(payload)
      let refreshed = try await supervisor.restart()
      applyBootstrap(refreshed)
      await loadRecentThreads(adoptPrimarySelection: false)
      if shouldRestoreThreadSection, selectedThread != nil {
        consoleSection = .thread
      }
      notice = successNotice
      errorMessage = ""
      needsRestart = false
      lastDraftSavedAt = Date()
    } catch {
      notice = ""
      if let failurePrefix, !failurePrefix.isEmpty {
        errorMessage = "\(failurePrefix)：\(error.localizedDescription)"
      } else {
        errorMessage = error.localizedDescription
      }
    }
  }

  private func persistDraft(showSuccess: Bool) async {
    isSaving = true
    defer { isSaving = false }
    let shouldRestoreThreadSection = consoleSection == .thread
    do {
      let payload = try await bridge.saveConfig(env: draftEnv, settings: draftSettings)
      applyBootstrap(payload)
      if shouldRestoreThreadSection, selectedThread != nil {
        consoleSection = .thread
      }
      if payload.restartRequired {
        needsRestart = true
      }
      lastDraftSavedAt = Date()
      if showSuccess {
        notice = "配置已保存。"
      }
      errorMessage = ""
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func startPolling() {
    pollingTask?.cancel()
    pollingTask = Task { [weak self] in
      while let self, !Task.isCancelled {
        await self.refreshHealth()
        await self.loadRecentThreads(adoptPrimarySelection: false)
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  private func hasFeishuCredentials(in env: [String: String]) -> Bool {
    let appId = (env["FEISHU_APP_ID"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let secret = (env["FEISHU_APP_SECRET"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return !appId.isEmpty && !secret.isEmpty
  }

  private func setConnectivityState(_ state: ConnectivityCheckState, for step: OnboardingStep) {
    switch step {
    case .feishu:
      feishuConnectivityState = state
    case .model:
      modelConnectivityState = state
    }
  }

  private func invalidateConnectivityState(for key: String) {
    switch key {
    case "FEISHU_APP_ID", "FEISHU_APP_SECRET":
      feishuConnectivityState = .idle
    case "BOT_LLM_PROVIDER", "BOT_LLM_API_KEY", "BOT_LLM_BASE_URL", "BOT_LLM_MODEL", "BOT_LLM_TIMEOUT_MS":
      modelConnectivityState = .idle
    case "DIAGNOSTIC_HTTP_BASE_URL", "DIAGNOSTIC_HTTP_TOKEN", "DIAGNOSTIC_HTTP_CALLER", "DIAGNOSTIC_HTTP_TIMEOUT_MS",
         "SMARTKIT_BASE_URL", "SMARTKIT_TOKEN", "SMARTKIT_CALLER", "SMARTKIT_TIMEOUT_MS":
      diagnosticComponentConnectivityState = .idle
    default:
      return
    }
  }

  private func loadRecentThreads(adoptPrimarySelection: Bool) async {
    do {
      recentThreads = try await bridge.listRecentThreads()
      syncSelectedThread(adoptPrimarySelection: adoptPrimarySelection)
      if isConversationSection(consoleSection), let selectedThreadID {
        await loadThreadMessages(sessionID: selectedThreadID)
      } else if isConversationSection(consoleSection) {
        selectedThreadMessages = []
      } else if recentThreads.isEmpty {
        selectedThreadMessages = []
      }
    } catch {
      recentThreads = []
      selectedThreadID = nil
      selectedThreadMessages = []
    }
  }

  private func loadThreadMessages(sessionID: String) async {
    do {
      selectedThreadMessages = try await bridge.listThreadMessages(sessionID: sessionID)
    } catch {
      selectedThreadMessages = []
    }
  }

  private func syncSelectedThread(adoptPrimarySelection: Bool) {
    syncSelectedThreadForCurrentSection()

    guard adoptPrimarySelection, appMode == .console else {
      return
    }

    if isConversationSection(consoleSection) {
      syncSelectedThreadForCurrentSection()
    } else if selectedThreadID == nil {
      selectedThreadID = recentThreads.first?.id
    }
  }

  private func isConversationSection(_ section: ConsoleSection) -> Bool {
    switch section {
    case .thread, .groups, .users:
      return true
    case .abilities, .system:
      return false
    }
  }

  private func syncSelectedThreadForCurrentSection() {
    let visibleThreads = recentThreads(for: consoleSection)
    if let selectedThreadID, visibleThreads.contains(where: { $0.id == selectedThreadID }) {
      return
    }
    selectedThreadID = visibleThreads.first?.id
  }
}
