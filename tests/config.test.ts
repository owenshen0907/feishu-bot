import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bot-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("treats feishu and diagnostic bridge config as optional at startup", () => {
    const home = makeTempDir();
    fs.writeFileSync(path.join(home, ".env"), "BOT_CHAT_ENABLED=true\n");

    const config = loadConfig({ FEISHU_BOT_HOME: home });

    expect(config.feishu.configured).toBe(false);
    expect(config.diagnosticBridge.configured).toBe(false);
    expect(config.smartkit.configured).toBe(false);
    expect(config.botLlm.provider).toBe("stepfun");
    expect(config.botLlm.baseUrl).toBe("https://api.stepfun.com/v1");
    expect(config.botLlm.model).toBe("step-3.5-flash");
    expect(config.botLlm.visionModel).toBe("step-1o-turbo-vision");
    expect(config.botLlm.ttsModel).toBe("step-tts-2");
    expect(config.session.dbPath).toBe(path.join(home, "data", "feishu-bot.sqlite"));
  });

  it("loads env files from FEISHU_BOT_HOME and resolves relative paths against it", () => {
    const home = makeTempDir();
    fs.writeFileSync(
      path.join(home, ".env"),
      [
        "FEISHU_APP_ID=cli_test",
        "FEISHU_APP_SECRET=secret_test",
        "DIAGNOSTIC_HTTP_BASE_URL=https://diagnostics.example.com",
        "SESSION_DB_PATH=./data/runtime.sqlite",
        "BOT_CHAT_ENABLED=false",
        "BOT_CAPABILITY_WEB_SEARCH=true",
        "BRAVE_SEARCH_API_KEY=brave-key"
      ].join("\n")
    );

    const config = loadConfig({ FEISHU_BOT_HOME: home });

    expect(config.feishu.appId).toBe("cli_test");
    expect(config.feishu.configured).toBe(true);
    expect(config.diagnosticBridge.configured).toBe(true);
    expect(config.session.dbPath).toBe(path.join(home, "data", "runtime.sqlite"));
    expect(config.botChat.enabled).toBe(false);
    expect(config.capabilities.webSearchEnabled).toBe(true);
    expect(config.capabilities.braveSearchConfigured).toBe(true);
  });

  it("applies profile-specific env overrides from FEISHU_BOT_HOME", () => {
    const home = makeTempDir();
    fs.writeFileSync(
      path.join(home, ".env"),
      [
        "FEISHU_APP_ID=cli_base",
        "FEISHU_APP_SECRET=secret_base",
        "DIAGNOSTIC_HTTP_BASE_URL=https://base.example.com"
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(home, ".env.production"),
      [
        "DIAGNOSTIC_HTTP_BASE_URL=https://prod.example.com",
        "FEISHU_BOT_NAME=desktop-bot"
      ].join("\n")
    );

    const config = loadConfig({
      FEISHU_BOT_HOME: home,
      BOT_PROFILE: "production"
    });

    expect(config.profile).toBe("production");
    expect(config.diagnosticBridge.baseUrl).toBe("https://prod.example.com");
    expect(config.feishu.botName).toBe("desktop-bot");
  });

  it("keeps legacy SMARTKIT env names working as aliases", () => {
    const home = makeTempDir();
    fs.writeFileSync(
      path.join(home, ".env"),
      [
        "SMARTKIT_BASE_URL=https://legacy.example.com",
        "SMARTKIT_TOKEN=legacy-token"
      ].join("\n")
    );

    const config = loadConfig({ FEISHU_BOT_HOME: home });

    expect(config.diagnosticBridge.baseUrl).toBe("https://legacy.example.com");
    expect(config.diagnosticBridge.token).toBe("legacy-token");
    expect(config.smartkit.baseUrl).toBe("https://legacy.example.com");
  });
});
