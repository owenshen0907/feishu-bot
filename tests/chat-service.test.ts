import { describe, expect, it } from "vitest";
import { ChatService, FakeChatGateway } from "../src/chat-service.js";
import { SessionStore } from "../src/session-store.js";

const llmConfig = {
  enabled: true,
  apiKey: "test-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutMs: 1000
};

const chatConfig = {
  enabled: true,
  memoryMessages: 6,
  systemPrompt: "你是测试助手。"
};

describe("ChatService", () => {
  it("keeps chat memory isolated per user", async () => {
    const store = new SessionStore(":memory:");
    const gateway = new FakeChatGateway((messages) => `收到${messages.at(-1)?.content}`);
    const service = new ChatService(store, llmConfig, chatConfig, gateway);

    const reply1 = await service.reply({ userId: "user-1", message: "你好" });
    const reply2 = await service.reply({ userId: "user-2", message: "你是谁" });

    expect(reply1.answer).toContain("你好");
    expect(reply2.answer).toContain("你是谁");
    expect(service.getMemoryCount("user-1")).toBe(2);
    expect(service.getMemoryCount("user-2")).toBe(2);
    store.close();
  });

  it("can clear memory without affecting other users", async () => {
    const store = new SessionStore(":memory:");
    const gateway = new FakeChatGateway(() => "ok");
    const service = new ChatService(store, llmConfig, chatConfig, gateway);

    await service.reply({ userId: "user-1", message: "A" });
    await service.reply({ userId: "user-2", message: "B" });

    const deleted = service.clearMemory("user-1");
    expect(deleted).toBe(2);
    expect(service.getMemoryCount("user-1")).toBe(0);
    expect(service.getMemoryCount("user-2")).toBe(2);
    store.close();
  });
});
