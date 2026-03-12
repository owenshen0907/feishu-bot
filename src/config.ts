import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import type { Scope } from "./types.js";

function resolveConfigHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FEISHU_BOT_HOME?.trim();
  return configured ? path.resolve(configured) : process.cwd();
}

function applyEnvFile(env: NodeJS.ProcessEnv, fullPath: string, override: boolean): void {
  const parsed = dotenv.parse(fs.readFileSync(fullPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (override || env[key] === undefined) {
      env[key] = value;
    }
  }
}

function loadEnvProfile(env: NodeJS.ProcessEnv = process.env): string {
  const profile = (env.BOT_PROFILE || env.NODE_ENV || "development").trim();
  const candidates = [".env", `.env.${profile}`];
  const configHome = resolveConfigHome(env);

  for (const name of candidates) {
    const fullPath = path.resolve(configHome, name);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    applyEnvFile(env, fullPath, name !== ".env");
  }

  return profile;
}

function readFirstText(env: NodeJS.ProcessEnv, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function normalizeDiagnosticEnvAliases(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const baseUrl = readFirstText(env, ["DIAGNOSTIC_HTTP_BASE_URL", "SMARTKIT_BASE_URL"]);
  const token = readFirstText(env, ["DIAGNOSTIC_HTTP_TOKEN", "SMARTKIT_TOKEN"]);
  const caller = readFirstText(env, ["DIAGNOSTIC_HTTP_CALLER", "SMARTKIT_CALLER"], "feishu-bot");
  const timeoutMs = readFirstText(env, ["DIAGNOSTIC_HTTP_TIMEOUT_MS", "SMARTKIT_TIMEOUT_MS"], "20000");
  const defaultScope = readFirstText(env, ["DIAGNOSTIC_HTTP_DEFAULT_SCOPE", "SMARTKIT_DEFAULT_SCOPE"], "p2p");

  return {
    ...env,
    DIAGNOSTIC_HTTP_BASE_URL: baseUrl,
    DIAGNOSTIC_HTTP_TOKEN: token,
    DIAGNOSTIC_HTTP_CALLER: caller,
    DIAGNOSTIC_HTTP_TIMEOUT_MS: timeoutMs,
    DIAGNOSTIC_HTTP_DEFAULT_SCOPE: defaultScope,
    SMARTKIT_BASE_URL: readFirstText(env, ["SMARTKIT_BASE_URL"], baseUrl),
    SMARTKIT_TOKEN: readFirstText(env, ["SMARTKIT_TOKEN"], token),
    SMARTKIT_CALLER: readFirstText(env, ["SMARTKIT_CALLER"], caller),
    SMARTKIT_TIMEOUT_MS: readFirstText(env, ["SMARTKIT_TIMEOUT_MS"], timeoutMs),
    SMARTKIT_DEFAULT_SCOPE: readFirstText(env, ["SMARTKIT_DEFAULT_SCOPE"], defaultScope)
  };
}

function normalizeOptionalText(value: string): string {
  return value.trim();
}

function isConfigured(...values: string[]): boolean {
  return values.every((value) => Boolean(value.trim()));
}

const defaultChatSystemPrompt = [
  "你是一个部署在飞书里的内部助手。",
  "当用户不是在查询某个自定义组件的结果时，你可以直接陪他聊天、答疑、做简短分析和整理思路。",
  "你要记住同一个用户最近几轮对话上下文，但不要编造公司内部事实。",
  "输出中文，简洁、自然、可直接发在飞书卡片里。",
  "如果用户的问题涉及你拿不到的实时内部数据，明确说明你当前只能基于聊天内容回答。"
].join("\n");

const stepDefaults = {
  provider: "stepfun",
  baseUrl: "https://api.stepfun.com/v1",
  chatModel: "step-3.5-flash",
  visionModel: "step-1o-turbo-vision",
  ttsModel: "step-tts-2"
};

function buildSchema(defaultProfile: string) {
  return z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    BOT_PROFILE: z.string().default(defaultProfile),
    FEISHU_APP_ID: z.string().default(""),
    FEISHU_APP_SECRET: z.string().default(""),
    FEISHU_BOT_NAME: z.string().default("feishu-bot"),
    DIAGNOSTIC_HTTP_BASE_URL: z.string().default(""),
    DIAGNOSTIC_HTTP_TOKEN: z.string().default(""),
    DIAGNOSTIC_HTTP_CALLER: z.string().default("feishu-bot"),
    DIAGNOSTIC_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    DIAGNOSTIC_HTTP_DEFAULT_SCOPE: z.enum(["p2p", "group"] as const).default("p2p"),
    SESSION_DB_PATH: z.string().default("./data/feishu-bot.sqlite"),
    JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
    HEALTH_BIND: z.string().default("127.0.0.1"),
    HEALTH_PORT: z.coerce.number().int().min(0).default(3179),
    BOT_LLM_PROVIDER: z.string().default(stepDefaults.provider),
    BOT_LLM_ENABLED: z.string().default("true"),
    BOT_LLM_API_KEY: z.string().default(""),
    BOT_LLM_BASE_URL: z.string().url().default(stepDefaults.baseUrl),
    BOT_LLM_MODEL: z.string().default(stepDefaults.chatModel),
    BOT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    BOT_VISION_MODEL: z.string().default(stepDefaults.visionModel),
    BOT_TTS_MODEL: z.string().default(stepDefaults.ttsModel),
    BOT_CHAT_ENABLED: z.string().default("true"),
    BOT_CHAT_MEMORY_MESSAGES: z.coerce.number().int().positive().default(16),
    BOT_CHAT_SYSTEM_PROMPT: z.string().default(defaultChatSystemPrompt),
    BRAVE_SEARCH_API_KEY: z.string().default(""),
    BOT_CAPABILITY_WEB_SEARCH: z.string().default("false"),
    BOT_CAPABILITY_VOICE_REPLY: z.string().default("false"),
    BOT_CAPABILITY_VISION: z.string().default("false")
  });
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  profile: string;
  feishu: {
    appId: string;
    appSecret: string;
    botName: string;
    configured: boolean;
  };
  diagnosticBridge: {
    baseUrl: string;
    token: string;
    caller: string;
    timeoutMs: number;
    defaultScope: Scope;
    configured: boolean;
  };
  smartkit: {
    baseUrl: string;
    token: string;
    caller: string;
    timeoutMs: number;
    defaultScope: Scope;
    configured: boolean;
  };
  session: {
    dbPath: string;
    jobPollIntervalMs: number;
  };
  health: {
    bind: string;
    port: number;
  };
  botLlm: {
    provider: string;
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    model: string;
    visionModel: string;
    ttsModel: string;
    timeoutMs: number;
  };
  botChat: {
    enabled: boolean;
    memoryMessages: number;
    systemPrompt: string;
  };
  capabilities: {
    chatAvailable: boolean;
    webSearchEnabled: boolean;
    voiceReplyEnabled: boolean;
    visionEnabled: boolean;
    braveSearchConfigured: boolean;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const loadedProfile = loadEnvProfile(env);
  const raw = buildSchema(loadedProfile).parse(normalizeDiagnosticEnvAliases(env));
  const configHome = resolveConfigHome(env);
  const diagnosticBridge = {
    baseUrl: normalizeOptionalText(raw.DIAGNOSTIC_HTTP_BASE_URL).replace(/\/$/, ""),
    token: raw.DIAGNOSTIC_HTTP_TOKEN,
    caller: raw.DIAGNOSTIC_HTTP_CALLER,
    timeoutMs: raw.DIAGNOSTIC_HTTP_TIMEOUT_MS,
    defaultScope: raw.DIAGNOSTIC_HTTP_DEFAULT_SCOPE,
    configured: isConfigured(raw.DIAGNOSTIC_HTTP_BASE_URL)
  };
  return {
    nodeEnv: raw.NODE_ENV,
    profile: raw.BOT_PROFILE,
    feishu: {
      appId: normalizeOptionalText(raw.FEISHU_APP_ID),
      appSecret: normalizeOptionalText(raw.FEISHU_APP_SECRET),
      botName: raw.FEISHU_BOT_NAME,
      configured: isConfigured(raw.FEISHU_APP_ID, raw.FEISHU_APP_SECRET)
    },
    diagnosticBridge,
    smartkit: diagnosticBridge,
    session: {
      dbPath:
        raw.SESSION_DB_PATH === ":memory:"
          ? ":memory:"
          : path.isAbsolute(raw.SESSION_DB_PATH)
            ? raw.SESSION_DB_PATH
            : path.resolve(configHome, raw.SESSION_DB_PATH),
      jobPollIntervalMs: raw.JOB_POLL_INTERVAL_MS
    },
    health: {
      bind: raw.HEALTH_BIND,
      port: raw.HEALTH_PORT
    },
    botLlm: {
      provider: raw.BOT_LLM_PROVIDER,
      enabled: raw.BOT_LLM_ENABLED.toLowerCase() === "true",
      apiKey: raw.BOT_LLM_API_KEY,
      baseUrl: raw.BOT_LLM_BASE_URL,
      model: raw.BOT_LLM_MODEL,
      visionModel: raw.BOT_VISION_MODEL,
      ttsModel: raw.BOT_TTS_MODEL,
      timeoutMs: raw.BOT_LLM_TIMEOUT_MS
    },
    botChat: {
      enabled: raw.BOT_CHAT_ENABLED.toLowerCase() === "true",
      memoryMessages: raw.BOT_CHAT_MEMORY_MESSAGES,
      systemPrompt: raw.BOT_CHAT_SYSTEM_PROMPT
    },
    capabilities: {
      chatAvailable:
        raw.BOT_CHAT_ENABLED.toLowerCase() === "true" &&
        Boolean(normalizeOptionalText(raw.BOT_LLM_API_KEY)) &&
        Boolean(normalizeOptionalText(raw.BOT_LLM_BASE_URL)),
      webSearchEnabled: raw.BOT_CAPABILITY_WEB_SEARCH.toLowerCase() === "true",
      voiceReplyEnabled: raw.BOT_CAPABILITY_VOICE_REPLY.toLowerCase() === "true",
      visionEnabled: raw.BOT_CAPABILITY_VISION.toLowerCase() === "true",
      braveSearchConfigured: Boolean(normalizeOptionalText(raw.BRAVE_SEARCH_API_KEY))
    }
  };
}
