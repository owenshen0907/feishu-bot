import SwiftUI

private let sidebarWidth: CGFloat = 220

struct RootConsoleView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    ZStack {
      WindowBackground()

      if store.isLoading && store.bootstrap == nil {
        ProgressView("正在加载 Feishu Bot 控制台...")
          .controlSize(.large)
      } else if store.bootstrap != nil {
        ShellView(store: store)
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
      case .ruleManager(let kind):
        RuleManagerSheet(store: store, kind: kind)
      case .threadPermissions(let sessionID):
        ThreadPermissionsSheet(store: store, sessionID: sessionID)
      }
    }
  }
}

private struct WindowBackground: View {
  var body: some View {
    Color(nsColor: .windowBackgroundColor)
      .ignoresSafeArea()
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
      .background(Color(nsColor: .controlBackgroundColor))

      Divider()

      VStack(spacing: 0) {
        ContentArea(store: store)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .layoutPriority(1)
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
      .background(Color(nsColor: .windowBackgroundColor))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        text: "正式控制台会切成三段：上方模式按钮、中部线程列表、底部设置。"
      )
    }
    .padding(28)
  }
}

private struct ConsoleSidebar: View {
  @ObservedObject var store: ConsoleStore

  private var visibleThreads: [RecentThread] {
    store.recentThreads(for: store.consoleSection)
  }

  private var threadPanelTitle: String {
    switch store.consoleSection {
    case .groups:
      return "群聊记录"
    case .users:
      return "私聊记录"
    case .thread:
      return "全部会话"
    default:
      return ""
    }
  }

  private var showsThreadList: Bool {
    switch store.consoleSection {
    case .thread, .groups, .users:
      return true
    case .abilities, .system:
      return false
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 18) {
        VStack(alignment: .leading, spacing: 6) {
          SidebarSectionLabel(title: "配置")
          Button {
            store.selectConsoleSection(.abilities)
          } label: {
            ConsoleModeRow(
              title: ConsoleSection.abilities.title,
              subtitle: ConsoleSection.abilities.sidebarHint,
              symbol: ConsoleSection.abilities.symbol,
              isSelected: store.consoleSection == .abilities
            )
          }
          .buttonStyle(.plain)
        }

        VStack(alignment: .leading, spacing: 6) {
          SidebarSectionLabel(title: "会话队列")
          ForEach([ConsoleSection.groups, .users], id: \.self) { section in
            Button {
              store.selectConsoleSection(section)
            } label: {
              ConsoleModeRow(
                title: section.title,
                subtitle: section.sidebarHint,
                symbol: section.symbol,
                isSelected: store.consoleSection == section
              )
            }
            .buttonStyle(.plain)
          }
        }
      }
      .padding(.leading, 10)
      .padding(.trailing, 12)
      .padding(.top, 10)

      Group {
        if showsThreadList {
          VStack(alignment: .leading, spacing: 12) {
            HStack {
              Text(threadPanelTitle)
                .font(.headline.weight(.semibold))
              Spacer()
              if !visibleThreads.isEmpty {
                Text("\(visibleThreads.count)")
                  .font(.caption2.weight(.semibold))
                  .foregroundStyle(.secondary)
                  .padding(.vertical, 3)
                  .padding(.horizontal, 7)
                  .background(Color.secondary.opacity(0.08))
                  .clipShape(Capsule())
              }
            }
            .padding(.horizontal, 6)

            ScrollView {
              VStack(spacing: 8) {
                if visibleThreads.isEmpty {
                  SidebarEmptyThreads(section: store.consoleSection)
                } else {
                  ForEach(visibleThreads) { thread in
                    Button {
                      let preferredSection: ConsoleSection? = store.consoleSection == .groups || store.consoleSection == .users
                        ? store.consoleSection
                        : nil
                      store.selectThread(thread, preferredSection: preferredSection)
                    } label: {
                      ThreadSidebarRow(
                        thread: thread,
                        isSelected: store.selectedThread?.id == thread.id
                      )
                    }
                    .buttonStyle(.plain)
                  }
                }
              }
              .padding(.bottom, 8)
            }
            .scrollIndicators(.never)
            .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .top)
          }
        } else {
          SidebarQueueGuide(store: store)
            .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .top)
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 20)
      .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
      .layoutPriority(1)

      VStack(alignment: .leading, spacing: 12) {
        if store.needsRestart {
          Label("已有改动待应用", systemImage: "arrow.triangle.2.circlepath")
            .font(.callout.weight(.medium))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.accentColor.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }

        Button {
          store.selectConsoleSection(.system)
        } label: {
          VStack(alignment: .leading, spacing: 6) {
            SidebarSectionLabel(title: "系统")
            FooterSidebarButton(title: "设置", symbol: "gearshape")
          }
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 18)
    }
    .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
  }
}

private struct SidebarSectionLabel: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.caption.weight(.semibold))
      .foregroundStyle(.secondary)
      .padding(.horizontal, 8)
      .padding(.bottom, 2)
  }
}

private struct ConsoleModeRow: View {
  let title: String
  let subtitle: String
  let symbol: String
  let isSelected: Bool

  @State private var isHovered = false

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol)
        .font(.system(size: 12, weight: .medium))
        .frame(width: 14, height: 14)
        .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 12.5, weight: .semibold))
        Text(subtitle)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      Spacer()
    }
    .padding(.vertical, 7)
    .padding(.horizontal, 8)
    .background(isSelected ? Color.accentColor.opacity(0.12) : (isHovered ? Color.black.opacity(0.035) : Color.clear))
    .shadow(color: isHovered ? Color.black.opacity(0.08) : .clear, radius: 8, y: 2)
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    .onHover { hovering in
      isHovered = hovering
    }
  }
}

private struct SidebarEmptyThreads: View {
  let section: ConsoleSection

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(section == .groups ? "还没有群聊记录" : (section == .users ? "还没有私聊记录" : "还没有线程"))
        .font(.headline)
      Text(
        section == .groups
          ? "只要群组开始和 Feishu Bot 互动，这里就会按时间顺序出现群聊记录。"
          : (section == .users
            ? "只要用户开始和 Feishu Bot 私聊，这里就会按时间顺序出现私聊记录。"
            : "只要用户或群组开始和 Feishu Bot 互动，这里就会按时间顺序出现记录。")
      )
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct SidebarQueueGuide: View {
  @ObservedObject var store: ConsoleStore

  private var userCount: Int {
    store.recentThreads(for: .users).count
  }

  private var groupCount: Int {
    store.recentThreads(for: .groups).count
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("群聊 / 私聊入口怎么用？")
        .font(.headline)

      Text("这两个入口是会话队列，不是权限表。点进去以后默认先看用户和 bot 的聊天记录；如果要调整某个对象的能力，再在对话页右上角点“查看权限”。")
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)

      QueueGuideCard(
        title: "私聊队列",
        detail: "适合按用户查看最近私聊记录，再单独给这个用户开关能力。",
        countText: userCount == 0 ? "暂无会话" : "\(userCount) 条"
      ) {
        store.selectConsoleSection(.users)
      }

      QueueGuideCard(
        title: "群聊队列",
        detail: "适合按群查看最近群聊记录，再给这个群打开或关闭可用能力。",
        countText: groupCount == 0 ? "暂无会话" : "\(groupCount) 条"
      ) {
        store.selectConsoleSection(.groups)
      }

      Text("能力配置页负责接入和总开关，会话队列负责看真实对话；两个入口职责分开以后会更好理解。")
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(14)
    .background(Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct QueueGuideCard: View {
  let title: String
  let detail: String
  let countText: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(title)
            .font(.headline)
          Spacer()
          StatusBadge(title: countText, color: .secondary)
        }

        Text(detail)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color(nsColor: .windowBackgroundColor))
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(.plain)
  }
}

private struct ThreadSidebarRow: View {
  let thread: RecentThread
  let isSelected: Bool

  @State private var isHovered = false

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: thread.iconName)
        .font(.system(size: 15, weight: .medium))
        .frame(width: 18, height: 18)
        .foregroundStyle(isSelected ? Color.primary : Color.secondary)
        .padding(.top, 2)

      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(thread.title)
            .font(.headline)
            .lineLimit(1)
          Spacer(minLength: 8)
          Text(thread.updatedAtLabel)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Text(thread.preview)
          .font(.callout)
          .foregroundStyle(.secondary)
          .lineLimit(2)
        Text(thread.subtitle)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .padding(.vertical, 10)
    .padding(.horizontal, 12)
    .background(isSelected ? Color.black.opacity(0.05) : (isHovered ? Color.black.opacity(0.03) : Color.clear))
    .shadow(color: isHovered && !isSelected ? Color.black.opacity(0.06) : .clear, radius: 8, y: 2)
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    .onHover { hovering in
      isHovered = hovering
    }
  }
}

private struct FooterSidebarButton: View {
  let title: String
  let symbol: String

  @State private var isHovered = false

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: .medium))
        .frame(width: 18, height: 18)
      Text(title)
        .font(.system(size: 13, weight: .semibold))
      Spacer()
    }
    .padding(.vertical, 8)
    .padding(.horizontal, 10)
    .background(isHovered ? Color.black.opacity(0.035) : Color.clear)
    .shadow(color: isHovered ? Color.black.opacity(0.08) : .clear, radius: 8, y: 2)
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    .onHover { hovering in
      isHovered = hovering
    }
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
    .background(Color.secondary.opacity(0.06))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct ContentArea: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    GeometryReader { proxy in
      VStack(alignment: .leading, spacing: 14) {
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
      .padding(18)
      .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(store.contentTitle)
        .font(.system(size: 26, weight: .semibold))
      Text(store.contentSubtitle)
        .font(.callout)
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

private struct OnboardingStatusCard: View {
  let state: ConnectivityCheckState

  var body: some View {
    switch state {
    case .idle:
      EmptyView()
    case .running:
      HStack(spacing: 12) {
        ProgressView()
          .controlSize(.small)
        Text("正在测试当前连接...")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(14)
      .background(Color.secondary.opacity(0.08))
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    case .succeeded(let message):
      InlineBanner(text: message, tint: .green.opacity(0.12), foreground: .green)
    case .failed(let message):
      InlineBanner(text: message, tint: .red.opacity(0.12), foreground: .red)
    }
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
    }
  }
}

private struct FeishuOnboardingView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 18) {
      Panel(title: "基础凭据", subtitle: "首次上线只需要 App ID、App Secret 和 Bot 名称。测试通过后自动进入模型接入。") {
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

          OnboardingStatusCard(state: store.onboardingState(for: .feishu))
        }
      }

      Panel(title: "测试会做什么") {
        VStack(alignment: .leading, spacing: 14) {
          ChecklistRow(text: "会直接请求飞书开放平台，验证 App ID / App Secret 是否能拿到 tenant_access_token。")
          ChecklistRow(text: "这一阶段不要求你先提供 chat_id；主动发消息测试仍保留在系统设置页。")
          ChecklistRow(text: "Bot 名称用于默认展示和调用标识，可在正式控制台里继续修改。")
        }
      }
      .frame(width: 260)
    }
  }
}

private struct ModelOnboardingView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 18) {
      Panel(title: "模型接入", subtitle: "这里只保留供应商和 API Key，高级参数通过 sheet 打开。测试通过后会直接进入正式控制台。") {
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

          OnboardingStatusCard(state: store.onboardingState(for: .model))
        }
      }

      Panel(title: "测试会做什么") {
        VStack(alignment: .leading, spacing: 12) {
          ChecklistRow(text: "会用当前 API Key、Base URL 和模型名发起一次最轻量的 Chat Completion 请求。")
          ChecklistRow(text: "测试通过后，基础接入就完成了，应用会自动进入正式控制台并尝试启动后台。")
          Divider()
          KeyValueRow(title: "Base URL", value: store.draftEnv["BOT_LLM_BASE_URL"] ?? "-")
          KeyValueRow(title: "文本模型", value: store.draftEnv["BOT_LLM_MODEL"] ?? "-")
          KeyValueRow(title: "视觉模型", value: store.draftEnv["BOT_VISION_MODEL"] ?? "-")
          KeyValueRow(title: "语音模型", value: store.draftEnv["BOT_TTS_MODEL"] ?? "-")
        }
      }
      .frame(width: 280)
    }
  }
}

private struct ConsoleContent: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    switch store.consoleSection {
    case .thread:
      ThreadWorkspaceView(store: store)
    case .abilities:
      AbilitiesConsoleView(store: store)
    case .groups:
      QueueConsoleView(store: store, kind: .groups)
    case .users:
      QueueConsoleView(store: store, kind: .users)
    case .system:
      SystemSettingsView(store: store)
    }
  }
}

private struct ThreadWorkspaceView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    guard let thread = store.selectedThread else {
      return AnyView(
        WorkspaceSurface {
          EmptyThreadGuide()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
      )
    }

    return AnyView(
      GeometryReader { proxy in
        WorkspaceSurface {
          VStack(spacing: 0) {
            ThreadWorkspaceHeader(store: store, thread: thread)

            Divider()

            ScrollView {
              LazyVStack(spacing: 18) {
                ConversationTimelineHeader(
                  messageCount: store.selectedThreadMessages.isEmpty ? 1 : store.selectedThreadMessages.count,
                  isFallback: store.selectedThreadMessages.isEmpty
                )

                if store.selectedThreadMessages.isEmpty {
                  ThreadMessageBubble(
                    message: ThreadMessage(
                      id: "\(thread.id)-fallback",
                      role: "user",
                      senderName: thread.scope == "group" ? "群成员" : thread.title,
                      content: thread.preview,
                      createdAt: thread.updatedAt
                    )
                  )

                  ThreadArchiveHint()
                } else {
                  ForEach(store.selectedThreadMessages) { message in
                    ThreadMessageBubble(message: message)
                  }
                }
              }
              .frame(maxWidth: .infinity, alignment: .topLeading)
              .padding(24)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .scrollIndicators(.never)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            Divider()

            ThreadReadOnlyHint()
          }
          .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
      }
    )
  }
}

private struct QueueConsoleView: View {
  @ObservedObject var store: ConsoleStore
  let kind: RuleKind

  private var section: ConsoleSection {
    kind == .groups ? .groups : .users
  }

  private var selectedThread: RecentThread? {
    store.selectedThread(for: section)
  }

  var body: some View {
    guard let selectedThread else {
      return AnyView(
        WorkspaceSurface {
          QueueEmptyState(store: store, kind: kind)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
      )
    }

    return AnyView(
      GeometryReader { proxy in
        WorkspaceSurface {
          VStack(spacing: 0) {
            QueueWorkspaceHeader(store: store, thread: selectedThread, kind: kind)

            Divider()

            ScrollView {
              LazyVStack(spacing: 18) {
                ConversationTimelineHeader(
                  messageCount: store.selectedThreadMessages.isEmpty ? 1 : store.selectedThreadMessages.count,
                  isFallback: store.selectedThreadMessages.isEmpty
                )

                if store.selectedThreadMessages.isEmpty {
                  ThreadMessageBubble(
                    message: ThreadMessage(
                      id: "\(selectedThread.id)-fallback",
                      role: "user",
                      senderName: selectedThread.scope == "group" ? "群成员" : selectedThread.title,
                      content: selectedThread.preview,
                      createdAt: selectedThread.updatedAt
                    )
                  )

                  ThreadArchiveHint()
                } else {
                  ForEach(store.selectedThreadMessages) { message in
                    ThreadMessageBubble(message: message)
                  }
                }
              }
              .frame(maxWidth: .infinity, alignment: .topLeading)
              .padding(24)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .scrollIndicators(.never)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            Divider()

            QueueReadOnlyHint(kind: kind)
          }
          .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
      }
    )
  }
}

private struct QueueWorkspaceHeader: View {
  @ObservedObject var store: ConsoleStore
  let thread: RecentThread
  let kind: RuleKind

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 14) {
        VStack(alignment: .leading, spacing: 4) {
          Text(thread.title)
            .font(.title3.weight(.semibold))
          Text(thread.subtitle)
            .font(.callout)
            .foregroundStyle(.secondary)
        }

        Spacer(minLength: 16)

        StatusBadge(title: kind == .groups ? "群聊队列" : "私聊队列", color: .secondary)
        StatusBadge(title: thread.statusLabel, color: thread.status.lowercased() == "failed" ? .red : .green)
        Text(thread.updatedAtLabel)
          .font(.callout)
          .foregroundStyle(.secondary)
      }

      HStack(alignment: .top, spacing: 12) {
        Text("这里默认展示当前\(kind == .groups ? "群组" : "用户")最近一次和机器人的对话；对象能力配置单独放到 sheet 里管理，避免和会话内容混在一起。")
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)

        Spacer(minLength: 10)

        Button {
          store.activeSheet = .threadPermissions(thread.id)
        } label: {
          Label("查看权限", systemImage: "checklist")
        }
        .buttonStyle(.bordered)

        Button {
          store.openRuleManager(for: kind)
        } label: {
          Label("管理全部\(kind.title)", systemImage: "slider.horizontal.3")
        }
        .buttonStyle(.borderedProminent)
      }
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 18)
  }
}

private struct QueueEmptyState: View {
  @ObservedObject var store: ConsoleStore
  let kind: RuleKind

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      VStack(alignment: .leading, spacing: 10) {
        Text(kind == .groups ? "还没有群聊会话" : "还没有私聊会话")
          .font(.title2.weight(.semibold))
        Text(kind == .groups
          ? "当群组先和机器人互动一次后，这里就会默认展示该群最近的对话。"
          : "当用户先和机器人互动一次后，这里就会默认展示该用户最近的对话。")
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      HStack(spacing: 12) {
        Button("打开能力配置") {
          store.openRuleManager(for: kind)
        }
        .buttonStyle(.borderedProminent)

        Text("如果对象还没在队列里出现，也可以先去能力配置 sheet 里手动新增。")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
    .padding(24)
  }
}

private struct QueueReadOnlyHint: View {
  let kind: RuleKind

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: kind == .groups ? "person.2" : "person.crop.circle")
        .foregroundStyle(.secondary)
      Text("当前是\(kind == .groups ? "群聊" : "私聊")队列视图：这里先看对话，能力调整放到右上角的“打开能力配置”里。")
        .font(.callout)
        .foregroundStyle(.secondary)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
    .background(Color.secondary.opacity(0.04))
  }
}

private struct ThreadPermissionsSheet: View {
  @ObservedObject var store: ConsoleStore
  let sessionID: String
  @Environment(\.dismiss) private var dismiss

  private var thread: RecentThread? {
    store.recentThreads.first(where: { $0.id == sessionID })
  }

  private var capabilities: [CatalogCapability] {
    store.bootstrap?.catalogs.capabilities ?? []
  }

  private func canAssign(thread: RecentThread) -> Bool {
    store.threadRuleKind(for: thread) != nil && !store.threadIdentifier(for: thread).isEmpty
  }

  var body: some View {
    let size = AppWindowController.currentSheetCGSize(idealWidth: 860, idealHeight: 620)

    return VStack(spacing: 0) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text("查看权限")
            .font(.title2.weight(.semibold))
          if let thread {
            Text("\(thread.title) · 切换后自动保存，下一条消息立即生效。")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        }
        Spacer()
        Button("关闭") {
          dismiss()
        }
        .buttonStyle(.bordered)
        .keyboardShortcut(.cancelAction)
      }
      .padding(.horizontal, 24)
      .padding(.top, 24)
      .padding(.bottom, 16)

      Divider()

      ScrollView {
        if let thread {
          let editable = canAssign(thread: thread)

          LazyVGrid(columns: [
            GridItem(.adaptive(minimum: 250), spacing: 14, alignment: .top)
          ], spacing: 14) {
            ForEach(capabilities) { capability in
              ThreadPermissionCard(
                capability: capability,
                isOn: editable
                  ? store.threadCapabilityBinding(for: capability.id, thread: thread)
                  : .constant(capability.id == "chat"),
                isEditable: editable && capability.assignable,
                detail: editable ? capability.message : "当前对象还没识别到稳定 ID，暂时不能直接改权限。"
              )
            }
          }
          .padding(24)
          .frame(maxWidth: .infinity, alignment: .topLeading)
        } else {
          ContentUnavailableView(
            "未找到当前对象",
            systemImage: "questionmark.bubble",
            description: Text("请先回到会话列表重新选择一个用户或群组，再打开查看权限。")
          )
          .frame(maxWidth: .infinity, minHeight: size.height - 140)
        }
      }
      .scrollIndicators(.never)

      Divider()

      HStack {
        Spacer()
        Button("完成") {
          dismiss()
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 18)
    }
    .frame(width: size.width, height: size.height)
  }
}

private struct ThreadPermissionCard: View {
  let capability: CatalogCapability
  @Binding var isOn: Bool
  let isEditable: Bool
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          Text(capability.label)
            .font(.headline)
          HStack(spacing: 8) {
            StatusBadge(
              title: capability.assignable ? "可切换" : "暂不可切换",
              color: capability.assignable ? .green : .secondary
            )
            StatusBadge(
              title: isOn ? "已授权" : "未授权",
              color: isOn ? .accentColor : .secondary
            )
          }
        }
        Spacer(minLength: 12)
        VStack(alignment: .trailing, spacing: 6) {
          Toggle("启用", isOn: $isOn)
            .labelsHidden()
            .toggleStyle(.switch)
            .disabled(!isEditable)
          Text(isOn ? "已开" : "已关")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isOn ? Color.accentColor : Color.secondary)
        }
      }

      Text(detail)
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isOn ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .opacity(isEditable ? 1 : 0.7)
  }
}

private struct EmptyThreadGuide: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 28) {
      VStack(alignment: .leading, spacing: 10) {
        Text("Feishu Bot 主要用法")
          .font(.title2.weight(.semibold))
        Text("当前还没有新的线程记录。你可以先去飞书里给机器人发一条消息，左侧线程列表就会自动出现最近会话。")
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      LazyVGrid(
        columns: [
          GridItem(.flexible(), spacing: 18),
          GridItem(.flexible(), spacing: 18)
        ],
        spacing: 18
      ) {
        UsageGuideCard(
          title: "基础聊天",
          detail: "私聊机器人直接提问；没有匹配命令时会自动进入聊天模式。",
          examples: ["/chat 帮我梳理一下这个方案", "你觉得这个方案还缺什么"]
        )
        UsageGuideCard(
          title: "排障命令",
          detail: "可以查 trace、uid、任务状态，并在原线程继续追问。",
          examples: ["/trace 7f8e9a0b1234", "/uid 123456 1h", "/job job_xxx"]
        )
        UsageGuideCard(
          title: "群聊触发",
          detail: "在群里需要 @bot 或者使用 Slash 命令，机器人才会响应。",
          examples: ["@bot 查下 trace 7f8e9a0b1234", "/help"]
        )
        UsageGuideCard(
          title: "下一步",
          detail: "先让用户或群组和 bot 互动一次；等左侧出现线程后，这里就会默认显示最新会话。",
          examples: ["左侧会按时间顺序显示线程", "底部设置里还能继续测飞书发消息"]
        )
      }
    }
    .padding(24)
  }
}

private struct UsageGuideCard: View {
  let title: String
  let detail: String
  let examples: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(title)
        .font(.headline)
      Text(detail)
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      VStack(alignment: .leading, spacing: 8) {
        ForEach(examples, id: \.self) { example in
          Text(example)
            .font(.system(.callout, design: .monospaced))
            .foregroundStyle(.primary)
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(Color.secondary.opacity(0.04))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct ThreadWorkspaceHeader: View {
  @ObservedObject var store: ConsoleStore
  let thread: RecentThread

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 14) {
        VStack(alignment: .leading, spacing: 4) {
          Text(thread.title)
            .font(.title3.weight(.semibold))
          Text(thread.subtitle)
            .font(.callout)
            .foregroundStyle(.secondary)
        }

        Spacer(minLength: 16)

        StatusBadge(title: thread.scope == "group" ? "群组" : "用户", color: .secondary)
        StatusBadge(title: thread.statusLabel, color: thread.status.lowercased() == "failed" ? .red : .green)
        Text(thread.updatedAtLabel)
          .font(.callout)
          .foregroundStyle(.secondary)
      }

      HStack(alignment: .top, spacing: 12) {
        Text("这里默认先看真实对话内容；如果你要调整这个对象能用哪些能力，再点右侧“查看权限”。")
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)

        Spacer(minLength: 12)

        Button {
          store.activeSheet = .threadPermissions(thread.id)
        } label: {
          Label("查看权限", systemImage: "slider.horizontal.3")
        }
        .buttonStyle(.borderedProminent)
      }
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 18)
  }
}

private struct ThreadAbilityPanel: View {
  @ObservedObject var store: ConsoleStore
  let thread: RecentThread

  private var capabilities: [CatalogCapability] {
    store.bootstrap?.catalogs.capabilities ?? []
  }

  private var scopeLabel: String {
    thread.scope.lowercased() == "group" ? "群组" : "用户"
  }

  private var identifier: String {
    store.threadIdentifier(for: thread)
  }

  private var identifierWarning: String {
    scopeLabel == "群组"
      ? "缺少 chat_id，暂时无法识别该群组；请让群聊里和机器人再互动一次。"
      : "缺少用户 ID，暂时无法识别该用户；请确认最近一条消息已经写入会话。"
  }

  private var canAssign: Bool {
    store.threadRuleKind(for: thread) != nil && !identifier.isEmpty
  }

  private func isAuthorized(_ capability: CatalogCapability) -> Bool {
    if canAssign {
      return store.threadCapabilityBinding(for: capability.id, thread: thread).wrappedValue
    }
    return capability.id == "chat"
  }

  private var enabledCapabilities: [CatalogCapability] {
    capabilities.filter(isAuthorized)
  }

  private var disabledCapabilities: [CatalogCapability] {
    capabilities.filter { !isAuthorized($0) }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack(alignment: .top, spacing: 16) {
        VStack(alignment: .leading, spacing: 6) {
          Text("对话内授权")
            .font(.title3.weight(.semibold))
          Text("这里直接展示当前对象的全部能力卡片；打开或关闭开关后会自动保存，并在下一条消息立即生效。")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 10)
        Button {
          store.openRule(for: thread)
        } label: {
          Label("打开能力配置", systemImage: "slider.horizontal.3")
        }
        .buttonStyle(.bordered)
      }

      ThreadAbilitySummaryCard(
        scopeLabel: scopeLabel,
        identifier: canAssign ? identifier : identifierWarning,
        ruleName: store.threadRuleDisplayName(for: thread),
        isIdentifierHealthy: canAssign
      )

      if capabilities.isEmpty {
        Text("当前没有可展示的能力。")
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        HStack(spacing: 8) {
          StatusBadge(title: "已授权 \(enabledCapabilities.count)", color: .accentColor)
          StatusBadge(title: "待授权 \(disabledCapabilities.count)", color: .secondary)
          if !canAssign {
            StatusBadge(title: "等待识别对象 ID", color: .orange)
          }
        }

        ThreadCapabilityGroupSection(
          store: store,
          thread: thread,
          title: "已授权能力",
          subtitle: "这些能力当前对象已经可以直接使用；关闭后下一条消息就会按最新权限收回。",
          capabilities: enabledCapabilities,
          canAssign: canAssign,
          identifierWarning: identifierWarning,
          emptyText: "当前还没有已授权能力。",
          authorizedGroup: true
        )

        ThreadCapabilityGroupSection(
          store: store,
          thread: thread,
          title: "待授权能力",
          subtitle: "需要时直接打开开关即可；如果能力先在全局被关闭，这里会保留卡片但不可直接授权。",
          capabilities: disabledCapabilities,
          canAssign: canAssign,
          identifierWarning: identifierWarning,
          emptyText: "当前全部能力都已授权。",
          authorizedGroup: false
        )
      }
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 24)
  }
}

private struct ThreadAbilitySummaryCard: View {
  let scopeLabel: String
  let identifier: String
  let ruleName: String
  let isIdentifierHealthy: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      KeyValueRow(title: "作用域", value: scopeLabel)
      KeyValueRow(title: "对象 ID", value: identifier)
      KeyValueRow(title: "权限规则", value: ruleName)
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isIdentifierHealthy ? Color.secondary.opacity(0.05) : Color.orange.opacity(0.08))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct ThreadCapabilityGroupSection: View {
  @ObservedObject var store: ConsoleStore
  let thread: RecentThread
  let title: String
  let subtitle: String
  let capabilities: [CatalogCapability]
  let canAssign: Bool
  let identifierWarning: String
  let emptyText: String
  let authorizedGroup: Bool

  var body: some View {
    Panel(title: title, subtitle: subtitle) {
      if capabilities.isEmpty {
        Text(emptyText)
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        LazyVGrid(columns: [
          GridItem(.adaptive(minimum: 260), spacing: 14, alignment: .top)
        ], spacing: 14) {
          ForEach(capabilities) { capability in
            CapabilityControlCard(
              capability: capability,
              detail: canAssign ? capability.message : identifierWarning,
              note: note(for: capability),
              isEditable: canAssign && capability.assignable,
              isOn: canAssign
                ? store.threadCapabilityBinding(for: capability.id, thread: thread)
                : .constant(capability.id == "chat")
            )
          }
        }
      }
    }
  }

  private func note(for capability: CatalogCapability) -> String {
    if capability.assignable {
      return authorizedGroup
        ? "已经授权；关闭后下一条消息会按最新权限生效。"
        : "打开后自动保存，下一条消息立即生效。"
    }
    return "请先完成全局接入并打开总开关，再来给当前对象授权。"
  }
}

private struct CapabilityControlCard: View {
  let capability: CatalogCapability
  let detail: String
  let note: String
  let isEditable: Bool
  @Binding var isOn: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 8) {
            Text(capability.label)
              .font(.headline)
            StatusBadge(
              title: capability.enabled ? "总开关已开" : (capability.configured ? "总开关未开" : "未接入"),
              color: capability.enabled ? .green : (capability.configured ? .orange : .secondary)
            )
            StatusBadge(title: isOn ? "当前已授权" : "当前未授权", color: isOn ? .accentColor : .secondary)
          }
          Text(detail)
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
          Text(note)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 12)
        VStack(alignment: .trailing, spacing: 8) {
          Toggle("启用", isOn: $isOn)
            .labelsHidden()
            .toggleStyle(.switch)
            .disabled(!isEditable)
          Text(isOn ? "已开" : "已关")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isOn ? Color.accentColor : Color.secondary)
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isOn ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    .opacity(isEditable ? 1 : 0.55)
  }
}

private struct ThreadMessageBubble: View {
  let message: ThreadMessage

  var body: some View {
    HStack(alignment: .bottom, spacing: 0) {
      if message.isAssistant {
        bubble
        Spacer(minLength: 72)
      } else {
        Spacer(minLength: 72)
        bubble
      }
    }
  }

  private var bubble: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Text(message.senderName.isEmpty ? (message.isAssistant ? "Feishu Bot" : "用户") : message.senderName)
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
        Spacer(minLength: 10)
        Text(message.createdAtLabel)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }

      Text(message.content)
        .font(.body)
        .foregroundStyle(.primary)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(16)
    .frame(maxWidth: 520, alignment: .leading)
    .background(message.isAssistant ? Color.secondary.opacity(0.06) : Color.accentColor.opacity(0.08))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct ConversationTimelineHeader: View {
  let messageCount: Int
  let isFallback: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Text("聊天记录")
          .font(.headline)
        Text(isFallback
          ? "这个线程还没有完整归档历史记录，当前先展示最近一条可用消息。后续新的用户 / bot 往返会直接连续显示在这里。"
          : "这里展示的是当前对象最近的用户 / bot 往返消息，默认按时间顺序展开。")
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 12)

      StatusBadge(title: "\(messageCount) 条", color: .accentColor)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.secondary.opacity(0.04))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct ThreadArchiveHint: View {
  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "clock.arrow.circlepath")
        .foregroundStyle(.secondary)
      Text("这是一条旧线程，历史上还没有完整归档。从现在开始的新往返消息，会直接在这里连续展示。")
        .font(.callout)
        .foregroundStyle(.secondary)
      Spacer(minLength: 0)
    }
    .padding(16)
    .background(Color.secondary.opacity(0.04))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct ThreadReadOnlyHint: View {
  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "text.bubble")
        .foregroundStyle(.secondary)
      Text("这里先作为线程记录面板使用；继续对话请直接在飞书里发送消息。")
        .font(.callout)
        .foregroundStyle(.secondary)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
    .background(Color.secondary.opacity(0.04))
  }
}

private struct AbilitiesConsoleView: View {
  @ObservedObject var store: ConsoleStore

  private let builtInAbilities: [AbilityKind] = [
    .webSearch,
    .voiceReply,
    .vision
  ]

  var body: some View {
    ScrollableConsoleSection {
      VStack(alignment: .leading, spacing: 18) {
        WorkspaceSurface(title: "分配逻辑") {
          HStack(spacing: 14) {
            CapabilityHint(text: "先全局接入能力并打开开关")
            CapabilityHint(text: "未全局开启的能力会在群组/用户页显示但置灰")
            CapabilityHint(text: "自定义 HTTP 组件只有在你添加后才会进入可分配列表")
            CapabilityHint(text: "用户规则优先于群组规则")
          }
        }

        WorkspaceSurface(title: "自定义 HTTP 组件") {
          if store.hasDiagnosticComponent {
            VStack(alignment: .leading, spacing: 14) {
              LazyVGrid(columns: [
                GridItem(.adaptive(minimum: 280), spacing: 14, alignment: .top)
              ], spacing: 14) {
                ForEach(store.diagnosticComponents, id: \.id) { component in
                  ComponentCatalogCard(
                    component: component,
                    catalog: store.capability(component.capabilityID),
                    description: !component.summary.isEmpty
                      ? component.summary
                      : (!component.usageDescription.isEmpty
                        ? component.usageDescription
                        : (store.capability(component.capabilityID)?.message ?? "每个组件都会以独立能力卡片出现在授权页里。")),
                    enabledBinding: store.diagnosticComponentEnabledBinding(componentID: component.id),
                    onConfigure: {
                      store.selectDiagnosticComponent(component.id)
                      store.activeSheet = .abilityDetail(.diagnosticHttp)
                    }
                  )
                }
              }

              HStack {
                Button("新增组件") {
                  store.addDiagnosticComponent()
                  store.activeSheet = .abilityDetail(.diagnosticHttp)
                }
                .buttonStyle(.borderedProminent)

                Text("每个组件都会单独出现在群组 / 用户 / 对话页的授权卡片里。")
                  .font(.caption)
                  .foregroundStyle(.secondary)
                Spacer(minLength: 0)
              }
            }
          } else {
            VStack(alignment: .leading, spacing: 14) {
              Text("当前还没有自定义 HTTP 组件")
                .font(.title3.weight(.semibold))
              Text("这类自研接口不再作为项目默认内置能力展示。只有你自己填好组件名称、用途说明和地址，并打开总开关后，它才会出现在群组 / 用户 / 对话页的授权卡片里。")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
              Button("添加自定义 HTTP 组件") {
                store.addDiagnosticComponent()
                store.activeSheet = .abilityDetail(.diagnosticHttp)
              }
              .buttonStyle(.borderedProminent)
            }
          }
        }

        WorkspaceSurface(title: "内置能力") {
          LazyVGrid(columns: [
            GridItem(.adaptive(minimum: 280), spacing: 14, alignment: .top)
          ], spacing: 14) {
            ForEach(builtInAbilities, id: \.id) { ability in
              if let enabledBinding = store.abilityEnabledBinding(for: ability) {
                BuiltinAbilityCard(
                  ability: ability,
                  catalog: store.abilityCatalog(for: ability),
                  enabledBinding: enabledBinding,
                  onConfigure: {
                    store.activeSheet = .abilityDetail(ability)
                  }
                )
              }
            }
          }
        }
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

private struct CapabilityCardIcon: View {
  let symbolName: String
  let tint: Color

  var body: some View {
    Image(systemName: symbolName)
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(tint)
      .frame(width: 38, height: 38)
      .background(tint.opacity(0.12))
      .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
  }
}

private struct BuiltinAbilityCard: View {
  let ability: AbilityKind
  let catalog: CatalogCapability?
  let enabledBinding: Binding<Bool>
  let onConfigure: (() -> Void)?

  private var isConfigured: Bool {
    catalog?.configured == true
  }

  private var isEnabled: Bool {
    enabledBinding.wrappedValue
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 12) {
        CapabilityCardIcon(symbolName: ability.symbolName, tint: isEnabled ? .accentColor : .secondary)

        VStack(alignment: .leading, spacing: 6) {
          Text(ability.title)
            .font(.headline)

          HStack(spacing: 8) {
            StatusBadge(title: isConfigured ? "已接入" : "未接入", color: isConfigured ? .green : .secondary)
            StatusBadge(
              title: isConfigured ? (isEnabled ? "总开关已开" : "总开关已关") : "等待配置",
              color: isEnabled ? .accentColor : (isConfigured ? .orange : .secondary)
            )
          }
        }

        Spacer(minLength: 12)

        VStack(alignment: .trailing, spacing: 6) {
          Toggle("启用", isOn: enabledBinding)
            .labelsHidden()
            .toggleStyle(.switch)
            .disabled(!isConfigured)
          Text(isEnabled ? "已开" : "已关")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isEnabled ? Color.accentColor : Color.secondary)
        }
      }

      Text(ability.description)
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)

      if let message = catalog?.message, message != ability.description {
        Text(message)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      HStack(alignment: .top, spacing: 12) {
        if let onConfigure {
          Button("配置详情", action: onConfigure)
            .buttonStyle(.bordered)
        }
        Spacer(minLength: 0)
        Text(isConfigured ? ability.enabledHint : ability.disabledHint)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.trailing)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isEnabled ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .opacity(isConfigured ? 1 : 0.8)
  }
}

private struct BuiltinAbilityHelpEditor: View {
  @ObservedObject var store: ConsoleStore
  let ability: AbilityKind

  var body: some View {
    if let binding = store.capabilityCardDescriptionBinding(for: ability) {
      Panel(title: "用户看到的能力说明", subtitle: "这里的文案会在 `/help` 第二段里按能力开通情况自动拼接给用户。") {
        VStack(alignment: .leading, spacing: 14) {
          HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
              Text(ability.title)
                .font(.headline)
              Text(store.capabilityCardDescription(for: ability))
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            PolishActionButton(
              title: "一键润色",
              isRunning: store.isPolishing("capability-card-\(ability.rawValue)"),
              action: {
                store.polishCapabilityCardDescription(for: ability)
              }
            )
          }

          TextEditor(text: binding)
            .font(.system(.callout))
            .frame(minHeight: 110)
            .padding(10)
            .background(Color.secondary.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

          Text("留空时使用默认文案。建议写成用户视角：这项能力能帮他解决什么问题。")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
  }
}

private struct ComponentCatalogCard: View {
  let component: DiagnosticHttpComponentConfig
  let catalog: CatalogCapability?
  let description: String
  let enabledBinding: Binding<Bool>
  let onConfigure: () -> Void

  private var canEnable: Bool {
    catalog?.configured == true
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 12) {
        CapabilityCardIcon(symbolName: AbilityKind.diagnosticHttp.symbolName, tint: enabledBinding.wrappedValue ? .accentColor : .secondary)

        VStack(alignment: .leading, spacing: 6) {
          Text(component.displayName)
            .font(.headline)
          HStack(spacing: 8) {
            StatusBadge(title: catalog?.configured == true ? "已接入" : "未接入", color: catalog?.configured == true ? .green : .secondary)
            StatusBadge(
              title: canEnable ? (enabledBinding.wrappedValue ? "总开关已开" : "总开关已关") : "等待配置",
              color: enabledBinding.wrappedValue ? .accentColor : (canEnable ? .orange : .secondary)
            )
          }
        }
        Spacer(minLength: 10)
        VStack(alignment: .trailing, spacing: 6) {
          Toggle("启用", isOn: enabledBinding)
            .labelsHidden()
            .toggleStyle(.switch)
            .disabled(!canEnable)
          Text(enabledBinding.wrappedValue ? "已开" : "已关")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(enabledBinding.wrappedValue ? Color.accentColor : Color.secondary)
        }
      }

      Text(description)
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)

      if !component.commandLabel.isEmpty {
        ExamplePromptChip(text: component.commandLabel)
      }

      if let message = catalog?.message, message != description {
        Text(message)
          .font(.caption)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      HStack {
        Button("配置详情", action: onConfigure)
          .buttonStyle(.bordered)
        Spacer(minLength: 0)
        Text(canEnable ? "打开后可在授权页直接分配给用户或群组。" : "先补齐组件地址与鉴权信息，才能打开总开关。")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(enabledBinding.wrappedValue ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .opacity(canEnable ? 1 : 0.8)
  }
}

private struct ExamplePromptChip: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(.caption, design: .monospaced))
      .foregroundStyle(.primary)
      .padding(.vertical, 8)
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.secondary.opacity(0.05))
      .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
  }
}

private struct PolishActionButton: View {
  let title: String
  let isRunning: Bool
  let action: () -> Void

  var body: some View {
    Button(isRunning ? "润色中..." : title, action: action)
      .buttonStyle(.bordered)
      .disabled(isRunning)
  }
}

private struct QuickCommandCard: View {
  let orderLabel: String
  let item: QuickCommandPreviewItem

  private var statusColor: Color {
    switch item.status ?? "" {
    case "命令已生效":
      return .green
    case "固定快捷命令":
      return .accentColor
    case "不可用", "等待接入", "总开关未开":
      return .orange
    default:
      return .secondary
    }
  }

  private var sourceColor: Color {
    switch item.source {
    case .fixed:
      return .accentColor
    case .component:
      return .orange
    }
  }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Text(orderLabel)
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.vertical, 5)
        .padding(.horizontal, 9)
        .background(Color.secondary.opacity(0.10))
        .clipShape(Capsule())

      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .top, spacing: 10) {
          Text(item.command)
            .font(.system(.headline, design: .monospaced))
            .padding(.vertical, 5)
            .padding(.horizontal, 10)
            .background(Color.secondary.opacity(0.08))
            .clipShape(Capsule())
          Spacer(minLength: 0)
          StatusBadge(title: item.source.title, color: sourceColor)
          if let status = item.status, !status.isEmpty {
            StatusBadge(title: status, color: statusColor)
          }
        }

        Text(item.title)
          .font(.headline)

        Text(item.description)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct HelpContentPreviewCard: View {
  let help: HelpContentSettings
  let capabilityItems: [HelpCapabilityPreviewItem]

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("当前生效效果")
          .font(.headline)
        StatusBadge(title: "能力说明自动拼接", color: .accentColor)
        StatusBadge(title: help.capabilityOrderMode.title, color: .secondary)
      }

      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .top, spacing: 12) {
          VStack(alignment: .leading, spacing: 6) {
            Text(help.title)
              .font(.title3.weight(.semibold))
            Text("/help 返回时会先展示你编辑的通用说明，再按当前对象已开通的能力动态补上第二段。")
              .font(.caption)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
          Spacer(minLength: 0)
          StatusBadge(title: "/help 预览", color: .blue)
        }

        VStack(alignment: .leading, spacing: 8) {
          Text("第一段 · 通用说明")
            .font(.callout.weight(.medium))
          Text(help.summary)
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.accentColor.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

        VStack(alignment: .leading, spacing: 10) {
          HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
              Text("第二段 · 自动拼接的能力说明")
                .font(.callout.weight(.medium))
              Text(help.capabilityOrderMode == .componentFirst ? "当前会先放组件能力，再放内置能力。" : "当前会先放内置能力，再放组件能力。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            StatusBadge(title: help.capabilityOrderMode.title, color: .secondary)
          }

          HelpPreviewEntryCard(
            orderLabel: "固定",
            command: "/new",
            title: "新话题",
            description: help.newCommandDescription,
            badgeTitle: "固定命令",
            badgeColor: .accentColor
          )

          if capabilityItems.isEmpty {
            Text("当前还没有全局启用的能力卡片；真正给对象授权后，这里会继续按顺序自动插入能力说明。")
              .font(.callout)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.vertical, 12)
              .padding(.horizontal, 14)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(Color.secondary.opacity(0.05))
              .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          } else {
            ForEach(Array(capabilityItems.enumerated()), id: \.element.id) { index, item in
              HelpPreviewEntryCard(
                orderLabel: "\(index + 1)",
                command: item.command,
                title: item.title,
                description: item.description,
                badgeTitle: item.source.title,
                badgeColor: item.source == .component ? .orange : .secondary
              )
            }
          }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct HelpPreviewEntryCard: View {
  let orderLabel: String
  let command: String?
  let title: String
  let description: String
  let badgeTitle: String
  let badgeColor: Color

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Text(orderLabel)
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.vertical, 5)
        .padding(.horizontal, 9)
        .background(Color.secondary.opacity(0.10))
        .clipShape(Capsule())

      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .top, spacing: 8) {
          if let command, !command.isEmpty {
            Text(command)
              .font(.system(.caption, design: .monospaced))
              .padding(.vertical, 4)
              .padding(.horizontal, 8)
              .background(Color.secondary.opacity(0.08))
              .clipShape(Capsule())
          }
          Text(title)
            .font(.callout.weight(.medium))
          Spacer(minLength: 0)
          StatusBadge(title: badgeTitle, color: badgeColor)
        }

        Text(description)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.vertical, 10)
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
  }
}

private struct SettingsSubcard<Content: View>: View {
  let title: String
  let subtitle: String?
  private let content: Content

  init(title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
    self.title = title
    self.subtitle = subtitle
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.callout.weight(.medium))
        if let subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }

      content
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct ModelConfigOverviewCard: View {
  let providerName: String
  let baseUrl: String
  let textModel: String
  let visionModel: String
  let ttsModel: String
  let timeoutMs: String
  let state: ConnectivityCheckState
  let docsURL: URL?
  let onTest: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          Text("当前生效模型配置")
            .font(.headline)
          Text("聊天、视觉、语音回复和文案润色都会优先复用这一套模型接入。")
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 0)
        StatusBadge(title: providerName, color: .accentColor)
      }

      HStack(spacing: 10) {
        Button(state.isRunning ? "测试中..." : "测试当前模型") {
          onTest()
        }
        .buttonStyle(.borderedProminent)
        .disabled(state.isRunning)

        if let docsURL {
          Link("供应商文档", destination: docsURL)
        }
      }

      OnboardingStatusCard(state: state)

      VStack(alignment: .leading, spacing: 10) {
        KeyValueRow(title: "Base URL", value: baseUrl.isEmpty ? "-" : baseUrl)
        KeyValueRow(title: "文本模型", value: textModel.isEmpty ? "-" : textModel)
        KeyValueRow(title: "视觉模型", value: visionModel.isEmpty ? "-" : visionModel)
        KeyValueRow(title: "语音模型", value: ttsModel.isEmpty ? "-" : ttsModel)
        KeyValueRow(title: "超时", value: timeoutMs.isEmpty ? "-" : "\(timeoutMs) ms")
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.accentColor.opacity(0.08))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct DiagnosticComponentOverviewCard: View {
  let component: DiagnosticHttpComponentConfig
  let catalog: CatalogCapability?

  private var canEnable: Bool {
    catalog?.configured == true
  }

  private var summaryText: String {
    let summary = component.summary.trimmingCharacters(in: .whitespacesAndNewlines)
    if !summary.isEmpty {
      return summary
    }
    return "还没有填写用途说明，建议补一句这个组件主要解决什么问题。"
  }

  private var usageText: String {
    let usage = component.usageDescription.trimmingCharacters(in: .whitespacesAndNewlines)
    if !usage.isEmpty {
      return usage
    }
    return "还没有填写调用提示，建议说明什么时候该调这个组件，以及什么问题不适合交给它。"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .top, spacing: 12) {
        CapabilityCardIcon(
          symbolName: AbilityKind.diagnosticHttp.symbolName,
          tint: component.enabled ? .accentColor : .secondary
        )

        VStack(alignment: .leading, spacing: 6) {
          Text(component.displayName)
            .font(.title3.weight(.semibold))

          HStack(spacing: 8) {
            StatusBadge(title: catalog?.configured == true ? "已接入" : "未接入", color: catalog?.configured == true ? .green : .secondary)
            StatusBadge(
              title: canEnable ? (component.enabled ? "总开关已开" : "总开关已关") : "等待配置",
              color: component.enabled ? .accentColor : (canEnable ? .orange : .secondary)
            )
            Text(component.capabilityID)
              .font(.system(.caption2, design: .monospaced))
              .foregroundStyle(.secondary)
          }
        }

        Spacer(minLength: 0)
      }

      VStack(alignment: .leading, spacing: 8) {
        Text("用途说明")
          .font(.caption.weight(.medium))
          .foregroundStyle(.secondary)
        Text(summaryText)
          .font(.callout)
          .fixedSize(horizontal: false, vertical: true)
      }

      if !component.commandLabel.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("快捷命令")
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
          ExamplePromptChip(text: component.commandLabel)
        }
      }

      VStack(alignment: .leading, spacing: 8) {
        Text("调用提示")
          .font(.caption.weight(.medium))
          .foregroundStyle(.secondary)
        Text(usageText)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      if !component.examplePrompts.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("示例请求")
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
          ForEach(Array(component.examplePrompts.prefix(3)), id: \.self) { prompt in
            ExamplePromptChip(text: prompt)
          }
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(component.enabled ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct RulesConsoleView: View {
  @ObservedObject var store: ConsoleStore
  let kind: RuleKind

  @State private var searchText = ""
  @State private var selectedIndex: Int?
  @State private var activeFilter: RuleListFilter = .all

  private var allRules: [ConsoleRule] {
    store.rules(for: kind)
  }

  private var capabilityTotalCount: Int {
    store.bootstrap?.catalogs.capabilities.count ?? 0
  }

  private var activeRuleCount: Int {
    allRules.filter { enabledCount(for: $0) > 0 }.count
  }

  private var recentRuleCount: Int {
    allRules.filter { recentThreadByIdentifier[$0.id.trimmingCharacters(in: .whitespacesAndNewlines)] != nil }.count
  }

  private var pendingRuleCount: Int {
    allRules.filter { enabledCount(for: $0) == 0 }.count
  }

  private var recentThreadByIdentifier: [String: RecentThread] {
    var result: [String: RecentThread] = [:]
    for thread in store.recentThreads {
      guard store.threadRuleKind(for: thread) == kind else {
        continue
      }
      let identifier = store.threadIdentifier(for: thread)
      guard !identifier.isEmpty, result[identifier] == nil else {
        continue
      }
      result[identifier] = thread
    }
    return result
  }

  private var activityOrder: [String: Int] {
    var result: [String: Int] = [:]
    for (index, thread) in store.recentThreads.enumerated() {
      guard store.threadRuleKind(for: thread) == kind else {
        continue
      }
      let identifier = store.threadIdentifier(for: thread)
      guard !identifier.isEmpty, result[identifier] == nil else {
        continue
      }
      result[identifier] = index
    }
    return result
  }

  private var filteredIndices: [Int] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let matched = allRules.indices.filter { index in
      let rule = allRules[index]
      let thread = recentThreadByIdentifier[rule.id.trimmingCharacters(in: .whitespacesAndNewlines)]
      guard matchesFilter(rule, recentThread: thread) else {
        return false
      }
      if query.isEmpty {
        return true
      }
      return rule.id.lowercased().contains(query) ||
        rule.name.lowercased().contains(query) ||
        rule.note.lowercased().contains(query) ||
        (thread?.title.lowercased().contains(query) ?? false) ||
        (thread?.subtitle.lowercased().contains(query) ?? false)
    }

    return matched.sorted { lhs, rhs in
      let lhsRule = allRules[lhs]
      let rhsRule = allRules[rhs]
      let lhsOrder = activityOrder[lhsRule.id.trimmingCharacters(in: .whitespacesAndNewlines)] ?? Int.max
      let rhsOrder = activityOrder[rhsRule.id.trimmingCharacters(in: .whitespacesAndNewlines)] ?? Int.max
      if lhsOrder != rhsOrder {
        return lhsOrder < rhsOrder
      }
      return lhsRule.displayName.localizedCompare(rhsRule.displayName) == .orderedAscending
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Panel(title: "直接配置", subtitle: "选择一个对象后，右侧会直接展示当前已拥有和未拥有的能力。切换开关后自动保存，下一条消息立即生效。") {
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 10) {
            StatusBadge(title: "对象数 \(allRules.count)", color: .secondary)
            StatusBadge(title: "已配能力 \(activeRuleCount)", color: activeRuleCount > 0 ? .green : .secondary)
            if !recentThreadByIdentifier.isEmpty {
              StatusBadge(title: "最近互动 \(recentThreadByIdentifier.count)", color: .accentColor)
            }
          }
          Text("最近互动过的\(kind.title)会自动出现在左侧；如果还没出现，也可以手动新增一个对象。")
            .font(.callout)
            .foregroundStyle(.secondary)
          Text(kind.overrideMessage ?? "普通聊天默认开启，其它能力需要在这里按对象打开或关闭。")
            .font(.callout)
            .foregroundStyle(.secondary)
          HStack(spacing: 10) {
            StatusBadge(title: store.autosaveStatusText, color: store.isSaving ? .orange : .green)
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
          activeFilter: $activeFilter,
          recentThreadByIdentifier: recentThreadByIdentifier,
          enabledSummary: { rule in enabledSummary(for: rule) },
          enabledCount: enabledCount,
          capabilityTotalCount: capabilityTotalCount,
          filterCounts: filterCounts,
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
        .frame(width: 280)

        if let selectedIndex, allRules.indices.contains(selectedIndex) {
          RuleDetailPanel(store: store, kind: kind, index: selectedIndex, recentThread: recentThreadByIdentifier[allRules[selectedIndex].id.trimmingCharacters(in: .whitespacesAndNewlines)])
        } else {
          Panel {
            ContentUnavailableView(kind.emptyTitle, systemImage: "tray", description: Text("让\(kind == .groups ? "群组" : "用户")先和 bot 互动一次，或手动新增一个对象后再来切换能力开关。"))
              .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      }
      .frame(maxHeight: .infinity)
    }
    .onAppear {
      store.syncRulesWithRecentThreads(for: kind)
      applyPendingFocusIfNeeded()
      syncSelection()
    }
    .onChange(of: store.recentThreads.map(\.id)) { _, _ in
      store.syncRulesWithRecentThreads(for: kind)
      applyPendingFocusIfNeeded()
      syncSelection(preferCurrentIfVisible: true)
    }
    .onChange(of: allRules.count) { _, _ in
      applyPendingFocusIfNeeded()
      syncSelection()
    }
    .onChange(of: activeFilter) { _, _ in
      syncSelection(preferCurrentIfVisible: true)
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

  private func enabledSummary(for rule: ConsoleRule) -> String {
    let labels = (store.bootstrap?.catalogs.capabilities ?? []).compactMap { capability -> String? in
      rule.capabilities.value(for: capability.id) ? capability.label : nil
    }
    return labels.isEmpty ? "仅保留默认状态" : labels.joined(separator: "、")
  }

  private func enabledCount(for rule: ConsoleRule) -> Int {
    (store.bootstrap?.catalogs.capabilities ?? []).reduce(into: 0) { count, capability in
      if rule.capabilities.value(for: capability.id) {
        count += 1
      }
    }
  }

  private func filterCounts(_ filter: RuleListFilter) -> Int {
    switch filter {
    case .all:
      return allRules.count
    case .recent:
      return recentRuleCount
    case .configured:
      return activeRuleCount
    case .pending:
      return pendingRuleCount
    }
  }

  private func matchesFilter(_ rule: ConsoleRule, recentThread: RecentThread?) -> Bool {
    switch activeFilter {
    case .all:
      return true
    case .recent:
      return recentThread != nil
    case .configured:
      return enabledCount(for: rule) > 0
    case .pending:
      return enabledCount(for: rule) == 0
    }
  }

  private func applyPendingFocusIfNeeded() {
    guard let identifier = store.pendingFocusedRuleIdentifier(for: kind), !identifier.isEmpty else {
      return
    }
    if let index = allRules.firstIndex(where: { $0.id.trimmingCharacters(in: .whitespacesAndNewlines) == identifier }) {
      if !searchText.isEmpty {
        searchText = ""
      }
      selectedIndex = index
      store.clearPendingRuleIdentifier(for: kind)
    }
  }
}

private enum RuleListFilter: String, CaseIterable, Identifiable {
  case all
  case recent
  case configured
  case pending

  var id: String { rawValue }

  var title: String {
    switch self {
    case .all: return "全部"
    case .recent: return "最近活跃"
    case .configured: return "已配置"
    case .pending: return "未配置"
    }
  }
}

private struct RuleFilterChip: View {
  let title: String
  let count: Int
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(title)
          .font(.caption.weight(.semibold))
        Text("\(count)")
          .font(.caption2.weight(.semibold))
          .padding(.vertical, 2)
          .padding(.horizontal, 6)
          .background((isSelected ? Color.white.opacity(0.22) : Color.secondary.opacity(0.10)))
          .clipShape(Capsule())
      }
      .padding(.vertical, 8)
      .padding(.horizontal, 12)
      .background(isSelected ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.06))
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
    .buttonStyle(.plain)
  }
}

private struct RuleListPanel: View {
  let kind: RuleKind
  let rules: [ConsoleRule]
  let filteredIndices: [Int]
  @Binding var searchText: String
  @Binding var selectedIndex: Int?
  @Binding var activeFilter: RuleListFilter
  let recentThreadByIdentifier: [String: RecentThread]
  let enabledSummary: (ConsoleRule) -> String
  let enabledCount: (ConsoleRule) -> Int
  let capabilityTotalCount: Int
  let filterCounts: (RuleListFilter) -> Int
  let onAdd: () -> Void
  let onDelete: () -> Void

  var body: some View {
    Panel(title: "\(kind.title)列表", subtitle: "左侧直接选对象，右侧切换能力开关。") {
      VStack(spacing: 14) {
        TextField(kind.placeholder, text: $searchText)
          .textFieldStyle(.roundedBorder)

        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(RuleListFilter.allCases) { filter in
              RuleFilterChip(
                title: filter.title,
                count: filterCounts(filter),
                isSelected: activeFilter == filter
              ) {
                activeFilter = filter
              }
            }
          }
          .padding(.vertical, 2)
        }

        ScrollViewReader { proxy in
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
                    RuleListRow(
                      kind: kind,
                      rule: rules[index],
                      isSelected: selectedIndex == index,
                      recentThread: recentThreadByIdentifier[rules[index].id.trimmingCharacters(in: .whitespacesAndNewlines)],
                      enabledSummary: enabledSummary(rules[index]),
                      enabledCount: enabledCount(rules[index]),
                      capabilityTotalCount: capabilityTotalCount
                    )
                  }
                  .buttonStyle(.plain)
                  .id(index)
                }
              }
            }
            .onAppear {
              scrollToSelection(proxy)
            }
            .onChange(of: selectedIndex) { _, _ in
              scrollToSelection(proxy)
            }
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)

        HStack {
          Button("手动添加", action: onAdd)
          Spacer()
          Button("删除", action: onDelete)
            .disabled(selectedIndex == nil)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func scrollToSelection(_ proxy: ScrollViewProxy) {
    guard let selectedIndex else {
      return
    }
    withAnimation(.snappy(duration: 0.2)) {
      proxy.scrollTo(selectedIndex, anchor: .center)
    }
  }
}

private struct RuleListRow: View {
  let kind: RuleKind
  let rule: ConsoleRule
  let isSelected: Bool
  let recentThread: RecentThread?
  let enabledSummary: String
  let enabledCount: Int
  let capabilityTotalCount: Int

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: kind == .groups ? "person.2.fill" : "person.crop.circle.fill")
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
        .padding(.top, 2)

      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          Text(rule.displayName)
            .font(.headline)
            .lineLimit(1)
          if recentThread != nil {
            StatusBadge(title: "最近活跃", color: .green)
          }
        }
        Text(rule.id.isEmpty ? "等待填写 ID" : rule.id)
          .font(.system(.caption, design: .monospaced))
          .foregroundStyle(.secondary)
        HStack(spacing: 8) {
          StatusBadge(
            title: capabilityTotalCount == 0 ? "能力待加载" : "\(enabledCount)/\(capabilityTotalCount) 已开启",
            color: enabledCount > 0 ? .accentColor : .secondary
          )
          if enabledCount == 0 {
            StatusBadge(title: "未单独配置", color: .secondary)
          }
        }
        Text(enabledSummary)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        if let recentThread {
          Text("\(recentThread.updatedAtLabel) · \(recentThread.subtitle)")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        } else if !rule.note.isEmpty {
          Text(rule.note)
            .font(.caption2)
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
  let recentThread: RecentThread?

  var body: some View {
    let ruleBinding = store.ruleBinding(for: kind, index: index)
    let capabilities = store.bootstrap?.catalogs.capabilities ?? []

    Panel(title: "\(ruleBinding.wrappedValue.displayName)能力配置", subtitle: "直接看当前已拥有和未拥有的能力；切换开关后自动保存，并对下一条消息立即生效。") {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          if let overrideMessage = kind.overrideMessage {
            InlineBanner(text: overrideMessage, tint: Color.accentColor.opacity(0.10), foreground: .accentColor)
          }

          HStack(alignment: .top, spacing: 18) {
            Panel(title: "对象信息", subtitle: "ID 用来和飞书会话精确匹配，名称只影响控制台展示。") {
              VStack(spacing: 14) {
                FieldRow(title: kind == .groups ? "群 ID" : "用户 ID") {
                  TextField(kind == .groups ? "oc_xxx" : "ou_xxx", text: ruleBinding.id)
                    .textFieldStyle(.roundedBorder)
                }
                FieldRow(title: "显示名称") {
                  TextField(kind == .groups ? "SRE 值班群" : "张三", text: ruleBinding.name)
                    .textFieldStyle(.roundedBorder)
                }
                if let recentThread {
                  FieldRow(title: "最近会话") {
                    Text(recentThread.subtitle)
                      .font(.callout)
                      .foregroundStyle(.secondary)
                      .frame(maxWidth: .infinity, alignment: .leading)
                  }
                } else if !ruleBinding.wrappedValue.note.isEmpty {
                  FieldRow(title: "备注") {
                    Text(ruleBinding.wrappedValue.note)
                      .font(.callout)
                      .foregroundStyle(.secondary)
                      .frame(maxWidth: .infinity, alignment: .leading)
                  }
                }
              }
            }

            Panel(title: "当前状态") {
              VStack(alignment: .leading, spacing: 12) {
                StatusBadge(title: store.autosaveStatusText, color: store.isSaving ? .orange : .green)
                KeyValueRow(title: "已拥有能力", value: enabledSummary(ruleBinding.wrappedValue, capabilities: capabilities))
                KeyValueRow(title: "未拥有能力", value: missingSummary(ruleBinding.wrappedValue, capabilities: capabilities))
                Text("对象能力保存后会立刻写入本地配置；运行中的后台会在下一条消息按最新结果判定，不需要重启。")
                  .font(.callout)
                  .foregroundStyle(.secondary)
                  .fixedSize(horizontal: false, vertical: true)
              }
            }
            .frame(width: 280)
          }

          Panel(title: "全部能力", subtitle: "直接切换开关即可授权；未全局开启或未接入的能力会自动置灰。") {
            LazyVGrid(columns: [
              GridItem(.adaptive(minimum: 260), spacing: 14, alignment: .top)
            ], spacing: 14) {
              ForEach(capabilities) { capability in
                CapabilityControlCard(
                  capability: capability,
                  detail: capability.message,
                  note: capability.assignable ? "开关变化会自动保存，下一条消息立即生效。" : "请先在“能力配置”页完成接入并打开总开关。",
                  isEditable: capability.assignable,
                  isOn: store.capabilityBinding(for: capability.id, kind: kind, index: index)
                )
              }
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(.trailing, 2)
      }
      .scrollIndicators(.never)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private func enabledSummary(_ rule: ConsoleRule, capabilities: [CatalogCapability]) -> String {
    let labels = capabilities.compactMap { capability -> String? in
      rule.capabilities.value(for: capability.id) ? capability.label : nil
    }
    return labels.isEmpty ? "未选择" : labels.joined(separator: "、")
  }

  private func missingSummary(_ rule: ConsoleRule, capabilities: [CatalogCapability]) -> String {
    let labels = capabilities.compactMap { capability -> String? in
      rule.capabilities.value(for: capability.id) ? nil : capability.label
    }
    return labels.isEmpty ? "全部已开启" : labels.joined(separator: "、")
  }
}

private enum ProcessingReactionPreset: String, CaseIterable, Identifiable {
  case onIt = "OnIt"
  case glance = "GLANCE"
  case thumbsUp = "THUMBSUP"
  case salute = "SALUTE"
  case muscle = "MUSCLE"
  case done = "DONE"

  var id: String { rawValue }

  var code: String { rawValue }

  var preview: String {
    switch self {
    case .onIt: return "⌨️"
    case .glance: return "👀"
    case .thumbsUp: return "👍"
    case .salute: return "🫡"
    case .muscle: return "💪"
    case .done: return "✅"
    }
  }

  var title: String {
    switch self {
    case .onIt: return "在做了"
    case .glance: return "我在看"
    case .thumbsUp: return "收到"
    case .salute: return "安排中"
    case .muscle: return "推进中"
    case .done: return "完成态"
    }
  }

  var subtitle: String {
    switch self {
    case .onIt: return "像敲键盘，最适合表示正在处理"
    case .glance: return "适合告诉用户“我已经看到了”"
    case .thumbsUp: return "偏确认收到，语气更轻"
    case .salute: return "像接到任务，动作感更强"
    case .muscle: return "更像“安排上了、我来处理”"
    case .done: return "更适合完成，不建议用作处理中"
    }
  }
}

private struct ProcessingReactionPresetCard: View {
  let preset: ProcessingReactionPreset
  let isSelected: Bool
  let isEnabled: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(preset.preview)
        .font(.system(size: 28))
      Text(preset.title)
        .font(.headline)
      Text(preset.subtitle)
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      Text(preset.code)
        .font(.system(.caption2, design: .monospaced))
        .foregroundStyle(.secondary)
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isSelected ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 1.5)
    )
    .opacity(isEnabled ? 1 : 0.65)
  }
}

private struct SystemSettingsView: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    let selectedProvider = store.bootstrap?.catalogs.providers.first(where: { $0.id == (store.draftEnv["BOT_LLM_PROVIDER"] ?? "") })
    let providerDocsURL = selectedProvider?.id == "stepfun"
      ? URL(string: store.bootstrap?.docs.stepApiKey ?? "")
      : nil
    let helpSummaryBinding = store.helpContentTextBinding(
      defaultValue: { $0.summary },
      get: { $0.summary },
      set: { $0.summary = $1 }
    )
    let newCommandBinding = store.helpContentTextBinding(
      defaultValue: { $0.newCommandDescription },
      get: { $0.newCommandDescription },
      set: { $0.newCommandDescription = $1 }
    )
    let helpCapabilityOrderBinding = store.helpCapabilityOrderBinding()
    let processingReactionEnabledBinding = store.processingReactionEnabledBinding()
    let processingReactionEmojiBinding = store.processingReactionEmojiBinding()

    ScrollableConsoleSection {
      VStack(spacing: 18) {
        Panel(title: "快捷命令", subtitle: "默认包含 `/help` 和 `/new`；每个自定义组件填了命令后，也会自动出现在这里。") {
          VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: [
              GridItem(.adaptive(minimum: 240), spacing: 12, alignment: .top)
            ], spacing: 12) {
              ForEach(Array(store.quickCommandPreviewItems.enumerated()), id: \.element.id) { index, item in
                QuickCommandCard(orderLabel: "\(index + 1)", item: item)
              }
            }
            Text("这里按最终展示顺序预览：先放固定命令，再放你给组件配置的命令。`/help` 会返回下面这段通用说明，并自动带上当前对象已开通的能力说明；组件命令是否真正可用，还会继续受全局接入和对象授权影响。")
              .font(.callout)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }

        Panel(title: "/help 说明", subtitle: "第一段由你自己编辑；第二段会根据对象已开通的能力自动拼接。这里的预览先按当前全局已启用能力展示。") {
          VStack(alignment: .leading, spacing: 16) {
            HelpContentPreviewCard(
              help: store.resolvedHelpContent,
              capabilityItems: store.helpPreviewCapabilityItems
            )

            VStack(alignment: .leading, spacing: 10) {
              HStack {
                Text("通用说明")
                  .font(.callout.weight(.medium))
                Spacer()
                PolishActionButton(
                  title: "一键润色",
                  isRunning: store.isPolishing("help-summary"),
                  action: store.polishHelpSummary
                )
              }
              TextEditor(text: helpSummaryBinding)
                .font(.system(.callout))
                .frame(minHeight: 110)
                .padding(10)
                .background(Color.secondary.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
              Text("建议把 bot 擅长做什么、群聊/私聊怎么触发、回答风格和边界都写在这里。")
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            FieldRow(title: "/new 说明") {
              HStack(spacing: 10) {
                TextField("开启一个新话题，并清空当前用户的聊天上下文。", text: newCommandBinding)
                  .textFieldStyle(.roundedBorder)
                PolishActionButton(
                  title: "一键润色",
                  isRunning: store.isPolishing("help-new-command"),
                  action: store.polishNewCommandDescription
                )
              }
            }

            FieldRow(title: "能力顺序") {
              VStack(alignment: .leading, spacing: 8) {
                Picker("能力顺序", selection: helpCapabilityOrderBinding) {
                  ForEach(HelpCapabilityOrderMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                  }
                }
                .labelsHidden()
                .pickerStyle(.segmented)

                Text(helpCapabilityOrderBinding.wrappedValue.subtitle)
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .fixedSize(horizontal: false, vertical: true)
              }
            }

            HStack(spacing: 12) {
              Button("恢复默认帮助") {
                store.resetHelpContent()
              }
              .buttonStyle(.bordered)
              Text("保存后下一条 `/help` 立即按新文案返回；第二段能力说明会自动跟着授权变化。")
                .font(.callout)
                .foregroundStyle(.secondary)
            }
          }
        }

        Panel(title: "模型配置", subtitle: "模型 Token、Base URL 和模型名都可以直接在这里改；文案润色也会优先使用这套配置。") {
          VStack(spacing: 16) {
            ModelConfigOverviewCard(
              providerName: selectedProvider?.name ?? store.stepProviderName,
              baseUrl: store.draftEnv["BOT_LLM_BASE_URL"] ?? "",
              textModel: store.draftEnv["BOT_LLM_MODEL"] ?? "",
              visionModel: store.draftEnv["BOT_VISION_MODEL"] ?? "",
              ttsModel: store.draftEnv["BOT_TTS_MODEL"] ?? "",
              timeoutMs: store.draftEnv["BOT_LLM_TIMEOUT_MS"] ?? "15000",
              state: store.onboardingState(for: .model),
              docsURL: providerDocsURL,
              onTest: store.testModelConnectivityFromConsole
            )

            SettingsSubcard(title: "接入凭据", subtitle: "这里决定模型服务走哪一个供应商、哪个地址以及哪一把 token。") {
              VStack(spacing: 14) {
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

                FieldRow(title: "Base URL") {
                  TextField("https://api.stepfun.com/v1", text: store.binding(for: "BOT_LLM_BASE_URL"))
                    .textFieldStyle(.roundedBorder)
                }
              }
            }

            SettingsSubcard(title: "模型分配", subtitle: "不同能力会读取各自的模型名；如果供应商有默认值，切换供应商后会自动带上。") {
              VStack(spacing: 14) {
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

            SettingsSubcard(title: "调用参数", subtitle: "超时配置也会影响桌面端的一键润色和连通性测试体验。") {
              FieldRow(title: "超时") {
                TextField("15000", text: store.binding(for: "BOT_LLM_TIMEOUT_MS", fallback: "15000"))
                  .textFieldStyle(.roundedBorder)
              }
            }
          }
        }

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

            Text("这里负责模型配置、命令文案、运行状态和后台操作；改完会自动保存，需要重启的项目会在底部统一提示。")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        }

        Panel(title: "处理态反馈", subtitle: "机器人收到消息后，可以先给原消息点一个飞书表情，告诉用户“已经在处理”；真正发出回复前会自动撤掉这个表情。") {
          VStack(alignment: .leading, spacing: 16) {
            Toggle(isOn: processingReactionEnabledBinding) {
              VStack(alignment: .leading, spacing: 6) {
                Text("开启处理中表情")
                  .font(.callout.weight(.medium))
                Text(store.processingReactionSummary)
                  .font(.caption)
                  .foregroundStyle(.secondary)
                  .fixedSize(horizontal: false, vertical: true)
              }
            }
            .toggleStyle(.switch)

            VStack(alignment: .leading, spacing: 10) {
              Text("直观选择")
                .font(.callout.weight(.medium))
              LazyVGrid(columns: [
                GridItem(.adaptive(minimum: 150), spacing: 12, alignment: .top)
              ], spacing: 12) {
                ForEach(ProcessingReactionPreset.allCases) { preset in
                  Button {
                    processingReactionEmojiBinding.wrappedValue = preset.code
                  } label: {
                    ProcessingReactionPresetCard(
                      preset: preset,
                      isSelected: store.processingReactionSettings.resolvedEmoji == preset.code,
                      isEnabled: store.processingReactionSettings.enabled
                    )
                  }
                  .buttonStyle(.plain)
                  .disabled(!store.processingReactionSettings.enabled)
                }
              }
            }

            FieldRow(title: "高级名称") {
              TextField("OnIt", text: processingReactionEmojiBinding)
                .textFieldStyle(.roundedBorder)
                .disabled(!store.processingReactionSettings.enabled)
            }

            Text("上面的卡片是语义预览，帮助你快速理解表情含义；真实飞书 reaction 以客户端实际显示为准。你也可以在“高级名称”里手动输入 emoji_type。")
              .font(.caption)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
              Button("恢复默认反馈") {
                store.resetProcessingReactionSettings()
              }
              .buttonStyle(.bordered)

              Text("修改后自动保存，下一条消息立即按这里的设置执行。")
                .font(.callout)
                .foregroundStyle(.secondary)
            }
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
              .frame(width: 220)

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

      Button(store.onboardingPrimaryButtonTitle) {
        store.runOnboardingPrimaryAction()
      }
      .buttonStyle(.borderedProminent)
      .disabled(store.isRunningOnboardingAction)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 12)
    .background(Color(nsColor: .windowBackgroundColor))
  }
}

private struct ConsoleFooterBar: View {
  @ObservedObject var store: ConsoleStore

  var body: some View {
    HStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 3) {
        Text(store.autosaveStatusText)
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
    .padding(.horizontal, 18)
    .padding(.vertical, 12)
    .background(Color(nsColor: .windowBackgroundColor))
  }
}

private struct WorkspaceSurface<Content: View>: View {
  private let title: String?
  private let content: Content

  init(title: String? = nil, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let title {
        Text(title)
          .font(.headline)
          .padding(.horizontal, 20)
          .padding(.top, 18)
          .padding(.bottom, 14)
        Divider()
      }

      content
        .padding(title == nil ? 0 : 20)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(Color(nsColor: .controlBackgroundColor).opacity(0.85))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(Color.black.opacity(0.06), lineWidth: 1)
    )
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

private struct ScrollableConsoleSection<Content: View>: View {
  private let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    ScrollView {
      content
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(.trailing, 2)
        .padding(.bottom, 4)
    }
    .scrollIndicators(.never)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
    .padding(18)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(Color(nsColor: .controlBackgroundColor).opacity(0.82))
    .overlay(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .stroke(Color.black.opacity(0.05), lineWidth: 1)
    )
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
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

private struct RuleManagerSheet: View {
  @ObservedObject var store: ConsoleStore
  let kind: RuleKind
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let size = AppWindowController.currentSheetCGSize(idealWidth: 1120, idealHeight: 760)

    return VStack(spacing: 0) {
      HStack(spacing: 12) {
        Text("\(kind.title)能力配置")
          .font(.title2.weight(.semibold))
        Spacer()
        Button("关闭") {
          dismiss()
        }
        .buttonStyle(.bordered)
        .keyboardShortcut(.cancelAction)
      }
      .padding(.horizontal, 24)
      .padding(.top, 24)
      .padding(.bottom, 16)

      Divider()

      RulesConsoleView(store: store, kind: kind)
        .padding(24)

      Divider()

      HStack {
        Spacer()
        Button("完成") {
          dismiss()
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 18)
    }
    .frame(width: size.width, height: size.height)
  }
}

private struct AdvancedModelSheet: View {
  @ObservedObject var store: ConsoleStore
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let size = AppWindowController.currentSheetCGSize(idealWidth: 760, idealHeight: 420)

    return ScrollView {
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
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .scrollIndicators(.never)
    .frame(width: size.width, height: size.height)
  }
}

private struct AdvancedRuntimeSheet: View {
  @ObservedObject var store: ConsoleStore
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let size = AppWindowController.currentSheetCGSize(idealWidth: 820, idealHeight: 520)

    return ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Advanced Runtime Settings")
          .font(.title2.weight(.semibold))

        Panel {
          VStack(spacing: 16) {
            FieldRow(title: "BOT_PROFILE") {
              TextField("development", text: store.binding(for: "BOT_PROFILE", fallback: "development"))
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
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .scrollIndicators(.never)
    .frame(width: size.width, height: size.height)
  }
}

private struct AbilityDetailSheet: View {
  @ObservedObject var store: ConsoleStore
  let ability: AbilityKind
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let title = ability == .diagnosticHttp ? "自定义 HTTP 组件" : ability.title
    let size = AppWindowController.currentSheetCGSize(
      idealWidth: 700,
      idealHeight: ability == .diagnosticHttp ? 860 : 440
    )
    let examplesBinding = Binding(
      get: { store.diagnosticComponentExamplesText },
      set: { store.diagnosticComponentExamplesText = $0 }
    )

    return VStack(spacing: 0) {
      HStack(spacing: 12) {
        Text(title)
          .font(.title2.weight(.semibold))
        Spacer()
        Button("关闭") {
          dismiss()
        }
        .buttonStyle(.bordered)
        .keyboardShortcut(.cancelAction)
      }
      .padding(.horizontal, 24)
      .padding(.top, 24)
      .padding(.bottom, 16)

      Divider()

      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          switch ability {
          case .diagnosticHttp:
            Panel(title: "组件列表", subtitle: "可以维护多个组件；先选中一个，再编辑它的说明、接入配置和导入 JSON。") {
              VStack(alignment: .leading, spacing: 14) {
                HStack {
                  Text("已添加 \(store.diagnosticComponents.count) 个组件")
                    .font(.callout.weight(.medium))
                  Spacer()
                  Button("新增组件") {
                    store.addDiagnosticComponent()
                  }
                  .buttonStyle(.borderedProminent)
                }

                if store.diagnosticComponents.isEmpty {
                  ContentUnavailableView(
                    "还没有组件",
                    systemImage: "puzzlepiece.extension",
                    description: Text("先新增一个组件，或者直接粘贴一键配置 JSON。")
                  )
                  .frame(maxWidth: .infinity)
                } else {
                  LazyVGrid(columns: [
                    GridItem(.adaptive(minimum: 260), spacing: 12, alignment: .top)
                  ], spacing: 12) {
                    ForEach(store.diagnosticComponents, id: \.id) { component in
                      Button {
                        store.selectDiagnosticComponent(component.id)
                      } label: {
                        HStack(alignment: .top, spacing: 12) {
                          CapabilityCardIcon(
                            symbolName: AbilityKind.diagnosticHttp.symbolName,
                            tint: store.selectedDiagnosticComponentID == component.id ? .accentColor : .secondary
                          )

                          VStack(alignment: .leading, spacing: 6) {
                            Text(component.displayName)
                              .font(.headline)
                            Text(component.summary.isEmpty ? "尚未填写用途说明" : component.summary)
                              .font(.caption)
                              .foregroundStyle(.secondary)
                              .lineLimit(2)
                            if !component.commandLabel.isEmpty {
                              Text(component.commandLabel)
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                            }
                            HStack(spacing: 8) {
                              StatusBadge(
                                title: component.baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "未接入" : "已接入",
                                color: component.baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .orange : .green
                              )
                              StatusBadge(
                                title: component.enabled ? "总开关已开" : "总开关已关",
                                color: component.enabled ? .accentColor : .secondary
                              )
                            }
                          }
                          Spacer(minLength: 0)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(store.selectedDiagnosticComponentID == component.id ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.05))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                      }
                      .buttonStyle(.plain)
                    }
                  }
                }
              }
            }

            if let selectedComponent = store.selectedDiagnosticComponent {
              Panel(title: "当前组件概览", subtitle: "这里展示的是这张组件卡片最终想表达给用户和管理员看的信息。") {
                DiagnosticComponentOverviewCard(
                  component: selectedComponent,
                  catalog: store.selectedDiagnosticComponentCatalog
                )
              }

              Panel(title: "组件说明", subtitle: "把组件名、用途说明和调用提示写清楚，机器人更容易把正确的问题路由到正确的组件。") {
                VStack(spacing: 16) {
                  FieldRow(title: "组件名称") {
                    HStack(spacing: 10) {
                      TextField(
                        "例如：订单诊断 / 支付排障 / CRM 查询",
                        text: store.diagnosticComponentTextBinding(
                          get: { $0.name },
                          set: { $0.name = $1 }
                        )
                      )
                      .textFieldStyle(.roundedBorder)

                      if let component = store.selectedDiagnosticComponent {
                        PolishActionButton(
                          title: "一键润色",
                          isRunning: store.isPolishing("component-name-\(component.id)"),
                          action: store.polishSelectedDiagnosticComponentName
                        )
                      }
                    }
                  }

                  FieldRow(title: "对应命令") {
                    VStack(alignment: .leading, spacing: 8) {
                      TextField(
                        "/orders",
                        text: store.diagnosticComponentCommandBinding()
                      )
                      .textFieldStyle(.roundedBorder)

                      if let component = store.selectedDiagnosticComponent {
                        if let issue = store.diagnosticComponentCommandIssue(for: component) {
                          Text(issue)
                            .font(.caption)
                            .foregroundStyle(.orange)
                        } else {
                          Text("只支持英文、数字、- 和 _；不要和 `/help`、`/new` 等系统命令重名。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                      }
                    }
                  }

                  FieldRow(title: "用途说明") {
                    HStack(spacing: 10) {
                      TextField(
                        "一句话说明这个接口解决什么问题",
                        text: store.diagnosticComponentTextBinding(
                          get: { $0.summary },
                          set: { $0.summary = $1 }
                        )
                      )
                      .textFieldStyle(.roundedBorder)

                      if let component = store.selectedDiagnosticComponent {
                        PolishActionButton(
                          title: "一键润色",
                          isRunning: store.isPolishing("component-summary-\(component.id)"),
                          action: store.polishSelectedDiagnosticComponentSummary
                        )
                      }
                    }
                  }

                  VStack(alignment: .leading, spacing: 10) {
                    HStack {
                      Text("适用场景 / 调用提示")
                        .font(.callout.weight(.medium))
                      Spacer()
                      if let component = store.selectedDiagnosticComponent {
                        PolishActionButton(
                          title: "一键润色",
                          isRunning: store.isPolishing("component-usage-\(component.id)"),
                          action: store.polishSelectedDiagnosticComponentUsageDescription
                        )
                      }
                    }
                    TextEditor(
                      text: store.diagnosticComponentTextBinding(
                        get: { $0.usageDescription },
                        set: { $0.usageDescription = $1 }
                      )
                    )
                    .font(.system(.callout))
                    .frame(minHeight: 110)
                    .padding(10)
                    .background(Color.secondary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Text("命令会自动规范成 `/xxx`。建议写清楚：什么时候该调这个组件、适合回答什么问题、不适合处理什么内容。")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }

                  VStack(alignment: .leading, spacing: 10) {
                    HStack {
                      Text("示例请求")
                        .font(.callout.weight(.medium))
                      Spacer()
                      if let component = store.selectedDiagnosticComponent {
                        PolishActionButton(
                          title: "一键润色",
                          isRunning: store.isPolishing("component-examples-\(component.id)"),
                          action: store.polishSelectedDiagnosticComponentExamples
                        )
                      }
                    }
                    TextEditor(text: examplesBinding)
                      .font(.system(.callout))
                      .frame(minHeight: 96)
                      .padding(10)
                      .background(Color.secondary.opacity(0.06))
                      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Text("每行写一个例子，例如：查一下 trace 7f8e9a0b1234。")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                }
              }

              Panel(title: "接入配置", subtitle: "保存后会自动生效；总开关决定这个组件是否会出现在群组 / 用户 / 对话页的授权卡片里。") {
                VStack(spacing: 16) {
                  HStack(spacing: 8) {
                    StatusBadge(
                      title: store.selectedDiagnosticComponentCatalog?.configured == true ? "已接入" : "等待配置",
                      color: store.selectedDiagnosticComponentCatalog?.configured == true ? .green : .secondary
                    )
                    StatusBadge(
                      title: selectedComponent.enabled ? "总开关已开" : "总开关已关",
                      color: selectedComponent.enabled ? .accentColor : .orange
                    )
                    StatusBadge(
                      title: store.selectedDiagnosticComponentCatalog?.assignable == true ? "可授权" : "暂不可授权",
                      color: store.selectedDiagnosticComponentCatalog?.assignable == true ? .green : .secondary
                    )
                  }
                  .frame(maxWidth: .infinity, alignment: .leading)

                  FieldRow(title: "总开关") {
                    HStack(spacing: 12) {
                      Toggle("启用这个组件", isOn: store.diagnosticComponentEnabledBinding(componentID: selectedComponent.id))
                        .toggleStyle(.switch)
                        .disabled(selectedComponent.baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                      Text(selectedComponent.baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "先填好 Base URL 后才能打开总开关。"
                        : "打开后，这个组件就会出现在群组 / 用户 / 对话页的授权卡片里。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                  }

                  FieldRow(title: "Base URL") {
                    TextField(
                      "https://diagnostics.example.com",
                      text: store.diagnosticComponentTextBinding(
                        get: { $0.baseUrl },
                        set: { $0.baseUrl = $1 }
                      )
                    )
                    .textFieldStyle(.roundedBorder)
                  }
                  FieldRow(title: "Token") {
                    SecureField(
                      "optional",
                      text: store.diagnosticComponentTextBinding(
                        get: { $0.token },
                        set: { $0.token = $1 }
                      )
                    )
                    .textFieldStyle(.roundedBorder)
                  }
                  FieldRow(title: "Caller Header") {
                    TextField(
                      "feishu-bot",
                      text: store.diagnosticComponentTextBinding(
                        get: { $0.caller },
                        set: { $0.caller = $1 }
                      )
                    )
                    .textFieldStyle(.roundedBorder)
                  }
                  FieldRow(title: "Timeout") {
                    TextField("20000", text: store.diagnosticComponentTimeoutBinding())
                      .textFieldStyle(.roundedBorder)
                  }
                }
              }

              Panel(title: "一键配置 / 连通测试", subtitle: "支持直接粘贴 Bundle JSON；解析后会覆盖当前选中的组件字段。") {
                VStack(alignment: .leading, spacing: 10) {
                  Text("粘贴组件一键配置 JSON")
                    .font(.callout.weight(.medium))
                  TextEditor(text: $store.diagnosticComponentImportText)
                    .font(.system(.callout, design: .monospaced))
                    .frame(minHeight: 180)
                    .padding(10)
                    .background(Color.secondary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                  Text("支持粘贴通用 `http-component-bundle/v1`，也兼容旧的 `smartkit-provider-bundle/v1`；会自动提取名称、用途、Base URL、Token 和 Caller，并写入当前选中的组件。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                  HStack {
                    Button("解析到当前组件") {
                      store.importDiagnosticComponentConfig()
                    }
                    .buttonStyle(.bordered)
                    Button(store.diagnosticComponentConnectivityState.isRunning ? "测试中..." : "测试连通性") {
                      store.testDiagnosticComponentConnectivity()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.diagnosticComponentConnectivityState.isRunning)
                    Button("移除组件", role: .destructive) {
                      store.removeDiagnosticComponent()
                    }
                    .buttonStyle(.bordered)
                  }
                  OnboardingStatusCard(state: store.diagnosticComponentConnectivityState)
                }
              }
            }
          case .webSearch:
            if let enabledBinding = store.abilityEnabledBinding(for: .webSearch) {
              Panel(title: "能力总览", subtitle: "先接入 Brave Search，再决定是否对用户和群组开放。") {
                BuiltinAbilityCard(
                  ability: .webSearch,
                  catalog: store.abilityCatalog(for: .webSearch),
                  enabledBinding: enabledBinding,
                  onConfigure: nil
                )
              }
            }
            BuiltinAbilityHelpEditor(store: store, ability: .webSearch)
            Panel(title: "接入设置", subtitle: "填好 API Key 后，这项能力才能被全局开启。") {
              VStack(spacing: 16) {
                FieldRow(title: "Brave API Key") {
                  SecureField("api key", text: store.binding(for: "BRAVE_SEARCH_API_KEY"))
                    .textFieldStyle(.roundedBorder)
                }
                if let url = URL(string: store.bootstrap?.docs.braveSearch ?? "") {
                  FieldRow(title: "文档") {
                    Link("Brave Search API", destination: url)
                  }
                }
              }
            }
          case .voiceReply:
            if let enabledBinding = store.abilityEnabledBinding(for: .voiceReply) {
              Panel(title: "能力总览", subtitle: "打开后可在授权页按用户、群组或会话分别开放语音回复能力。") {
                BuiltinAbilityCard(
                  ability: .voiceReply,
                  catalog: store.abilityCatalog(for: .voiceReply),
                  enabledBinding: enabledBinding,
                  onConfigure: nil
                )
              }
            }
            BuiltinAbilityHelpEditor(store: store, ability: .voiceReply)
            Panel(title: "接入设置", subtitle: "这里使用当前模型接入里的语音能力配置。") {
              FieldRow(title: "语音模型") {
                TextField("step-tts-2", text: store.binding(for: "BOT_TTS_MODEL"))
                  .textFieldStyle(.roundedBorder)
              }
            }
          case .vision:
            if let enabledBinding = store.abilityEnabledBinding(for: .vision) {
              Panel(title: "能力总览", subtitle: "打开后可在授权页按对象精细分配图片理解能力。") {
                BuiltinAbilityCard(
                  ability: .vision,
                  catalog: store.abilityCatalog(for: .vision),
                  enabledBinding: enabledBinding,
                  onConfigure: nil
                )
              }
            }
            BuiltinAbilityHelpEditor(store: store, ability: .vision)
            Panel(title: "接入设置", subtitle: "这里使用当前模型接入里的视觉模型配置。") {
              FieldRow(title: "视觉模型") {
                TextField("step-1o-turbo-vision", text: store.binding(for: "BOT_VISION_MODEL"))
                  .textFieldStyle(.roundedBorder)
              }
            }
          }
        }
        .padding(24)
      }
      .scrollIndicators(.never)

      Divider()

      HStack {
        Spacer()
        Button("完成") {
          dismiss()
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 18)
    }
    .frame(width: size.width, height: size.height)
  }
}
