import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import type { Scope } from "./types.js";

function loadEnvProfile(env: NodeJS.ProcessEnv = process.env): string {
  const profile = (env.BOT_PROFILE || env.NODE_ENV || "development").trim();
  const candidates = [".env", `.env.${profile}`];

  for (const name of candidates) {
    const fullPath = path.resolve(process.cwd(), name);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    dotenv.config({
      path: fullPath,
      override: name !== ".env"
    });
  }

  return profile;
}

const loadedProfile = loadEnvProfile();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_PROFILE: z.string().default(loadedProfile),
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  FEISHU_BOT_NAME: z.string().default("smartkit-bot"),
  SMARTKIT_BASE_URL: z.string().url(),
  SMARTKIT_TOKEN: z.string().default(""),
  SMARTKIT_CALLER: z.string().default("feishu-bot"),
  SMARTKIT_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  SMARTKIT_DEFAULT_SCOPE: z.enum(["p2p", "group"] as const).default("p2p"),
  SESSION_DB_PATH: z.string().default("./data/feishu-bot.sqlite"),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  HEALTH_BIND: z.string().default("127.0.0.1"),
  HEALTH_PORT: z.coerce.number().int().min(0).default(3179),
  BOT_LLM_ENABLED: z.string().default("false"),
  BOT_LLM_API_KEY: z.string().default(""),
  BOT_LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  BOT_LLM_MODEL: z.string().default("gpt-4.1-mini"),
  BOT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000)
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  profile: string;
  feishu: {
    appId: string;
    appSecret: string;
    botName: string;
  };
  smartkit: {
    baseUrl: string;
    token: string;
    caller: string;
    timeoutMs: number;
    defaultScope: Scope;
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
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = schema.parse(env);
  return {
    nodeEnv: raw.NODE_ENV,
    profile: raw.BOT_PROFILE,
    feishu: {
      appId: raw.FEISHU_APP_ID,
      appSecret: raw.FEISHU_APP_SECRET,
      botName: raw.FEISHU_BOT_NAME
    },
    smartkit: {
      baseUrl: raw.SMARTKIT_BASE_URL.replace(/\/$/, ""),
      token: raw.SMARTKIT_TOKEN,
      caller: raw.SMARTKIT_CALLER,
      timeoutMs: raw.SMARTKIT_TIMEOUT_MS,
      defaultScope: raw.SMARTKIT_DEFAULT_SCOPE
    },
    session: {
      dbPath: raw.SESSION_DB_PATH === ":memory:" ? ":memory:" : path.resolve(raw.SESSION_DB_PATH),
      jobPollIntervalMs: raw.JOB_POLL_INTERVAL_MS
    },
    health: {
      bind: raw.HEALTH_BIND,
      port: raw.HEALTH_PORT
    },
    botLlm: {
      enabled: raw.BOT_LLM_ENABLED.toLowerCase() === "true",
      apiKey: raw.BOT_LLM_API_KEY,
      baseUrl: raw.BOT_LLM_BASE_URL,
      model: raw.BOT_LLM_MODEL,
      timeoutMs: raw.BOT_LLM_TIMEOUT_MS
    }
  };
}
