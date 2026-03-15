import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BotService } from "../src/bot-service.js";
import { StaticDiagnosticGatewayProvider } from "../src/diagnostic-components.js";
import { ConsoleDiagnosticIntentRouter } from "../src/diagnostic-intent-router.js";
import { BotFormatter } from "../src/formatter.js";
import { ConsoleHelpContentProvider } from "../src/help-content.js";
import { JobPoller } from "../src/job-poller.js";
import { InMemoryMessenger } from "../src/adapter/feishu/message-client.js";
import { SessionStore } from "../src/session-store.js";
import type {
  AcceptedPayload,
  BotChatService,
  BridgeEnvelope,
  CapabilityAccessResult,
  CapabilityContext,
  CapabilityGate,
  CapabilityID,
  DiagnosisPayload,
  FeishuReceiveMessageEvent,
  JobPayload,
  SmartKitGateway
} from "../src/types.js";

class FakeSmartKit implements SmartKitGateway {
  public followupCalls: string[] = [];
  public traceCalls = 0;
  public uidCalls = 0;
  private readonly diagnosis: DiagnosisPayload = {
    target_type: "trace",
    target_id: "trace-123",
    status: "completed",
    structured_result: { summary: "诊断完成" },
    canonical_summary: "trace-123 关联请求在网关超时。",
    probable_causes: ["下游超时"],
    evidence: [{ title: "gateway", detail: "出现 timeout", severity: "error" }],
    recommended_actions: ["检查下游依赖"],
    links: [{ label: "trace", url: "https://example.com" }],
    conversation_id: "conv-1",
    job_id: null
  };

  async analyzeTrace(): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>> {
    this.traceCalls += 1;
    return envelope("ok", this.diagnosis, 200);
  }

  async analyzeUid(): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>> {
    this.uidCalls += 1;
    return envelope("accepted", {
      target_type: "uid",
      target_id: "123456",
      status: "pending",
      conversation_id: "conv-2",
      job_id: "job-2"
    }, 202);
  }

  async getJob(jobId: string): Promise<BridgeEnvelope<JobPayload>> {
    return envelope("ok", {
      job_id: jobId,
      conversation_id: "conv-2",
      target_type: "uid",
      target_id: "123456",
      status: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      request_payload: { uid: "123456" },
      result_payload: {
        ...this.diagnosis,
        target_type: "uid",
        target_id: "123456",
        conversation_id: "conv-2"
      }
    }, 200);
  }

  async followup(input: { conversationId: string; message: string }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>> {
    this.followupCalls.push(`${input.conversationId}:${input.message}`);
    return envelope("ok", {
      ...this.diagnosis,
      canonical_summary: "已展开原因：下游超时重试后仍失败。"
    }, 200);
  }

  async getConversation() {
    throw new Error("not implemented in test");
  }
}

class FakeChatService implements BotChatService {
  public messages: string[] = [];
  private readonly memory = new Map<string, string[]>();

  constructor(private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  async reply(input: { userId: string; message: string }) {
    this.messages.push(`${input.userId}:${input.message}`);
    const history = this.memory.get(input.userId) ?? [];
    history.push(input.message, `回答:${input.message}`);
    this.memory.set(input.userId, history);
    return {
      answer: `我记住了：${input.message}`,
      memoryCount: history.length
    };
  }

  clearMemory(userId: string): number {
    const count = this.getMemoryCount(userId);
    this.memory.delete(userId);
    return count;
  }

  getMemoryCount(userId: string): number {
    return this.memory.get(userId)?.length ?? 0;
  }
}

class FakeCapabilityGate implements CapabilityGate {
  constructor(private readonly states: Partial<Record<CapabilityID, boolean>>) {}

  canUse(capabilityID: CapabilityID, _context: CapabilityContext): CapabilityAccessResult {
    const allowed = capabilityID.startsWith("component:")
      ? (this.states[capabilityID] ?? this.states.diagnosticHttp ?? true)
      : (this.states[capabilityID] ?? true);
    return {
      allowed,
      source: "user",
      reason: allowed ? "已开启" : "当前对象尚未开启该能力。"
    };
  }
}

function envelope<T>(code: string, data: T, httpStatus: number): BridgeEnvelope<T> {
  return {
    code,
    message: code,
    data,
    trace_id: "trace-request",
    http_status: httpStatus
  };
}

function buildEvent(text: string, overrides: Partial<FeishuReceiveMessageEvent> = {}): FeishuReceiveMessageEvent {
  return {
    event_id: overrides.event_id ?? `evt-${Math.random().toString(36).slice(2)}`,
    sender: {
      sender_id: {
        user_id: overrides.sender?.sender_id?.user_id ?? "user-1"
      },
      sender_type: "user"
    },
    message: {
      message_id: overrides.message?.message_id ?? `msg-${Math.random().toString(36).slice(2)}`,
      create_time: overrides.message?.create_time ?? new Date().toISOString(),
      chat_id: overrides.message?.chat_id ?? "chat-1",
      chat_type: overrides.message?.chat_type ?? "p2p",
      message_type: "text",
      content: JSON.stringify({ text }),
      mentions: overrides.message?.mentions ?? []
    }
  };
}

function renderReplyText(messenger: InMemoryMessenger, index: number): string {
  const reply = messenger.replies[index]?.reply;
  if (!reply) {
    return "";
  }
  return reply.kind === "card" ? JSON.stringify(reply.card) : reply.text;
}

const formatter = new BotFormatter({
  enabled: false,
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutMs: 1000
});

describe("BotService", () => {
  it("handles trace query and returns diagnosis card", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const service = new BotService(store, new FakeSmartKit(), new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/trace trace-123"));

    expect(messenger.replies).toHaveLength(1);
    expect(messenger.replies[0]?.reply.kind).toBe("card");
    expect(renderReplyText(messenger, 0)).toContain("Trace诊断结果");
    expect(renderReplyText(messenger, 0)).toContain("结论");
    expect(renderReplyText(messenger, 0)).toContain("证据摘录");
    expect(messenger.processingEvents.map((item) => item.type)).toEqual(["add", "remove"]);
    expect(store.listSessionsAwaitingJobResult()).toHaveLength(0);
    store.close();
  });

  it("falls back to local chat in private chat", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const chatService = new FakeChatService();
    const service = new BotService(store, new FakeSmartKit(), chatService, messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("帮我总结一下今天的工作"));

    expect(chatService.messages).toContain("user-1:帮我总结一下今天的工作");
    expect(messenger.replies[0]?.reply.kind).toBe("text");
    expect(renderReplyText(messenger, 0)).toContain("我记住了");
    expect(store.getSessionByAlias("p2p:chat-1:user-1")).toMatchObject({
      conversationId: "local:p2p:chat-1:user-1",
      lastQuestion: "帮我总结一下今天的工作",
      scope: "p2p"
    });
    store.close();
  });

  it("persists help requests into the local thread store", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const service = new BotService(store, new FakeSmartKit(), new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/help"));

    expect(renderReplyText(messenger, 0)).toContain("Feishu 诊断助手");
    expect(store.getSessionByAlias("p2p:chat-1:user-1")).toMatchObject({
      conversationId: "local:p2p:chat-1:user-1",
      lastQuestion: "/help",
      scope: "p2p"
    });
    store.close();
  });

  it("uses configured help content when replying to /help", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-help-"));
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {},
        feedback: {
          processingReaction: {
            enabled: true,
            emoji: "OnIt"
          }
        },
        help: {
          title: "订单助手帮助",
          summary: "这里优先说明订单排障和聊天入口。",
          newCommandDescription: "开始新话题并清空聊天上下文。",
          capabilityOrderMode: "builtin_first",
          examplePrompts: ["/trace trace-123456", "订单诊断帮我看 123456 最近 1h"],
          notes: ["私聊没命中命令时会自动进入聊天模式。"]
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const formatterWithHelp = new BotFormatter({
        enabled: false,
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        timeoutMs: 1000
      }, new ConsoleHelpContentProvider(process.env));
      const service = new BotService(store, new FakeSmartKit(), new FakeChatService(), messenger, formatterWithHelp, "smartkit-bot");

      await service.handleEvent(buildEvent("/help"));

      expect(renderReplyText(messenger, 0)).toContain("订单助手帮助");
      expect(renderReplyText(messenger, 0)).toContain("订单排障和聊天入口");
      expect(renderReplyText(messenger, 0)).toContain("/new");
      expect(renderReplyText(messenger, 0)).toContain("开始新话题并清空聊天上下文");
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("uses configured built-in ability descriptions in /help", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-ability-help-"));
    fs.writeFileSync(
      path.join(tempHome, ".env"),
      [
        "BOT_LLM_API_KEY=test-key",
        "BOT_LLM_BASE_URL=https://api.example.com/v1",
        "BOT_LLM_MODEL=test-model",
        "BRAVE_SEARCH_API_KEY=brave-key",
        "BOT_CAPABILITY_WEB_SEARCH=true"
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {},
        capabilityCards: {
          webSearch: {
            helpDescription: "可以联网搜索公开资料后再给出整理结果。"
          }
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const service = new BotService(store, new FakeSmartKit(), new FakeChatService(), messenger, formatter, "smartkit-bot");

      await service.handleEvent(buildEvent("/help"));

      expect(renderReplyText(messenger, 0)).toContain("联网搜索");
      expect(renderReplyText(messenger, 0)).toContain("可以联网搜索公开资料后再给出整理结果");
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("includes valid component shortcut commands in /help", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const orders = new FakeSmartKit();
    const provider = new StaticDiagnosticGatewayProvider(
      [
        {
          id: "orders",
          name: "订单诊断",
          command: "orders",
          enabled: true,
          summary: "排查订单失败和履约异常。",
          usageDescription: "",
          examplePrompts: [],
          baseUrl: "https://orders.example.com",
          token: "",
          caller: "feishu-bot",
          timeoutMs: 20000
        }
      ],
      new Map([["orders", orders]])
    );
    const router = new ConsoleDiagnosticIntentRouter(process.env);
    const service = new BotService(store, provider, new FakeChatService(), messenger, formatter, "smartkit-bot", undefined, undefined, router);

    await service.handleEvent(buildEvent("/help"));

    expect(renderReplyText(messenger, 0)).toContain("/orders");
    expect(renderReplyText(messenger, 0)).toContain("订单诊断");
    store.close();
  });

  it("supports rendering component help before built-in abilities", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-help-order-"));
    fs.writeFileSync(
      path.join(tempHome, ".env"),
      [
        "BOT_LLM_API_KEY=test-key",
        "BOT_LLM_BASE_URL=https://api.example.com/v1",
        "BOT_LLM_MODEL=test-model",
        "BRAVE_SEARCH_API_KEY=brave-key",
        "BOT_CAPABILITY_WEB_SEARCH=true"
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {},
        capabilityCards: {
          webSearch: {
            helpDescription: "可以联网搜索公开资料后再给出整理结果。"
          }
        },
        help: {
          capabilityOrderMode: "component_first"
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const orders = new FakeSmartKit();
      const provider = new StaticDiagnosticGatewayProvider(
        [
          {
            id: "orders",
            name: "订单诊断",
            command: "orders",
            enabled: true,
            summary: "排查订单失败和履约异常。",
            usageDescription: "",
            examplePrompts: [],
            baseUrl: "https://orders.example.com",
            token: "",
            caller: "feishu-bot",
            timeoutMs: 20000
          }
        ],
        new Map([["orders", orders]])
      );
      const router = new ConsoleDiagnosticIntentRouter(process.env);
      const service = new BotService(store, provider, new FakeChatService(false), messenger, formatter, "smartkit-bot", undefined, undefined, router);

      await service.handleEvent(buildEvent("/help"));

      const rendered = renderReplyText(messenger, 0);
      expect(rendered).toContain("订单诊断");
      expect(rendered).toContain("联网搜索");
      expect(rendered.indexOf("订单诊断")).toBeLessThan(rendered.indexOf("联网搜索"));
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("skips processing reactions when feedback is disabled", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger({ processingReactionEnabled: false });
    const service = new BotService(store, new FakeSmartKit(), new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/help"));

    expect(messenger.processingEvents).toEqual([]);
    expect(messenger.replies).toHaveLength(1);
    store.close();
  });

  it("degrades trace commands when smartkit is not configured", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const service = new BotService(store, undefined, new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/trace trace-123"));

    expect(renderReplyText(messenger, 0)).toContain("当前还没有可用的自定义 HTTP 组件");
    expect(renderReplyText(messenger, 0)).toContain("普通机器人");
    store.close();
  });

  it("blocks smartkit commands when the current object is not authorized", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const smartkit = new FakeSmartKit();
    const service = new BotService(
      store,
      smartkit,
      new FakeChatService(),
      messenger,
      formatter,
      "smartkit-bot",
      undefined,
      new FakeCapabilityGate({ diagnosticHttp: false })
    );

    await service.handleEvent(buildEvent("/trace trace-123"));

    expect(smartkit.traceCalls).toBe(0);
    expect(renderReplyText(messenger, 0)).toContain("自定义 HTTP 组件未对当前对象开启");
    store.close();
  });

  it("supports clearing per-user chat memory", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const chatService = new FakeChatService();
    const service = new BotService(store, new FakeSmartKit(), chatService, messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/chat 你好"));
    await service.handleEvent(buildEvent("/memory"));
    await service.handleEvent(buildEvent("/new"));

    expect(renderReplyText(messenger, 1)).toContain("当前聊天记忆");
    expect(renderReplyText(messenger, 2)).toContain("聊天记忆已清空");
    expect(chatService.getMemoryCount("user-1")).toBe(0);
    store.close();
  });

  it("blocks chat commands when the current object is not authorized", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const chatService = new FakeChatService();
    const service = new BotService(
      store,
      new FakeSmartKit(),
      chatService,
      messenger,
      formatter,
      "smartkit-bot",
      undefined,
      new FakeCapabilityGate({ chat: false })
    );

    await service.handleEvent(buildEvent("/chat 你好"));

    expect(chatService.messages).toHaveLength(0);
    expect(renderReplyText(messenger, 0)).toContain("普通聊天未对当前对象开启");
    store.close();
  });

  it("requires mention or slash in group chat", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const service = new BotService(store, new FakeSmartKit(), new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("查下 trace trace-123", {
      message: {
        message_id: "msg-1",
        create_time: new Date().toISOString(),
        chat_id: "chat-group",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "查下 trace trace-123" }),
        mentions: []
      }
    }));

    expect(messenger.replies).toHaveLength(0);
    store.close();
  });

  it("routes followup through existing conversation", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const smartkit = new FakeSmartKit();
    const service = new BotService(store, smartkit, new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/trace trace-123"));
    await service.handleEvent(buildEvent("展开原因"));

    expect(smartkit.followupCalls).toContain("conv-1:展开原因");
    expect(renderReplyText(messenger, 1)).toContain("已展开原因");
    store.close();
  });

  it("falls back to chat for plain private messages even when a diagnostic session exists", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const smartkit = new FakeSmartKit();
    const chatService = new FakeChatService();
    const service = new BotService(store, smartkit, chatService, messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/trace trace-123"));
    await service.handleEvent(buildEvent("你太棒了"));

    expect(smartkit.followupCalls).toHaveLength(0);
    expect(chatService.messages).toContain("user-1:你太棒了");
    expect(renderReplyText(messenger, 1)).toContain("我记住了：你太棒了");
    store.close();
  });

  it("polls async jobs and pushes completion card", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const smartkit = new FakeSmartKit();
    const service = new BotService(store, smartkit, new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/uid 123456 1h"));

    const poller = new JobPoller(store, smartkit, messenger, formatter, 1000, "smartkit-bot");
    await poller.tick();

    expect(messenger.replies).toHaveLength(2);
    expect(renderReplyText(messenger, 0)).toContain("后台诊断已提交");
    expect(renderReplyText(messenger, 1)).toContain("任务结果诊断结果");
    expect(store.listSessionsAwaitingJobResult()).toHaveLength(0);
    store.close();
  });

  it("skips async completion pushes after a capability is turned off", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const smartkit = new FakeSmartKit();
    const service = new BotService(store, smartkit, new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/uid 123456 1h"));

    const poller = new JobPoller(
      store,
      smartkit,
      messenger,
      formatter,
      1000,
      "smartkit-bot",
      new FakeCapabilityGate({ diagnosticHttp: false })
    );
    await poller.tick();

    expect(messenger.replies).toHaveLength(1);
    expect(renderReplyText(messenger, 0)).toContain("后台诊断已提交");
    expect(store.listSessionsAwaitingJobResult()).toHaveLength(0);
    store.close();
  });

  it("routes metadata-matched private chat to the diagnostic component", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-intent-"));
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {
          diagnosticHttp: {
            name: "订单诊断",
            command: "orders",
            summary: "用于订单失败与支付超时排查",
            usageDescription: "当用户提到订单失败、支付超时时，优先尝试 uid 或 trace 排查。",
            examplePrompts: ["订单诊断帮我看 123456 最近 1h 的失败原因"]
          }
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const smartkit = new FakeSmartKit();
      const router = new ConsoleDiagnosticIntentRouter(process.env);
      const service = new BotService(store, smartkit, new FakeChatService(), messenger, formatter, "smartkit-bot", undefined, undefined, router);

      await service.handleEvent(buildEvent("订单诊断帮我看 123456 最近1h 的失败原因"));

      expect(smartkit.uidCalls).toBe(1);
      expect(renderReplyText(messenger, 0)).toContain("UID 后台诊断已提交");
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("still inspects private followups for diagnostic intent before defaulting to chat", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-followup-intent-"));
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {
          diagnosticHttp: {
            name: "订单诊断",
            command: "orders",
            summary: "用于订单失败与支付超时排查",
            usageDescription: "当用户提到订单失败、支付超时时，优先尝试 uid 或 trace 排查。",
            examplePrompts: ["订单诊断帮我看 123456 最近 1h 的失败原因"]
          }
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const smartkit = new FakeSmartKit();
      const chatService = new FakeChatService();
      const router = new ConsoleDiagnosticIntentRouter(process.env);
      const service = new BotService(store, smartkit, chatService, messenger, formatter, "smartkit-bot", undefined, undefined, router);

      await service.handleEvent(buildEvent("先随便聊两句"));
      await service.handleEvent(buildEvent("订单诊断帮我看 123456 最近1h 的失败原因"));

      expect(chatService.messages).toContain("user-1:先随便聊两句");
      expect(smartkit.uidCalls).toBe(1);
      expect(renderReplyText(messenger, 1)).toContain("UID 后台诊断已提交");
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("routes an explicit component shortcut command to the selected component", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-component-command-"));
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {
          diagnosticHttp: {
            id: "orders",
            name: "订单诊断",
            command: "orders",
            summary: "用于订单失败与支付超时排查",
            usageDescription: "当用户提到订单失败、支付超时时，优先尝试 uid 或 trace 排查。",
            examplePrompts: ["订单诊断帮我看 uid 123456 最近 1h 的失败原因"],
            baseUrl: "https://orders.example.com",
            token: "",
            caller: "feishu-bot",
            timeoutMs: 20000
          }
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const smartkit = new FakeSmartKit();
      const provider = new StaticDiagnosticGatewayProvider(
        new ConsoleDiagnosticIntentRouter(process.env).getComponents(),
        new Map([["orders", smartkit]])
      );
      const router = new ConsoleDiagnosticIntentRouter(process.env);
      const service = new BotService(store, provider, new FakeChatService(), messenger, formatter, "smartkit-bot", undefined, undefined, router);

      await service.handleEvent(buildEvent("/orders uid 123456 1h"));

      expect(smartkit.uidCalls).toBe(1);
      expect(renderReplyText(messenger, 0)).toContain("UID 后台诊断已提交");
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("asks for trace or uid when metadata matched but target is missing", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-intent-"));
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {
          diagnosticHttp: {
            name: "订单诊断",
            command: "orders",
            summary: "用于订单失败与支付超时排查",
            usageDescription: "当用户提到订单失败、支付超时时，应该走这个接口。",
            examplePrompts: ["订单诊断帮我看 trace 7f8e9a0b1234"]
          }
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const smartkit = new FakeSmartKit();
      const router = new ConsoleDiagnosticIntentRouter(process.env);
      const service = new BotService(store, smartkit, new FakeChatService(), messenger, formatter, "smartkit-bot", undefined, undefined, router);

      await service.handleEvent(buildEvent("订单诊断帮我看看订单失败原因"));

      expect(smartkit.traceCalls).toBe(0);
      expect(smartkit.uidCalls).toBe(0);
      expect(renderReplyText(messenger, 0)).toContain("订单诊断 还需要更多输入");
      expect(renderReplyText(messenger, 0)).toContain("trace_id");
      expect(renderReplyText(messenger, 0)).toContain("uid");
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("routes to the best matching component when multiple custom components exist", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-intent-multi-"));
    fs.writeFileSync(
      path.join(tempHome, "console-settings.json"),
      JSON.stringify({
        version: 2,
        permissions: { defaultMode: "allow", groups: [], users: [] },
        components: {
          diagnosticHttp: [
            {
              id: "orders",
              name: "订单诊断",
              command: "orders",
              summary: "用于订单失败排查",
              usageDescription: "当用户提到订单失败、履约异常时，优先走这个接口。",
              examplePrompts: ["订单诊断帮我看 123456 最近 1h 的失败原因"],
              baseUrl: "https://orders.example.com",
              token: "",
              caller: "feishu-bot",
              timeoutMs: 20000
            },
            {
              id: "payments",
              name: "支付诊断",
              command: "payments",
              summary: "用于支付失败和扣款超时排查",
              usageDescription: "当用户提到支付失败、扣款超时、退款异常时，应该走这个接口。",
              examplePrompts: ["支付诊断帮我看 uid 123456 最近 1h 的失败原因"],
              baseUrl: "https://payments.example.com",
              token: "",
              caller: "feishu-bot",
              timeoutMs: 20000
            }
          ]
        },
        ui: {}
      }),
      "utf8"
    );

    const previousHome = process.env.FEISHU_BOT_HOME;
    process.env.FEISHU_BOT_HOME = tempHome;
    try {
      const orders = new FakeSmartKit();
      const payments = new FakeSmartKit();
      const provider = new StaticDiagnosticGatewayProvider(
        new ConsoleDiagnosticIntentRouter(process.env).getComponents(),
        new Map([
          ["orders", orders],
          ["payments", payments]
        ])
      );
      const store = new SessionStore(":memory:");
      const messenger = new InMemoryMessenger();
      const router = new ConsoleDiagnosticIntentRouter(process.env);
      const service = new BotService(store, provider, new FakeChatService(), messenger, formatter, "smartkit-bot", undefined, undefined, router);

      await service.handleEvent(buildEvent("支付诊断帮我看 123456 最近1h 的失败原因"));

      expect(orders.uidCalls).toBe(0);
      expect(payments.uidCalls).toBe(1);
      expect(renderReplyText(messenger, 0)).toContain("UID 后台诊断已提交");
      store.close();
    } finally {
      process.env.FEISHU_BOT_HOME = previousHome;
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("asks the user to specify the component when multiple components are available", async () => {
    const orders = new FakeSmartKit();
    const payments = new FakeSmartKit();
    const provider = new StaticDiagnosticGatewayProvider(
      [
        {
          id: "orders",
          name: "订单诊断",
          command: "",
          summary: "",
          usageDescription: "",
          examplePrompts: [],
          baseUrl: "https://orders.example.com",
          token: "",
          caller: "feishu-bot",
          timeoutMs: 20000
        },
        {
          id: "payments",
          name: "支付诊断",
          command: "",
          summary: "",
          usageDescription: "",
          examplePrompts: [],
          baseUrl: "https://payments.example.com",
          token: "",
          caller: "feishu-bot",
          timeoutMs: 20000
        }
      ],
      new Map([
        ["orders", orders],
        ["payments", payments]
      ])
    );
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const service = new BotService(store, provider, new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/trace trace-123"));

    expect(orders.traceCalls).toBe(0);
    expect(payments.traceCalls).toBe(0);
    expect(renderReplyText(messenger, 0)).toContain("多个自定义 HTTP 组件");
    expect(renderReplyText(messenger, 0)).toContain("订单诊断");
    expect(renderReplyText(messenger, 0)).toContain("支付诊断");
    store.close();
  });

  it("ignores duplicated component shortcut commands and falls back to help", async () => {
    const orders = new FakeSmartKit();
    const payments = new FakeSmartKit();
    const provider = new StaticDiagnosticGatewayProvider(
      [
        {
          id: "orders",
          name: "订单诊断",
          command: "orders",
          enabled: true,
          summary: "",
          usageDescription: "",
          examplePrompts: [],
          baseUrl: "https://orders.example.com",
          token: "",
          caller: "feishu-bot",
          timeoutMs: 20000
        },
        {
          id: "payments",
          name: "支付诊断",
          command: "orders",
          enabled: true,
          summary: "",
          usageDescription: "",
          examplePrompts: [],
          baseUrl: "https://payments.example.com",
          token: "",
          caller: "feishu-bot",
          timeoutMs: 20000
        }
      ],
      new Map([
        ["orders", orders],
        ["payments", payments]
      ])
    );
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const router = new ConsoleDiagnosticIntentRouter(process.env);
    const service = new BotService(store, provider, new FakeChatService(), messenger, formatter, "smartkit-bot", undefined, undefined, router);

    await service.handleEvent(buildEvent("/orders uid 123456 1h"));

    expect(orders.uidCalls).toBe(0);
    expect(payments.uidCalls).toBe(0);
    expect(renderReplyText(messenger, 0)).toContain("Feishu 诊断助手");
    store.close();
  });
});
