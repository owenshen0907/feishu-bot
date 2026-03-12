import fs from "node:fs";
import path from "node:path";
import { getDiagnosticComponentIdFromCapability, isDiagnosticComponentCapability } from "./diagnostic-components.js";
import type { CapabilityAccessResult, CapabilityGate, CapabilityID, CapabilityAccessSource, Scope } from "./types.js";

interface RuleCapabilities {
  chat: boolean;
  diagnosticHttp: boolean;
  customComponents: Record<string, boolean>;
  webSearch: boolean;
  voiceReply: boolean;
  vision: boolean;
}

interface ConsoleRule {
  id: string;
  name: string;
  capabilities: RuleCapabilities;
}

interface CapabilitySettings {
  users: ConsoleRule[];
  groups: ConsoleRule[];
}

const defaultCapabilities = (): RuleCapabilities => ({
  chat: true,
  diagnosticHttp: false,
  customComponents: {},
  webSearch: false,
  voiceReply: false,
  vision: false
});

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveConfigHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = trim(env.FEISHU_BOT_HOME);
  return configured ? path.resolve(configured) : process.cwd();
}

function resolveSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveConfigHome(env), "console-settings.json");
}

function sanitizeRule(raw: unknown): ConsoleRule {
  const base = defaultCapabilities();
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const capabilities = value.capabilities && typeof value.capabilities === "object"
    ? value.capabilities as Record<string, unknown>
    : {};

  return {
    id: trim(value.id),
    name: trim(value.name),
    capabilities: {
      chat: Boolean(capabilities.chat ?? base.chat),
      diagnosticHttp: Boolean(capabilities.diagnosticHttp ?? capabilities.smartkit ?? base.diagnosticHttp),
      customComponents: capabilities.customComponents && typeof capabilities.customComponents === "object"
        ? Object.fromEntries(
            Object.entries(capabilities.customComponents as Record<string, unknown>)
              .map(([key, value]) => [trim(key), Boolean(value)])
              .filter(([key]) => Boolean(key))
          )
        : {},
      webSearch: Boolean(capabilities.webSearch ?? base.webSearch),
      voiceReply: Boolean(capabilities.voiceReply ?? base.voiceReply),
      vision: Boolean(capabilities.vision ?? base.vision)
    }
  };
}

function defaultSettings(): CapabilitySettings {
  return {
    users: [],
    groups: []
  };
}

function capabilityLabel(capabilityID: CapabilityID): string {
  if (isDiagnosticComponentCapability(capabilityID)) {
    return "自定义 HTTP 组件";
  }
  switch (capabilityID) {
    case "chat":
      return "普通聊天";
    case "diagnosticHttp":
    case "smartkit":
      return "自定义 HTTP 组件";
    case "webSearch":
      return "联网搜索";
    case "voiceReply":
      return "语音回复";
    case "vision":
      return "视觉理解";
  }
}

function defaultAccess(capabilityID: CapabilityID): CapabilityAccessResult {
  if (capabilityID === "chat") {
    return {
      allowed: true,
      source: "default",
      reason: "普通聊天默认可用；如需关闭，可在对象能力页关闭对应开关。"
    };
  }

  return {
    allowed: false,
    source: "default",
    reason: `当前对象还没有开启${capabilityLabel(capabilityID)}，请在能力页打开开关后再试。`
  };
}

function ruleAccess(
  capabilityID: CapabilityID,
  source: CapabilityAccessSource,
  rule: ConsoleRule
): CapabilityAccessResult {
  const allowed = isDiagnosticComponentCapability(capabilityID)
    ? (rule.capabilities.customComponents[getDiagnosticComponentIdFromCapability(capabilityID)] ?? rule.capabilities.diagnosticHttp)
    : capabilityID === "smartkit"
      ? rule.capabilities.diagnosticHttp
      : capabilityID === "diagnosticHttp"
        ? rule.capabilities.diagnosticHttp
        : rule.capabilities[capabilityID];
  const objectName = rule.name || rule.id || "当前对象";

  return {
    allowed,
    source,
    reason: allowed
      ? `${objectName}已开启${capabilityLabel(capabilityID)}。`
      : `${objectName}尚未开启${capabilityLabel(capabilityID)}。`
  };
}

export class ConsoleCapabilityPolicy implements CapabilityGate {
  private cachedSettings = defaultSettings();
  private cachedMtimeMs = -1;
  private cachedSettingsPath = "";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  canUse(capabilityID: CapabilityID, context: { scope: Scope; chatId: string; userId: string }): CapabilityAccessResult {
    const settings = this.readSettings();
    const userRule = this.findRule(settings.users, context.userId);
    if (userRule) {
      return ruleAccess(capabilityID, "user", userRule);
    }

    if (context.scope === "group") {
      const groupRule = this.findRule(settings.groups, context.chatId);
      if (groupRule) {
        return ruleAccess(capabilityID, "group", groupRule);
      }
    }

    return defaultAccess(capabilityID);
  }

  private readSettings(): CapabilitySettings {
    const settingsPath = resolveSettingsPath(this.env);
    if (!fs.existsSync(settingsPath)) {
      this.cachedSettingsPath = settingsPath;
      this.cachedSettings = defaultSettings();
      this.cachedMtimeMs = -1;
      return this.cachedSettings;
    }

    const stat = fs.statSync(settingsPath);
    if (this.cachedSettingsPath === settingsPath && this.cachedMtimeMs === stat.mtimeMs) {
      return this.cachedSettings;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      const permissions = raw.permissions && typeof raw.permissions === "object"
        ? raw.permissions as Record<string, unknown>
        : {};
      this.cachedSettings = {
        groups: Array.isArray(permissions.groups) ? permissions.groups.map(sanitizeRule).filter((rule) => Boolean(rule.id)) : [],
        users: Array.isArray(permissions.users) ? permissions.users.map(sanitizeRule).filter((rule) => Boolean(rule.id)) : []
      };
    } catch {
      this.cachedSettings = defaultSettings();
    }

    this.cachedSettingsPath = settingsPath;
    this.cachedMtimeMs = stat.mtimeMs;
    return this.cachedSettings;
  }

  private findRule(rules: ConsoleRule[], identifier: string): ConsoleRule | undefined {
    const target = identifier.trim();
    if (!target) {
      return undefined;
    }
    return rules.find((rule) => rule.id === target);
  }
}
