import AppKit
import XCTest
@testable import FeishuBotApp

final class ConsoleValidationTests: XCTestCase {
  func testFeishuStepRequiresCredentials() {
    XCTAssertFalse(StepValidation.canContinue(step: .feishu, env: [:]))
    XCTAssertTrue(
      StepValidation.canContinue(
        step: .feishu,
        env: [
          "FEISHU_APP_ID": "app-id",
          "FEISHU_APP_SECRET": "secret"
        ]
      )
    )
  }

  func testModelStepRequiresApiKey() {
    XCTAssertFalse(StepValidation.canContinue(step: .model, env: [:]))
    XCTAssertTrue(
      StepValidation.canContinue(
        step: .model,
        env: [
          "BOT_LLM_API_KEY": "llm-key",
          "BOT_LLM_BASE_URL": "https://api.example.com/v1",
          "BOT_LLM_MODEL": "demo-model"
        ]
      )
    )
  }

  func testConnectivityTestResultDecodesBridgePayload() throws {
    let data = """
    {
      "kind": "feishu",
      "title": "飞书连通成功",
      "detail": "已成功获取 tenant_access_token。"
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(ConnectivityTestResult.self, from: data)

    XCTAssertEqual(decoded.kind, "feishu")
    XCTAssertEqual(decoded.title, "飞书连通成功")
  }

  func testRecentThreadDecodesBridgePayload() throws {
    let data = """
    {
      "id": "session-1",
      "title": "用户 ou_xxx",
      "subtitle": "私聊会话 · oc_xxx",
      "preview": "/help",
      "scope": "p2p",
      "status": "completed",
      "requesterId": "ou_xxx",
      "chatId": "oc_xxx",
      "conversationId": "conv_123",
      "jobId": null,
      "updatedAt": "2026-03-10T01:00:00Z"
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(RecentThread.self, from: data)

    XCTAssertEqual(decoded.id, "session-1")
    XCTAssertEqual(decoded.conversationId, "conv_123")
    XCTAssertEqual(decoded.statusLabel, "已完成")
  }

  func testThreadMessageDecodesBridgePayload() throws {
    let data = """
    {
      "id": "1",
      "role": "assistant",
      "senderName": "feishu-bot",
      "content": "你好，我在。",
      "createdAt": "2026-03-10T01:00:00Z"
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(ThreadMessage.self, from: data)

    XCTAssertEqual(decoded.id, "1")
    XCTAssertTrue(decoded.isAssistant)
    XCTAssertEqual(decoded.senderName, "feishu-bot")
  }

  func testConsoleSettingsDecodeUiState() throws {
    let data = """
    {
      "version": 2,
      "permissions": {
        "defaultMode": "allow",
        "groups": [],
        "users": []
      },
      "feedback": {
        "processingReaction": {
          "enabled": false,
          "emoji": "Keyboard"
        }
      },
      "capabilityCards": {
        "webSearch": {
          "helpDescription": "可以联网搜索公开资料后再给出整理结果。"
        },
        "voiceReply": {
          "helpDescription": "支持把回复生成语音返回。"
        },
        "vision": {
          "helpDescription": ""
        }
      },
      "help": {
        "title": "订单助手帮助",
        "summary": "优先说明订单排障入口",
        "newCommandDescription": "开始一个新话题，并清空聊天上下文。",
        "capabilityOrderMode": "component_first",
        "examplePrompts": ["/trace trace-123456"],
        "notes": ["私聊里没命中命令时会自动进入聊天模式。"]
      },
      "ui": {
        "onboardingCompleted": true,
        "lastVisitedSection": "users",
        "feishuTestReceiveId": "oc_test",
        "feishuTestReceiveIdType": "chat_id"
      }
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(ConsoleSettings.self, from: data)

    XCTAssertTrue(decoded.ui.onboardingCompleted)
    XCTAssertEqual(decoded.ui.lastVisitedSection, .users)
    XCTAssertEqual(decoded.ui.feishuTestReceiveId, "oc_test")
    XCTAssertEqual(decoded.ui.feishuTestReceiveIdType, .chatID)
    XCTAssertFalse(decoded.feedback.processingReaction.enabled)
    XCTAssertEqual(decoded.feedback.processingReaction.emoji, "Keyboard")
    XCTAssertEqual(decoded.capabilityCards.webSearch.helpDescription, "可以联网搜索公开资料后再给出整理结果。")
    XCTAssertEqual(decoded.help?.title, "订单助手帮助")
    XCTAssertEqual(decoded.help?.newCommandDescription, "开始一个新话题，并清空聊天上下文。")
    XCTAssertEqual(decoded.help?.capabilityOrderMode, .componentFirst)
  }

  func testConsoleSettingsDefaultsProcessingReactionWhenFeedbackIsMissing() throws {
    let data = """
    {
      "version": 2,
      "permissions": {
        "defaultMode": "allow",
        "groups": [],
        "users": []
      },
      "ui": {
        "onboardingCompleted": false,
        "lastVisitedSection": "thread",
        "feishuTestReceiveId": "",
        "feishuTestReceiveIdType": "chat_id"
      }
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(ConsoleSettings.self, from: data)

    XCTAssertTrue(decoded.feedback.processingReaction.enabled)
    XCTAssertEqual(decoded.feedback.processingReaction.resolvedEmoji, "OnIt")
  }

  func testConsoleSettingsDecodesMultipleDiagnosticComponents() throws {
    let data = """
    {
      "version": 2,
      "permissions": {
        "defaultMode": "allow",
        "groups": [],
        "users": []
      },
      "components": {
        "diagnosticHttp": [
          {
            "id": "orders",
            "name": "订单诊断",
            "command": "orders",
            "summary": "订单失败排查",
            "usageDescription": "处理订单失败和履约异常。",
            "examplePrompts": ["订单诊断帮我看 uid 123456 最近 1h 的失败原因"],
            "baseUrl": "https://orders.example.com",
            "token": "",
            "caller": "feishu-bot",
            "timeoutMs": 20000
          },
          {
            "id": "payments",
            "name": "支付诊断",
            "command": "/payments",
            "summary": "支付失败排查",
            "usageDescription": "处理支付失败和扣款超时。",
            "examplePrompts": ["支付诊断帮我看 uid 123456 最近 1h 的失败原因"],
            "baseUrl": "https://payments.example.com",
            "token": "",
            "caller": "feishu-bot",
            "timeoutMs": 20000
          }
        ]
      },
      "ui": {
        "onboardingCompleted": true,
        "lastVisitedSection": "abilities",
        "feishuTestReceiveId": "",
        "feishuTestReceiveIdType": "chat_id"
      }
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(ConsoleSettings.self, from: data)

    XCTAssertEqual(decoded.components.diagnosticHttp.count, 2)
    XCTAssertTrue(decoded.components.diagnosticHttp.first?.enabled == true)
    XCTAssertEqual(decoded.components.diagnosticHttp.first?.capabilityID, "component:orders")
    XCTAssertEqual(decoded.components.diagnosticHttp.first?.commandLabel, "/orders")
    XCTAssertEqual(decoded.components.diagnosticHttp.last?.displayName, "支付诊断")
  }

  func testCapabilityCatalogDecodesAssignableState() throws {
    let data = """
    {
      "id": "webSearch",
      "label": "联网搜索",
      "configured": false,
      "enabled": false,
      "assignable": false,
      "message": "请先配置 Brave Search API Key。"
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(CatalogCapability.self, from: data)

    XCTAssertEqual(decoded.id, "webSearch")
    XCTAssertFalse(decoded.assignable)
    XCTAssertEqual(decoded.message, "请先配置 Brave Search API Key。")
  }

  func testRuleCapabilitiesLookupAndMutation() {
    var capabilities = RuleCapabilities()

    XCTAssertTrue(capabilities.value(for: "chat"))
    XCTAssertFalse(capabilities.value(for: "diagnosticHttp"))
    capabilities.setValue(false, for: "vision")
    capabilities.setValue(true, for: "diagnosticHttp")
    capabilities.setValue(true, for: "component:orders")

    XCTAssertFalse(capabilities.value(for: "vision"))
    XCTAssertTrue(capabilities.value(for: "diagnosticHttp"))
    XCTAssertTrue(capabilities.value(for: "component:orders"))
  }

  func testHealthProbeDecodesBridgePayload() throws {
    let data = """
    {
      "ok": true,
      "target": "http://127.0.0.1:3179/health",
      "health": {
        "profile": "development",
        "features": {
          "feishu": {
            "configured": true,
            "active": false,
            "state": "degraded",
            "message": "waiting"
          }
        }
      }
    }
    """.data(using: .utf8)!

    let decoded = try JSONDecoder().decode(HealthProbe.self, from: data)

    XCTAssertEqual(decoded.target, "http://127.0.0.1:3179/health")
    XCTAssertEqual(decoded.health?.features?["feishu"]?.message, "waiting")
  }

  func testConsoleWindowLayoutClampsToSmallVisibleFrames() {
    let layout = AppWindowController.layout(
      for: .console,
      visibleFrame: NSRect(x: 0, y: 0, width: 780, height: 540),
      chromeHeight: 52
    )

    XCTAssertEqual(layout.maximumContentSize.width, 692, accuracy: 0.001)
    XCTAssertEqual(layout.maximumContentSize.height, 404, accuracy: 0.001)
    XCTAssertEqual(layout.minimumContentSize.height, 380, accuracy: 0.001)
    XCTAssertEqual(layout.targetContentSize.height, 404, accuracy: 0.001)
  }

  func testOnboardingWindowLayoutAlsoRespectsVisibleFrameHeight() {
    let layout = AppWindowController.layout(
      for: .onboarding,
      visibleFrame: NSRect(x: 0, y: 0, width: 760, height: 520),
      chromeHeight: 48
    )

    XCTAssertEqual(layout.targetContentSize.width, 500, accuracy: 0.001)
    XCTAssertEqual(layout.targetContentSize.height, 388, accuracy: 0.001)
    XCTAssertFalse(layout.resizable)
    XCTAssertTrue(layout.center)
  }

  func testConsoleWindowLayoutIgnoresTinyCurrentWindowState() {
    let layout = AppWindowController.layout(
      for: .console,
      visibleFrame: NSRect(x: 0, y: 0, width: 1280, height: 900),
      chromeHeight: 52
    )

    XCTAssertEqual(layout.targetContentSize.width, 760, accuracy: 0.001)
    XCTAssertEqual(layout.targetContentSize.height, 420, accuracy: 0.001)
  }

  func testSheetWindowLayoutClampsToSmallVisibleFrames() {
    let size = AppWindowController.sheetContentSize(
      idealSize: NSSize(width: 820, height: 620),
      visibleFrame: NSRect(x: 0, y: 0, width: 760, height: 520)
    )

    XCTAssertEqual(size.width, 672, accuracy: 0.001)
    XCTAssertEqual(size.height, 436, accuracy: 0.001)
  }

  func testResetPersistedWindowFramesRemovesSavedSwiftUIFrames() {
    let suiteName = "FeishuBotAppTests.\(#function)"
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      XCTFail("unable to create test user defaults suite")
      return
    }

    defaults.removePersistentDomain(forName: suiteName)
    defaults.set("0 0 900 900", forKey: "NSWindow Frame SwiftUI.Sample")
    defaults.set("keep", forKey: "unrelated")

    AppWindowController.resetPersistedWindowFrames(userDefaults: defaults)

    XCTAssertNil(defaults.string(forKey: "NSWindow Frame SwiftUI.Sample"))
    XCTAssertEqual(defaults.string(forKey: "unrelated"), "keep")
    defaults.removePersistentDomain(forName: suiteName)
  }
}
