import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import OpenAI from "openai";
import Database from "better-sqlite3";
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
  normalizeDiagnosticEnvAliases,
  readConsoleSettings,
  readEnvConfig,
  resolveDiagnosticEnvValues,
  writeConsoleSettings,
  writeEnvConfig
} from "./runtime-config.mjs";
import { parseDiagnosticComponentConfig } from "./custom-http-manifest.mjs";

const PID_FILE = "desktop-backend.pid";
const HEALTH_POLL_TIMEOUT_MS = 20000;
const HEALTH_POLL_INTERVAL_MS = 400;
const RESTART_REQUIRED_ENV_KEYS = [
  "BOT_PROFILE",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_BOT_NAME",
  "DIAGNOSTIC_HTTP_BASE_URL",
  "DIAGNOSTIC_HTTP_TOKEN",
  "DIAGNOSTIC_HTTP_CALLER",
  "DIAGNOSTIC_HTTP_TIMEOUT_MS",
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

function normalizeCommand(value) {
  const raw = trim(value).replace(/^\//, "").toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, "");
}

function normalizeBoolean(value, fallback = false) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "true";
}

function mergeEnvOverride(payload = {}) {
  const current = readEnvConfig();
  return normalizeDiagnosticEnvAliases({
    ...current,
    ...(payload?.env && typeof payload.env === "object" ? payload.env : {})
  });
}

function maskIdentifier(value) {
  const text = trim(value);
  if (text.length <= 8) {
    return text || "-";
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function shortIdentifier(value) {
  const text = trim(value);
  if (!text) {
    return "-";
  }
  if (text.length <= 12) {
    return text;
  }
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
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

function normalizeDiagnosticCatalogComponents(env, settings = {}) {
  const components = Array.isArray(settings?.components?.diagnosticHttp)
    ? settings.components.diagnosticHttp
    : settings?.components?.diagnosticHttp
      ? [settings.components.diagnosticHttp]
      : [];
  const normalized = components
    .map((component, index) => {
      const name = trim(component?.name);
      const summary = trim(component?.summary);
      const usageDescription = trim(component?.usageDescription);
      const examplePrompts = Array.isArray(component?.examplePrompts) ? component.examplePrompts.map((item) => trim(item)).filter(Boolean) : [];
      const baseUrl = trim(component?.baseUrl).replace(/\/$/, "");
      return {
        id: trim(component?.id) || `component-${index + 1}`,
        name: name || "自定义 HTTP 组件",
        enabled: typeof component?.enabled === "boolean" ? component.enabled : true,
        command: normalizeCommand(component?.command),
        summary,
        usageDescription,
        examplePrompts,
        baseUrl,
        token: trim(component?.token),
        caller: trim(component?.caller) || "feishu-bot",
        timeoutMs: Number(component?.timeoutMs || 20000),
        _hasContent: Boolean(name || normalizeCommand(component?.command) || summary || usageDescription || examplePrompts.length || baseUrl)
      };
    })
    .filter((component) => component._hasContent)
    .map(({ _hasContent, ...component }) => component);

  if (normalized.length > 0) {
    return normalized;
  }

  const diagnostic = resolveDiagnosticEnvValues(env);
  const legacyBaseUrl = trim(diagnostic.baseUrl).replace(/\/$/, "");
  if (!legacyBaseUrl) {
    return [];
  }

  return [
    {
      id: "legacy-diagnostic-http",
      name: "自定义 HTTP 组件",
      enabled: true,
      command: "",
      summary: "",
      usageDescription: "",
      examplePrompts: [],
      baseUrl: legacyBaseUrl,
      token: trim(diagnostic.token),
      caller: trim(diagnostic.caller) || "feishu-bot",
      timeoutMs: Number(diagnostic.timeoutMs || 20000)
    }
  ];
}

function buildCatalogs(env, settings = {}) {
  const step = getStepProviderDefaults();
  const llmConfigured = Boolean(trim(env.BOT_LLM_API_KEY) && trim(env.BOT_LLM_BASE_URL));
  const llmEnabled = normalizeBoolean(env.BOT_LLM_ENABLED, true);
  const chatEnabled = normalizeBoolean(env.BOT_CHAT_ENABLED, true);
  const diagnosticComponents = normalizeDiagnosticCatalogComponents(env, settings);
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

  const capabilities = [
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
    )
  ];

  for (const component of diagnosticComponents) {
    const configured = Boolean(component.baseUrl);
    const enabled = configured && component.enabled !== false;
    capabilities.push(
      capability(
        `component:${component.id}`,
        component.name,
        configured,
        enabled,
        !configured
          ? "这是一个自定义 HTTP 组件；请先补齐地址与鉴权信息，再保存并测试。"
          : !enabled
            ? "组件已经接入，但全局开关关闭；打开后才能授权给群组和用户。"
            : component.summary || component.usageDescription || "组件已接入，可分配给群组和用户。"
      )
    );
  }

  capabilities.push(
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
  );

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
    capabilities,
    braveEndpoint: BRAVE_SEARCH_ENDPOINT
  };
}

function buildOnboarding(env) {
  const requiredReady = Boolean(
    env.FEISHU_APP_ID &&
    env.FEISHU_APP_SECRET &&
    env.BOT_LLM_API_KEY &&
    env.BOT_LLM_BASE_URL &&
    env.BOT_LLM_MODEL
  );
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
    loggerLevel: Lark.LoggerLevel.error
  });
}

function createModelClient(env) {
  const apiKey = trim(env.BOT_LLM_API_KEY);
  const baseURL = trim(env.BOT_LLM_BASE_URL);
  if (!apiKey || !baseURL) {
    throw new Error("Model credentials are incomplete. Fill BOT_LLM_API_KEY and BOT_LLM_BASE_URL first.");
  }
  return new OpenAI({
    apiKey,
    baseURL
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function resolveSessionDbPath(env) {
  const raw = trim(env.SESSION_DB_PATH) || "./data/feishu-bot.sqlite";
  if (raw === ":memory:") {
    return null;
  }
  return path.isAbsolute(raw) ? raw : path.resolve(getRuntimeHome(), raw);
}

function detectUserIdType(userId) {
  return trim(userId).startsWith("ou_") ? "open_id" : "user_id";
}

function displayName(...values) {
  for (const value of values) {
    const name = trim(value);
    if (name) {
      return name;
    }
  }
  return "";
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row?.name);
}

function tableHasColumn(db, tableName, columnName) {
  if (!tableExists(db, tableName)) {
    return false;
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column?.name === columnName);
}

async function resolveRequesterName(client, requesterId) {
  const normalized = trim(requesterId);
  if (!normalized) {
    return "";
  }

  try {
    const response = await client.contact.v3.user.get({
      path: {
        user_id: normalized
      },
      params: {
        user_id_type: detectUserIdType(normalized)
      }
    });
    return displayName(response.data?.user?.name, response.data?.user?.nickname);
  } catch {
    return "";
  }
}

async function resolveChatName(client, chatId) {
  const normalized = trim(chatId);
  if (!normalized) {
    return "";
  }

  try {
    const response = await client.im.v1.chat.get({
      path: {
        chat_id: normalized
      }
    });
    return displayName(response.data?.name, response.data?.i18n_names?.zh_cn, response.data?.i18n_names?.en_us);
  } catch {
    return "";
  }
}

async function enrichThreadRows(db, rows, env) {
  if (!rows.length) {
    return rows;
  }

  const hasRequesterNameColumn = tableHasColumn(db, "sessions", "requester_name");
  const hasChatNameColumn = tableHasColumn(db, "sessions", "chat_name");
  if (!hasRequesterNameColumn && !hasChatNameColumn) {
    return rows;
  }

  const needsEnrichment = rows.some((row) => {
    const needsRequesterName = !displayName(row.requester_name) && trim(row.requester_id);
    const needsChatName = trim(row.scope) === "group" && !displayName(row.chat_name) && trim(row.chat_id);
    return needsRequesterName || needsChatName;
  });
  if (!needsEnrichment) {
    return rows;
  }
  let client;
  try {
    client = createFeishuClient(env);
  } catch {
    return rows;
  }

  for (const row of rows) {
    const needsRequesterName = !displayName(row.requester_name) && trim(row.requester_id);
    const needsChatName = trim(row.scope) === "group" && !displayName(row.chat_name) && trim(row.chat_id);
    if (!needsRequesterName && !needsChatName) {
      continue;
    }

    const requesterName = needsRequesterName ? await resolveRequesterName(client, row.requester_id) : displayName(row.requester_name);
    const chatName = needsChatName ? await resolveChatName(client, row.chat_id) : displayName(row.chat_name);

    if (requesterName) {
      row.requester_name = requesterName;
    }
    if (chatName) {
      row.chat_name = chatName;
    }

    const updates = [];
    const values = [];
    if (hasRequesterNameColumn && requesterName) {
      updates.push("requester_name = ?");
      values.push(requesterName);
    }
    if (hasChatNameColumn && chatName) {
      updates.push("chat_name = ?");
      values.push(chatName);
    }
    if (!updates.length) {
      continue;
    }
    values.push(row.session_id);
    db.prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE session_id = ?`).run(...values);
  }

  return rows;
}

function buildThreadTitle(row) {
  if (trim(row.scope) === "group") {
    return displayName(row.chat_name) || "未命名群聊";
  }
  return displayName(row.requester_name) || "未命名用户";
}

function buildThreadSubtitle(row) {
  if (trim(row.scope) === "group") {
    return displayName(row.requester_name) ? `群聊 · ${displayName(row.requester_name)}` : "群聊";
  }
  return "私聊";
}

function hasRuntimeEnvChanges(previousEnv, nextEnv) {
  return RESTART_REQUIRED_ENV_KEYS.some((key) => String(previousEnv?.[key] ?? "") !== String(nextEnv?.[key] ?? ""));
}

function normalizeRecordedTimestamp(value) {
  const raw = trim(value);
  if (!raw) {
    return new Date(0).toISOString();
  }
  if (/^\d{10,13}$/.test(raw)) {
    const millis = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    if (Number.isFinite(millis)) {
      return new Date(millis).toISOString();
    }
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return raw;
}

function compareRecordedTimestamps(left, right) {
  return toTimestampNumber(left) - toTimestampNumber(right);
}

function toTimestampNumber(value) {
  const raw = trim(value);
  if (/^\d{10,13}$/.test(raw)) {
    return raw.length === 10 ? Number(raw) * 1000 : Number(raw);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
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
    catalogs: buildCatalogs(env, settings),
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

export async function listRecentThreads(limit = 40) {
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  const dbPath = resolveSessionDbPath(env);
  if (!dbPath || !fs.existsSync(dbPath)) {
    return [];
  }

  const db = new Database(dbPath, { fileMustExist: true });
  try {
    if (!tableExists(db, "sessions")) {
      return [];
    }
    const rows = db.prepare(`
      SELECT *
      FROM sessions
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit);
    const enrichedRows = await enrichThreadRows(db, rows, env);

    return enrichedRows.map((row) => ({
      id: String(row.session_id ?? ""),
      title: buildThreadTitle(row),
      subtitle: buildThreadSubtitle(row),
      preview: trim(row.last_question) || "暂无上下文",
      scope: trim(row.scope) || "p2p",
      status: trim(row.job_status) || (trim(row.job_id) ? "accepted" : "completed"),
      requesterId: String(row.requester_id ?? ""),
      chatId: String(row.chat_id ?? ""),
      conversationId: String(row.conversation_id ?? ""),
      jobId: trim(row.job_id) || null,
      updatedAt: String(row.updated_at ?? "")
    }));
  } finally {
    db.close();
  }
}

export function listThreadMessages(payload = {}) {
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  const dbPath = resolveSessionDbPath(env);
  const sessionId = trim(payload?.sessionId);
  const limit = Math.max(1, Number(payload?.limit ?? 200));
  if (!dbPath || !fs.existsSync(dbPath) || !sessionId) {
    return [];
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, "sessions")) {
      return [];
    }
    if (tableExists(db, "session_messages")) {
      const messages = db.prepare(`
        SELECT
          m.id,
          m.role,
          COALESCE(m.sender_name, CASE WHEN m.role = 'assistant' THEN ? ELSE s.requester_name END) AS sender_name,
          m.content,
          m.created_at
        FROM session_messages m
        LEFT JOIN sessions s ON s.session_id = m.session_id
        WHERE m.session_id = ?
        ORDER BY m.id ASC
        LIMIT ?
      `).all(trim(env.FEISHU_BOT_NAME) || "Feishu Bot", sessionId, limit);

      if (messages.length > 0) {
        return messages
          .map((row) => ({
            id: String(row.id ?? ""),
            sortId: Number(row.id ?? 0),
            role: trim(row.role) || "assistant",
            senderName: displayName(row.sender_name) || (trim(row.role) === "assistant" ? (trim(env.FEISHU_BOT_NAME) || "Feishu Bot") : "用户"),
            content: trim(row.content),
            createdAt: normalizeRecordedTimestamp(row.created_at)
          }))
          .sort((left, right) => compareRecordedTimestamps(left.createdAt, right.createdAt) || left.sortId - right.sortId)
          .map(({ sortId: _sortId, ...message }) => message);
      }
    }

    const row = db.prepare(`
      SELECT *
      FROM sessions
      WHERE session_id = ?
      LIMIT 1
    `).get(sessionId);
    if (!row) {
      return [];
    }

    return [
      {
        id: `${sessionId}:fallback`,
        role: "user",
        senderName: trim(row.scope) === "group" ? (displayName(row.requester_name) || "群成员") : (displayName(row.requester_name) || "用户"),
        content: trim(row.last_question) || "暂无消息内容",
        createdAt: String(row.updated_at ?? "")
      }
    ];
  } finally {
    db.close();
  }
}

export async function testFeishuConnectivity() {
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  const appId = trim(env.FEISHU_APP_ID);
  const appSecret = trim(env.FEISHU_APP_SECRET);

  if (!appId || !appSecret) {
    throw new Error("请先填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET。");
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    })
  });

  if (!response.ok) {
    throw new Error(`飞书连通性测试失败：HTTP ${response.status}`);
  }

  const payload = await response.json();
  if ((payload?.code ?? -1) !== 0 || !trim(payload?.tenant_access_token)) {
    throw new Error(payload?.msg || "飞书凭据不可用，无法获取 tenant_access_token。");
  }

  return {
    kind: "feishu",
    title: "飞书连通成功",
    detail: `已成功获取 tenant_access_token，当前 App ID ${maskIdentifier(appId)} 可用。`
  };
}

export async function testModelConnectivity() {
  ensureDefaultRuntimeConfig();
  const env = readEnvConfig();
  const model = trim(env.BOT_LLM_MODEL);

  if (!model) {
    throw new Error("请先填写 BOT_LLM_MODEL。");
  }

  const client = createModelClient(env);
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: "ping"
      }
    ],
    max_tokens: 8
  }, {
    timeout: Number(env.BOT_LLM_TIMEOUT_MS || 15000)
  });

  if (!response?.id || !Array.isArray(response?.choices) || response.choices.length === 0) {
    throw new Error("模型接口已响应，但未返回可识别结果。");
  }

  return {
    kind: "model",
    title: "模型连通成功",
    detail: `已成功调用 ${trim(env.BOT_LLM_PROVIDER) || "provider"} / ${model}。`
  };
}

function extractModelText(response) {
  if (typeof response?.choices?.[0]?.message?.content === "string") {
    return trim(response.choices[0].message.content);
  }
  if (Array.isArray(response?.choices?.[0]?.message?.content)) {
    return response.choices[0].message.content
      .map((item) => trim(item?.text))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export async function polishConsoleCopy(payload = {}) {
  const text = trim(payload?.text);
  const purpose = trim(payload?.purpose) || "飞书机器人设置文案";
  if (!text) {
    throw new Error("请先输入想要润色的内容。");
  }

  const env = mergeEnvOverride(payload);
  const model = trim(env.BOT_LLM_MODEL);
  if (!model) {
    throw new Error("请先填写 BOT_LLM_MODEL。");
  }

  const client = createModelClient(env);
  const response = await client.chat.completions.create({
    model,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: [
          "你是中文产品文案编辑。",
          "请把用户提供的配置文案润色成更清晰、自然、可直接上线使用的版本。",
          "不要编造新事实，不要新增未提供的能力、命令、链接、ID 或承诺。",
          "保留原文里的 Slash 命令、专有名词、数字、换行结构和 Markdown 语义。",
          "只输出润色后的正文，不要解释。"
        ].join(" ")
      },
      {
        role: "user",
        content: `用途：${purpose}\n原文：\n${text}`
      }
    ],
    max_tokens: Math.max(180, Math.min(800, text.length * 2))
  }, {
    timeout: Number(env.BOT_LLM_TIMEOUT_MS || 15000)
  });

  const polished = extractModelText(response);
  if (!polished) {
    throw new Error("模型已响应，但没有返回可用的润色结果。");
  }

  return {
    text: polished
  };
}

export function importDiagnosticComponentConfig(payload = {}) {
  const rawText = trim(payload?.text);
  const parsed = parseDiagnosticComponentConfig(rawText);
  return parsed;
}

export async function testDiagnosticComponentConnectivity(payload = {}) {
  ensureDefaultRuntimeConfig();
  const env = mergeEnvOverride(payload);
  const component = payload?.component && typeof payload.component === "object" ? payload.component : {};
  const diagnostic = resolveDiagnosticEnvValues(env);
  const baseUrl = trim(component?.baseUrl || diagnostic.baseUrl).replace(/\/$/, "");
  const caller = trim(component?.caller || diagnostic.caller) || "feishu-bot";
  const timeoutMs = Number(component?.timeoutMs || diagnostic.timeoutMs || 20000);
  const token = trim(component?.token || diagnostic.token);

  if (!baseUrl) {
    throw new Error("请先填写组件 Base URL，或先粘贴一键配置 JSON。");
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/bridge/health`, {
    headers: {
      Accept: "application/json",
      "X-Bridge-Caller": caller,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(`自定义 HTTP 组件连通性测试失败：HTTP ${response.status}`);
  }

  const result = await response.json();
  if (trim(result?.code) !== "ok") {
    throw new Error(result?.message || "组件健康检查已响应，但未返回成功状态。");
  }

  const providerSummary = Object.entries(result?.data?.providers || {})
    .map(([key, value]) => `${key}:${value?.configured ? "ok" : "missing"}`)
    .join(" / ");

  return {
    kind: "diagnosticHttp",
    title: "自定义 HTTP 组件连通成功",
    detail: `已成功访问 ${baseUrl}/api/bridge/health，caller=${caller}${providerSummary ? `，依赖状态 ${providerSummary}` : ""}。`
  };
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
