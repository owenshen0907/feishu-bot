import Foundation
import SwiftUI

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
  @Published var consoleSection: ConsoleSection = .abilities
  @Published var activeSheet: ActiveSheet?
  @Published var notice = ""
  @Published var errorMessage = ""
  @Published var isLoading = false
  @Published var isSaving = false
  @Published var isSendingTestMessage = false
  @Published var needsRestart = false
  @Published private(set) var health: HealthProbe?

  let bridge: BridgeClient
  let supervisor: BackendSupervisor

  private var autosaveTask: Task<Void, Never>?
  private var pollingTask: Task<Void, Never>?
  private var isApplyingBootstrap = false
  private var isRerunningOnboarding = false

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
    scheduleAutosave()
  }

  func setBoolEnvValue(_ key: String, value: Bool) {
    draftEnv[key] = value ? "true" : "false"
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
    draftSettings.ui.lastVisitedSection = section
    scheduleAutosave()
  }

  func rerunOnboarding() {
    isRerunningOnboarding = true
    appMode = .onboarding
    onboardingStep = .feishu
    notice = ""
    errorMessage = ""
  }

  func previousOnboardingStep() {
    guard let previous = OnboardingStep(rawValue: onboardingStep.rawValue - 1) else {
      return
    }
    onboardingStep = previous
    errorMessage = ""
  }

  func nextOnboardingStep() {
    switch onboardingStep {
    case .feishu, .model:
      guard StepValidation.canContinue(step: onboardingStep, env: draftEnv) else {
        errorMessage = StepValidation.message(step: onboardingStep, env: draftEnv) ?? ""
        return
      }
      errorMessage = ""
      if let next = OnboardingStep(rawValue: onboardingStep.rawValue + 1) {
        onboardingStep = next
      }
    case .complete:
      finishOnboarding()
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
      draftSettings.ui.lastVisitedSection = .abilities
      consoleSection = .abilities
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

  func capability(_ id: String) -> CatalogCapability? {
    bootstrap?.catalogs.capabilities.first(where: { $0.id == id })
  }

  func abilityCatalog(for kind: AbilityKind) -> CatalogCapability? {
    capability(kind.capabilityID)
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
      let messages = ["feishu", "smartkit", "chat"].compactMap { key in
        features[key]?.message
      }
      if !messages.isEmpty {
        return messages.joined(separator: " ")
      }
    }
    return "后台尚未返回健康状态。"
  }

  var onboardingFooterHint: String {
    if let validationMessage {
      return validationMessage
    }
    if onboardingStep == .complete {
      return "完成后会自动启动后台并进入能力配置；系统设置里可以重新运行向导。"
    }
    return "当前步骤的字段会自动保存；真正生效需要你稍后应用并重启。"
  }

  private func applyBootstrap(_ payload: BridgeBootstrap) {
    let isInitialBootstrap = bootstrap == nil
    isApplyingBootstrap = true
    bootstrap = payload
    draftEnv = payload.env
    draftSettings = payload.settings
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
    return .complete
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

  private func autoStartBackendIfNeeded() async {
    guard draftSettings.ui.onboardingCompleted else {
      return
    }
    guard hasFeishuCredentials(in: draftEnv) else {
      return
    }
    guard health?.ok != true else {
      return
    }

    notice = "检测到基础配置已完成，正在自动启动后台..."
    do {
      let refreshed = try await supervisor.restart()
      applyBootstrap(refreshed)
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
    do {
      let payload = try await bridge.saveConfig(env: draftEnv, settings: draftSettings)
      applyBootstrap(payload)
      let refreshed = try await supervisor.restart()
      applyBootstrap(refreshed)
      notice = successNotice
      errorMessage = ""
      needsRestart = false
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
    do {
      let payload = try await bridge.saveConfig(env: draftEnv, settings: draftSettings)
      applyBootstrap(payload)
      if payload.restartRequired {
        needsRestart = true
      }
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
        try? await Task.sleep(for: .seconds(15))
      }
    }
  }

  private func hasFeishuCredentials(in env: [String: String]) -> Bool {
    let appId = (env["FEISHU_APP_ID"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let secret = (env["FEISHU_APP_SECRET"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return !appId.isEmpty && !secret.isEmpty
  }
}
