import { describe, expect, it } from "vitest";
import { BotService } from "../src/bot-service.js";
import { BotFormatter } from "../src/formatter.js";
import { JobPoller } from "../src/job-poller.js";
import { InMemoryMessenger } from "../src/adapter/feishu/message-client.js";
import { SessionStore } from "../src/session-store.js";
import type {
  AcceptedPayload,
  BotChatService,
  BridgeEnvelope,
  DiagnosisPayload,
  FeishuReceiveMessageEvent,
  JobPayload,
  SmartKitGateway
} from "../src/types.js";

class FakeSmartKit implements SmartKitGateway {
  public followupCalls: string[] = [];
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
    return envelope("ok", this.diagnosis, 200);
  }

  async analyzeUid(): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>> {
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

function renderCardText(messenger: InMemoryMessenger, index: number): string {
  return JSON.stringify(messenger.replies[index]?.reply.card);
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
    expect(renderCardText(messenger, 0)).toContain("Trace诊断结果");
    expect(renderCardText(messenger, 0)).toContain("结论");
    expect(renderCardText(messenger, 0)).toContain("证据摘录");
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
    expect(renderCardText(messenger, 0)).toContain("轻量对话助手");
    expect(renderCardText(messenger, 0)).toContain("我记住了");
    store.close();
  });

  it("supports clearing per-user chat memory", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const chatService = new FakeChatService();
    const service = new BotService(store, new FakeSmartKit(), chatService, messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/chat 你好"));
    await service.handleEvent(buildEvent("/memory"));
    await service.handleEvent(buildEvent("/chat-reset"));

    expect(renderCardText(messenger, 1)).toContain("当前聊天记忆");
    expect(renderCardText(messenger, 2)).toContain("聊天记忆已清空");
    expect(chatService.getMemoryCount("user-1")).toBe(0);
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
    expect(renderCardText(messenger, 1)).toContain("已展开原因");
    store.close();
  });

  it("polls async jobs and pushes completion card", async () => {
    const store = new SessionStore(":memory:");
    const messenger = new InMemoryMessenger();
    const smartkit = new FakeSmartKit();
    const service = new BotService(store, smartkit, new FakeChatService(), messenger, formatter, "smartkit-bot");

    await service.handleEvent(buildEvent("/uid 123456 1h"));

    const poller = new JobPoller(store, smartkit, messenger, formatter, 1000);
    await poller.tick();

    expect(messenger.replies).toHaveLength(2);
    expect(renderCardText(messenger, 0)).toContain("后台诊断已提交");
    expect(renderCardText(messenger, 1)).toContain("任务结果诊断结果");
    expect(store.listSessionsAwaitingJobResult()).toHaveLength(0);
    store.close();
  });
});
