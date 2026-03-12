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
  "DIAGNOSTIC_HTTP_BASE_URL",
  "DIAGNOSTIC_HTTP_TOKEN",
  "DIAGNOSTIC_HTTP_CALLER",
  "DIAGNOSTIC_HTTP_TIMEOUT_MS",
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

function readFirstText(values, keys, fallback = "") {
  for (const key of keys) {
    const value = trim(values?.[key]);
    if (value) {
      return value;
    }
  }
  return fallback;
}

export function resolveDiagnosticEnvValues(values = {}) {
  return {
    baseUrl: readFirstText(values, ["DIAGNOSTIC_HTTP_BASE_URL", "SMARTKIT_BASE_URL"]),
    token: readFirstText(values, ["DIAGNOSTIC_HTTP_TOKEN", "SMARTKIT_TOKEN"]),
    caller: readFirstText(values, ["DIAGNOSTIC_HTTP_CALLER", "SMARTKIT_CALLER"], "feishu-bot"),
    timeoutMs: readFirstText(values, ["DIAGNOSTIC_HTTP_TIMEOUT_MS", "SMARTKIT_TIMEOUT_MS"], "20000")
  };
}

export function normalizeDiagnosticEnvAliases(values = {}) {
  const diagnostic = resolveDiagnosticEnvValues(values);
  return {
    ...values,
    DIAGNOSTIC_HTTP_BASE_URL: diagnostic.baseUrl,
    DIAGNOSTIC_HTTP_TOKEN: diagnostic.token,
    DIAGNOSTIC_HTTP_CALLER: diagnostic.caller,
    DIAGNOSTIC_HTTP_TIMEOUT_MS: diagnostic.timeoutMs,
    SMARTKIT_BASE_URL: readFirstText(values, ["SMARTKIT_BASE_URL"], diagnostic.baseUrl),
    SMARTKIT_TOKEN: readFirstText(values, ["SMARTKIT_TOKEN"], diagnostic.token),
    SMARTKIT_CALLER: readFirstText(values, ["SMARTKIT_CALLER"], diagnostic.caller),
    SMARTKIT_TIMEOUT_MS: readFirstText(values, ["SMARTKIT_TIMEOUT_MS"], diagnostic.timeoutMs)
  };
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
    DIAGNOSTIC_HTTP_BASE_URL: "",
    DIAGNOSTIC_HTTP_TOKEN: "",
    DIAGNOSTIC_HTTP_CALLER: "feishu-bot",
    DIAGNOSTIC_HTTP_TIMEOUT_MS: "20000",
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
  const values = normalizeDiagnosticEnvAliases(applyProviderDefaults({
    ...defaults,
    ...parsed
  }));
  const diagnostic = resolveDiagnosticEnvValues(values);
  return {
    ...values,
    FEISHU_APP_ID: trim(values.FEISHU_APP_ID),
    FEISHU_APP_SECRET: trim(values.FEISHU_APP_SECRET),
    FEISHU_BOT_NAME: trim(values.FEISHU_BOT_NAME) || defaults.FEISHU_BOT_NAME,
    DIAGNOSTIC_HTTP_BASE_URL: diagnostic.baseUrl,
    DIAGNOSTIC_HTTP_TOKEN: diagnostic.token,
    DIAGNOSTIC_HTTP_CALLER: diagnostic.caller,
    DIAGNOSTIC_HTTP_TIMEOUT_MS: diagnostic.timeoutMs,
    SMARTKIT_BASE_URL: trim(values.SMARTKIT_BASE_URL) || diagnostic.baseUrl,
    SMARTKIT_TOKEN: trim(values.SMARTKIT_TOKEN) || diagnostic.token,
    SMARTKIT_CALLER: trim(values.SMARTKIT_CALLER) || diagnostic.caller,
    SMARTKIT_TIMEOUT_MS: trim(values.SMARTKIT_TIMEOUT_MS) || diagnostic.timeoutMs,
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
  const values = normalizeDiagnosticEnvAliases(applyProviderDefaults({
    ...defaults,
    ...input
  }));
  const diagnostic = resolveDiagnosticEnvValues(values);
  const lines = [
    `BOT_PROFILE=${trim(values.BOT_PROFILE) || defaults.BOT_PROFILE}`,
    "",
    "# Feishu long connection (required for the bot to actually come online)",
    `FEISHU_APP_ID=${trim(values.FEISHU_APP_ID)}`,
    `FEISHU_APP_SECRET=${trim(values.FEISHU_APP_SECRET)}`,
    `FEISHU_BOT_NAME=${trim(values.FEISHU_BOT_NAME) || defaults.FEISHU_BOT_NAME}`,
    "",
    "# Diagnostic bridge (preferred env names; legacy SMARTKIT_* aliases are still supported)",
    `DIAGNOSTIC_HTTP_BASE_URL=${diagnostic.baseUrl}`,
    `DIAGNOSTIC_HTTP_TOKEN=${diagnostic.token}`,
    `DIAGNOSTIC_HTTP_CALLER=${diagnostic.caller || defaults.DIAGNOSTIC_HTTP_CALLER}`,
    `DIAGNOSTIC_HTTP_TIMEOUT_MS=${diagnostic.timeoutMs || defaults.DIAGNOSTIC_HTTP_TIMEOUT_MS}`,
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
      diagnosticHttp: false,
      customComponents: {},
      webSearch: false,
      voiceReply: false,
      vision: false
    }
  };
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => trim(value))
    .filter(Boolean);
}

function normalizeTimeout(value) {
  const numeric = typeof value === "number" ? value : Number(trim(value));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 20000;
}

function normalizeCommand(value) {
  const raw = trim(value).replace(/^\//, "").toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, "");
}

function sanitizeHelpCapabilityOrderMode(value) {
  return trim(value) === "component_first" ? "component_first" : "builtin_first";
}

function sanitizeDiagnosticComponent(component, fallbackId = "legacy-diagnostic-http") {
  const value = component && typeof component === "object" ? component : {};
  const explicitId = trim(value?.id);
  const normalized = {
    id: explicitId || fallbackId,
    name: trim(value?.name),
    enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    command: normalizeCommand(value?.command),
    summary: trim(value?.summary),
    usageDescription: trim(value?.usageDescription),
    examplePrompts: normalizeStringArray(value?.examplePrompts),
    baseUrl: trim(value?.baseUrl).replace(/\/$/, ""),
    token: trim(value?.token),
    caller: trim(value?.caller) || "feishu-bot",
    timeoutMs: normalizeTimeout(value?.timeoutMs)
  };

  const hasContent =
    normalized.name ||
    normalized.command ||
    normalized.summary ||
    normalized.usageDescription ||
    normalized.examplePrompts.length ||
    normalized.baseUrl;
  return hasContent || explicitId ? normalized : null;
}

function sanitizeDiagnosticComponents(components) {
  if (Array.isArray(components)) {
    return components
      .map((component, index) => sanitizeDiagnosticComponent(component, `component-${index + 1}`))
      .filter(Boolean);
  }
  const single = sanitizeDiagnosticComponent(components, "legacy-diagnostic-http");
  return single ? [single] : [];
}

function sanitizeHelpSettings(help) {
  const value = help && typeof help === "object" ? help : {};
  const normalized = {
    title: trim(value?.title),
    summary: trim(value?.summary),
    newCommandDescription: trim(value?.newCommandDescription),
    capabilityOrderMode: sanitizeHelpCapabilityOrderMode(value?.capabilityOrderMode),
    examplePrompts: normalizeStringArray(value?.examplePrompts),
    notes: normalizeStringArray(value?.notes)
  };
  const hasContent =
    normalized.title ||
    normalized.summary ||
    normalized.newCommandDescription ||
    normalized.capabilityOrderMode !== "builtin_first" ||
    normalized.examplePrompts.length ||
    normalized.notes.length;
  return hasContent ? normalized : null;
}

function sanitizeCapabilityCardText(value) {
  return {
    helpDescription: trim(value?.helpDescription)
  };
}

function sanitizeCapabilityCardSettings(cards) {
  const value = cards && typeof cards === "object" ? cards : {};
  return {
    webSearch: sanitizeCapabilityCardText(value?.webSearch),
    voiceReply: sanitizeCapabilityCardText(value?.voiceReply),
    vision: sanitizeCapabilityCardText(value?.vision)
  };
}

function sanitizeProcessingReactionSettings(reaction) {
  const value = reaction && typeof reaction === "object" ? reaction : {};
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
    emoji: trim(value?.emoji) || "OnIt"
  };
}

function sanitizeFeedbackSettings(feedback) {
  const value = feedback && typeof feedback === "object" ? feedback : {};
  return {
    processingReaction: sanitizeProcessingReactionSettings(value?.processingReaction)
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
      diagnosticHttp: Boolean(rule?.capabilities?.diagnosticHttp ?? rule?.capabilities?.smartkit ?? base.capabilities.diagnosticHttp),
      customComponents: rule?.capabilities?.customComponents && typeof rule.capabilities.customComponents === "object"
        ? Object.fromEntries(
            Object.entries(rule.capabilities.customComponents)
              .map(([key, value]) => [trim(key), Boolean(value)])
              .filter(([key]) => Boolean(key))
          )
        : {},
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
    components: {
      diagnosticHttp: []
    },
    capabilityCards: sanitizeCapabilityCardSettings(null),
    feedback: sanitizeFeedbackSettings(null),
    help: null,
    ui: {
      onboardingCompleted: false,
      lastVisitedSection: "thread",
      feishuTestReceiveId: "",
      feishuTestReceiveIdType: "chat_id"
    }
  };
}

export function readConsoleSettings() {
  const env = readEnvConfig();
  const requiredReady = Boolean(
    env.FEISHU_APP_ID &&
    env.FEISHU_APP_SECRET &&
    env.BOT_LLM_API_KEY &&
    env.BOT_LLM_BASE_URL &&
    env.BOT_LLM_MODEL
  );
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
    const lastVisitedSection = ["thread", "abilities", "groups", "users", "system"].includes(trim(rawUi?.lastVisitedSection))
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
      components: {
        diagnosticHttp: sanitizeDiagnosticComponents(raw?.components?.diagnosticHttp)
      },
      capabilityCards: sanitizeCapabilityCardSettings(raw?.capabilityCards),
      feedback: sanitizeFeedbackSettings(raw?.feedback),
      help: sanitizeHelpSettings(raw?.help),
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
    components: {
      diagnosticHttp: sanitizeDiagnosticComponents(settings?.components?.diagnosticHttp)
    },
    capabilityCards: sanitizeCapabilityCardSettings(settings?.capabilityCards),
    feedback: sanitizeFeedbackSettings(settings?.feedback),
    help: sanitizeHelpSettings(settings?.help),
    ui: {
      onboardingCompleted: Boolean(settings?.ui?.onboardingCompleted),
      lastVisitedSection: ["thread", "abilities", "groups", "users", "system"].includes(trim(settings?.ui?.lastVisitedSection))
        ? trim(settings.ui.lastVisitedSection)
        : "thread",
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
        onboardingCompleted: Boolean(
          env.FEISHU_APP_ID &&
          env.FEISHU_APP_SECRET &&
          env.BOT_LLM_API_KEY &&
          env.BOT_LLM_BASE_URL &&
          env.BOT_LLM_MODEL
        ),
        lastVisitedSection: "thread",
        feishuTestReceiveId: "",
        feishuTestReceiveIdType: "chat_id"
      }
    });
  }
}
