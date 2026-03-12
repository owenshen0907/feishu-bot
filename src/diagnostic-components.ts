import fs from "node:fs";
import path from "node:path";
import { DiagnosticHttpClient } from "./diagnostic-http-client.js";
import type {
  CapabilityID,
  DiagnosticGateway,
  DiagnosticComponentProfile,
  DiagnosticGatewayProvider,
  DynamicDiagnosticCapabilityID
} from "./types.js";

const DEFAULT_COMPONENT_NAME = "自定义 HTTP 组件";
const DEFAULT_COMPONENT_CALLER = "feishu-bot";
const DEFAULT_COMPONENT_TIMEOUT_MS = 20000;
const LEGACY_COMPONENT_ID = "legacy-diagnostic-http";
const RESERVED_COMPONENT_COMMANDS = new Set([
  "help",
  "new",
  "trace",
  "trace-async",
  "uid",
  "uid-async",
  "job",
  "chat",
  "chat-reset",
  "memory"
]);

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => trim(value)).filter(Boolean);
}

function normalizeTimeout(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(trim(value));
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_COMPONENT_TIMEOUT_MS;
}

export function normalizeComponentCommand(value: unknown): string {
  const raw = trim(value).replace(/^\//, "").toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, "");
}

function buildCommandUsageMap(components: DiagnosticComponentProfile[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const component of components) {
    const command = normalizeComponentCommand(component.command);
    if (!command) {
      continue;
    }
    const ids = usage.get(command) ?? [];
    ids.push(component.id);
    usage.set(command, ids);
  }
  return usage;
}

export function getComponentCommandIssue(
  component: Pick<DiagnosticComponentProfile, "id" | "command">,
  components: DiagnosticComponentProfile[]
): string | null {
  const command = normalizeComponentCommand(component.command);
  if (!command) {
    return null;
  }
  if (RESERVED_COMPONENT_COMMANDS.has(command)) {
    return "reserved";
  }
  const usage = buildCommandUsageMap(components).get(command) ?? [];
  return usage.length > 1 ? "duplicate" : null;
}

export function resolveUsableComponentCommand(
  component: Pick<DiagnosticComponentProfile, "id" | "command">,
  components: DiagnosticComponentProfile[]
): string {
  const command = normalizeComponentCommand(component.command);
  return command && !getComponentCommandIssue(component, components) ? command : "";
}

function resolveConfigHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = trim(env.FEISHU_BOT_HOME);
  return configured ? path.resolve(configured) : process.cwd();
}

function resolveSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveConfigHome(env), "console-settings.json");
}

function sanitizeComponent(raw: unknown, fallbackId: string): DiagnosticComponentProfile | null {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawName = trim(value.name);
  const rawCommand = normalizeComponentCommand(value.command);
  const rawSummary = trim(value.summary);
  const rawUsageDescription = trim(value.usageDescription);
  const rawExamplePrompts = normalizeStringArray(value.examplePrompts);
  const rawBaseUrl = trim(value.baseUrl).replace(/\/$/, "");
  const component = {
    id: trim(value.id) || fallbackId,
    name: rawName || DEFAULT_COMPONENT_NAME,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    command: rawCommand,
    summary: rawSummary,
    usageDescription: rawUsageDescription,
    examplePrompts: rawExamplePrompts,
    baseUrl: rawBaseUrl,
    token: trim(value.token),
    caller: trim(value.caller) || DEFAULT_COMPONENT_CALLER,
    timeoutMs: normalizeTimeout(value.timeoutMs)
  };

  const hasContent = Boolean(
    rawName ||
    rawCommand ||
    rawSummary ||
    rawUsageDescription ||
    rawExamplePrompts.length ||
    rawBaseUrl
  );
  return hasContent ? component : null;
}

function deriveLegacyComponent(rawSettings: Record<string, unknown>, env: NodeJS.ProcessEnv): DiagnosticComponentProfile | null {
  const baseUrl = trim(env.DIAGNOSTIC_HTTP_BASE_URL || env.SMARTKIT_BASE_URL).replace(/\/$/, "");
  if (!baseUrl) {
    return null;
  }

  const components = rawSettings.components && typeof rawSettings.components === "object"
    ? rawSettings.components as Record<string, unknown>
    : {};
  const legacyRaw = components.diagnosticHttp && typeof components.diagnosticHttp === "object"
    ? components.diagnosticHttp
    : {};
  const legacy = sanitizeComponent({
    id: LEGACY_COMPONENT_ID,
    name: trim((legacyRaw as Record<string, unknown>).name) || DEFAULT_COMPONENT_NAME,
    enabled: true,
    command: normalizeComponentCommand((legacyRaw as Record<string, unknown>).command),
    summary: trim((legacyRaw as Record<string, unknown>).summary),
    usageDescription: trim((legacyRaw as Record<string, unknown>).usageDescription),
    examplePrompts: normalizeStringArray((legacyRaw as Record<string, unknown>).examplePrompts),
    baseUrl,
    token: trim(env.DIAGNOSTIC_HTTP_TOKEN || env.SMARTKIT_TOKEN),
    caller: trim(env.DIAGNOSTIC_HTTP_CALLER || env.SMARTKIT_CALLER) || DEFAULT_COMPONENT_CALLER,
    timeoutMs: normalizeTimeout(env.DIAGNOSTIC_HTTP_TIMEOUT_MS || env.SMARTKIT_TIMEOUT_MS)
  }, LEGACY_COMPONENT_ID);

  return legacy;
}

function sanitizeComponents(rawSettings: Record<string, unknown>, env: NodeJS.ProcessEnv): DiagnosticComponentProfile[] {
  const components = rawSettings.components && typeof rawSettings.components === "object"
    ? rawSettings.components as Record<string, unknown>
    : {};
  const rawDiagnosticHttp = components.diagnosticHttp;

  let normalized: DiagnosticComponentProfile[] = [];
  if (Array.isArray(rawDiagnosticHttp)) {
    normalized = rawDiagnosticHttp
      .map((item, index) => sanitizeComponent(item, `component-${index + 1}`))
      .filter((item): item is DiagnosticComponentProfile => Boolean(item));
  } else if (rawDiagnosticHttp && typeof rawDiagnosticHttp === "object") {
    const migrated = sanitizeComponent(rawDiagnosticHttp, LEGACY_COMPONENT_ID);
    if (migrated) {
      normalized = [migrated];
    }
  }

  if (normalized.length > 0) {
    return normalized;
  }

  const legacy = deriveLegacyComponent(rawSettings, env);
  return legacy ? [legacy] : [];
}

export function capabilityIdForDiagnosticComponent(componentId: string): DynamicDiagnosticCapabilityID {
  return `component:${componentId}` as DynamicDiagnosticCapabilityID;
}

export function isDiagnosticComponentCapability(capabilityID: string): capabilityID is DynamicDiagnosticCapabilityID {
  return capabilityID.startsWith("component:");
}

export function getDiagnosticComponentIdFromCapability(capabilityID: string): string {
  return capabilityID.replace(/^component:/, "").trim();
}

export class ConsoleDiagnosticComponentProvider {
  private cachedSettingsPath = "";
  private cachedMtimeMs = -1;
  private cachedComponents: DiagnosticComponentProfile[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  listComponents(): DiagnosticComponentProfile[] {
    const settingsPath = resolveSettingsPath(this.env);
    if (!fs.existsSync(settingsPath)) {
      this.cachedSettingsPath = settingsPath;
      this.cachedMtimeMs = -1;
      this.cachedComponents = sanitizeComponents({}, this.env);
      return this.cachedComponents;
    }

    const stat = fs.statSync(settingsPath);
    if (this.cachedSettingsPath === settingsPath && this.cachedMtimeMs === stat.mtimeMs) {
      return this.cachedComponents;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      this.cachedComponents = sanitizeComponents(raw, this.env);
    } catch {
      this.cachedComponents = sanitizeComponents({}, this.env);
    }

    this.cachedSettingsPath = settingsPath;
    this.cachedMtimeMs = stat.mtimeMs;
    return this.cachedComponents;
  }

  getComponent(componentId: string): DiagnosticComponentProfile | null {
    const normalized = trim(componentId);
    if (!normalized) {
      return null;
    }
    return this.listComponents().find((component) => component.id === normalized) ?? null;
  }
}

export class ConsoleDiagnosticGatewayProvider implements DiagnosticGatewayProvider {
  private readonly componentProvider: ConsoleDiagnosticComponentProvider;
  private readonly gatewayCache = new Map<string, { signature: string; gateway: DiagnosticGateway }>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.componentProvider = new ConsoleDiagnosticComponentProvider(env);
  }

  listComponents(): DiagnosticComponentProfile[] {
    return this.componentProvider
      .listComponents()
      .filter((component) => component.enabled && Boolean(component.baseUrl));
  }

  getComponent(componentId: string): DiagnosticComponentProfile | null {
    const normalized = trim(componentId);
    if (!normalized) {
      return null;
    }
    return this.listComponents().find((component) => component.id === normalized) ?? null;
  }

  getGateway(componentId: string): DiagnosticGateway | undefined {
    const component = this.getComponent(componentId);
    if (!component) {
      return undefined;
    }
    const signature = [
      component.baseUrl,
      component.token,
      component.caller,
      String(component.timeoutMs),
      component.enabled ? "enabled" : "disabled"
    ].join("|");
    const cached = this.gatewayCache.get(component.id);
    if (cached?.signature === signature) {
      return cached.gateway;
    }
    const gateway = new DiagnosticHttpClient(component);
    this.gatewayCache.set(component.id, { signature, gateway });
    return gateway;
  }
}

export class StaticDiagnosticGatewayProvider implements DiagnosticGatewayProvider {
  private readonly componentById: Map<string, DiagnosticComponentProfile>;

  constructor(
    private readonly components: DiagnosticComponentProfile[],
    private readonly gateways: Map<string, DiagnosticGateway>
  ) {
    this.componentById = new Map(components.map((component) => [component.id, component]));
  }

  listComponents(): DiagnosticComponentProfile[] {
    return this.components;
  }

  getComponent(componentId: string): DiagnosticComponentProfile | null {
    return this.componentById.get(componentId) ?? null;
  }

  getGateway(componentId: string): DiagnosticGateway | undefined {
    return this.gateways.get(componentId);
  }
}

export function labelForCapability(
  capabilityID: CapabilityID,
  components: DiagnosticComponentProfile[]
): string {
  if (isDiagnosticComponentCapability(capabilityID)) {
    const targetId = getDiagnosticComponentIdFromCapability(capabilityID);
    return components.find((component) => component.id === targetId)?.name || DEFAULT_COMPONENT_NAME;
  }
  return DEFAULT_COMPONENT_NAME;
}
