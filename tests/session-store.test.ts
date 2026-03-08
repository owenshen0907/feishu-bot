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
});
