import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConsoleCapabilityPolicy } from "../src/capability-policy.js";

const tempDirs: string[] = [];
const originalHome = process.env.FEISHU_BOT_HOME;

function makeTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-policy-"));
  tempDirs.push(dir);
  return dir;
}

function writeSettings(home: string, permissions: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(home, "console-settings.json"),
    JSON.stringify({ version: 2, permissions, ui: {} }, null, 2),
    "utf8"
  );
}

afterEach(() => {
  process.env.FEISHU_BOT_HOME = originalHome;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ConsoleCapabilityPolicy", () => {
  it("allows chat by default but keeps gated abilities off until explicitly enabled", () => {
    const home = makeTempHome();
    process.env.FEISHU_BOT_HOME = home;
    const policy = new ConsoleCapabilityPolicy(process.env);

    expect(policy.canUse("chat", { scope: "p2p", chatId: "chat-1", userId: "user-1" }).allowed).toBe(true);
    expect(policy.canUse("diagnosticHttp", { scope: "p2p", chatId: "chat-1", userId: "user-1" }).allowed).toBe(false);
  });

  it("allows a gated ability when the matching group rule turns it on", () => {
    const home = makeTempHome();
    process.env.FEISHU_BOT_HOME = home;
    writeSettings(home, {
      defaultMode: "allow",
      groups: [
        {
          id: "chat-group",
          name: "SRE Oncall",
          capabilities: {
            chat: true,
            diagnosticHttp: true
          }
        }
      ],
      users: []
    });

    const policy = new ConsoleCapabilityPolicy(process.env);
    const access = policy.canUse("diagnosticHttp", { scope: "group", chatId: "chat-group", userId: "user-1" });

    expect(access.allowed).toBe(true);
    expect(access.source).toBe("group");
  });

  it("lets an explicit user rule override the matching group rule", () => {
    const home = makeTempHome();
    process.env.FEISHU_BOT_HOME = home;
    writeSettings(home, {
      defaultMode: "allow",
      groups: [
        {
          id: "chat-group",
          name: "SRE Oncall",
          capabilities: {
            chat: true,
            diagnosticHttp: true
          }
        }
      ],
      users: [
        {
          id: "user-1",
          name: "张三",
          capabilities: {
            chat: true,
            diagnosticHttp: false
          }
        }
      ]
    });

    const policy = new ConsoleCapabilityPolicy(process.env);
    const access = policy.canUse("diagnosticHttp", { scope: "group", chatId: "chat-group", userId: "user-1" });

    expect(access.allowed).toBe(false);
    expect(access.source).toBe("user");
  });

  it("supports per-component overrides while keeping legacy diagnostic access as fallback", () => {
    const home = makeTempHome();
    process.env.FEISHU_BOT_HOME = home;
    writeSettings(home, {
      defaultMode: "allow",
      groups: [],
      users: [
        {
          id: "user-1",
          name: "张三",
          capabilities: {
            chat: true,
            diagnosticHttp: false,
            customComponents: {
              orders: true
            }
          }
        }
      ]
    });

    const policy = new ConsoleCapabilityPolicy(process.env);

    expect(policy.canUse("component:orders", { scope: "p2p", chatId: "chat-1", userId: "user-1" }).allowed).toBe(true);
    expect(policy.canUse("component:payments", { scope: "p2p", chatId: "chat-1", userId: "user-1" }).allowed).toBe(false);
  });
});
