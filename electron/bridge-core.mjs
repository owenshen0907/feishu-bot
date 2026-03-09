import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  BRAVE_SEARCH_DOC_URL,
  BRAVE_SEARCH_ENDPOINT,
  STEP_PROVIDER_DOC_URL,
  ensureDefaultRuntimeConfig,
  getDataDir,
  getEnvPath,
  getRuntimeHome,
  getSettingsPath,
  getStepProviderDefaults,
  readConsoleSettings,
  readEnvConfig,
  writeConsoleSettings,
  writeEnvConfig
} from "./runtime-config.mjs";

const PID_FILE = "desktop-backend.pid";
const HEALTH_POLL_TIMEOUT_MS = 20000;
const HEALTH_POLL_INTERVAL_MS = 400;
const RESTART_REQUIRED_ENV_KEYS = [
  "BOT_PROFILE",
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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runtimeHome() {
  ensureDefaultRuntimeConfig();
  return getRuntimeHome();
}

function pidPath() {
  return path.join(runtimeHome(), PID_FILE);
}

function readPidRecord() {
  const fullPath = pidPath();
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    return typeof raw?.pid === "number" && raw.pid > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writePidRecord(pid) {
  fs.mkdirSync(runtimeHome(), { recursive: true });
  fs.writeFileSync(
    pidPath(),
    JSON.stringify(
      {
        pid,
        startedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

function clearPidRecord() {
  fs.rmSync(pidPath(), { force: true });
}

function canSignal(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function trySignal(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (groupError) {
    try {
      process.kill(pid, signal);
      return true;
    } catch (singleError) {
      return singleError?.code !== "ESRCH";
    }
  }
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!canSignal(pid)) {
      return true;
    }
    await delay(150);
  }
  return !canSignal(pid);
}

async function stopPid(pid) {
  if (!pid || !canSignal(pid)) {
    return;
  }
  trySignal(pid, "SIGTERM");
  if (await waitForPidExit(pid, 5000)) {
    return;
  }
  trySignal(pid, "SIGKILL");
  await waitForPidExit(pid, 2000);
}

function buildCatalogs(env) {
  const step = getStepProviderDefaults();
  const llmConfigured = Boolean(trim(env.BOT_LLM_API_KEY) && trim(env.BOT_LLM_BASE_URL));
  const llmEnabled = normalizeBoolean(env.BOT_LLM_ENABLED, true);
  const chatEnabled = normalizeBoolean(env.BOT_CHAT_ENABLED, true);
  const smartkitConfigured = Boolean(trim(env.SMARTKIT_BASE_URL));
  const braveConfigured = Boolean(trim(env.BRAVE_SEARCH_API_KEY));
  const webSearchEnabled = normalizeBoolean(env.BOT_CAPABILITY_WEB_SEARCH);
  const voiceReplyEnabled = normalizeBoolean(env.BOT_CAPABILITY_VOICE_REPLY);
  const visionEnabled = normalizeBoolean(env.BOT_CAPABILITY_VISION);

  const capability = (id, label, configured, enabled, message) => ({
    id,
    label,
    configured,
    enabled,
    assignable: enabled,
    message
  });

  return {
    providers: [
      {
        id: "stepfun",
        name: "阶跃星辰 StepFun",
        baseUrl: step.baseUrl,
        chatModel: step.chatModel,
        visionModel: step.visionModel,
        ttsModel: step.ttsModel
      },
      {
        id: "custom-openai",
        name: "自定义 OpenAI Compatible",
        baseUrl: env.BOT_LLM_BASE_URL,
        chatModel: env.BOT_LLM_MODEL,
        visionModel: env.BOT_VISION_MODEL,
        ttsModel: env.BOT_TTS_MODEL
      }
    ],
    capabilities: [
      capability(
        "chat",
        "普通聊天",
        llmConfigured,
        llmConfigured && llmEnabled && chatEnabled,
        !llmConfigured
          ? "请先完成模型接入。"
          : !llmEnabled
            ? "模型能力已全局关闭。"
            : !chatEnabled
              ? "普通聊天开关已关闭。"
              : "可分配给群组和用户。"
      ),
      capability(
        "smartkit",
        "SmartKit",
        smartkitConfigured,
        smartkitConfigured,
        smartkitConfigured ? "已接入，可分配给群组和用户。" : "请先在能力配置中接入 SmartKit。"
      ),
      capability(
        "webSearch",
        "联网搜索",
        braveConfigured,
        braveConfigured && webSearchEnabled,
        !braveConfigured
          ? "请先配置 Brave Search API Key。"
          : !webSearchEnabled
            ? "联网搜索开关尚未开启。"
            : "可分配给群组和用户。"
      ),
      capability(
        "voiceReply",
        "语音回复",
        llmConfigured && Boolean(trim(env.BOT_TTS_MODEL)),
        llmConfigured && Boolean(trim(env.BOT_TTS_MODEL)) && voiceReplyEnabled,
        !llmConfigured
          ? "请先完成模型接入。"
          : !trim(env.BOT_TTS_MODEL)
            ? "请先配置语音模型。"
            : !voiceReplyEnabled
              ? "语音回复开关尚未开启。"
              : "可分配给群组和用户。"
      ),
      capability(
        "vision",
        "视觉理解",
        llmConfigured && Boolean(trim(env.BOT_VISION_MODEL)),
        llmConfigured && Boolean(trim(env.BOT_VISION_MODEL)) && visionEnabled,
        !llmConfigured
          ? "请先完成模型接入。"
          : !trim(env.BOT_VISION_MODEL)
            ? "请先配置视觉模型。"
            : !visionEnabled
              ? "视觉理解开关尚未开启。"
              : "可分配给群组和用户。"
      )
    ],
    braveEndpoint: BRAVE_SEARCH_ENDPOINT
  };
}

function buildOnboarding(env) {
  const requiredReady = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.BOT_LLM_API_KEY);
  return {
    complete: requiredReady,
    missing: {
      feishuAppId: !env.FEISHU_APP_ID,
      feishuAppSecret: !env.FEISHU_APP_SECRET,
      llmApiKey: !env.BOT_LLM_API_KEY
    }
  };
}

function createFeishuClient(env) {
  const appId = trim(env.FEISHU_APP_ID);
  const appSecret = trim(env.FEISHU_APP_SECRET);
  if (!appId || !appSecret) {
    throw new Error("Feishu credentials are incomplete. Fill FEISHU_APP_ID and FEISHU_APP_SECRET first.");
  }
  return new Lark.Client({
    appId,
    appSecret,
    loggerLevel: Lark.LoggerLevel.info
  });
}

function hasRuntimeEnvChanges(previousEnv, nextEnv) {
  return RESTART_REQUIRED_ENV_KEYS.some((key) => String(previousEnv?.[key] ?? "") !== String(nextEnv?.[key] ?? ""));
}

export function buildBootstrapPayload(options = {}) {
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  const settings = readConsoleSettings();
  return {
    runtimeHome: getRuntimeHome(),
    envPath: getEnvPath(),
    settingsPath: getSettingsPath(),
    env,
    settings,
    docs: {
      stepApiKey: STEP_PROVIDER_DOC_URL,
      braveSearch: BRAVE_SEARCH_DOC_URL
    },
    catalogs: buildCatalogs(env),
    onboarding: buildOnboarding(env),
    restartRequired: Boolean(options.restartRequired)
  };
}

export function saveDesktopConfig(payload = {}) {
  ensureDefaultRuntimeConfig();
  const previousEnv = readEnvConfig();
  const previousSettings = readConsoleSettings();
  writeEnvConfig(payload?.env ?? previousEnv);
  writeConsoleSettings(payload?.settings ?? previousSettings);
  const nextEnv = readEnvConfig();
  const restartRequired = hasRuntimeEnvChanges(previousEnv, nextEnv);
  return buildBootstrapPayload({ restartRequired });
}

export async function readHealthStatus() {
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  const target = `http://${env.HEALTH_BIND}:${env.HEALTH_PORT}/health`;
  try {
    const response = await fetch(target, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return {
      ok: true,
      health: await response.json(),
      target
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      target
    };
  }
}

export async function sendFeishuTestMessage(payload = {}) {
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  const client = createFeishuClient(env);
  const receiveIdType = ["chat_id", "open_id", "user_id"].includes(trim(payload?.receiveIdType))
    ? trim(payload.receiveIdType)
    : "chat_id";
  const receiveId = trim(payload?.receiveId);

  if (!receiveId) {
    throw new Error("Please provide a Feishu chat_id / open_id / user_id for the test message.");
  }

  const now = new Date().toLocaleString("zh-CN", {
    hour12: false
  });
  const response = await client.im.v1.message.create({
    params: {
      receive_id_type: receiveIdType
    },
    data: {
      receive_id: receiveId,
      msg_type: "text",
      content: JSON.stringify({
        text: `Feishu Bot 测试消息\n时间：${now}\n飞书凭据可用，机器人可以主动发消息。\n现在你可以直接在飞书里给机器人发送 /help。`
      })
    }
  });

  if ((response.code ?? 0) !== 0) {
    throw new Error(response.msg || "failed to send feishu test message");
  }

  return {
    receiveIdType,
    receiveId,
    messageId: response.data?.message_id || ""
  };
}

function launchOpen(fullPath) {
  const child = spawn("open", [fullPath], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export function openConfigPath() {
  const fullPath = getEnvPath();
  launchOpen(fullPath);
  return { path: fullPath };
}

export function openDataPath() {
  const fullPath = getDataDir();
  launchOpen(fullPath);
  return { path: fullPath };
}

function resolveDistDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
}

function resolveBackendEntry() {
  return path.join(resolveDistDir(), "index.js");
}

async function waitForHealthReady() {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const health = await readHealthStatus();
    if (health.ok) {
      return health;
    }
    await delay(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error("backend did not become healthy in time");
}

export async function restartDetachedBackend() {
  ensureDefaultRuntimeConfig();
  const record = readPidRecord();
  if (record?.pid) {
    await stopPid(record.pid);
    clearPidRecord();
  }

  const backendEntry = resolveBackendEntry();
  const backendRoot = path.resolve(resolveDistDir(), "..");
  const child = spawn(process.execPath, [backendEntry], {
    cwd: backendRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      FEISHU_BOT_HOME: getRuntimeHome()
    }
  });
  child.unref();
  writePidRecord(child.pid);
  const health = await waitForHealthReady();
  return {
    ...buildBootstrapPayload({ restartRequired: false }),
    health
  };
}

export async function stopDetachedBackend() {
  const record = readPidRecord();
  if (record?.pid) {
    await stopPid(record.pid);
  }
  clearPidRecord();
  return {
    stopped: true
  };
}
