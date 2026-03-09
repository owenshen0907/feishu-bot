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
          "BOT_LLM_API_KEY": "llm-key"
        ]
      )
    )
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
    capabilities.setValue(false, for: "vision")

    XCTAssertFalse(capabilities.value(for: "vision"))
    XCTAssertTrue(capabilities.value(for: "smartkit"))
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
}
