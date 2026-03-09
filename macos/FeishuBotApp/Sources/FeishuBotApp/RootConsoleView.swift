import SwiftUI

private let shellCornerRadius: CGFloat = 30
private let sidebarWidth: CGFloat = 292

struct RootConsoleView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    ZStack {
      BackgroundDecoration()

      if store.isLoading && store.bootstrap == nil {
        ProgressView("正在加载 Feishu Bot 控制台...")
          .controlSize(.large)
      } else if store.bootstrap != nil {
        ShellView(store: store)
          .padding(22)
      } else {
        LoadFailureView(store: store)
      }
    }
    .sheet(item: $store.activeSheet) { sheet in
      switch sheet {
      case .advancedModel:
        AdvancedModelSheet(store: store)
      case .advancedRuntime:
        AdvancedRuntimeSheet(store: store)
      case .abilityDetail(let ability):
        AbilityDetailSheet(store: store, ability: ability)
      }
    }
  }
}

private struct BackgroundDecoration: View {
  var body: some View {
    ZStack {
      LinearGradient(
        colors: [
          Color(nsColor: .windowBackgroundColor),
          Color(red: 0.95, green: 0.96, blue: 0.98)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      .ignoresSafeArea()

      Circle()
        .fill(Color.accentColor.opacity(0.08))
        .frame(width: 420, height: 420)
        .blur(radius: 20)
        .offset(x: -380, y: -260)

      Circle()
        .fill(Color.orange.opacity(0.08))
        .frame(width: 360, height: 360)
        .blur(radius: 30)
        .offset(x: 420, y: 260)
    }
  }
}

private struct LoadFailureView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    VStack(spacing: 14) {
      Text("控制台加载失败")
        .font(.title2.weight(.semibold))
      Text(store.errorMessage.isEmpty ? "未获取到初始化数据。" : store.errorMessage)
        .foregroundStyle(.secondary)
      Button("重试") {
        Task {
          await store.load()
        }
      }
      .buttonStyle(.borderedProminent)
    }
    .padding(32)
    .background(.regularMaterial)
    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
  }
}

private struct ShellView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 0) {
      Group {
        switch store.appMode {
        case .onboarding:
          OnboardingSidebar(store: store)
        case .console:
          ConsoleSidebar(store: store)
        }
      }
      .frame(width: sidebarWidth)
      .background(.ultraThinMaterial)

      Divider()

      VStack(spacing: 0) {
        ContentArea(store: store)
        Divider()
        Group {
          switch store.appMode {
          case .onboarding:
            OnboardingFooterBar(store: store)
          case .console:
            ConsoleFooterBar(store: store)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color.white.opacity(0.32))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .clipShape(RoundedRectangle(cornerRadius: shellCornerRadius, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: shellCornerRadius, style: .continuous)
        .stroke(Color.black.opacity(0.06), lineWidth: 1)
    )
    .shadow(color: Color.black.opacity(0.08), radius: 30, y: 18)
  }
}

private struct OnboardingSidebar: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    VStack(alignment: .leading, spacing: 26) {
      BrandBlock(
        eyebrow: "首次引导",
        title: "Feishu Bot",
        subtitle: "只保留基础接入。完成后默认进入正式控制台，不再反复显示步骤。"
      )

      VStack(alignment: .leading, spacing: 10) {
        Text("步骤")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)

        ForEach(OnboardingStep.allCases) { step in
          Button {
            store.onboardingStep = step
            store.errorMessage = ""
          } label: {
            SidebarStepRow(
              title: step.title,
              subtitle: step.subtitle,
              symbol: step.symbol,
              isSelected: store.onboardingStep == step
            )
          }
          .buttonStyle(.plain)
        }
      }

      Spacer()

      InfoCallout(
        title: "完成后去哪里？",
        text: "正式控制台只保留能力配置、群组、用户和系统设置。"
      )
    }
    .padding(28)
  }
}

private struct ConsoleSidebar: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    VStack(alignment: .leading, spacing: 26) {
      BrandBlock(
        eyebrow: "正式控制台",
        title: "Feishu Bot",
        subtitle: "先做全局能力接入，再决定哪些群组和用户可以消费这些能力。"
      )

      VStack(alignment: .leading, spacing: 10) {
        Text("主导航")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)

        ForEach([ConsoleSection.abilities, .groups, .users], id: \.self) { section in
          Button {
            store.selectConsoleSection(section)
          } label: {
            SidebarStepRow(
              title: section.title,
              subtitle: section.subtitle,
              symbol: section.symbol,
              isSelected: store.consoleSection == section
            )
          }
          .buttonStyle(.plain)
        }
      }

      Spacer()

      VStack(alignment: .leading, spacing: 12) {
        Button {
          store.selectConsoleSection(.system)
        } label: {
          SidebarStepRow(
            title: ConsoleSection.system.title,
            subtitle: ConsoleSection.system.subtitle,
            symbol: ConsoleSection.system.symbol,
            isSelected: store.consoleSection == .system
          )
        }
        .buttonStyle(.plain)

        if store.needsRestart {
          Label("已有配置写入磁盘，等待应用并重启", systemImage: "arrow.triangle.2.circlepath")
            .font(.callout.weight(.medium))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.accentColor.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
      }
    }
    .padding(28)
  }
}

private struct BrandBlock: View {
  let eyebrow: String
  let title: String
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(eyebrow)
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
      Text(title)
        .font(.system(size: 30, weight: .bold, design: .rounded))
      Text(subtitle)
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

private struct SidebarStepRow: View {
  let title: String
  let subtitle: String
  let symbol: String
  let isSelected: Bool

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: symbol)
        .frame(width: 22)
        .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)

      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.headline)
          .foregroundStyle(.primary)
        Text(subtitle)
          .font(.caption)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 0)
    }
    .padding(.vertical, 11)
    .padding(.horizontal, 12)
    .background(isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct InfoCallout: View {
  let title: String
  let text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
      Text(text)
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.white.opacity(0.55))
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

private struct ContentArea: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      header

      if !store.errorMessage.isEmpty {
        InlineBanner(text: store.errorMessage, tint: .red.opacity(0.12), foreground: .red)
      } else if store.needsRestart {
        InlineBanner(text: "配置已自动保存。点击“应用并重启”让后台使用最新配置。", tint: Color.accentColor.opacity(0.12), foreground: .accentColor)
      } else if !store.notice.isEmpty {
        InlineBanner(text: store.notice, tint: .green.opacity(0.12), foreground: .green)
      }

      Group {
        switch store.appMode {
        case .onboarding:
          OnboardingContent(store: store)
        case .console:
          ConsoleContent(store: store)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .animation(.snappy(duration: 0.25), value: store.appMode)
      .animation(.snappy(duration: 0.25), value: store.consoleSection)
      .animation(.snappy(duration: 0.25), value: store.onboardingStep)
    }
    .padding(28)
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(store.appMode == .onboarding ? store.onboardingStep.title : store.consoleSection.title)
        .font(.system(size: 34, weight: .bold, design: .rounded))
      Text(store.appMode == .onboarding ? store.onboardingStep.subtitle : store.consoleSection.subtitle)
        .font(.title3)
        .foregroundStyle(.secondary)
    }
  }
}

private struct InlineBanner: View {
  let text: String
  let tint: Color
  let foreground: Color

  var body: some View {
    Text(text)
      .font(.callout)
      .foregroundStyle(foreground)
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(tint)
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct OnboardingContent: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    switch store.onboardingStep {
    case .feishu:
      FeishuOnboardingView(store: store)
    case .model:
      ModelOnboardingView(store: store)
    case .complete:
      CompleteOnboardingView(store: store)
    }
  }
}

private struct FeishuOnboardingView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 18) {
      Panel(title: "基础凭据", subtitle: "首次上线只需要 App ID、App Secret 和 Bot 名称。") {
        VStack(spacing: 16) {
          FieldRow(title: "App ID") {
            TextField("cli_xxx", text: store.binding(for: "FEISHU_APP_ID"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "App Secret") {
            SecureField("secret_xxx", text: store.binding(for: "FEISHU_APP_SECRET"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "Bot 名称") {
            TextField("feishu-bot", text: store.binding(for: "FEISHU_BOT_NAME", fallback: "feishu-bot"))
              .textFieldStyle(.roundedBorder)
          }
        }
      }

      Panel(title: "填写说明") {
        VStack(alignment: .leading, spacing: 14) {
          ChecklistRow(text: "App ID / App Secret 是机器人上线的必填项。")
          ChecklistRow(text: "Bot 名称用于默认展示和调用标识，可后续再改。")
          ChecklistRow(text: "本页不显示运行状态或快捷入口，只处理当前步骤配置。")
        }
      }
      .frame(width: 300)
    }
  }
}

private struct ModelOnboardingView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 18) {
      Panel(title: "模型接入", subtitle: "这里只保留供应商和 API Key，高级参数通过 sheet 打开。") {
        VStack(spacing: 16) {
          FieldRow(title: "供应商") {
            Picker("供应商", selection: store.binding(for: "BOT_LLM_PROVIDER")) {
              ForEach(store.bootstrap?.catalogs.providers ?? []) { provider in
                Text(provider.name).tag(provider.id)
              }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
          }

          FieldRow(title: "API Key") {
            SecureField("sk-...", text: store.binding(for: "BOT_LLM_API_KEY"))
              .textFieldStyle(.roundedBorder)
          }

          FieldRow(title: "高级设置") {
            HStack(spacing: 12) {
              Button("Advanced Model Settings") {
                store.activeSheet = .advancedModel
              }
              if let url = URL(string: store.bootstrap?.docs.stepApiKey ?? "") {
                Link("Step API 文档", destination: url)
              }
            }
          }
        }
      }

      Panel(title: "当前默认值") {
        VStack(alignment: .leading, spacing: 12) {
          KeyValueRow(title: "Base URL", value: store.draftEnv["BOT_LLM_BASE_URL"] ?? "-")
          KeyValueRow(title: "文本模型", value: store.draftEnv["BOT_LLM_MODEL"] ?? "-")
          KeyValueRow(title: "视觉模型", value: store.draftEnv["BOT_VISION_MODEL"] ?? "-")
          KeyValueRow(title: "语音模型", value: store.draftEnv["BOT_TTS_MODEL"] ?? "-")
        }
      }
      .frame(width: 320)
    }
  }
}

private struct CompleteOnboardingView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 18) {
      Panel(title: "基础接入确认") {
        VStack(alignment: .leading, spacing: 14) {
          KeyValueRow(title: "飞书 App ID", value: store.draftEnv["FEISHU_APP_ID"] ?? "-")
          KeyValueRow(title: "Bot 名称", value: store.draftEnv["FEISHU_BOT_NAME"] ?? "feishu-bot")
          KeyValueRow(title: "模型供应商", value: store.stepProviderName)
          KeyValueRow(title: "API Key", value: (store.draftEnv["BOT_LLM_API_KEY"] ?? "").isEmpty ? "未填写" : "已填写")
        }
      }

      Panel(title: "进入正式控制台后") {
        VStack(alignment: .leading, spacing: 14) {
          ChecklistRow(text: "先在能力配置里接入 SmartKit、联网搜索、语音和视觉能力。")
          ChecklistRow(text: "再到群组和用户页面分配可消费能力。")
          ChecklistRow(text: "系统设置里提供运行状态、目录入口、重启后台和重新运行向导。")
        }
      }
      .frame(width: 340)
    }
  }
}

private struct ConsoleContent: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    switch store.consoleSection {
    case .abilities:
      AbilitiesConsoleView(store: store)
    case .groups:
      RulesConsoleView(store: store, kind: .groups)
    case .users:
      RulesConsoleView(store: store, kind: .users)
    case .system:
      SystemSettingsView(store: store)
    }
  }
}

private struct AbilitiesConsoleView: View {
  @ObservedObject var store: ConsoleStore

  private let columns = [
    GridItem(.flexible(), spacing: 18),
    GridItem(.flexible(), spacing: 18)
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Panel(title: "分配逻辑") {
        HStack(spacing: 14) {
          CapabilityHint(text: "先全局接入能力并打开开关")
          CapabilityHint(text: "未全局开启的能力会在群组/用户页显示但置灰")
          CapabilityHint(text: "用户规则优先于群组规则")
        }
      }

      LazyVGrid(columns: columns, spacing: 18) {
        AbilityCardView(
          ability: .smartkit,
          catalog: store.abilityCatalog(for: .smartkit),
          toggle: nil,
          action: { store.activeSheet = .abilityDetail(.smartkit) }
        )
        AbilityCardView(
          ability: .webSearch,
          catalog: store.abilityCatalog(for: .webSearch),
          toggle: store.boolBinding(for: "BOT_CAPABILITY_WEB_SEARCH"),
          action: { store.activeSheet = .abilityDetail(.webSearch) }
        )
        AbilityCardView(
          ability: .voiceReply,
          catalog: store.abilityCatalog(for: .voiceReply),
          toggle: store.boolBinding(for: "BOT_CAPABILITY_VOICE_REPLY"),
          action: { store.activeSheet = .abilityDetail(.voiceReply) }
        )
        AbilityCardView(
          ability: .vision,
          catalog: store.abilityCatalog(for: .vision),
          toggle: store.boolBinding(for: "BOT_CAPABILITY_VISION"),
          action: { store.activeSheet = .abilityDetail(.vision) }
        )
      }
    }
  }
}

private struct CapabilityHint: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.callout)
      .padding(.vertical, 10)
      .padding(.horizontal, 12)
      .background(Color.secondary.opacity(0.08))
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
  }
}

private struct AbilityCardView: View {
  let ability: AbilityKind
  let catalog: CatalogCapability?
  let toggle: Binding<Bool>?
  let action: () -> Void

  var body: some View {
    Panel {
      VStack(alignment: .leading, spacing: 18) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 6) {
            Text(ability.title)
              .font(.title3.weight(.semibold))
            Text(ability.description)
              .font(.callout)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
          Spacer(minLength: 16)
          if let toggle {
            Toggle("", isOn: toggle)
              .labelsHidden()
          } else {
            StatusBadge(title: "接入即生效", color: .secondary)
          }
        }

        VStack(alignment: .leading, spacing: 10) {
          HStack(spacing: 10) {
            StatusBadge(title: catalog?.configured == true ? "已接入" : "未接入", color: catalog?.configured == true ? .green : .secondary)
            StatusBadge(title: catalog?.enabled == true ? "已开启" : "未开启", color: catalog?.enabled == true ? .accentColor : .orange)
          }

          Text(catalog?.message ?? ability.description)
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }

        Spacer(minLength: 0)

        Button("配置", action: action)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .frame(height: 240)
  }
}

private struct RulesConsoleView: View {
  @ObservedObject var store: ConsoleStore
  let kind: RuleKind

  @State private var searchText = ""
  @State private var selectedIndex: Int?

  private var allRules: [ConsoleRule] {
    store.rules(for: kind)
  }

  private var filteredIndices: [Int] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !query.isEmpty else {
      return Array(allRules.indices)
    }
    return allRules.indices.filter { index in
      let rule = allRules[index]
      return rule.id.lowercased().contains(query) || rule.name.lowercased().contains(query) || rule.note.lowercased().contains(query)
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Panel(title: "规则基础设置") {
        HStack(alignment: .top, spacing: 20) {
          FieldRow(title: "默认模式") {
            Picker("默认模式", selection: Binding(
              get: { store.draftSettings.permissions.defaultMode },
              set: { store.setDefaultMode($0) }
            )) {
              Text("默认允许").tag("allow")
              Text("仅白名单").tag("restricted")
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: 260)
          }

          Divider()
            .frame(height: 40)

          VStack(alignment: .leading, spacing: 8) {
            Text(kind.overrideMessage ?? "能力未全局开启时会在矩阵中显示为置灰。")
              .font(.callout)
              .foregroundStyle(.secondary)
            Text("规则模式支持 allow / readonly / block；能力矩阵只决定哪些能力可以消费。")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        }
      }

      HStack(spacing: 18) {
        RuleListPanel(
          kind: kind,
          rules: allRules,
          filteredIndices: filteredIndices,
          searchText: $searchText,
          selectedIndex: $selectedIndex,
          onAdd: {
            let index = store.addRule(kind)
            selectedIndex = index
          },
          onDelete: {
            guard let selectedIndex else {
              return
            }
            store.deleteRule(kind, index: selectedIndex)
            syncSelection(afterRemoving: selectedIndex)
          }
        )
        .frame(width: 320)

        if let selectedIndex, allRules.indices.contains(selectedIndex) {
          RuleDetailPanel(store: store, kind: kind, index: selectedIndex)
        } else {
          Panel {
            ContentUnavailableView(kind.emptyTitle, systemImage: "tray", description: Text("先在左侧新增一条规则，再在这里配置模式和能力矩阵。"))
              .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      }
      .frame(maxHeight: .infinity)
    }
    .onAppear {
      syncSelection()
    }
    .onChange(of: allRules.count) { _, _ in
      syncSelection()
    }
    .onChange(of: searchText) { _, _ in
      syncSelection(preferCurrentIfVisible: true)
    }
  }

  private func syncSelection(preferCurrentIfVisible: Bool = false, afterRemoving removedIndex: Int? = nil) {
    let currentRules = allRules
    guard !currentRules.isEmpty else {
      selectedIndex = nil
      return
    }

    let visibleIndices = filteredIndices
    guard !visibleIndices.isEmpty else {
      selectedIndex = nil
      return
    }

    if let removedIndex {
      if let firstVisible = visibleIndices.first {
        selectedIndex = min(firstVisible, max(currentRules.count - 1, 0))
      } else {
        selectedIndex = max(min(removedIndex, currentRules.count - 1), 0)
      }
      return
    }

    if preferCurrentIfVisible, let selectedIndex, visibleIndices.contains(selectedIndex) {
      return
    }

    if let selectedIndex, currentRules.indices.contains(selectedIndex), visibleIndices.contains(selectedIndex) {
      return
    }

    self.selectedIndex = visibleIndices.first
  }
}

private struct RuleListPanel: View {
  let kind: RuleKind
  let rules: [ConsoleRule]
  let filteredIndices: [Int]
  @Binding var searchText: String
  @Binding var selectedIndex: Int?
  let onAdd: () -> Void
  let onDelete: () -> Void

  var body: some View {
    Panel(title: "\(kind.title)列表") {
      VStack(spacing: 14) {
        TextField(kind.placeholder, text: $searchText)
          .textFieldStyle(.roundedBorder)

        ScrollView {
          VStack(spacing: 10) {
            if filteredIndices.isEmpty {
              ContentUnavailableView("未找到结果", systemImage: "magnifyingglass", description: Text("换个关键词，或直接新增一条规则。"))
                .frame(maxWidth: .infinity)
                .padding(.top, 20)
            } else {
              ForEach(filteredIndices, id: \.self) { index in
                Button {
                  selectedIndex = index
                } label: {
                  RuleListRow(rule: rules[index], isSelected: selectedIndex == index)
                }
                .buttonStyle(.plain)
              }
            }
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)

        HStack {
          Button(kind.addTitle, action: onAdd)
          Spacer()
          Button("删除", action: onDelete)
            .disabled(selectedIndex == nil)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

private struct RuleListRow: View {
  let rule: ConsoleRule
  let isSelected: Bool

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(rule.displayName)
          .font(.headline)
        Text(rule.id.isEmpty ? rule.mode : rule.id)
          .font(.caption)
          .foregroundStyle(.secondary)
        if !rule.note.isEmpty {
          Text(rule.note)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isSelected ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct RuleDetailPanel: View {
  @ObservedObject var store: ConsoleStore
  let kind: RuleKind
  let index: Int

  var body: some View {
    let ruleBinding = store.ruleBinding(for: kind, index: index)
    Panel(title: "\(kind.title)详情", subtitle: kind == .users ? "右侧编辑当前规则；用户配置覆盖群组配置。" : "右侧编辑当前规则，并控制当前群组可消费的能力。") {
      VStack(alignment: .leading, spacing: 18) {
        if let overrideMessage = kind.overrideMessage {
          InlineBanner(text: overrideMessage, tint: Color.accentColor.opacity(0.10), foreground: .accentColor)
        }

        HStack(spacing: 18) {
          Panel(title: "基础信息") {
            VStack(spacing: 14) {
              FieldRow(title: kind == .groups ? "群标识" : "用户标识") {
                TextField(kind == .groups ? "oc_xxx" : "ou_xxx", text: ruleBinding.id)
                  .textFieldStyle(.roundedBorder)
              }
              FieldRow(title: "备注名称") {
                TextField(kind == .groups ? "SRE 值班群" : "张三", text: ruleBinding.name)
                  .textFieldStyle(.roundedBorder)
              }
              FieldRow(title: "模式") {
                Picker("模式", selection: ruleBinding.mode) {
                  Text("allow").tag("allow")
                  Text("readonly").tag("readonly")
                  Text("block").tag("block")
                }
                .labelsHidden()
                .pickerStyle(.segmented)
              }
              FieldRow(title: "备注") {
                TextField("例如：只允许排障时使用", text: ruleBinding.note)
                  .textFieldStyle(.roundedBorder)
              }
            }
          }

          Panel(title: "摘要") {
            VStack(alignment: .leading, spacing: 12) {
              KeyValueRow(title: "规则名称", value: ruleBinding.wrappedValue.displayName)
              KeyValueRow(title: "当前模式", value: ruleBinding.wrappedValue.mode)
              KeyValueRow(title: "启用能力", value: enabledSummary(ruleBinding.wrappedValue))
            }
          }
          .frame(width: 260)
        }

        Panel(title: "可消费能力矩阵", subtitle: "未全局开启的能力显示为置灰，不可勾选。") {
          VStack(spacing: 12) {
            ForEach(store.bootstrap?.catalogs.capabilities ?? []) { capability in
              CapabilityAssignmentRow(
                capability: capability,
                isOn: store.capabilityBinding(for: capability.id, kind: kind, index: index)
              )
            }
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private func enabledSummary(_ rule: ConsoleRule) -> String {
    let labels = (store.bootstrap?.catalogs.capabilities ?? []).compactMap { capability -> String? in
      rule.capabilities.value(for: capability.id) ? capability.label : nil
    }
    return labels.isEmpty ? "未选择" : labels.joined(separator: "、")
  }
}

private struct CapabilityAssignmentRow: View {
  let capability: CatalogCapability
  @Binding var isOn: Bool

  var body: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text(capability.label)
            .font(.headline)
          StatusBadge(title: capability.enabled ? "已开启" : "未开启", color: capability.enabled ? .green : .secondary)
        }
        Text(capability.message)
          .font(.caption)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 0)

      Toggle("", isOn: $isOn)
        .labelsHidden()
        .disabled(!capability.assignable)
    }
    .padding(14)
    .background(Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct SystemSettingsView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    VStack(spacing: 18) {
      HStack(spacing: 18) {
        Panel(title: "健康状态") {
          VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
              StatusBadge(title: store.health?.ok == true ? "在线" : "未就绪", color: store.health?.ok == true ? .green : .orange)
              if let target = store.health?.target, !target.isEmpty {
                Text(target)
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .lineLimit(1)
              }
            }
            Text(store.healthSummary)
              .font(.callout)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
            if let nextSteps = store.health?.health?.nextSteps, !nextSteps.isEmpty {
              Divider()
              ForEach(nextSteps, id: \.self) { step in
                ChecklistRow(text: step)
              }
            }
          }
        }

        Panel(title: "路径") {
          VStack(alignment: .leading, spacing: 12) {
            KeyValueRow(title: "运行目录", value: store.runtimeHomePath)
            KeyValueRow(title: ".env", value: store.envPath)
            KeyValueRow(title: "console-settings", value: store.settingsPath)
            KeyValueRow(title: "数据目录", value: store.dataDirectoryPath)
          }
        }
      }

      Panel(title: "操作") {
        VStack(alignment: .leading, spacing: 16) {
          HStack(spacing: 12) {
            Button("打开 .env") {
              store.openConfig()
            }
            Button("打开数据目录") {
              store.openData()
            }
            Button(store.needsRestart ? "应用并重启" : "重启后台") {
              store.applyAndRestart()
            }
            .buttonStyle(.borderedProminent)
          }

          HStack(spacing: 12) {
            Button("高级运行参数") {
              store.activeSheet = .advancedRuntime
            }
            Button("重新运行向导") {
              store.rerunOnboarding()
            }
          }

          Text("系统设置不占正式业务页面空间；这里只放运行状态、目录入口和后台操作。")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }

      Panel(title: "飞书连通性测试", subtitle: "给一个指定的 chat_id / open_id / user_id 主动发送测试消息，确认机器人已经能真正发出消息。") {
        VStack(alignment: .leading, spacing: 16) {
          HStack(spacing: 14) {
            Picker("接收类型", selection: store.feishuTestReceiveTypeBinding()) {
              ForEach(FeishuTestReceiveType.allCases) { type in
                Text(type.title).tag(type)
              }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .frame(width: 260)

            TextField(
              store.draftSettings.ui.feishuTestReceiveIdType.placeholder,
              text: store.feishuTestReceiveIdBinding()
            )
            .textFieldStyle(.roundedBorder)
          }

          HStack(spacing: 12) {
            Button("发送测试消息") {
              store.sendFeishuTestMessage()
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.isSendingTestMessage)

            Text("成功后你会收到一条主动消息，然后再给机器人发 `/help` 就能验证收发两侧。")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        }
      }
    }
  }
}

private struct OnboardingFooterBar: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 16) {
      Text(store.onboardingFooterHint)
        .font(.callout)
        .foregroundStyle(store.validationMessage == nil ? Color.secondary : Color.orange)

      Spacer(minLength: 0)

      Button("上一步") {
        store.previousOnboardingStep()
      }
      .disabled(store.onboardingStep == .feishu)

      if store.needsRestart {
        Button("应用并重启") {
          store.applyAndRestart()
        }
      }

      Button(store.onboardingStep == .complete ? "进入控制台" : "下一步") {
        store.nextOnboardingStep()
      }
      .buttonStyle(.borderedProminent)
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 18)
    .background(.regularMaterial)
  }
}

private struct ConsoleFooterBar: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 3) {
        Text(store.isSaving ? "自动保存中..." : "正式控制台中的修改会自动写入本地配置。")
          .font(.callout)
          .foregroundStyle(.secondary)
        Text(store.needsRestart ? "存在待应用改动，点击右侧按钮后统一重启后台。" : "当前没有待应用改动，仍可手动重启后台确认状态。")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 0)

      Button(store.needsRestart ? "应用并重启" : "重启后台") {
        store.applyAndRestart()
      }
      .buttonStyle(.borderedProminent)
      .disabled(store.isSaving || store.supervisor.isRestarting)
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 18)
    .background(.regularMaterial)
  }
}

private struct Panel<Content: View>: View {
  private let title: String?
  private let subtitle: String?
  private let content: Content

  init(title: String? = nil, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
    self.title = title
    self.subtitle = subtitle
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      if let title {
        VStack(alignment: .leading, spacing: 4) {
          Text(title)
            .font(.headline)
          if let subtitle {
            Text(subtitle)
              .font(.callout)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }

      content
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(.thinMaterial)
    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
  }
}

private struct FieldRow<Content: View>: View {
  let title: String
  private let content: Content

  init(title: String, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 16) {
      Text(title)
        .frame(width: 126, alignment: .leading)
        .foregroundStyle(.secondary)
      content
    }
  }
}

private struct ChecklistRow: View {
  let text: String

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "checkmark.circle.fill")
        .foregroundStyle(.green)
      Text(text)
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

private struct StatusBadge: View {
  let title: String
  let color: Color

  var body: some View {
    Text(title)
      .font(.caption.weight(.semibold))
      .foregroundStyle(color)
      .padding(.vertical, 6)
      .padding(.horizontal, 10)
      .background(color.opacity(0.10))
      .clipShape(Capsule())
  }
}

private struct KeyValueRow: View {
  let title: String
  let value: String

  var body: some View {
    HStack(alignment: .top, spacing: 16) {
      Text(title)
        .foregroundStyle(.secondary)
      Spacer(minLength: 20)
      Text(value)
        .multilineTextAlignment(.trailing)
        .fontWeight(.medium)
        .lineLimit(3)
    }
  }
}

private struct AdvancedModelSheet: View {
  @ObservedObject var store: ConsoleStore
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("Advanced Model Settings")
        .font(.title2.weight(.semibold))

      Panel {
        VStack(spacing: 16) {
          FieldRow(title: "Base URL") {
            TextField("https://api.stepfun.com/v1", text: store.binding(for: "BOT_LLM_BASE_URL"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "文本模型") {
            TextField("step-3.5-flash", text: store.binding(for: "BOT_LLM_MODEL"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "视觉模型") {
            TextField("step-1o-turbo-vision", text: store.binding(for: "BOT_VISION_MODEL"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "语音模型") {
            TextField("step-tts-2", text: store.binding(for: "BOT_TTS_MODEL"))
              .textFieldStyle(.roundedBorder)
          }
        }
      }

      HStack {
        Spacer()
        Button("完成") {
          dismiss()
        }
        .buttonStyle(.borderedProminent)
      }
    }
    .padding(24)
    .frame(width: 760, height: 420)
  }
}

private struct AdvancedRuntimeSheet: View {
  @ObservedObject var store: ConsoleStore
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("Advanced Runtime Settings")
        .font(.title2.weight(.semibold))

      Panel {
        VStack(spacing: 16) {
          FieldRow(title: "BOT_PROFILE") {
            TextField("development", text: store.binding(for: "BOT_PROFILE", fallback: "development"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "SMARTKIT_CALLER") {
            TextField("feishu-bot", text: store.binding(for: "SMARTKIT_CALLER", fallback: "feishu-bot"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "SMARTKIT_TIMEOUT_MS") {
            TextField("20000", text: store.binding(for: "SMARTKIT_TIMEOUT_MS", fallback: "20000"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "SESSION_DB_PATH") {
            TextField("./data/feishu-bot.sqlite", text: store.binding(for: "SESSION_DB_PATH", fallback: "./data/feishu-bot.sqlite"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "HEALTH_BIND") {
            TextField("127.0.0.1", text: store.binding(for: "HEALTH_BIND", fallback: "127.0.0.1"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "HEALTH_PORT") {
            TextField("3179", text: store.binding(for: "HEALTH_PORT", fallback: "3179"))
              .textFieldStyle(.roundedBorder)
          }
          FieldRow(title: "JOB_POLL_INTERVAL_MS") {
            TextField("15000", text: store.binding(for: "JOB_POLL_INTERVAL_MS", fallback: "15000"))
              .textFieldStyle(.roundedBorder)
          }
        }
      }

      HStack {
        Spacer()
        Button("完成") {
          dismiss()
        }
        .buttonStyle(.borderedProminent)
      }
    }
    .padding(24)
    .frame(width: 820, height: 520)
  }
}

private struct AbilityDetailSheet: View {
  @ObservedObject var store: ConsoleStore
  let ability: AbilityKind
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text(ability.title)
        .font(.title2.weight(.semibold))

      Panel {
        VStack(spacing: 16) {
          switch ability {
          case .smartkit:
            FieldRow(title: "Base URL") {
              TextField("https://smartkit.example.com", text: store.binding(for: "SMARTKIT_BASE_URL"))
                .textFieldStyle(.roundedBorder)
            }
            FieldRow(title: "Token") {
              SecureField("optional", text: store.binding(for: "SMARTKIT_TOKEN"))
                .textFieldStyle(.roundedBorder)
            }
          case .webSearch:
            FieldRow(title: "Brave API Key") {
              SecureField("api key", text: store.binding(for: "BRAVE_SEARCH_API_KEY"))
                .textFieldStyle(.roundedBorder)
            }
            if let url = URL(string: store.bootstrap?.docs.braveSearch ?? "") {
              FieldRow(title: "文档") {
                Link("Brave Search API", destination: url)
              }
            }
          case .voiceReply:
            FieldRow(title: "语音模型") {
              TextField("step-tts-2", text: store.binding(for: "BOT_TTS_MODEL"))
                .textFieldStyle(.roundedBorder)
            }
          case .vision:
            FieldRow(title: "视觉模型") {
              TextField("step-1o-turbo-vision", text: store.binding(for: "BOT_VISION_MODEL"))
                .textFieldStyle(.roundedBorder)
            }
          }
        }
      }

      HStack {
        Spacer()
        Button("完成") {
          dismiss()
        }
        .buttonStyle(.borderedProminent)
      }
    }
    .padding(24)
    .frame(width: 680, height: ability == .smartkit ? 300 : 260)
  }
}
