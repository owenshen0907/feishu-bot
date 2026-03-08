import OpenAI from "openai";
import type { AppConfig } from "./config.js";
import type { AcceptedPayload, DiagnosisPayload, EvidenceItem, JobPayload, LinkItem } from "./types.js";

export class BotFormatter {
  private client?: OpenAI;

  constructor(private readonly config: AppConfig["botLlm"]) {}

  formatHelp(): string {
    return [
      "SmartKit 飞书助手支持这些命令:",
      "/trace <trace_id>",
      "/trace-async <trace_id>",
      "/uid <uid> [15m|1h|6h|1d]",
      "/uid-async <uid> [15m|1h|6h|1d]",
      "/job <job_id>",
      "也支持口语，比如: 查下 trace xxx、帮我看 uid 123456、这个任务现在怎样了。"
    ].join("\n");
  }

  formatAccepted(data: AcceptedPayload): string {
    return [
      "已提交后台诊断任务。",
      `目标: ${data.target_type} ${data.target_id}`,
      `任务号: ${data.job_id}`,
      `会话号: ${data.conversation_id}`,
      `可发送 /job ${data.job_id} 查询进度。`
    ].join("\n");
  }

  async formatDiagnosis(data: DiagnosisPayload, question = ""): Promise<string> {
    const summary = data.canonical_summary?.trim() || "已完成诊断，请查看原因与建议。";
    const causes = data.probable_causes ?? [];
    const actions = data.recommended_actions ?? [];
    const evidence = data.evidence ?? [];
    const links = data.links ?? [];
    if (this.shouldUseLlm()) {
      try {
        return await this.renderWithLlm({ summary, causes, actions, evidence, links, question });
      } catch {
        // fall back to deterministic template
      }
    }
    return this.renderWithTemplate(summary, causes, actions, evidence, links);
  }

  async formatJob(job: JobPayload): Promise<string> {
    if (job.status === "completed" && job.result_payload) {
      return this.formatDiagnosis(job.result_payload, `/job ${job.job_id}`);
    }
    if (job.status === "failed") {
      return [
        `任务 ${job.job_id} 执行失败。`,
        job.error_message ? `原因: ${job.error_message}` : "原因: SmartKit 未返回更多错误信息。",
        "建议: 稍后重试，或回到原会话里继续追问。"
      ].join("\n");
    }
    return [
      `任务 ${job.job_id} 还在处理中。`,
      `状态: ${job.status}`,
      `目标: ${job.target_type} ${job.target_id}`,
      "建议: 稍后再查一次，或等待 Bot 自动补发结果。"
    ].join("\n");
  }

  formatBridgeError(message: string): string {
    return `请求失败: ${message}`;
  }

  private shouldUseLlm(): boolean {
    return this.config.enabled && Boolean(this.config.apiKey) && Boolean(this.config.baseUrl);
  }

  private renderWithTemplate(
    summary: string,
    causes: string[],
    actions: string[],
    evidence: EvidenceItem[],
    links: LinkItem[]
  ): string {
    const lines = [`结论: ${summary}`];
    if (causes.length > 0) {
      lines.push("原因:");
      for (const cause of causes.slice(0, 3)) {
        lines.push(`- ${cause}`);
      }
    }
    if (actions.length > 0) {
      lines.push("建议:");
      for (const action of actions.slice(0, 3)) {
        lines.push(`- ${action}`);
      }
    }
    const evidenceLines = evidence
      .slice(0, 2)
      .map((item) => [item.title, item.detail].filter(Boolean).join(": "))
      .filter(Boolean);
    if (evidenceLines.length > 0) {
      lines.push("证据:");
      for (const item of evidenceLines) {
        lines.push(`- ${item}`);
      }
    }
    const linkLines = links
      .slice(0, 2)
      .map((item) => [item.label, item.url].filter(Boolean).join(": "))
      .filter(Boolean);
    if (linkLines.length > 0) {
      lines.push("链接:");
      for (const item of linkLines) {
        lines.push(`- ${item}`);
      }
    }
    return lines.join("\n");
  }

  private async renderWithLlm(input: {
    summary: string;
    causes: string[];
    actions: string[];
    evidence: EvidenceItem[];
    links: LinkItem[];
    question: string;
  }): Promise<string> {
    const response = await this.getClient().chat.completions.create({
      model: this.config.model,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "你是飞书里的内部排障助手。你只能改写输入里的已有事实。请输出中文短文本，格式固定为 结论 / 原因 / 建议 三段，每段 1-3 行，不要输出 JSON。"
        },
        {
          role: "user",
          content: JSON.stringify(input, null, 2)
        }
      ]
    }, {
      timeout: this.config.timeoutMs
    });
    const content = response.choices[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const merged = content
        .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
        .join("\n")
        .trim();
      if (merged) {
        return merged;
      }
    }
    throw new Error("empty llm response");
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl
      });
    }
    return this.client;
  }
}
