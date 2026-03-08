import { setTimeout as delay } from "node:timers/promises";
import type { AppConfig } from "./config.js";
import type {
  AcceptedPayload,
  BridgeEnvelope,
  ConversationPayload,
  DiagnosisPayload,
  JobPayload,
  Mode,
  Scope,
  SmartKitGateway,
  TimeRange
} from "./types.js";

export class SmartKitClient implements SmartKitGateway {
  constructor(private readonly config: AppConfig["smartkit"]) {}

  analyzeTrace(input: { traceId: string; mode: Mode; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>> {
    return this.request("POST", "/api/bridge/analyze/trace", {
      trace_id: input.traceId,
      mode: input.mode,
      requester_id: input.requesterId,
      scope: input.scope
    });
  }

  analyzeUid(input: { uid: string; mode: Mode; timeRange: TimeRange; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>> {
    return this.request("POST", "/api/bridge/analyze/uid", {
      uid: input.uid,
      mode: input.mode,
      time_range: input.timeRange,
      requester_id: input.requesterId,
      scope: input.scope
    });
  }

  getJob(jobId: string): Promise<BridgeEnvelope<JobPayload>> {
    return this.request("GET", `/api/bridge/analyze/jobs/${encodeURIComponent(jobId)}`);
  }

  followup(input: { conversationId: string; message: string; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>> {
    return this.request("POST", `/api/bridge/conversations/${encodeURIComponent(input.conversationId)}/followup`, {
      message: input.message,
      requester_id: input.requesterId,
      scope: input.scope
    });
  }

  getConversation(conversationId: string): Promise<BridgeEnvelope<ConversationPayload>> {
    return this.request("GET", `/api/bridge/conversations/${encodeURIComponent(conversationId)}`);
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<BridgeEnvelope<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Caller": this.config.caller,
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const payload = (await response.json()) as Omit<BridgeEnvelope<T>, "http_status">;
      return {
        ...payload,
        http_status: response.status
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        await delay(0);
        throw new Error(`SmartKit request timeout after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
