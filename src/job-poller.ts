import type { BotFormatter } from "./formatter.js";
import { logError, logInfo } from "./logger.js";
import { SessionStore } from "./session-store.js";
import type { BotMessenger, SmartKitGateway } from "./types.js";

export class JobPoller {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly store: SessionStore,
    private readonly smartkit: SmartKitGateway,
    private readonly messenger: BotMessenger,
    private readonly formatter: BotFormatter,
    private readonly intervalMs: number
  ) {}

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
        const envelope = await this.smartkit.getJob(session.jobId);
        if (envelope.http_status >= 400 || envelope.code !== "ok") {
          logError("poll job failed", { jobId: session.jobId, message: envelope.message });
          continue;
        }
        const job = envelope.data;
        if (!["completed", "failed"].includes(job.status)) {
          continue;
        }
        const reply = await this.formatter.formatJob(job);
        await this.messenger.replyCard(session.anchorMessageId, reply, { replyInThread: session.scope === "group" });
        this.store.markJobNotified(session.sessionId, job.status, new Date().toISOString());
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
}
