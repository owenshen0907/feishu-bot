import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/session-store.js";

const stores: SessionStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
});

describe("SessionStore", () => {
  it("stores aliases and retrieves session", () => {
    const store = new SessionStore(":memory:");
    stores.push(store);
    store.upsertSession(
      {
        sessionId: "session-1",
        conversationId: "conv-1",
        jobId: "job-1",
        requesterId: "user-1",
        scope: "group",
        chatId: "chat-1",
        chatType: "group",
        anchorMessageId: "msg-1",
        lastMessageId: "msg-1",
        threadId: "thread-1",
        lastQuestion: "/trace trace-1",
        jobStatus: "pending",
        notificationSentAt: null,
        updatedAt: new Date().toISOString()
      },
      ["group:chat-1:msg-1", "group:chat-1:thread-1"]
    );

    const session = store.getSessionByAlias("group:chat-1:thread-1");
    expect(session?.conversationId).toBe("conv-1");
    expect(store.listSessionsAwaitingJobResult()).toHaveLength(1);
  });

  it("stores chat memory per user and supports clearing", () => {
    const store = new SessionStore(":memory:");
    stores.push(store);
    const now = new Date().toISOString();

    store.appendChatMemory("user-1", [
      { role: "user", content: "你好", createdAt: now },
      { role: "assistant", content: "你好，我在。", createdAt: now }
    ], 10);
    store.appendChatMemory("user-2", [
      { role: "user", content: "只属于 user-2", createdAt: now }
    ], 10);

    expect(store.getChatMemoryCount("user-1")).toBe(2);
    expect(store.getChatMemoryCount("user-2")).toBe(1);
    expect(store.listChatMemory("user-1", 10).map((item) => item.content)).toEqual(["你好", "你好，我在。"]);

    const deleted = store.clearChatMemory("user-1");
    expect(deleted).toBe(2);
    expect(store.getChatMemoryCount("user-1")).toBe(0);
    expect(store.getChatMemoryCount("user-2")).toBe(1);
  });
});
