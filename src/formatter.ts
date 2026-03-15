import OpenAI from "openai";
import { isDiagnosticComponentCapability } from "./diagnostic-components.js";
import type { AppConfig } from "./config.js";
import type {
  AcceptedPayload,
  BotOutboundMessage,
  CapabilityID,
  DiagnosticComponentProfile,
  DiagnosisPayload,
  EvidenceItem,
  HelpCapabilitySummaryItem,
  HelpContentProvider,
  JobPayload,
  LarkCardMessage,
  LinkItem
} from "./types.js";

const TEXT_CONTENT_PART_TYPES = new Set(["text", "output_text"]);

function extractAssistantText(content: unknown): string {
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const type = "type" in part ? String(part.type ?? "").trim().toLowerCase() : "";
      if (type && !TEXT_CONTENT_PART_TYPES.has(type)) {
        return "";
      }
      const text = "text" in part ? part.text : "";
      if (typeof text === "string") {
        return text.trim();
      }
      if (text && typeof text === "object" && "value" in text) {
        return String(text.value ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export class BotFormatter {
  private client?: OpenAI;

  constructor(
    private readonly config: AppConfig["botLlm"],
    private readonly helpContentProvider?: HelpContentProvider
  ) {}

  private capabilityLabel(capabilityID: CapabilityID): string {
    if (isDiagnosticComponentCapability(capabilityID)) {
      return "自定义 HTTP 组件";
    }
    switch (capabilityID) {
      case "chat":
        return "普通聊天";
      case "diagnosticHttp":
      case "smartkit":
        return "自定义 HTTP 组件";
      case "webSearch":
        return "联网搜索";
      case "voiceReply":
        return "语音回复";
      case "vision":
        return "视觉理解";
    }
  }

  formatHelp(input: { capabilities?: HelpCapabilitySummaryItem[] } = {}): BotOutboundMessage {
    const help = this.helpContentProvider?.getHelpContent();
    const title = help?.title || "Feishu 诊断助手";
    const summary = help?.summary || "这里会先说明机器人怎么用，再按当前对象已开通的能力，自动列出可直接使用的功能说明。";
    const newCommandDescription = help?.newCommandDescription || "开启一个新话题，并清空你自己的聊天上下文。";
    const capabilityLines = [
      `- \`/new\`：${normalizeInline(newCommandDescription, 180)}`,
      ...(input.capabilities?.length
        ? input.capabilities.map((item) => {
            const label = item.command
              ? `${normalizeInline(item.title, 60)}（\`${normalizeInline(item.command, 40)}\`）`
              : normalizeInline(item.title, 60);
            return `- ${label}：${normalizeInline(item.description, 180)}`;
          })
        : ["- 当前对象还没有额外开通能力；如需授权，可在桌面控制台里打开对应能力卡片。"])
    ];

    const card = buildCard({
      title,
      template: "blue",
      elements: [
        markdownBlock(normalizeMultiline(summary, 420)),
        divider(),
        markdownBlock([
          "**当前已为你开通的功能**",
          ...capabilityLines
        ].join("\n"))
      ]
    });

    return {
      kind: "card",
      card,
      textPreview: `${normalizeInline(title, 80)}使用说明`
    };
  }

  formatAccepted(data: AcceptedPayload): BotOutboundMessage {
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
          "- 组件会在后台继续取证并更新结果",
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

  async formatDiagnosis(data: DiagnosisPayload, question = "", options: { titlePrefix?: string } = {}): Promise<BotOutboundMessage> {
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

  async formatJob(job: JobPayload): Promise<BotOutboundMessage> {
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
          markdownBlock(`**失败原因**\n${normalizeMultiline(job.error_message || "组件未返回更多错误信息。")}`),
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
          "- 组件还在继续取证或等待下游返回",
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

  formatChatReply(input: { question: string; answer: string; memoryCount: number }): BotOutboundMessage {
    return textReply(
      [
        input.answer.trim(),
        "",
        `已记住 ${input.memoryCount} 条与你相关的聊天上下文。`,
        "继续追问即可；如果要清空记忆，发送 /new。"
      ].join("\n"),
      `聊天回复：${normalizeInline(input.answer)}`
    );
  }

  formatChatUnavailable(): BotOutboundMessage {
    return textReply(
      [
        "聊天能力暂不可用。",
        "当前 Bot 侧聊天模型还没准备好，所以暂时不能走独立聊天。",
        "你仍然可以继续使用 /trace、/uid、/job 这些诊断命令。",
        "如要启用聊天，请配置 BOT_LLM_API_KEY / BOT_LLM_BASE_URL / BOT_LLM_MODEL，并打开 BOT_CHAT_ENABLED=true。"
      ].join("\n"),
      "聊天能力暂不可用"
    );
  }

  formatDiagnosticUnavailable(): BotOutboundMessage {
    return textReply(
      [
        "当前还没有可用的自定义 HTTP 组件。",
        "当没有组件接入，或者组件的全局开关还没打开时，/trace、/uid、/job 这类命令暂时不可用。",
        "如果你只想把它当普通机器人使用，可以直接发 /chat 你的问题，或在私聊里直接说话。",
        "把组件地址、鉴权信息和全局开关配置好后，诊断命令就能立刻恢复。"
      ].join("\n"),
      "当前还没有可用的自定义 HTTP 组件"
    );
  }

  formatSmartKitUnavailable(): BotOutboundMessage {
    return this.formatDiagnosticUnavailable();
  }

  formatDiagnosticComponentSelectionRequired(componentNames: string[]): BotOutboundMessage {
    const visible = componentNames.filter(Boolean).slice(0, 6);
    return textReply(
      [
        "当前命中了多个自定义 HTTP 组件，我还不能确定该走哪一个。",
        visible.length > 0 ? `请在消息里带上组件名，例如：${visible.join(" / ")}。` : "请在消息里补充组件名称。",
        "补上组件名后，我会按对应组件继续执行 trace / uid / job。"
      ].join("\n"),
      "需要先确认要使用哪个自定义 HTTP 组件"
    );
  }

  formatDiagnosticTargetRequired(input: {
    component: DiagnosticComponentProfile;
    reason: string;
    expectedInputs: string[];
  }): BotOutboundMessage {
    const componentName = input.component.name || "自定义 HTTP 组件";
    const hints = input.expectedInputs.length > 0 ? input.expectedInputs.join(" / ") : "trace_id / uid";
    const lines = [
      `${componentName} 还需要更多输入。`,
      input.reason,
      `请补一个 ${hints}。`,
      "如果是链路问题，优先给 trace_id；如果是用户维度问题，给 uid + 时间范围会更准确。"
    ];
    if (input.component.summary || input.component.usageDescription) {
      lines.push(`组件说明：${normalizeInline(input.component.summary || input.component.usageDescription, 220)}`);
    }
    if (input.component.examplePrompts.length > 0) {
      lines.push(`示例：${normalizeInline(input.component.examplePrompts[0] || "", 220)}`);
    }
    return textReply(lines.join("\n"), `${componentName} 还需要 trace_id 或 uid`);
  }

  formatCapabilityDenied(input: { capabilityID: CapabilityID; scope: "p2p" | "group"; reason: string }): BotOutboundMessage {
    const capability = this.capabilityLabel(input.capabilityID);
    const objectLabel = input.scope === "group" ? "当前群组" : "当前用户";
    return textReply(
      [
        `${capability}未对当前对象开启。`,
        `${objectLabel}现在还不能使用${capability}。`,
        normalizeInline(input.reason, 220),
        "去桌面控制台的“群组”或“用户”页直接打开对应能力的开关即可；配置会自动保存，下一条消息立即生效。"
      ].join("\n"),
      `${capability}未对当前对象开启`
    );
  }

  formatMemoryCleared(deletedCount: number): BotOutboundMessage {
    return textReply(
      [
        `聊天记忆已清空，共删除 ${deletedCount} 条。`,
        "下次聊天将从空记忆开始。",
        "这只会清掉你自己的聊天记忆，不影响诊断会话。以后也可以直接发送 /new。"
      ].join("\n"),
      `聊天记忆已清空 ${deletedCount} 条`
    );
  }

  formatMemoryStatus(memoryCount: number): BotOutboundMessage {
    return textReply(
      [
        `当前聊天记忆 ${memoryCount} 条。`,
        "这些记忆只用于普通聊天模式。",
        "不会混入其他用户上下文；如需清空，请发送 /new。"
      ].join("\n"),
      `当前聊天记忆 ${memoryCount} 条`
    );
  }

  formatBridgeError(message: string): BotOutboundMessage {
    return textReply(
      [
        `请求处理失败：${normalizeInline(message)}`,
        "你可以先确认组件服务是否可达，再确认 Bridge Token / 调用方配置是否正确。",
        "如仍失败，可先发 /help 看命令格式；如果只是想普通聊天，可改发 /chat 你的问题。"
      ].join("\n"),
      `请求失败：${normalizeInline(message)}`
    );
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
    const content = extractAssistantText(response.choices[0]?.message?.content);
    if (content) {
      return normalizeMultiline(content, 220);
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

function textReply(text: string, textPreview?: string): BotOutboundMessage {
  const normalized = normalizeMultiline(text, 1400);
  return {
    kind: "text",
    text: normalized,
    textPreview: textPreview ? normalizeInline(textPreview, 180) : normalizeInline(normalized, 180)
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
