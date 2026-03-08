import type { ParsedCommand, TimeRange } from "../types.js";

const TIME_RANGE_PATTERN = /\b(15m|1h|6h|1d)\b/i;
const COMMAND_PATTERN = /^\/(help|trace|trace-async|uid|uid-async|job)\b/i;
const TRACE_NAMED_PATTERN = /trace(?:[_-]?id)?\s*[:：=]?\s*([A-Za-z0-9_-]{6,})/i;
const TRACE_GENERIC_PATTERN = /\b([A-Za-z0-9_-]{8,})\b/;
const UID_PATTERN = /\b(\d{6,})\b/;
const JOB_PATTERN = /\bjob[-_:\s]?([A-Za-z0-9-]{6,})\b/i;

export interface ParseOptions {
  hasThreadContext: boolean;
  currentJobId?: string | null;
}

export function parseMessage(text: string, options: ParseOptions): ParsedCommand {
  const raw = cleanMessage(text);
  if (!raw) {
    return buildHelp(raw, ["empty_message"]);
  }
  const explicit = parseExplicitCommand(raw, options.currentJobId);
  if (explicit) {
    return explicit;
  }
  const natural = parseNaturalAlias(raw, options.currentJobId);
  if (natural) {
    return natural;
  }
  if (options.hasThreadContext) {
    return {
      action: "followup",
      targetId: "",
      mode: "sync",
      timeRange: "15m",
      rawText: raw,
      isFollowup: true,
      errors: [],
      useCurrentJob: false
    };
  }
  return buildHelp(raw, ["unrecognized_message"]);
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
    return {
      action: "help",
      targetId: "",
      mode: "sync",
      timeRange: "15m",
      rawText: raw,
      isFollowup: false,
      errors: [],
      useCurrentJob: false
    };
  }
  if (command === "job") {
    const targetId = tokens[1] ?? currentJobId ?? "";
    if (!targetId) {
      return buildHelp(raw, ["missing_job_id"]);
    }
    return {
      action: "job",
      targetId,
      mode: "sync",
      timeRange: "15m",
      rawText: raw,
      isFollowup: false,
      errors: [],
      useCurrentJob: !tokens[1]
    };
  }
  if (command.startsWith("trace")) {
    if (!tokens[1]) {
      return buildHelp(raw, ["missing_trace_id"]);
    }
    return {
      action: "trace",
      targetId: tokens[1],
      mode: command.endsWith("async") ? "async" : "sync",
      timeRange: "15m",
      rawText: raw,
      isFollowup: false,
      errors: [],
      useCurrentJob: false
    };
  }
  if (!tokens[1]) {
    return buildHelp(raw, ["missing_uid"]);
  }
  return {
    action: "uid",
    targetId: tokens[1],
    mode: command.endsWith("async") ? "async" : "sync",
    timeRange: isTimeRange(tokens[2]) ? (tokens[2].toLowerCase() as TimeRange) : "15m",
    rawText: raw,
    isFollowup: false,
    errors: [],
    useCurrentJob: false
  };
}

function parseNaturalAlias(raw: string, currentJobId?: string | null): ParsedCommand | null {
  const lowered = raw.toLowerCase();
  if (/(这个任务|任务状态|任务现在|后台任务|异步任务|job)/i.test(raw)) {
    const targetId = raw.match(JOB_PATTERN)?.[1] ?? currentJobId ?? "";
    if (targetId) {
      return {
        action: "job",
        targetId,
        mode: "sync",
        timeRange: "15m",
        rawText: raw,
        isFollowup: false,
        errors: [],
        useCurrentJob: !raw.match(JOB_PATTERN)
      };
    }
  }
  if (/(trace|链路|调用链)/i.test(raw)) {
    const targetId = raw.match(TRACE_NAMED_PATTERN)?.[1] ?? raw.match(TRACE_GENERIC_PATTERN)?.[1] ?? "";
    if (targetId) {
      return {
        action: "trace",
        targetId,
        mode: /(异步|后台)/.test(raw) ? "async" : "sync",
        timeRange: "15m",
        rawText: raw,
        isFollowup: false,
        errors: [],
        useCurrentJob: false
      };
    }
  }
  if (lowered.includes("uid") || raw.includes("用户")) {
    const targetId = raw.match(UID_PATTERN)?.[1] ?? "";
    if (targetId) {
      return {
        action: "uid",
        targetId,
        mode: /(异步|后台)/.test(raw) ? "async" : "sync",
        timeRange: extractTimeRange(raw),
        rawText: raw,
        isFollowup: false,
        errors: [],
        useCurrentJob: false
      };
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

function buildHelp(raw: string, errors: string[]): ParsedCommand {
  return {
    action: "help",
    targetId: "",
    mode: "sync",
    timeRange: "15m",
    rawText: raw,
    isFollowup: false,
    errors,
    useCurrentJob: false
  };
}
