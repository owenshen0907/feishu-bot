import type { ParsedCommand, TimeRange } from "../types.js";

const TIME_RANGE_PATTERN = /\b(15m|1h|6h|1d)\b/i;
const COMMAND_PATTERN = /^\/(help|trace|trace-async|uid|uid-async|job|chat-reset|chat|memory|new)\b/i;
const TRACE_NAMED_PATTERN = /trace(?:[_-]?id)?\s*[:：=]?\s*([A-Za-z0-9_-]{6,})/i;
const TRACE_GENERIC_PATTERN = /\b([A-Za-z0-9_-]{8,})\b/;
const UID_PATTERN = /\b(\d{6,})\b/;
const JOB_PATTERN = /\bjob[-_:\s]?([A-Za-z0-9-]{6,})\b/i;

export interface ParseOptions {
  hasThreadContext: boolean;
  currentJobId?: string | null;
  allowChatFallback?: boolean;
}

export function parseMessage(text: string, options: ParseOptions): ParsedCommand {
  const raw = cleanMessage(text);
  if (!raw) {
    return buildCommand("help", raw, ["empty_message"]);
  }
  const explicit = parseExplicitCommand(raw, options.currentJobId);
  if (explicit) {
    return explicit;
  }
  if (raw.startsWith("/")) {
    return buildCommand("help", raw, ["unknown_command"]);
  }
  const natural = parseNaturalAlias(raw, options.currentJobId);
  if (natural) {
    return natural;
  }
  if (options.hasThreadContext) {
    return buildCommand("followup", raw, [], { isFollowup: true });
  }
  if (options.allowChatFallback) {
    return buildCommand("chat", raw);
  }
  return buildCommand("help", raw, ["unrecognized_message"]);
}

export function cleanMessage(text: string): string {
  return (text || "")
    .replace(/<at[^>]*>.*?<\/at>/gi, " ")
    .replace(/@_user_\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExplicitCommand(raw: string, currentJobId?: string | null): ParsedCommand | null {
  const command = raw.match(COMMAND_PATTERN)?.[1]?.toLowerCase();
  if (!command) {
    return null;
  }
  const tokens = raw.split(/\s+/);
  if (command === "help") {
    return buildCommand("help", raw);
  }
  if (command === "memory") {
    return buildCommand("memory_status", raw);
  }
  if (command === "chat-reset" || command === "new") {
    return buildCommand("memory_clear", raw);
  }
  if (command === "chat") {
    const prompt = raw.replace(/^\/chat\b/i, "").trim();
    if (!prompt) {
      return buildCommand("help", raw, ["missing_chat_message"]);
    }
    return buildCommand("chat", prompt);
  }
  if (command === "job") {
    const targetId = tokens[1] ?? currentJobId ?? "";
    if (!targetId) {
      return buildCommand("help", raw, ["missing_job_id"]);
    }
    return buildCommand("job", raw, [], {
      targetId,
      useCurrentJob: !tokens[1]
    });
  }
  if (command.startsWith("trace")) {
    if (!tokens[1]) {
      return buildCommand("help", raw, ["missing_trace_id"]);
    }
    return buildCommand("trace", raw, [], {
      targetId: tokens[1],
      mode: command.endsWith("async") ? "async" : "sync"
    });
  }
  if (!tokens[1]) {
    return buildCommand("help", raw, ["missing_uid"]);
  }
  return buildCommand("uid", raw, [], {
    targetId: tokens[1],
    mode: command.endsWith("async") ? "async" : "sync",
    timeRange: isTimeRange(tokens[2]) ? (tokens[2].toLowerCase() as TimeRange) : "15m"
  });
}

function parseNaturalAlias(raw: string, currentJobId?: string | null): ParsedCommand | null {
  const lowered = raw.toLowerCase();
  if (/(这个任务|任务状态|任务现在|后台任务|异步任务|job)/i.test(raw)) {
    const targetId = raw.match(JOB_PATTERN)?.[1] ?? currentJobId ?? "";
    if (targetId) {
      return buildCommand("job", raw, [], {
        targetId,
        useCurrentJob: !raw.match(JOB_PATTERN)
      });
    }
  }
  if (/(trace|链路|调用链)/i.test(raw)) {
    const targetId = raw.match(TRACE_NAMED_PATTERN)?.[1] ?? raw.match(TRACE_GENERIC_PATTERN)?.[1] ?? "";
    if (targetId) {
      return buildCommand("trace", raw, [], {
        targetId,
        mode: /(异步|后台)/.test(raw) ? "async" : "sync"
      });
    }
  }
  if (lowered.includes("uid") || raw.includes("用户")) {
    const targetId = raw.match(UID_PATTERN)?.[1] ?? "";
    if (targetId) {
      return buildCommand("uid", raw, [], {
        targetId,
        mode: /(异步|后台)/.test(raw) ? "async" : "sync",
        timeRange: extractTimeRange(raw)
      });
    }
  }
  return null;
}

function extractTimeRange(raw: string): TimeRange {
  const direct = raw.match(TIME_RANGE_PATTERN)?.[1]?.toLowerCase();
  if (isTimeRange(direct)) {
    return direct;
  }
  const lowered = raw.toLowerCase();
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

function isTimeRange(value: string | undefined): value is TimeRange {
  return value === "15m" || value === "1h" || value === "6h" || value === "1d";
}

function buildCommand(
  action: ParsedCommand["action"],
  rawText: string,
  errors: string[] = [],
  override: Partial<ParsedCommand> = {}
): ParsedCommand {
  return {
    action,
    targetId: override.targetId ?? "",
    mode: override.mode ?? "sync",
    timeRange: override.timeRange ?? "15m",
    rawText,
    isFollowup: override.isFollowup ?? false,
    errors,
    useCurrentJob: override.useCurrentJob ?? false
  };
}
