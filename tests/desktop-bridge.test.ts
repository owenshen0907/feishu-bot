import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBootstrapPayload,
  importDiagnosticComponentConfig,
  listRecentThreads,
  listThreadMessages,
  saveDesktopConfig,
  testDiagnosticComponentConnectivity
} from "../desktop/bridge-core.mjs";
import { SessionStore } from "../src/session-store.js";

const tempDirs: string[] = [];
const originalHome = process.env.FEISHU_BOT_HOME;
const originalFetch = globalThis.fetch;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-bridge-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.FEISHU_BOT_HOME = originalHome;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktop bridge core", () => {
  it("builds bootstrap payload with runtime defaults", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const payload = buildBootstrapPayload();

    expect(payload.runtimeHome).toBe(home);
    expect(payload.env.BOT_LLM_PROVIDER).toBe("stepfun");
    expect(payload.catalogs.providers[0].chatModel).toBe("step-3.5-flash");
    expect(payload.onboarding.complete).toBe(false);
    expect(payload.settings.ui.onboardingCompleted).toBe(false);
    expect(payload.settings.ui.lastVisitedSection).toBe("thread");
    expect(payload.settings.ui.feishuTestReceiveId).toBe("");
    expect(payload.settings.ui.feishuTestReceiveIdType).toBe("chat_id");
    expect(payload.settings.feedback.processingReaction).toMatchObject({
      enabled: true,
      emoji: "OnIt"
    });
    expect(payload.settings.capabilityCards.webSearch.helpDescription).toBe("");
    expect(payload.catalogs.capabilities.some((item) => item.id === "diagnosticHttp")).toBe(false);
    expect(fs.existsSync(path.join(home, ".env"))).toBe(true);
    expect(fs.existsSync(path.join(home, "console-settings.json"))).toBe(true);
  });

  it("marks legacy ready installs as onboarding-complete on first bootstrap", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, ".env"),
      [
        "FEISHU_APP_ID=app_id_123",
        "FEISHU_APP_SECRET=secret_123",
        "BOT_LLM_API_KEY=llm-key"
      ].join("\n"),
      "utf8"
    );

    const payload = buildBootstrapPayload();

    expect(payload.onboarding.complete).toBe(true);
    expect(payload.settings.ui.onboardingCompleted).toBe(true);
    expect(payload.settings.ui.lastVisitedSection).toBe("thread");
  });

  it("surfaces capability availability metadata from the current env", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: {
        ...initial.env,
        BOT_LLM_API_KEY: "llm-key",
        DIAGNOSTIC_HTTP_BASE_URL: "https://diagnostics.example.com",
        BRAVE_SEARCH_API_KEY: "brave-key",
        BOT_CAPABILITY_WEB_SEARCH: "true",
        BOT_CAPABILITY_VOICE_REPLY: "true",
        BOT_CAPABILITY_VISION: "true"
      },
      settings: initial.settings
    });

    const capabilities = Object.fromEntries(payload.catalogs.capabilities.map((item) => [item.id, item]));
    const diagnosticCapability = payload.catalogs.capabilities.find((item) => item.id.startsWith("component:"));

    expect(diagnosticCapability?.configured).toBe(true);
    expect(diagnosticCapability?.assignable).toBe(true);
    expect(capabilities.webSearch.enabled).toBe(true);
    expect(capabilities.voiceReply.enabled).toBe(true);
    expect(capabilities.vision.enabled).toBe(true);
    expect(capabilities.chat.assignable).toBe(true);
  });

  it("shows a custom diagnostic component only after the user adds metadata", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        components: {
          diagnosticHttp: [
            {
              id: "orders",
              name: "订单诊断",
              command: "/Orders!",
              summary: "订单失败排查接口",
              usageDescription: "用户提到订单失败时，优先调用这个接口。",
              examplePrompts: ["订单诊断帮我看 123456 最近 1h 的失败原因"],
              baseUrl: "",
              token: "",
              caller: "feishu-bot",
              timeoutMs: 20000
            }
          ]
        }
      }
    });

    const capability = payload.catalogs.capabilities.find((item) => item.id === "component:orders");
    expect(capability).toBeTruthy();
    expect(capability?.label).toBe("订单诊断");
    expect(capability?.configured).toBe(false);
    expect(payload.settings.components.diagnosticHttp[0]?.command).toBe("orders");
  });

  it("keeps an empty draft component in settings until the user finishes editing it", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        components: {
          diagnosticHttp: [
            {
              id: "draft-component",
              name: "",
              enabled: false,
              summary: "",
              usageDescription: "",
              examplePrompts: [],
              baseUrl: "",
              token: "",
              caller: "feishu-bot",
              timeoutMs: 20000
            }
          ]
        }
      }
    });

    expect(payload.settings.components.diagnosticHttp).toHaveLength(1);
    expect(payload.settings.components.diagnosticHttp[0]?.id).toBe("draft-component");
    expect(payload.catalogs.capabilities.some((item) => item.id === "component:draft-component")).toBe(false);
  });

  it("surfaces each custom component as an independent assignable capability", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        components: {
          diagnosticHttp: [
            {
              id: "orders",
              name: "订单诊断",
              summary: "订单失败排查",
              usageDescription: "处理订单失败和履约异常。",
              examplePrompts: ["订单诊断帮我看 uid 123456 最近 1h 的失败原因"],
              baseUrl: "https://orders.example.com",
              token: "",
              caller: "feishu-bot",
              timeoutMs: 20000
            },
            {
              id: "payments",
              name: "支付诊断",
              summary: "支付失败排查",
              usageDescription: "处理支付失败和扣款超时。",
              examplePrompts: ["支付诊断帮我看 uid 123456 最近 1h 的失败原因"],
              baseUrl: "https://payments.example.com",
              token: "",
              caller: "feishu-bot",
              timeoutMs: 20000
            }
          ]
        }
      }
    });

    const capabilityIDs = payload.catalogs.capabilities.map((item) => item.id);
    expect(capabilityIDs).toContain("component:orders");
    expect(capabilityIDs).toContain("component:payments");
  });

  it("keeps configured components visible but non-assignable when the component switch is off", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        components: {
          diagnosticHttp: [
            {
              id: "orders",
              name: "订单组件",
              enabled: false,
              summary: "订单失败排查",
              usageDescription: "处理订单失败和履约异常。",
              examplePrompts: ["订单组件帮我看 uid 123456 最近 1h 的失败原因"],
              baseUrl: "https://orders.example.com",
              token: "",
              caller: "feishu-bot",
              timeoutMs: 20000
            }
          ]
        }
      }
    });

    const capability = payload.catalogs.capabilities.find((item) => item.id === "component:orders");
    expect(capability?.configured).toBe(true);
    expect(capability?.enabled).toBe(false);
    expect(capability?.assignable).toBe(false);
  });

  it("persists custom help content in console settings", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        help: {
          title: "订单助手帮助",
          summary: "优先说明订单排障入口",
          newCommandDescription: "开始一个新话题，并清空聊天上下文。",
          capabilityOrderMode: "component_first",
          examplePrompts: ["/trace trace-123456", "/chat 帮我总结一下今天的问题"],
          notes: ["私聊没命中命令时会自动进入聊天模式。"]
        }
      }
    });

    expect(payload.settings.help).toMatchObject({
      title: "订单助手帮助",
      summary: "优先说明订单排障入口",
      newCommandDescription: "开始一个新话题，并清空聊天上下文。",
      capabilityOrderMode: "component_first"
    });
    const settingsFile = JSON.parse(fs.readFileSync(path.join(home, "console-settings.json"), "utf8"));
    expect(settingsFile.help.title).toBe("订单助手帮助");
    expect(settingsFile.help.newCommandDescription).toBe("开始一个新话题，并清空聊天上下文。");
    expect(settingsFile.help.capabilityOrderMode).toBe("component_first");
  });

  it("persists help capability ordering even without custom copy", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        help: {
          capabilityOrderMode: "component_first"
        }
      }
    });

    expect(payload.settings.help).toMatchObject({
      capabilityOrderMode: "component_first"
    });
    const settingsFile = JSON.parse(fs.readFileSync(path.join(home, "console-settings.json"), "utf8"));
    expect(settingsFile.help.capabilityOrderMode).toBe("component_first");
  });

  it("persists processing reaction settings in console settings", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        feedback: {
          processingReaction: {
            enabled: false,
            emoji: "Keyboard"
          }
        }
      }
    });

    expect(payload.settings.feedback.processingReaction).toMatchObject({
      enabled: false,
      emoji: "Keyboard"
    });
    const settingsFile = JSON.parse(fs.readFileSync(path.join(home, "console-settings.json"), "utf8"));
    expect(settingsFile.feedback.processingReaction.enabled).toBe(false);
    expect(settingsFile.feedback.processingReaction.emoji).toBe("Keyboard");
  });

  it("persists built-in ability help descriptions in console settings", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        capabilityCards: {
          webSearch: {
            helpDescription: "可以联网搜索公开资料后再给出整理结果。"
          },
          voiceReply: {
            helpDescription: "支持把回复生成语音返回。"
          },
          vision: {
            helpDescription: ""
          }
        }
      }
    });

    expect(payload.settings.capabilityCards.webSearch.helpDescription).toBe("可以联网搜索公开资料后再给出整理结果。");
    expect(payload.settings.capabilityCards.voiceReply.helpDescription).toBe("支持把回复生成语音返回。");
    const settingsFile = JSON.parse(fs.readFileSync(path.join(home, "console-settings.json"), "utf8"));
    expect(settingsFile.capabilityCards.webSearch.helpDescription).toBe("可以联网搜索公开资料后再给出整理结果。");
  });

  it("marks runtime env edits as requiring restart", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const nextEnv = {
      ...initial.env,
      FEISHU_APP_ID: "app_id_123",
      FEISHU_APP_SECRET: "secret_123",
      BOT_LLM_API_KEY: "llm-key"
    };

    const payload = saveDesktopConfig({
      env: nextEnv,
      settings: initial.settings
    });

    expect(payload.restartRequired).toBe(true);
    expect(payload.onboarding.complete).toBe(true);
    const envFile = fs.readFileSync(path.join(home, ".env"), "utf8");
    expect(envFile).toContain("FEISHU_APP_ID=app_id_123");
  });

  it("imports diagnostic component config into env fields and metadata", () => {
    const result = importDiagnosticComponentConfig({
      text: JSON.stringify({
        schema: "smartkit-provider-bundle/v1",
        provider: {
          id: "smartkit",
          name: "SmartKit",
          description: "订单链路排障接口",
          base_url: "https://smartkit.example.com"
        },
        interfaces: [
          {
            schema: "diagnostic-bridge/v1",
            name: "SmartKit Bridge",
            base_url: "https://smartkit.example.com",
            purpose: "处理 trace / uid 的排障问题",
            examples: ["查一下 trace 123456"],
            auth: {
              type: "bearer",
              required: true,
              token: "bridge-token"
            },
            headers: {
              "X-Bridge-Caller": "feishu-bot"
            }
          }
        ],
        targets: {
          feishu_bot_desktop: {
            env: {
              DIAGNOSTIC_HTTP_BASE_URL: "https://diagnostics.example.com",
              DIAGNOSTIC_HTTP_TOKEN: "bridge-token",
              DIAGNOSTIC_HTTP_CALLER: "feishu-bot",
              DIAGNOSTIC_HTTP_TIMEOUT_MS: "20000"
            }
          }
        }
      })
    });

    expect(result.env).toMatchObject({
      DIAGNOSTIC_HTTP_BASE_URL: "https://diagnostics.example.com",
      DIAGNOSTIC_HTTP_TOKEN: "bridge-token",
      DIAGNOSTIC_HTTP_CALLER: "feishu-bot",
      DIAGNOSTIC_HTTP_TIMEOUT_MS: "20000"
    });
    expect(result.component).toMatchObject({
      name: "SmartKit",
      summary: "订单链路排障接口",
      usageDescription: "处理 trace / uid 的排障问题",
      examplePrompts: ["查一下 trace 123456"]
    });
  });

  it("rejects direct bridge config payloads", () => {
    expect(() => importDiagnosticComponentConfig({
      text: JSON.stringify({
        schema: "diagnostic-bridge/v1",
        base_url: "https://diagnostics.example.com"
      })
    })).toThrow(/http-component-bundle\/v1/);
  });

  it("tests diagnostic component connectivity against bridge health", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "ok",
        data: {
          providers: {
            tls_logs: { configured: true }
          }
        }
      })
    }) as typeof fetch;

    const result = await testDiagnosticComponentConnectivity({
      env: {
        DIAGNOSTIC_HTTP_BASE_URL: "https://diagnostics.example.com",
        DIAGNOSTIC_HTTP_TOKEN: "bridge-token",
        DIAGNOSTIC_HTTP_CALLER: "feishu-bot",
        DIAGNOSTIC_HTTP_TIMEOUT_MS: "1000"
      }
    });

    expect(result.kind).toBe("diagnosticHttp");
    expect(result.detail).toContain("/api/bridge/health");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("persists permissions without forcing backend restart or resetting onboarding UI state", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: initial.env,
      settings: {
        ...initial.settings,
        ui: {
          onboardingCompleted: true,
          lastVisitedSection: "users",
          feishuTestReceiveId: "oc_test",
          feishuTestReceiveIdType: "chat_id"
        },
        permissions: {
          defaultMode: "restricted",
          groups: [
            {
              id: "oc_123",
              name: "SRE Oncall",
              mode: "allow",
              note: "ops",
              capabilities: {
                chat: true,
                diagnosticHttp: true,
                webSearch: false,
                voiceReply: false,
                vision: true
              }
            }
          ],
          users: []
        }
      }
    });

    expect(payload.restartRequired).toBe(false);
    expect(payload.settings.permissions.defaultMode).toBe("restricted");
    expect(payload.settings.permissions.groups).toHaveLength(1);
    expect(payload.settings.ui.onboardingCompleted).toBe(true);
    expect(payload.settings.ui.lastVisitedSection).toBe("users");
    expect(payload.settings.ui.feishuTestReceiveId).toBe("oc_test");
    expect(payload.settings.ui.feishuTestReceiveIdType).toBe("chat_id");
    const settingsFile = JSON.parse(fs.readFileSync(path.join(home, "console-settings.json"), "utf8"));
    expect(settingsFile.permissions.groups[0].id).toBe("oc_123");
    expect(settingsFile.ui.onboardingCompleted).toBe(true);
    expect(settingsFile.ui.feishuTestReceiveId).toBe("oc_test");
  });

  it("lists recent threads from the local session database in updated order", async () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;
    buildBootstrapPayload();

    const dbPath = path.join(home, "data", "feishu-bot.sqlite");
    const store = new SessionStore(dbPath);
    store.upsertSession({
      sessionId: "session-older",
      conversationId: "local:p2p:chat-1:user-1",
      requesterId: "user-1",
      scope: "p2p",
      chatId: "chat-1",
      chatType: "p2p",
      anchorMessageId: "msg-1",
      lastMessageId: "msg-1",
      threadId: null,
      lastQuestion: "第一条消息",
      jobStatus: null,
      notificationSentAt: null,
      updatedAt: "2026-03-10T05:00:00.000Z"
    }, ["p2p:chat-1:user-1"]);
    store.upsertSession({
      sessionId: "session-newer",
      conversationId: "local:group:chat-group:thread-1",
      requesterId: "user-2",
      scope: "group",
      chatId: "chat-group",
      chatType: "group",
      anchorMessageId: "msg-2",
      lastMessageId: "msg-2",
      threadId: "thread-1",
      lastQuestion: "@bot 帮我汇总一下今天的值班情况",
      jobId: "job-9",
      jobStatus: "accepted",
      notificationSentAt: null,
      updatedAt: "2026-03-10T06:00:00.000Z"
    }, ["group:chat-group:thread-1"]);
    store.close();

    const threads = await listRecentThreads();

    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({
      id: "session-newer",
      title: "未命名群聊",
      preview: "@bot 帮我汇总一下今天的值班情况",
      status: "accepted"
    });
    expect(threads[1]).toMatchObject({
      id: "session-older",
      title: "未命名用户",
      preview: "第一条消息",
      status: "completed"
    });
  });

  it("lists stored thread messages and falls back to the latest question for legacy sessions", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;
    buildBootstrapPayload();

    const dbPath = path.join(home, "data", "feishu-bot.sqlite");
    const store = new SessionStore(dbPath);
    store.upsertSession({
      sessionId: "session-1",
      conversationId: "local:p2p:chat-1:user-1",
      requesterId: "user-1",
      requesterName: "张三",
      scope: "p2p",
      chatId: "chat-1",
      chatName: null,
      chatType: "p2p",
      anchorMessageId: "msg-1",
      lastMessageId: "msg-2",
      threadId: null,
      lastQuestion: "你好",
      jobStatus: null,
      notificationSentAt: null,
      updatedAt: "2026-03-10T05:00:00.000Z"
    }, ["p2p:chat-1:user-1"]);
    store.appendSessionMessages("session-1", [
      {
        sessionId: "session-1",
        role: "user",
        senderId: "user-1",
        senderName: "张三",
        messageId: "msg-1",
        content: "你好",
        createdAt: "2026-03-10T05:00:00.000Z"
      },
      {
        sessionId: "session-1",
        role: "assistant",
        senderName: "feishu-bot",
        messageId: "msg-2",
        content: "你好，我在。",
        createdAt: "2026-03-10T05:00:01.000Z"
      }
    ]);
    store.upsertSession({
      sessionId: "session-legacy",
      conversationId: "local:p2p:chat-2:user-2",
      requesterId: "user-2",
      requesterName: "李四",
      scope: "p2p",
      chatId: "chat-2",
      chatName: null,
      chatType: "p2p",
      anchorMessageId: "msg-3",
      lastMessageId: "msg-3",
      threadId: null,
      lastQuestion: "旧会话消息",
      jobStatus: null,
      notificationSentAt: null,
      updatedAt: "2026-03-10T05:10:00.000Z"
    }, ["p2p:chat-2:user-2"]);
    store.close();

    expect(listThreadMessages({ sessionId: "session-1" })).toEqual([
      {
        id: "1",
        role: "user",
        senderName: "张三",
        content: "你好",
        createdAt: "2026-03-10T05:00:00.000Z"
      },
      {
        id: "2",
        role: "assistant",
        senderName: "feishu-bot",
        content: "你好，我在。",
        createdAt: "2026-03-10T05:00:01.000Z"
      }
    ]);

    expect(listThreadMessages({ sessionId: "session-legacy" })).toEqual([
      {
        id: "session-legacy:fallback",
        role: "user",
        senderName: "李四",
        content: "旧会话消息",
        createdAt: "2026-03-10T05:10:00.000Z"
      }
    ]);
  });

  it("keeps locally archived thread messages in chronological order when Feishu timestamps are stored as millis", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;
    buildBootstrapPayload();

    const dbPath = path.join(home, "data", "feishu-bot.sqlite");
    const store = new SessionStore(dbPath);
    store.upsertSession({
      sessionId: "session-1",
      conversationId: "local:p2p:chat-1:user-1",
      requesterId: "user-1",
      requesterName: "张三",
      scope: "p2p",
      chatId: "chat-1",
      chatName: null,
      chatType: "p2p",
      anchorMessageId: "msg-1",
      lastMessageId: "msg-2",
      threadId: null,
      lastQuestion: "在吗",
      jobStatus: null,
      notificationSentAt: null,
      updatedAt: "2026-03-10T09:56:31.382Z"
    }, ["p2p:chat-1:user-1"]);
    store.appendSessionMessages("session-1", [
      {
        sessionId: "session-1",
        role: "user",
        senderId: "user-1",
        senderName: "张三",
        messageId: "msg-1",
        content: "在吗",
        createdAt: "1773136588931"
      },
      {
        sessionId: "session-1",
        role: "assistant",
        senderName: "feishu-bot",
        messageId: "msg-2",
        content: "我在",
        createdAt: "2026-03-10T09:56:31.382Z"
      }
    ]);
    store.close();

    expect(listThreadMessages({ sessionId: "session-1" })).toEqual([
      {
        id: "1",
        role: "user",
        senderName: "张三",
        content: "在吗",
        createdAt: "2026-03-10T09:56:28.931Z"
      },
      {
        id: "2",
        role: "assistant",
        senderName: "feishu-bot",
        content: "我在",
        createdAt: "2026-03-10T09:56:31.382Z"
      }
    ]);
  });
});
