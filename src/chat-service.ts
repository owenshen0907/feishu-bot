import OpenAI from "openai";
import type { AppConfig } from "./config.js";
import { SessionStore } from "./session-store.js";
import type { BotChatService, ChatMemoryRecord, ChatReply } from "./types.js";

interface ChatCompletionGateway {
  complete(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string>;
}

const TEXT_CONTENT_PART_TYPES = new Set(["text", "output_text"]);

function extractAssistantText(content: unknown): string {
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const merged = content
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
  return merged;
}

class OpenAIChatGateway implements ChatCompletionGateway {
  private client?: OpenAI;

  constructor(private readonly llmConfig: AppConfig["botLlm"]) {}

  async complete(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
    const response = await this.getClient().chat.completions.create({
      model: this.llmConfig.model,
      temperature: 0.6,
      messages
    }, {
      timeout: this.llmConfig.timeoutMs
    });
    const merged = extractAssistantText(response.choices[0]?.message?.content);
    if (merged) {
      return merged;
    }
    throw new Error("empty chat response");
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.llmConfig.apiKey,
        baseURL: this.llmConfig.baseUrl
      });
    }
    return this.client;
  }
}

export class ChatService implements BotChatService {
  private readonly gateway: ChatCompletionGateway;

  constructor(
    private readonly store: SessionStore,
    private readonly llmConfig: AppConfig["botLlm"],
    private readonly chatConfig: AppConfig["botChat"],
    gateway?: ChatCompletionGateway
  ) {
    this.gateway = gateway ?? new OpenAIChatGateway(llmConfig);
  }

  isAvailable(): boolean {
    return this.chatConfig.enabled && Boolean(this.llmConfig.apiKey) && Boolean(this.llmConfig.baseUrl);
  }

  async reply(input: { userId: string; message: string }): Promise<ChatReply> {
    if (!this.isAvailable()) {
      throw new Error("chat_unavailable");
    }
    const prompt = input.message.trim();
    if (!prompt) {
      throw new Error("empty_chat_message");
    }
    const history = this.store.listChatMemory(input.userId, this.chatConfig.memoryMessages);
    const messages = [
      { role: "system" as const, content: this.chatConfig.systemPrompt },
      ...history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user" as const, content: prompt }
    ];
    const answer = normalizeAssistantAnswer(await this.gateway.complete(messages));
    const now = new Date().toISOString();
    const memoryCount = this.store.appendChatMemory(
      input.userId,
      [
        { role: "user", content: prompt, createdAt: now },
        { role: "assistant", content: answer, createdAt: now }
      ],
      this.chatConfig.memoryMessages
    );
    return {
      answer,
      memoryCount
    };
  }

  clearMemory(userId: string): number {
    return this.store.clearChatMemory(userId);
  }

  getMemoryCount(userId: string): number {
    return this.store.getChatMemoryCount(userId);
  }
}

function normalizeAssistantAnswer(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2000);
}

export class FakeChatGateway implements ChatCompletionGateway {
  constructor(private readonly handler: (messages: ChatMemoryRecord[]) => string | Promise<string>) {}

  async complete(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
    return await this.handler(messages.map((item) => ({ role: item.role, content: item.content, createdAt: "" })));
  }
}
