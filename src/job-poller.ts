import { capabilityIdForDiagnosticComponent } from "./diagnostic-components.js";
import type { BotFormatter } from "./formatter.js";
import { logError, logInfo } from "./logger.js";
import { SessionStore } from "./session-store.js";
import type { BotMessenger, CapabilityGate, DiagnosticGateway, DiagnosticGatewayProvider } from "./types.js";

export class JobPoller {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly diagnosticGatewayProvider?: DiagnosticGatewayProvider;

  constructor(
    private readonly store: SessionStore,
    diagnosticGateway: DiagnosticGateway | DiagnosticGatewayProvider,
    private readonly messenger: BotMessenger,
    private readonly formatter: BotFormatter,
    private readonly intervalMs: number,
    private readonly botName: string,
    private readonly capabilityGate?: CapabilityGate
  ) {
    this.diagnosticGatewayProvider = this.normalizeDiagnosticGatewayProvider(diagnosticGateway);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const sessions = this.store.listSessionsAwaitingJobResult();
      for (const session of sessions) {
        if (!session.jobId) {
          continue;
        }
        const resolved = this.resolveDiagnosticGateway(session.componentId);
        if (!resolved) {
          logError("poll job failed because component is unavailable", {
            jobId: session.jobId,
            componentId: session.componentId
          });
          continue;
        }
        const envelope = await resolved.gateway.getJob(session.jobId);
        if (envelope.http_status >= 400 || envelope.code !== "ok") {
          logError("poll job failed", { jobId: session.jobId, message: envelope.message });
          continue;
        }
        const job = envelope.data;
        if (!["completed", "failed"].includes(job.status)) {
          continue;
        }
        if (this.capabilityGate) {
          const access = this.capabilityGate.canUse(capabilityIdForDiagnosticComponent(resolved.component.id), {
            scope: session.scope,
            chatId: session.chatId,
            userId: session.requesterId
          });
          if (!access.allowed) {
            this.store.markJobNotified(session.sessionId, job.status, new Date().toISOString());
            logInfo("job result skipped by capability policy", {
              jobId: session.jobId,
              scope: session.scope,
              source: access.source
            });
            continue;
          }
        }
        const reply = await this.formatter.formatJob(job);
        const sent = await this.messenger.replyMessage(session.anchorMessageId, reply, { replyInThread: session.scope === "group" });
        const notifiedAt = new Date().toISOString();
        this.store.markJobNotified(session.sessionId, job.status, notifiedAt);
        this.store.appendSessionMessages(session.sessionId, [
          {
            sessionId: session.sessionId,
            role: "assistant",
            senderName: this.botName,
            messageId: sent.messageId,
            content: reply.textPreview,
            createdAt: notifiedAt
          }
        ]);
        logInfo("job result pushed", { jobId: session.jobId, status: job.status });
      }
    } catch (error) {
      logError("job poller tick failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.running = false;
    }
  }

  private normalizeDiagnosticGatewayProvider(
    value: DiagnosticGateway | DiagnosticGatewayProvider
  ): DiagnosticGatewayProvider {
    if ("getGateway" in value && "getComponent" in value && "listComponents" in value) {
      return value;
    }
    const component = {
      id: "legacy-diagnostic-http",
      name: "自定义 HTTP 组件",
      enabled: true,
      command: "",
      summary: "",
      usageDescription: "",
      examplePrompts: [],
      baseUrl: "",
      token: "",
      caller: "feishu-bot",
      timeoutMs: 20000
    };
    return {
      listComponents: () => [component],
      getComponent: (componentId: string) => componentId === component.id ? component : null,
      getGateway: (componentId: string) => componentId === component.id ? value : undefined
    };
  }

  private resolveDiagnosticGateway(componentId: string | null | undefined) {
    const provider = this.diagnosticGatewayProvider;
    if (!provider) {
      return null;
    }
    const preferred = componentId?.trim();
    const component = preferred
      ? provider.getComponent(preferred)
      : provider.listComponents()[0] ?? null;
    if (!component) {
      return null;
    }
    const gateway = provider.getGateway(component.id);
    return gateway ? { component, gateway } : null;
  }
}
