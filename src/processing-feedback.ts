import fs from "node:fs";
import path from "node:path";
import type { ProcessingReactionProfile, ProcessingReactionProvider } from "./types.js";

export const DEFAULT_PROCESSING_REACTION: ProcessingReactionProfile = Object.freeze({
  enabled: true,
  emoji: "OnIt"
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

function sanitizeProcessingReaction(raw: unknown): ProcessingReactionProfile {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_PROCESSING_REACTION.enabled,
    emoji: trim(value.emoji) || DEFAULT_PROCESSING_REACTION.emoji
  };
}

export class ConsoleProcessingReactionProvider implements ProcessingReactionProvider {
  private cachedSettingsPath = "";
  private cachedMtimeMs = -1;
  private cachedReaction: ProcessingReactionProfile = DEFAULT_PROCESSING_REACTION;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getProcessingReaction(): ProcessingReactionProfile {
    const settingsPath = resolveSettingsPath(this.env);
    if (!fs.existsSync(settingsPath)) {
      this.cachedSettingsPath = settingsPath;
      this.cachedMtimeMs = -1;
      this.cachedReaction = DEFAULT_PROCESSING_REACTION;
      return this.cachedReaction;
    }

    const stat = fs.statSync(settingsPath);
    if (this.cachedSettingsPath === settingsPath && this.cachedMtimeMs === stat.mtimeMs) {
      return this.cachedReaction;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      const feedback = raw.feedback && typeof raw.feedback === "object" ? raw.feedback as Record<string, unknown> : {};
      this.cachedReaction = sanitizeProcessingReaction(feedback.processingReaction);
    } catch {
      this.cachedReaction = DEFAULT_PROCESSING_REACTION;
    }

    this.cachedSettingsPath = settingsPath;
    this.cachedMtimeMs = stat.mtimeMs;
    return this.cachedReaction;
  }
}
