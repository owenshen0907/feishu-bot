import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parser/index.js";

describe("parseMessage", () => {
  it("parses explicit trace command", () => {
    const parsed = parseMessage("/trace trace-123456", { hasThreadContext: false });
    expect(parsed.action).toBe("trace");
    expect(parsed.targetId).toBe("trace-123456");
    expect(parsed.mode).toBe("sync");
  });

  it("parses natural uid alias with time range", () => {
    const parsed = parseMessage("帮我看 uid 123456 1h", { hasThreadContext: false });
    expect(parsed.action).toBe("uid");
    expect(parsed.targetId).toBe("123456");
    expect(parsed.timeRange).toBe("1h");
  });

  it("parses explicit chat command", () => {
    const parsed = parseMessage("/chat 帮我总结一下今天的工作", { hasThreadContext: false });
    expect(parsed.action).toBe("chat");
    expect(parsed.rawText).toBe("帮我总结一下今天的工作");
  });

  it("falls back to chat in private chat when no command matches", () => {
    const parsed = parseMessage("你觉得这个方案怎么样", { hasThreadContext: false, allowChatFallback: true });
    expect(parsed.action).toBe("chat");
  });

  it("falls back to followup inside thread context", () => {
    const parsed = parseMessage("展开原因", { hasThreadContext: true });
    expect(parsed.action).toBe("followup");
    expect(parsed.isFollowup).toBe(true);
  });

  it("uses current job id when asking task status", () => {
    const parsed = parseMessage("这个任务现在怎样了", { hasThreadContext: true, currentJobId: "job-123" });
    expect(parsed.action).toBe("job");
    expect(parsed.targetId).toBe("job-123");
    expect(parsed.useCurrentJob).toBe(true);
  });
});
