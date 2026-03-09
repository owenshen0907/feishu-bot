import OpenAI from "openai";
import type { AppConfig } from "./config.js";
import type {
  AcceptedPayload,
  BotReplyMessage,
  DiagnosisPayload,
  EvidenceItem,
  JobPayload,
  LarkCardMessage,
  LinkItem
} from "./types.js";

export class BotFormatter {
  private client?: OpenAI;

  constructor(private readonly config: AppConfig["botLlm"]) {}

  formatHelp(): BotReplyMessage {
    const card = buildCard({
      title: "SmartKit 飞书助手",
      template: "blue",
      elements: [
        markdownBlock("这是一张**命令优先 + 对话补充**的飞书助手卡片。你可以查 `trace_id` / `uid`，也可以直接把它当一个带记忆的聊天助手来用。"),
        divider(),
        fieldGrid([
          ["诊断对象", "`trace_id` / `uid`"],
          ["聊天模式", "私聊可直接聊天"],
          ["群聊规则", "`@bot` 或 Slash 触发"],
          ["记忆范围", "按用户独立保存"]
        ]),
        markdownBlock([
          "**排障命令**",
          "- `/trace <trace_id>`",
          "- `/trace-async <trace_id>`",
          "- `/uid <uid> [15m|1h|6h|1d]`",
          "- `/uid-async <uid> [15m|1h|6h|1d]`",
          "- `/job <job_id>`"
        ].join("\n")),
        markdownBlock([
          "**聊天命令**",
          "- `/chat <问题>`：走独立对话，不依赖 SmartKit",
          "- `/memory`：查看你当前记忆条数",
          "- `/chat-reset`：清空你自己的聊天记忆"
        ].join("\n")),
        markdownBlock([
          "**口语示例**",
          "- 查下 trace 7f8e9a0b1234",
          "- 帮我看 uid 123456",
          "- 帮我梳理一下这个需求的实现思路",
          "- 展开原因",
          "- 再查过去 1h"
        ].join("\n")),
        noteBlock([
          "私聊里如果消息没有匹配到排障命令，会自动进入聊天模式。",
          "安全：排障结果只展示脱敏摘要；聊天记忆按用户隔离。"
        ])
      ]
    });

    return {
      kind: "card",
      card,
      textPreview: "SmartKit 飞书助手使用说明"
    };
  }

  formatAccepted(data: AcceptedPayload): BotReplyMessage {
    const queryCommand = `/job ${data.job_id}`;
    const card = buildCard({
      title: data.target_type === "trace" ? "Trace 后台诊断已提交" : "UID 后台诊断已提交",
      template: "yellow",
      elements: [
        fieldGrid([
          ["目标对象", formatTarget(data.target_type, data.target_id)],
          ["当前状态", statusLabel(data.status)],
          ["任务号", code(data.job_id)],
          ["会话号", code(data.conversation_id)]
        ]),
        divider(),
        markdownBlock([
          "**接下来会发生什么**",
          "- SmartKit 会在后台继续取证并更新诊断结果",
          "- 你可以稍后手动查询，也可以等待 Bot 自动补发结果",
          `- 手动查询命令：${code(queryCommand)}`
        ].join("\n")),
        noteBlock([
          "如果后面还想放大范围，可以继续发：再查过去 1h / 6h / 1d。"
        ])
      ]
    });

    return {
      kind: "card",
      card,
      textPreview: `已提交后台诊断任务 ${data.job_id}`
    };
  }

  async formatDiagnosis(data: DiagnosisPayload, question = "", options: { titlePrefix?: string } = {}): Promise<BotReplyMessage> {
    const readableSummary = await this.renderReadableSummary(data, question);
    const elements: Array<Record<string, unknown>> = [
      fieldGrid([
        ["目标对象", formatTarget(data.target_type, data.target_id)],
        ["诊断状态", statusLabel(data.status)],
        ["会话号", code(data.conversation_id)],
        ["任务号", data.job_id ? code(data.job_id) : "本次为同步结果"]
      ]),
      divider(),
      markdownBlock(`**结论**\n${readableSummary}`)
    ];

    const causes = renderBulletList(data.probable_causes, 3);
    if (causes) {
      elements.push(markdownBlock(`**可能原因**\n${causes}`));
    }

    const actions = renderBulletList(data.recommended_actions, 3);
    if (actions) {
      elements.push(markdownBlock(`**建议动作**\n${actions}`));
    }

    const evidence = renderEvidence(data.evidence, 2);
    if (evidence) {
      elements.push(markdownBlock(`**证据摘录**\n${evidence}`));
    }

    const links = renderLinks(data.links, 2);
    if (links) {
      elements.push(markdownBlock(`**参考链接**\n${links}`));
    }

    const footerLines = [
      question ? `问题：${normalizeInline(question)}` : "问题：未记录原始提问",
      "你可以继续回复：展开原因 / 换一种说法 / 再查过去 1h / 只看 5xx",
      "如果想切到普通聊天，直接发 `/chat 你的问题`。"
    ];
    elements.push(noteBlock(footerLines));

    const card = buildCard({
      title: `${options.titlePrefix ?? formatTargetLabel(data.target_type)}诊断结果`,
      template: pickTemplateForDiagnosis(data),
      elements
    });

    return {
      kind: "card",
      card,
      textPreview: `${formatTargetLabel(data.target_type)}诊断结果：${normalizeInline(data.canonical_summary)}`
    };
  }

  async formatJob(job: JobPayload): Promise<BotReplyMessage> {
    if (job.status === "completed" && job.result_payload) {
      return this.formatDiagnosis(job.result_payload, `/job ${job.job_id}`, { titlePrefix: "任务结果" });
    }

    if (job.status === "failed") {
      const card = buildCard({
        title: "后台任务执行失败",
        template: "red",
        elements: [
          fieldGrid([
            ["任务号", code(job.job_id)],
            ["目标对象", formatTarget(job.target_type, job.target_id)],
            ["当前状态", statusLabel(job.status)],
            ["会话号", code(job.conversation_id)]
          ]),
          divider(),
          markdownBlock(`**失败原因**\n${normalizeMultiline(job.error_message || "SmartKit 未返回更多错误信息。")}`),
          noteBlock([
            "建议：稍后重试，或回到原会话里继续追问。",
            `可再次查询：${code(`/job ${job.job_id}`)}`
          ])
        ]
      });

      return {
        kind: "card",
        card,
        textPreview: `任务 ${job.job_id} 执行失败`
      };
    }

    const card = buildCard({
      title: "后台任务仍在处理中",
      template: "yellow",
      elements: [
        fieldGrid([
          ["任务号", code(job.job_id)],
          ["目标对象", formatTarget(job.target_type, job.target_id)],
          ["当前状态", statusLabel(job.status)],
          ["会话号", code(job.conversation_id)]
        ]),
        divider(),
        markdownBlock([
          "**当前说明**",
          "- SmartKit 还在继续取证或等待下游返回",
          "- 你可以稍后手动查一次，或等待 Bot 自动补发完成结果",
          `- 手动查询：${code(`/job ${job.job_id}`)}`
        ].join("\n"))
      ]
    });

    return {
      kind: "card",
      card,
      textPreview: `任务 ${job.job_id} 还在处理中`
    };
  }

  formatChatReply(input: { question: string; answer: string; memoryCount: number }): BotReplyMessage {
    const card = buildCard({
      title: "轻量对话助手",
      template: "indigo",
      elements: [
        markdownBlock(`**你的问题**\n${normalizeMultiline(input.question, 300)}`),
        divider(),
        markdownBlock(`**回复**\n${normalizeMultiline(input.answer, 1400)}`),
        noteBlock([
          `当前已记住 ${input.memoryCount} 条与你相关的聊天上下文。`,
          "你可以继续追问；如果要清空记忆，发送 `/chat-reset`。",
          "这个聊天能力不依赖 SmartKit 诊断接口，可单独使用。"
        ])
      ]
    });

    return {
      kind: "card",
      card,
      textPreview: `聊天回复：${normalizeInline(input.answer)}`
    };
  }

  formatChatUnavailable(): BotReplyMessage {
    const card = buildCard({
      title: "聊天能力暂不可用",
      template: "orange",
      elements: [
        markdownBlock([
          "当前 Bot 侧聊天模型还没准备好，所以暂时不能走独立聊天。",
          "你仍然可以继续使用 `/trace`、`/uid`、`/job` 这些 SmartKit 排障命令。"
        ].join("\n\n")),
        noteBlock([
          "如要启用聊天，请配置 `BOT_LLM_API_KEY` / `BOT_LLM_BASE_URL` / `BOT_LLM_MODEL`，并打开 `BOT_CHAT_ENABLED=true`。"
        ])
      ]
    });

    return {
      kind: "card",
      card,
      textPreview: "聊天能力暂不可用"
    };
  }

  formatMemoryCleared(deletedCount: number): BotReplyMessage {
    const card = buildCard({
      title: "聊天记忆已清空",
      template: "green",
      elements: [
        fieldGrid([
          ["已清除条数", String(deletedCount)],
          ["当前状态", "下次聊天将从空记忆开始"]
        ]),
        noteBlock([
          "这只会清掉你自己的聊天记忆，不影响 SmartKit 诊断会话。"
        ])
      ]
    });
    return {
      kind: "card",
      card,
      textPreview: `聊天记忆已清空 ${deletedCount} 条`
    };
  }

  formatMemoryStatus(memoryCount: number): BotReplyMessage {
    const card = buildCard({
      title: "当前聊天记忆",
      template: "wathet",
      elements: [
        fieldGrid([
          ["记忆条数", String(memoryCount)],
          ["作用范围", "仅你本人可见 / 独立管理"]
        ]),
        markdownBlock([
          "**说明**",
          "- 这些记忆只用于普通聊天模式",
          "- 不会混入其他用户上下文",
          "- 如需清空，请发送 `/chat-reset`"
        ].join("\n"))
      ]
    });
    return {
      kind: "card",
      card,
      textPreview: `当前聊天记忆 ${memoryCount} 条`
    };
  }

  formatBridgeError(message: string): BotReplyMessage {
    const card = buildCard({
      title: "请求处理失败",
      template: "red",
      elements: [
        markdownBlock(`**错误信息**\n${normalizeMultiline(message)}`),
        divider(),
        markdownBlock([
          "**你可以这样排查**",
          "- 先确认 SmartKit 服务是否可达",
          "- 再确认 Bridge Token / 调用方配置是否正确",
          "- 如仍失败，可先发 `/help` 看命令格式",
          "- 如果只是想普通聊天，可改发 `/chat 你的问题`"
        ].join("\n"))
      ]
    });

    return {
      kind: "card",
      card,
      textPreview: `请求失败：${normalizeInline(message)}`
    };
  }

  private async renderReadableSummary(data: DiagnosisPayload, question: string): Promise<string> {
    const fallback = normalizeMultiline(data.canonical_summary || "已完成诊断，请结合下方原因和建议继续判断。", 220);
    if (!this.shouldUseLlm()) {
      return fallback;
    }
    try {
      return await this.renderWithLlm({
        summary: data.canonical_summary,
        causes: data.probable_causes,
        actions: data.recommended_actions,
        evidence: data.evidence,
        links: data.links,
        question
      });
    } catch {
      return fallback;
    }
  }

  private shouldUseLlm(): boolean {
    return this.config.enabled && Boolean(this.config.apiKey) && Boolean(this.config.baseUrl);
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
            "你是飞书里的内部排障助手。你只能改写输入里的已有事实。请只输出 2 到 4 行中文结论摘要，不要标题，不要项目符号，不要 JSON。"
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
      return normalizeMultiline(content, 220);
    }
    if (Array.isArray(content)) {
      const merged = content
        .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
        .join("\n")
        .trim();
      if (merged) {
        return normalizeMultiline(merged, 220);
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

function buildCard(params: {
  title: string;
  template: string;
  elements: Array<Record<string, unknown>>;
}): LarkCardMessage {
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true
    },
    header: {
      template: params.template,
      title: {
        tag: "plain_text",
        content: params.title
      }
    },
    elements: params.elements
  };
}

function markdownBlock(content: string): Record<string, unknown> {
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content
    }
  };
}

function fieldGrid(items: Array<[string, string]>): Record<string, unknown> {
  return {
    tag: "div",
    fields: items.map(([label, value]) => ({
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**${label}**\n${value}`
      }
    }))
  };
}

function divider(): Record<string, unknown> {
  return { tag: "hr" };
}

function noteBlock(lines: string[]): Record<string, unknown> {
  return {
    tag: "note",
    elements: [
      {
        tag: "lark_md",
        content: lines.map((line) => normalizeInline(line, 240)).join("\n")
      }
    ]
  };
}

function renderBulletList(items: string[], limit: number): string {
  return items
    .slice(0, limit)
    .map((item) => `- ${normalizeInline(item, 180)}`)
    .join("\n");
}

function renderEvidence(items: EvidenceItem[], limit: number): string {
  return items
    .slice(0, limit)
    .map((item) => {
      const title = item.title ? `**${normalizeInline(item.title)}**` : "**证据**";
      const detail = normalizeInline(item.detail || item.snippet || "暂无细节", 220);
      const source = item.source ? ` · 来源：${normalizeInline(item.source)}` : "";
      return `- ${title}：${detail}${source}`;
    })
    .join("\n");
}

function renderLinks(items: LinkItem[], limit: number): string {
  return items
    .slice(0, limit)
    .map((item) => {
      const label = normalizeInline(item.label || item.kind || "查看详情");
      const url = item.url || "";
      return url ? `- [${label}](${url})` : `- ${label}`;
    })
    .join("\n");
}

function formatTarget(type: string, id: string): string {
  return `${formatTargetLabel(type)} ${code(id)}`;
}

function formatTargetLabel(type: string): string {
  return type === "uid" ? "UID" : "Trace";
}

function pickTemplateForDiagnosis(data: DiagnosisPayload): string {
  if (data.status !== "completed") {
    return "yellow";
  }
  const hasCriticalEvidence = (data.evidence || []).some((item) => ["error", "critical", "high"].includes((item.severity || "").toLowerCase()));
  return hasCriticalEvidence ? "red" : "green";
}

function statusLabel(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "completed":
      return "已完成";
    case "pending":
      return "排队中";
    case "running":
      return "执行中";
    case "failed":
      return "失败";
    default:
      return normalizeInline(status || "unknown");
  }
}

function code(value: string): string {
  return `\`${normalizeInline(value)}\``;
}

function normalizeInline(value: string, limit = 120): string {
  return String(value || "")
    .replace(/[`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeMultiline(value: string, limit = 320): string {
  return String(value || "")
    .replace(/[`]/g, "'")
    .replace(/\r/g, "")
    .trim()
    .slice(0, limit);
}
