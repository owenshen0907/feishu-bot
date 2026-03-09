import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

export const STEP_PROVIDER_DOC_URL = "https://platform.stepfun.com/interface-key";
export const BRAVE_SEARCH_DOC_URL = "https://brave.com/search/api/";
export const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export const MANAGED_ENV_KEYS = [
  "BOT_PROFILE",
  "NODE_ENV",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_BOT_NAME",
  "SMARTKIT_BASE_URL",
  "SMARTKIT_TOKEN",
  "SMARTKIT_CALLER",
  "SMARTKIT_TIMEOUT_MS",
  "SESSION_DB_PATH",
  "JOB_POLL_INTERVAL_MS",
  "HEALTH_BIND",
  "HEALTH_PORT",
  "BOT_LLM_PROVIDER",
  "BOT_LLM_ENABLED",
  "BOT_LLM_API_KEY",
  "BOT_LLM_BASE_URL",
  "BOT_LLM_MODEL",
  "BOT_LLM_TIMEOUT_MS",
  "BOT_VISION_MODEL",
  "BOT_TTS_MODEL",
  "BOT_CHAT_ENABLED",
  "BOT_CHAT_MEMORY_MESSAGES",
  "BRAVE_SEARCH_API_KEY",
  "BOT_CAPABILITY_WEB_SEARCH",
  "BOT_CAPABILITY_VOICE_REPLY",
  "BOT_CAPABILITY_VISION"
];

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeBoolean(value, fallback = false) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "true";
}

export function getRuntimeHome() {
  return process.env.FEISHU_BOT_HOME || process.cwd();
}

export function getEnvPath() {
  return path.join(getRuntimeHome(), ".env");
}

export function getSettingsPath() {
  return path.join(getRuntimeHome(), "console-settings.json");
}

export function getDataDir() {
  if (process.env.SESSION_DB_PATH === ":memory:") {
    return path.join(getRuntimeHome(), "data");
  }
  const dbPath = process.env.SESSION_DB_PATH || path.join(getRuntimeHome(), "data", "feishu-bot.sqlite");
  return path.dirname(path.isAbsolute(dbPath) ? dbPath : path.join(getRuntimeHome(), dbPath));
}

export function getStepProviderDefaults() {
  return {
    provider: "stepfun",
    baseUrl: "https://api.stepfun.com/v1",
    chatModel: "step-3.5-flash",
    visionModel: "step-1o-turbo-vision",
    ttsModel: "step-tts-2"
  };
}

export function getDefaultEnvValues() {
  const step = getStepProviderDefaults();
  return {
    BOT_PROFILE: "development",
    FEISHU_APP_ID: "",
    FEISHU_APP_SECRET: "",
    FEISHU_BOT_NAME: "feishu-bot",
    SMARTKIT_BASE_URL: "",
    SMARTKIT_TOKEN: "",
    SMARTKIT_CALLER: "feishu-bot",
    SMARTKIT_TIMEOUT_MS: "20000",
    SESSION_DB_PATH: "./data/feishu-bot.sqlite",
    JOB_POLL_INTERVAL_MS: "15000",
    HEALTH_BIND: "127.0.0.1",
    HEALTH_PORT: "3179",
    BOT_LLM_PROVIDER: step.provider,
    BOT_LLM_ENABLED: "true",
    BOT_LLM_API_KEY: "",
    BOT_LLM_BASE_URL: step.baseUrl,
    BOT_LLM_MODEL: step.chatModel,
    BOT_LLM_TIMEOUT_MS: "15000",
    BOT_VISION_MODEL: step.visionModel,
    BOT_TTS_MODEL: step.ttsModel,
    BOT_CHAT_ENABLED: "true",
    BOT_CHAT_MEMORY_MESSAGES: "16",
    BRAVE_SEARCH_API_KEY: "",
    BOT_CAPABILITY_WEB_SEARCH: "false",
    BOT_CAPABILITY_VOICE_REPLY: "false",
    BOT_CAPABILITY_VISION: "false"
  };
}

function applyProviderDefaults(values) {
  const provider = trim(values.BOT_LLM_PROVIDER) || "stepfun";
  if (provider !== "stepfun") {
    return values;
  }
  const step = getStepProviderDefaults();
  return {
    ...values,
    BOT_LLM_PROVIDER: step.provider,
    BOT_LLM_BASE_URL: trim(values.BOT_LLM_BASE_URL) || step.baseUrl,
    BOT_LLM_MODEL: trim(values.BOT_LLM_MODEL) || step.chatModel,
    BOT_VISION_MODEL: trim(values.BOT_VISION_MODEL) || step.visionModel,
    BOT_TTS_MODEL: trim(values.BOT_TTS_MODEL) || step.ttsModel
  };
}

export function readEnvConfig() {
  const defaults = getDefaultEnvValues();
  const fullPath = getEnvPath();
  let parsed = {};
  if (fs.existsSync(fullPath)) {
    parsed = dotenv.parse(fs.readFileSync(fullPath));
  }
  const values = applyProviderDefaults({
    ...defaults,
    ...parsed
  });
  return {
    ...values,
    FEISHU_APP_ID: trim(values.FEISHU_APP_ID),
    FEISHU_APP_SECRET: trim(values.FEISHU_APP_SECRET),
    FEISHU_BOT_NAME: trim(values.FEISHU_BOT_NAME) || defaults.FEISHU_BOT_NAME,
    SMARTKIT_BASE_URL: trim(values.SMARTKIT_BASE_URL),
    SMARTKIT_TOKEN: trim(values.SMARTKIT_TOKEN),
    BOT_LLM_PROVIDER: trim(values.BOT_LLM_PROVIDER) || defaults.BOT_LLM_PROVIDER,
    BOT_LLM_API_KEY: trim(values.BOT_LLM_API_KEY),
    BOT_LLM_BASE_URL: trim(values.BOT_LLM_BASE_URL) || defaults.BOT_LLM_BASE_URL,
    BOT_LLM_MODEL: trim(values.BOT_LLM_MODEL) || defaults.BOT_LLM_MODEL,
    BOT_VISION_MODEL: trim(values.BOT_VISION_MODEL) || defaults.BOT_VISION_MODEL,
    BOT_TTS_MODEL: trim(values.BOT_TTS_MODEL) || defaults.BOT_TTS_MODEL,
    BRAVE_SEARCH_API_KEY: trim(values.BRAVE_SEARCH_API_KEY),
    BOT_CHAT_ENABLED: normalizeBoolean(values.BOT_CHAT_ENABLED, true) ? "true" : "false",
    BOT_CAPABILITY_WEB_SEARCH: normalizeBoolean(values.BOT_CAPABILITY_WEB_SEARCH) ? "true" : "false",
    BOT_CAPABILITY_VOICE_REPLY: normalizeBoolean(values.BOT_CAPABILITY_VOICE_REPLY) ? "true" : "false",
    BOT_CAPABILITY_VISION: normalizeBoolean(values.BOT_CAPABILITY_VISION) ? "true" : "false"
  };
}

export function buildEnvFileContent(input) {
  const defaults = getDefaultEnvValues();
  const values = applyProviderDefaults({
    ...defaults,
    ...input
  });
  const lines = [
    `BOT_PROFILE=${trim(values.BOT_PROFILE) || defaults.BOT_PROFILE}`,
    "",
    "# Feishu long connection (required for the bot to actually come online)",
    `FEISHU_APP_ID=${trim(values.FEISHU_APP_ID)}`,
    `FEISHU_APP_SECRET=${trim(values.FEISHU_APP_SECRET)}`,
    `FEISHU_BOT_NAME=${trim(values.FEISHU_BOT_NAME) || defaults.FEISHU_BOT_NAME}`,
    "",
    "# SmartKit bridge (optional; leave empty to use chat-only mode)",
    `SMARTKIT_BASE_URL=${trim(values.SMARTKIT_BASE_URL)}`,
    `SMARTKIT_TOKEN=${trim(values.SMARTKIT_TOKEN)}`,
    `SMARTKIT_CALLER=${trim(values.SMARTKIT_CALLER) || defaults.SMARTKIT_CALLER}`,
    `SMARTKIT_TIMEOUT_MS=${trim(values.SMARTKIT_TIMEOUT_MS) || defaults.SMARTKIT_TIMEOUT_MS}`,
    "",
    "# Local session store",
    `SESSION_DB_PATH=${trim(values.SESSION_DB_PATH) || defaults.SESSION_DB_PATH}`,
    `JOB_POLL_INTERVAL_MS=${trim(values.JOB_POLL_INTERVAL_MS) || defaults.JOB_POLL_INTERVAL_MS}`,
    "",
    "# Local health endpoint",
    `HEALTH_BIND=${trim(values.HEALTH_BIND) || defaults.HEALTH_BIND}`,
    `HEALTH_PORT=${trim(values.HEALTH_PORT) || defaults.HEALTH_PORT}`,
    "",
    "# Model provider",
    `BOT_LLM_PROVIDER=${trim(values.BOT_LLM_PROVIDER) || defaults.BOT_LLM_PROVIDER}`,
    `BOT_LLM_ENABLED=${trim(values.BOT_LLM_ENABLED) || defaults.BOT_LLM_ENABLED}`,
    `BOT_LLM_API_KEY=${trim(values.BOT_LLM_API_KEY)}`,
    `BOT_LLM_BASE_URL=${trim(values.BOT_LLM_BASE_URL) || defaults.BOT_LLM_BASE_URL}`,
    `BOT_LLM_MODEL=${trim(values.BOT_LLM_MODEL) || defaults.BOT_LLM_MODEL}`,
    `BOT_LLM_TIMEOUT_MS=${trim(values.BOT_LLM_TIMEOUT_MS) || defaults.BOT_LLM_TIMEOUT_MS}`,
    `BOT_VISION_MODEL=${trim(values.BOT_VISION_MODEL) || defaults.BOT_VISION_MODEL}`,
    `BOT_TTS_MODEL=${trim(values.BOT_TTS_MODEL) || defaults.BOT_TTS_MODEL}`,
    "",
    "# Chat capability",
    `BOT_CHAT_ENABLED=${normalizeBoolean(values.BOT_CHAT_ENABLED, true) ? "true" : "false"}`,
    `BOT_CHAT_MEMORY_MESSAGES=${trim(values.BOT_CHAT_MEMORY_MESSAGES) || defaults.BOT_CHAT_MEMORY_MESSAGES}`,
    "",
    "# Optional abilities",
    `BRAVE_SEARCH_API_KEY=${trim(values.BRAVE_SEARCH_API_KEY)}`,
    `BOT_CAPABILITY_WEB_SEARCH=${normalizeBoolean(values.BOT_CAPABILITY_WEB_SEARCH) ? "true" : "false"}`,
    `BOT_CAPABILITY_VOICE_REPLY=${normalizeBoolean(values.BOT_CAPABILITY_VOICE_REPLY) ? "true" : "false"}`,
    `BOT_CAPABILITY_VISION=${normalizeBoolean(values.BOT_CAPABILITY_VISION) ? "true" : "false"}`,
    ""
  ];
  return `${lines.join("\n")}`;
}

export function writeEnvConfig(input) {
  fs.mkdirSync(getRuntimeHome(), { recursive: true });
  fs.writeFileSync(getEnvPath(), buildEnvFileContent(input), "utf8");
}

function defaultRule() {
  return {
    id: "",
    name: "",
    mode: "allow",
    note: "",
    capabilities: {
      chat: true,
      smartkit: true,
      webSearch: true,
      voiceReply: true,
      vision: true
    }
  };
}

function sanitizeRule(rule) {
  const base = defaultRule();
  return {
    id: trim(rule?.id),
    name: trim(rule?.name),
    mode: ["allow", "readonly", "block"].includes(trim(rule?.mode)) ? trim(rule.mode) : base.mode,
    note: trim(rule?.note),
    capabilities: {
      chat: Boolean(rule?.capabilities?.chat ?? base.capabilities.chat),
      smartkit: Boolean(rule?.capabilities?.smartkit ?? base.capabilities.smartkit),
      webSearch: Boolean(rule?.capabilities?.webSearch ?? base.capabilities.webSearch),
      voiceReply: Boolean(rule?.capabilities?.voiceReply ?? base.capabilities.voiceReply),
      vision: Boolean(rule?.capabilities?.vision ?? base.capabilities.vision)
    }
  };
}

export function getDefaultConsoleSettings() {
  return {
    version: 2,
    permissions: {
      defaultMode: "allow",
      groups: [],
      users: []
    },
    ui: {
      onboardingCompleted: false,
      lastVisitedSection: "abilities",
      feishuTestReceiveId: "",
      feishuTestReceiveIdType: "chat_id"
    }
  };
}

export function readConsoleSettings() {
  const env = readEnvConfig();
  const requiredReady = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.BOT_LLM_API_KEY);
  const defaults = {
    ...getDefaultConsoleSettings(),
    ui: {
      ...getDefaultConsoleSettings().ui,
      onboardingCompleted: requiredReady
    }
  };
  const fullPath = getSettingsPath();
  if (!fs.existsSync(fullPath)) {
    return defaults;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const rawUi = raw?.ui ?? null;
    const lastVisitedSection = ["abilities", "groups", "users", "system"].includes(trim(rawUi?.lastVisitedSection))
      ? trim(rawUi.lastVisitedSection)
      : defaults.ui.lastVisitedSection;
    const feishuTestReceiveIdType = ["chat_id", "open_id", "user_id"].includes(trim(rawUi?.feishuTestReceiveIdType))
      ? trim(rawUi.feishuTestReceiveIdType)
      : defaults.ui.feishuTestReceiveIdType;
    const onboardingCompleted = typeof rawUi?.onboardingCompleted === "boolean"
      ? rawUi.onboardingCompleted
      : requiredReady;
    return {
      version: 2,
      permissions: {
        defaultMode: trim(raw?.permissions?.defaultMode) === "restricted" ? "restricted" : "allow",
        groups: Array.isArray(raw?.permissions?.groups) ? raw.permissions.groups.map(sanitizeRule) : [],
        users: Array.isArray(raw?.permissions?.users) ? raw.permissions.users.map(sanitizeRule) : []
      },
      ui: {
        onboardingCompleted,
        lastVisitedSection,
        feishuTestReceiveId: trim(rawUi?.feishuTestReceiveId),
        feishuTestReceiveIdType
      }
    };
  } catch {
    return defaults;
  }
}

export function writeConsoleSettings(settings) {
  const value = {
    version: 2,
    permissions: {
      defaultMode: trim(settings?.permissions?.defaultMode) === "restricted" ? "restricted" : "allow",
      groups: Array.isArray(settings?.permissions?.groups)
        ? settings.permissions.groups.map(sanitizeRule).filter((rule) => rule.id || rule.name)
        : [],
      users: Array.isArray(settings?.permissions?.users)
        ? settings.permissions.users.map(sanitizeRule).filter((rule) => rule.id || rule.name)
        : []
    },
    ui: {
      onboardingCompleted: Boolean(settings?.ui?.onboardingCompleted),
      lastVisitedSection: ["abilities", "groups", "users", "system"].includes(trim(settings?.ui?.lastVisitedSection))
        ? trim(settings.ui.lastVisitedSection)
        : "abilities",
      feishuTestReceiveId: trim(settings?.ui?.feishuTestReceiveId),
      feishuTestReceiveIdType: ["chat_id", "open_id", "user_id"].includes(trim(settings?.ui?.feishuTestReceiveIdType))
        ? trim(settings.ui.feishuTestReceiveIdType)
        : "chat_id"
    }
  };
  fs.mkdirSync(getRuntimeHome(), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(value, null, 2), "utf8");
}

export function clearManagedEnv() {
  for (const key of MANAGED_ENV_KEYS) {
    delete process.env[key];
  }
}

export function ensureDefaultRuntimeConfig() {
  fs.mkdirSync(getRuntimeHome(), { recursive: true });
  if (!fs.existsSync(getEnvPath())) {
    writeEnvConfig(getDefaultEnvValues());
  }
  if (!fs.existsSync(getSettingsPath())) {
    const env = readEnvConfig();
    writeConsoleSettings({
      ...getDefaultConsoleSettings(),
      ui: {
        onboardingCompleted: Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.BOT_LLM_API_KEY),
        lastVisitedSection: "abilities",
        feishuTestReceiveId: "",
        feishuTestReceiveIdType: "chat_id"
      }
    });
  }
}
