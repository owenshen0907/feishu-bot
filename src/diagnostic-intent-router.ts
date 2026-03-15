import { ConsoleDiagnosticComponentProvider } from "./diagnostic-components.js";
import { cleanMessage } from "./parser/index.js";
import { normalizeComponentCommand, resolveUsableComponentCommand } from "./diagnostic-components.js";
import type {
  DiagnosticComponentProfile,
  DiagnosticIntentPrompt,
  DiagnosticIntentResolution,
  DiagnosticIntentResolver,
  ParsedCommand,
  TimeRange
} from "./types.js";

const TRACE_NAMED_PATTERN = /trace(?:[_-]?id)?\s*[:：=]?\s*([A-Za-z0-9_-]{6,})/i;
const TRACE_GENERIC_PATTERN = /\b([A-Za-z][A-Za-z0-9_-]{7,})\b/;
const UID_PATTERN = /\b(\d{6,})\b/;
const JOB_PATTERN = /\bjob[-_:\s]?([A-Za-z0-9-]{6,})\b/i;
const TIME_RANGE_PATTERN = /\b(15m|1h|6h|1d)\b/i;
const DIAGNOSTIC_KEYWORD_PATTERN = /(排查|排障|诊断|定位|根因|故障|报错|错误|异常|失败|超时|日志|告警|trace|uid|job|链路|调用链)/i;
const ACTION_PATTERN = /^(查|看|排查|排障|诊断|定位|分析|帮我查|帮我看|帮我排查|请查|请看|请排查)/i;
const USER_KEYWORD_PATTERN = /(uid|用户|user[\s_-]?id|账号|member|memberid|open[_-]?id)/i;
const JOB_KEYWORD_PATTERN = /(这个任务|任务状态|任务现在|后台任务|异步任务|job)/i;
const TRACE_KEYWORD_PATTERN = /(trace|链路|调用链)/i;
const SKIP_EXPLICIT_PATTERN = /^\/(chat|help|memory|chat-reset|new)\b/i;
const STOP_WORDS = new Set([
  "用于",
  "用来",
  "组件",
  "接口",
  "能力",
  "服务",
  "支持",
  "适合",
  "例如",
  "比如",
  "可以",
  "需要",
  "用于订",
  "http",
  "https",
  "trace",
  "uid",
  "job",
  "排查",
  "排障",
  "诊断",
  "用户"
]);

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class ConsoleDiagnosticIntentRouter implements DiagnosticIntentResolver {
  private readonly provider: ConsoleDiagnosticComponentProvider;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.provider = new ConsoleDiagnosticComponentProvider(env);
  }

  getComponents(): DiagnosticComponentProfile[] {
    return this.provider.listComponents();
  }

  pickComponent(input: {
    message: string;
    preferredComponentId?: string | null;
    availableComponentIds?: string[];
  }): string | null {
    const components = this.filterAvailableComponents(input.availableComponentIds);
    const cleaned = cleanMessage(input.message);
    const explicit = resolveExplicitComponentSelection(cleaned, components);
    const component = explicit ?? chooseComponent(cleaned, components, input.preferredComponentId);
    return component?.id ?? null;
  }

  resolve(input: {
    message: string;
    parsed: ParsedCommand;
    currentJobId?: string | null;
    hasThreadContext: boolean;
    preferredComponentId?: string | null;
    availableComponentIds?: string[];
  }): DiagnosticIntentResolution | null {
    if (!shouldInspectReroute(input.parsed, input.message)) {
      return null;
    }

    const message = cleanMessage(input.message);
    if (!message) {
      return null;
    }

    const components = this.filterAvailableComponents(input.availableComponentIds);
    if (components.length === 0) {
      return null;
    }

    const explicitCommand = resolveExplicitComponentCommand(message, components, input.currentJobId);
    if (explicitCommand) {
      return explicitCommand;
    }

    const component = chooseComponent(message, components, input.preferredComponentId);
    if (!component) {
      return null;
    }

    const analysis = analyzeDiagnosticIntent(message, component, input.currentJobId);
    if (analysis.kind === "none") {
      return null;
    }

    if (analysis.kind === "missing_target") {
      const prompt: DiagnosticIntentPrompt = {
        component,
        reason: analysis.reason,
        expectedInputs: analysis.expectedInputs
      };
      return { kind: "missing_target", componentId: component.id, prompt };
    }

    return {
      kind: "command",
      componentId: component.id,
      command: {
        action: analysis.action,
        targetId: analysis.targetId,
        mode: analysis.mode,
        timeRange: analysis.timeRange,
        rawText: message,
        isFollowup: false,
        errors: [],
        useCurrentJob: analysis.useCurrentJob
      }
    };
  }

  private filterAvailableComponents(availableComponentIds?: string[]): DiagnosticComponentProfile[] {
    const all = this.provider.listComponents();
    if (!Array.isArray(availableComponentIds) || availableComponentIds.length === 0) {
      return all;
    }
    const allowed = new Set(availableComponentIds.map((item) => trim(item)).filter(Boolean));
    return all.filter((component) => allowed.has(component.id));
  }
}

function resolveExplicitComponentCommand(
  message: string,
  components: DiagnosticComponentProfile[],
  currentJobId?: string | null
): DiagnosticIntentResolution | null {
  const normalized = cleanMessage(message);
  const component = resolveExplicitComponentSelection(normalized, components);
  if (!component) {
    return null;
  }

  const remaining = normalized.replace(/^\/[a-z0-9_-]+\b/i, "").trim();
  const analysis = analyzeForcedComponentCommand(remaining, currentJobId);
  if (analysis.kind === "command") {
    return {
      kind: "command",
      componentId: component.id,
      command: {
        action: analysis.action,
        targetId: analysis.targetId,
        mode: analysis.mode,
        timeRange: analysis.timeRange,
        rawText: normalized,
        isFollowup: false,
        errors: [],
        useCurrentJob: analysis.useCurrentJob
      }
    };
  }

  return {
    kind: "missing_target",
    componentId: component.id,
    prompt: {
      component,
      reason: component.command
        ? `已命中快捷命令 /${normalizeComponentCommand(component.command)}。`
        : `已识别到你在提 ${component.name || "自定义组件"}。`,
      expectedInputs: analysis.expectedInputs
    }
  };
}

function resolveExplicitComponentSelection(
  message: string,
  components: DiagnosticComponentProfile[]
): DiagnosticComponentProfile | null {
  const explicitCommand = cleanMessage(message).match(/^\/([a-z0-9_-]+)\b/i)?.[1]?.toLowerCase();
  if (!explicitCommand) {
    return null;
  }
  return components.find((item) => resolveUsableComponentCommand(item, components) === explicitCommand) ?? null;
}

function shouldInspectReroute(parsed: ParsedCommand, message: string): boolean {
  if (SKIP_EXPLICIT_PATTERN.test(message.trim())) {
    return false;
  }
  return parsed.action === "chat" || parsed.action === "help" || parsed.action === "followup";
}

function analyzeDiagnosticIntent(message: string, component: DiagnosticComponentProfile, currentJobId?: string | null):
  | {
      kind: "command";
      action: "trace" | "uid" | "job";
      targetId: string;
      mode: "sync" | "async";
      timeRange: TimeRange;
      useCurrentJob: boolean;
    }
  | {
      kind: "missing_target";
      reason: string;
      expectedInputs: string[];
    }
  | {
      kind: "none";
    } {
  const lowered = message.toLowerCase();
  const keywords = extractComponentKeywords(component);
  const matchedKeywords = keywords.filter((keyword) => keyword.length >= 2 && lowered.includes(keyword.toLowerCase()));
  const mentionsComponent = Boolean(component.name && lowered.includes(component.name.toLowerCase()));
  const hasDiagnosticKeyword = DIAGNOSTIC_KEYWORD_PATTERN.test(message);
  const hasActionPrefix = ACTION_PATTERN.test(message);
  const hasUserKeyword = USER_KEYWORD_PATTERN.test(message);
  const hasJobKeyword = JOB_KEYWORD_PATTERN.test(message);
  const hasTraceKeyword = TRACE_KEYWORD_PATTERN.test(message);
  const hasMetadataSignal = mentionsComponent || matchedKeywords.length > 0;

  const traceId = resolveTraceId(message, hasTraceKeyword || hasDiagnosticKeyword || hasMetadataSignal);
  const uid = message.match(UID_PATTERN)?.[1] ?? "";
  const jobId = message.match(JOB_PATTERN)?.[1] ?? currentJobId ?? "";
  const timeRange = extractTimeRange(message);
  const mode = /(异步|后台)/.test(message) ? "async" as const : "sync" as const;

  if (jobId && hasJobKeyword && (hasMetadataSignal || hasDiagnosticKeyword || Boolean(currentJobId))) {
    return {
      kind: "command",
      action: "job",
      targetId: jobId,
      mode: "sync",
      timeRange: "15m",
      useCurrentJob: !message.match(JOB_PATTERN)
    };
  }

  if (traceId && (hasTraceKeyword || hasMetadataSignal || hasDiagnosticKeyword)) {
    return {
      kind: "command",
      action: "trace",
      targetId: traceId,
      mode,
      timeRange: "15m",
      useCurrentJob: false
    };
  }

  if (
    uid &&
    (hasUserKeyword || hasMetadataSignal) &&
    (hasActionPrefix || hasDiagnosticKeyword || hasTraceKeyword)
  ) {
    return {
      kind: "command",
      action: "uid",
      targetId: uid,
      mode,
      timeRange,
      useCurrentJob: false
    };
  }

  if (
    hasMetadataSignal &&
    (hasActionPrefix || hasJobKeyword || hasTraceKeyword || hasUserKeyword || mentionsComponent) &&
    (hasActionPrefix || hasDiagnosticKeyword || hasJobKeyword)
  ) {
    const expectedInputs = hasJobKeyword
      ? ["job_id"]
      : hasTraceKeyword
        ? ["trace_id"]
        : hasUserKeyword
          ? ["uid"]
          : ["trace_id", "uid"];
    return {
      kind: "missing_target",
      reason: matchedKeywords.length
        ? `已命中组件说明里的关键词：${matchedKeywords.slice(0, 3).join(" / ")}。`
        : `已识别到你在提 ${component.name || "自定义组件"}。`,
      expectedInputs
    };
  }

  return { kind: "none" };
}

function analyzeForcedComponentCommand(
  message: string,
  currentJobId?: string | null
):
  | {
      kind: "command";
      action: "trace" | "uid" | "job";
      targetId: string;
      mode: "sync" | "async";
      timeRange: TimeRange;
      useCurrentJob: boolean;
    }
  | {
      kind: "missing_target";
      expectedInputs: string[];
    } {
  const raw = message.trim();
  const mode = /(异步|后台)/.test(raw) ? "async" as const : "sync" as const;
  const timeRange = extractTimeRange(raw);
  const jobId = raw.match(JOB_PATTERN)?.[1] ?? currentJobId ?? "";
  const traceId = resolveTraceId(raw, true);
  const uid = raw.match(UID_PATTERN)?.[1] ?? "";

  if (jobId && /(job|任务|后台)/i.test(raw)) {
    return {
      kind: "command",
      action: "job",
      targetId: jobId,
      mode: "sync",
      timeRange: "15m",
      useCurrentJob: !raw.match(JOB_PATTERN)
    };
  }

  if (traceId && !/^\d+$/.test(traceId) && (TRACE_KEYWORD_PATTERN.test(raw) || Boolean(traceId))) {
    return {
      kind: "command",
      action: "trace",
      targetId: traceId,
      mode,
      timeRange: "15m",
      useCurrentJob: false
    };
  }

  if (uid) {
    return {
      kind: "command",
      action: "uid",
      targetId: uid,
      mode,
      timeRange,
      useCurrentJob: false
    };
  }

  return {
    kind: "missing_target",
    expectedInputs: /(job|任务|后台)/i.test(raw)
      ? ["job_id"]
      : TRACE_KEYWORD_PATTERN.test(raw)
        ? ["trace_id"]
        : USER_KEYWORD_PATTERN.test(raw)
          ? ["uid"]
          : ["trace_id", "uid"]
  };
}

function chooseComponent(
  message: string,
  components: DiagnosticComponentProfile[],
  preferredComponentId?: string | null
): DiagnosticComponentProfile | null {
  const preferred = trim(preferredComponentId);
  if (preferred) {
    const preferredMatch = components.find((component) => component.id === preferred);
    if (preferredMatch) {
      return preferredMatch;
    }
  }

  const ranked = components
    .map((component) => ({
      component,
      score: scoreComponent(message, component)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) {
    return null;
  }
  if (ranked.length === 1) {
    return ranked[0]?.component ?? null;
  }
  return ranked[0].score >= (ranked[1].score + 2)
    ? ranked[0].component
    : null;
}

function scoreComponent(message: string, component: DiagnosticComponentProfile): number {
  const lowered = message.toLowerCase();
  let score = 0;
  if (component.name && lowered.includes(component.name.toLowerCase())) {
    score += 6;
  }
  const keywords = extractComponentKeywords(component);
  for (const keyword of keywords) {
    if (keyword.length >= 2 && lowered.includes(keyword.toLowerCase())) {
      score += 2;
    }
  }
  if (component.summary && lowered.includes(component.summary.toLowerCase())) {
    score += 3;
  }
  return score;
}

function resolveTraceId(message: string, allowGeneric: boolean): string {
  const named = message.match(TRACE_NAMED_PATTERN)?.[1] ?? "";
  if (named) {
    return named;
  }
  if (!allowGeneric) {
    return "";
  }
  const generic = message.match(TRACE_GENERIC_PATTERN)?.[1] ?? "";
  if (/^\d+$/.test(generic)) {
    return "";
  }
  return generic;
}

function extractTimeRange(message: string): TimeRange {
  const direct = message.match(TIME_RANGE_PATTERN)?.[1]?.toLowerCase();
  if (direct === "15m" || direct === "1h" || direct === "6h" || direct === "1d") {
    return direct;
  }

  const lowered = message.toLowerCase();
  if (lowered.includes("1小时") || lowered.includes("一小时")) {
    return "1h";
  }
  if (lowered.includes("6小时")) {
    return "6h";
  }
  if (lowered.includes("1天") || lowered.includes("一天")) {
    return "1d";
  }
  return "15m";
}

function extractComponentKeywords(component: DiagnosticComponentProfile): string[] {
  const segments = [
    component.name,
    component.summary,
    component.usageDescription,
    ...component.examplePrompts
  ]
    .map((item) => trim(item))
    .filter(Boolean);

  const keywords = new Set<string>();
  for (const segment of segments) {
    for (const token of segment.split(/[\s,，。；;、/|()\[\]{}]+/u)) {
      const normalized = trim(token);
      if (!normalized) {
        continue;
      }
      if (/^[A-Za-z0-9_-]{3,}$/u.test(normalized)) {
        keywords.add(normalized.toLowerCase());
        continue;
      }
      const chineseParts = normalized.match(/[\u4e00-\u9fff]{2,8}/gu) ?? [];
      for (const part of chineseParts) {
        if (!STOP_WORDS.has(part) && part.length >= 2) {
          keywords.add(part);
        }
      }
    }
  }

  return Array.from(keywords).slice(0, 24);
}
