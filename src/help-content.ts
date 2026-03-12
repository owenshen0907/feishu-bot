import fs from "node:fs";
import path from "node:path";
import type { HelpCapabilityOrderMode, HelpContentProfile, HelpContentProvider } from "./types.js";

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

function sanitizeCapabilityOrderMode(value: unknown): HelpCapabilityOrderMode {
  return trim(value) === "component_first" ? "component_first" : "builtin_first";
}

function sanitizeHelpContent(raw: unknown): HelpContentProfile | null {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const examplePrompts = Array.isArray(value.examplePrompts)
    ? value.examplePrompts.map((item) => trim(item)).filter(Boolean)
    : [];
  const notes = Array.isArray(value.notes)
    ? value.notes.map((item) => trim(item)).filter(Boolean)
    : [];
  const help = {
    title: trim(value.title),
    summary: trim(value.summary),
    newCommandDescription: trim(value.newCommandDescription),
    capabilityOrderMode: sanitizeCapabilityOrderMode(value.capabilityOrderMode),
    examplePrompts,
    notes
  };

  return (
    help.title ||
    help.summary ||
    help.newCommandDescription ||
    help.capabilityOrderMode !== "builtin_first" ||
    help.examplePrompts.length ||
    help.notes.length
  )
    ? help
    : null;
}

function sanitizeCapabilityCardDescriptions(raw: unknown): Record<string, string> {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const readDescription = (key: string): string => {
    const entry = value[key];
    if (!entry || typeof entry !== "object") {
      return "";
    }
    return trim((entry as Record<string, unknown>).helpDescription);
  };

  return {
    webSearch: readDescription("webSearch"),
    voiceReply: readDescription("voiceReply"),
    vision: readDescription("vision")
  };
}

export class ConsoleHelpContentProvider implements HelpContentProvider {
  private cachedSettingsPath = "";
  private cachedMtimeMs = -1;
  private cachedHelp: HelpContentProfile | null = null;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getHelpContent(): HelpContentProfile | null {
    const settingsPath = resolveSettingsPath(this.env);
    if (!fs.existsSync(settingsPath)) {
      this.cachedSettingsPath = settingsPath;
      this.cachedMtimeMs = -1;
      this.cachedHelp = null;
      return this.cachedHelp;
    }

    const stat = fs.statSync(settingsPath);
    if (this.cachedSettingsPath === settingsPath && this.cachedMtimeMs === stat.mtimeMs) {
      return this.cachedHelp;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      this.cachedHelp = sanitizeHelpContent(raw.help);
    } catch {
      this.cachedHelp = null;
    }

    this.cachedSettingsPath = settingsPath;
    this.cachedMtimeMs = stat.mtimeMs;
    return this.cachedHelp;
  }
}

export function readHelpContent(env: NodeJS.ProcessEnv = process.env): HelpContentProfile | null {
  const settingsPath = resolveSettingsPath(env);
  if (!fs.existsSync(settingsPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    return sanitizeHelpContent(raw.help);
  } catch {
    return null;
  }
}

export function readCapabilityCardHelpDescriptions(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const settingsPath = resolveSettingsPath(env);
  if (!fs.existsSync(settingsPath)) {
    return {
      webSearch: "",
      voiceReply: "",
      vision: ""
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    return sanitizeCapabilityCardDescriptions(raw.capabilityCards);
  } catch {
    return {
      webSearch: "",
      voiceReply: "",
      vision: ""
    };
  }
}
