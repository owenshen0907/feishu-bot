import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBootstrapPayload, saveDesktopConfig } from "../electron/bridge-core.mjs";

const tempDirs: string[] = [];
const originalHome = process.env.FEISHU_BOT_HOME;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-bridge-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.FEISHU_BOT_HOME = originalHome;
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
    expect(payload.settings.ui.lastVisitedSection).toBe("abilities");
    expect(payload.settings.ui.feishuTestReceiveId).toBe("");
    expect(payload.settings.ui.feishuTestReceiveIdType).toBe("chat_id");
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
    expect(payload.settings.ui.lastVisitedSection).toBe("abilities");
  });

  it("surfaces capability availability metadata from the current env", () => {
    const home = makeTempDir();
    process.env.FEISHU_BOT_HOME = home;

    const initial = buildBootstrapPayload();
    const payload = saveDesktopConfig({
      env: {
        ...initial.env,
        BOT_LLM_API_KEY: "llm-key",
        SMARTKIT_BASE_URL: "https://smartkit.example.com",
        BRAVE_SEARCH_API_KEY: "brave-key",
        BOT_CAPABILITY_WEB_SEARCH: "true",
        BOT_CAPABILITY_VOICE_REPLY: "true",
        BOT_CAPABILITY_VISION: "true"
      },
      settings: initial.settings
    });

    const capabilities = Object.fromEntries(payload.catalogs.capabilities.map((item) => [item.id, item]));

    expect(capabilities.smartkit.configured).toBe(true);
    expect(capabilities.smartkit.assignable).toBe(true);
    expect(capabilities.webSearch.enabled).toBe(true);
    expect(capabilities.voiceReply.enabled).toBe(true);
    expect(capabilities.vision.enabled).toBe(true);
    expect(capabilities.chat.assignable).toBe(true);
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
                smartkit: true,
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
});
