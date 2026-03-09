import { randomUUID } from "node:crypto";
import type { BotFormatter } from "./formatter.js";
import { logError, logInfo } from "./logger.js";
import { cleanMessage, parseMessage } from "./parser/index.js";
import type {
  AcceptedPayload,
  BotChatService,
  BotMessenger,
  BotReplyMessage,
  BridgeEnvelope,
  DiagnosisPayload,
  FeishuMention,
  FeishuReceiveMessageEvent,
  Scope,
  SessionRecord,
  SmartKitGateway
} from "./types.js";
import { SessionStore } from "./session-store.js";

interface MessageContext {
  aliasKeys: string[];
  scope: Scope;
  chatId: string;
  chatType: string;
  userId: string;
  messageId: string;
  text: string;
  replyInThread: boolean;
}

export class BotService {
  constructor(
    private readonly store: SessionStore,
    private readonly smartkit: SmartKitGateway | undefined,
    private readonly chatService: BotChatService,
    private readonly messenger: BotMessenger,
    private readonly formatter: BotFormatter,
    private readonly botName: string
  ) {}

  async handleEvent(event: FeishuReceiveMessageEvent): Promise<void> {
    const dedupeIds = [event.event_id, event.message.message_id].filter(Boolean) as string[];
    if (dedupeIds.some((id) => this.store.hasProcessedMessage(id))) {
      return;
    }
    const createdAt = event.message.create_time || new Date().toISOString();
    for (const id of dedupeIds) {
      this.store.markProcessedMessage(id, createdAt);
    }

    if (event.message.message_type !== "text") {
      return;
    }

    const rawText = parseTextContent(event.message.content);
    if (!this.shouldHandleGroupMessage(event.message.chat_type, rawText, event.message.mentions)) {
      return;
    }

    const context = this.buildContext(event, rawText);
    const session = this.findSession(context.aliasKeys);
    const parsed = parseMessage(context.text, {
      hasThreadContext: Boolean(session),
      currentJobId: session?.jobId,
      allowChatFallback: context.scope === "p2p"
    });

    try {
      if (parsed.action === "help") {
        await this.replySafely(context.messageId, this.formatter.formatHelp(), context.replyInThread);
        return;
      }

      const outcome = await this.executeCommand(parsed, session, context);
      const sentMessage = await this.replySafely(context.messageId, outcome.reply, context.replyInThread);
      if (!outcome.conversationId) {
        return;
      }

      const effectiveRequester = outcome.requesterId ?? session?.requesterId ?? context.userId;
      const record: SessionRecord = {
        sessionId: session?.sessionId ?? randomUUID(),
        conversationId: outcome.conversationId,
        jobId: outcome.jobId ?? session?.jobId ?? null,
        requesterId: effectiveRequester,
        scope: outcome.scope ?? session?.scope ?? context.scope,
        chatId: context.chatId,
        chatType: context.chatType,
        anchorMessageId: session?.anchorMessageId ?? context.messageId,
        lastMessageId: context.messageId,
        threadId: sentMessage.threadId ?? event.message.thread_id ?? event.message.root_id ?? session?.threadId ?? null,
        lastQuestion: parsed.rawText,
        jobStatus: outcome.jobStatus ?? session?.jobStatus ?? null,
        notificationSentAt: outcome.notificationSentAt ?? session?.notificationSentAt ?? null,
        updatedAt: new Date().toISOString()
      };

      const aliases = new Set(context.aliasKeys);
      if (context.chatType === "group") {
        if (sentMessage.threadId) {
          aliases.add(buildGroupAlias(context.chatId, sentMessage.threadId));
        }
        if (sentMessage.rootId) {
          aliases.add(buildGroupAlias(context.chatId, sentMessage.rootId));
        }
        if (sentMessage.messageId) {
          aliases.add(buildGroupAlias(context.chatId, sentMessage.messageId));
        }
      }
      this.store.upsertSession(record, Array.from(aliases));
    } catch (error) {
      logError("handle message failed", {
        error: error instanceof Error ? error.message : String(error),
        messageId: context.messageId
      });
      await this.replySafely(context.messageId, this.formatter.formatBridgeError(toErrorMessage(error)), context.replyInThread);
    }
  }

  private async executeCommand(
    parsed: ReturnType<typeof parseMessage>,
    session: SessionRecord | undefined,
    context: MessageContext
  ): Promise<{
    reply: BotReplyMessage;
    conversationId?: string;
    jobId?: string | null;
    jobStatus?: string | null;
    notificationSentAt?: string | null;
    requesterId?: string;
    scope?: Scope;
  }> {
    switch (parsed.action) {
      case "trace": {
        if (!this.smartkit) {
          return { reply: this.formatter.formatSmartKitUnavailable() };
        }
        const envelope = await this.smartkit.analyzeTrace({
          traceId: parsed.targetId,
          mode: parsed.mode,
          requesterId: context.userId,
          scope: context.scope
        });
        return this.handleBridgeResponse(envelope, parsed.rawText, context.userId, context.scope);
      }
      case "uid": {
        if (!this.smartkit) {
          return { reply: this.formatter.formatSmartKitUnavailable() };
        }
        const envelope = await this.smartkit.analyzeUid({
          uid: parsed.targetId,
          mode: parsed.mode,
          timeRange: parsed.timeRange,
          requesterId: context.userId,
          scope: context.scope
        });
        return this.handleBridgeResponse(envelope, parsed.rawText, context.userId, context.scope);
      }
      case "job": {
        if (!this.smartkit) {
          return { reply: this.formatter.formatSmartKitUnavailable() };
        }
        const jobId = parsed.targetId || session?.jobId;
        if (!jobId) {
          return { reply: this.formatter.formatHelp() };
        }
        const envelope = await this.smartkit.getJob(jobId);
        ensureBridgeOk(envelope);
        return {
          reply: await this.formatter.formatJob(envelope.data),
          conversationId: envelope.data.conversation_id || session?.conversationId,
          jobId: envelope.data.job_id,
          jobStatus: envelope.data.status,
          notificationSentAt: ["completed", "failed"].includes(envelope.data.status) ? new Date().toISOString() : null,
          requesterId: session?.requesterId ?? context.userId,
          scope: session?.scope ?? context.scope
        };
      }
      case "followup": {
        if (!this.smartkit) {
          return { reply: this.formatter.formatSmartKitUnavailable() };
        }
        if (!session?.conversationId) {
          return { reply: this.formatter.formatHelp() };
        }
        const requesterId = session.scope === "group" ? session.requesterId : context.userId;
        const envelope = await this.smartkit.followup({
          conversationId: session.conversationId,
          message: parsed.rawText,
          requesterId,
          scope: session.scope
        });
        return this.handleBridgeResponse(envelope, parsed.rawText, requesterId, session.scope);
      }
      case "chat": {
        if (!this.chatService.isAvailable()) {
          return { reply: this.formatter.formatChatUnavailable() };
        }
        const result = await this.chatService.reply({
          userId: context.userId,
          message: parsed.rawText
        });
        return {
          reply: this.formatter.formatChatReply({
            question: parsed.rawText,
            answer: result.answer,
            memoryCount: result.memoryCount
          })
        };
      }
      case "memory_clear": {
        const deletedCount = this.chatService.clearMemory(context.userId);
        return { reply: this.formatter.formatMemoryCleared(deletedCount) };
      }
      case "memory_status": {
        const memoryCount = this.chatService.getMemoryCount(context.userId);
        return { reply: this.formatter.formatMemoryStatus(memoryCount) };
      }
      default:
        return { reply: this.formatter.formatHelp() };
    }
  }

  private async handleBridgeResponse(
    envelope: BridgeEnvelope<DiagnosisPayload | AcceptedPayload>,
    question: string,
    requesterId: string,
    scope: Scope
  ): Promise<{
    reply: BotReplyMessage;
    conversationId?: string;
    jobId?: string | null;
    jobStatus?: string | null;
    notificationSentAt?: string | null;
    requesterId?: string;
    scope?: Scope;
  }> {
    ensureBridgeOk(envelope);
    if (envelope.code === "accepted") {
      const accepted = envelope.data as AcceptedPayload;
      return {
        reply: this.formatter.formatAccepted(accepted),
        conversationId: accepted.conversation_id,
        jobId: accepted.job_id,
        jobStatus: accepted.status,
        notificationSentAt: null,
        requesterId,
        scope
      };
    }

    const diagnosis = envelope.data as DiagnosisPayload;
    return {
      reply: await this.formatter.formatDiagnosis(diagnosis, question),
      conversationId: diagnosis.conversation_id,
      jobId: diagnosis.job_id ?? null,
      jobStatus: diagnosis.status,
      notificationSentAt: diagnosis.job_id ? new Date().toISOString() : null,
      requesterId,
      scope
    };
  }

  private buildContext(event: FeishuReceiveMessageEvent, rawText: string): MessageContext {
    const userId = event.sender.sender_id?.user_id || event.sender.sender_id?.open_id || "unknown-user";
    const chatId = event.message.chat_id;
    const chatType = event.message.chat_type;
    const cleanedText = cleanMessage(stripBotName(rawText, this.botName, event.message.mentions ?? []));

    if (chatType === "group") {
      const aliasKeys = [
        event.message.thread_id ? buildGroupAlias(chatId, event.message.thread_id) : "",
        event.message.root_id ? buildGroupAlias(chatId, event.message.root_id) : "",
        event.message.parent_id ? buildGroupAlias(chatId, event.message.parent_id) : "",
        buildGroupAlias(chatId, event.message.message_id)
      ].filter(Boolean);
      return {
        aliasKeys,
        scope: "group",
        chatId,
        chatType,
        userId,
        messageId: event.message.message_id,
        replyInThread: true,
        text: cleanedText
      };
    }

    return {
      aliasKeys: [buildP2PAlias(chatId, userId)],
      scope: "p2p",
      chatId,
      chatType,
      userId,
      messageId: event.message.message_id,
      replyInThread: false,
      text: cleanedText
    };
  }

  private findSession(aliasKeys: string[]): SessionRecord | undefined {
    for (const alias of aliasKeys) {
      const session = this.store.getSessionByAlias(alias);
      if (session) {
        return session;
      }
    }
    return undefined;
  }

  private shouldHandleGroupMessage(chatType: string, rawText: string, mentions?: FeishuMention[]): boolean {
    if (chatType !== "group") {
      return true;
    }
    const trimmed = rawText.trim();
    if (trimmed.startsWith("/")) {
      return true;
    }
    const names = (mentions ?? []).map((item) => item.name || "");
    return names.includes(this.botName);
  }

  private async replySafely(messageId: string, reply: BotReplyMessage, replyInThread: boolean) {
    const sent = await this.messenger.replyCard(messageId, reply, { replyInThread });
    logInfo("reply sent", { messageId, replyInThread, kind: reply.kind });
    return sent;
  }
}

function ensureBridgeOk(envelope: BridgeEnvelope<unknown>): void {
  if (["ok", "accepted"].includes(envelope.code) && envelope.http_status < 400) {
    return;
  }
  throw new Error(envelope.message || `SmartKit returned ${envelope.http_status}`);
}

function parseTextContent(rawContent: string): string {
  try {
    const parsed = JSON.parse(rawContent) as { text?: string };
    return parsed.text ?? rawContent;
  } catch {
    return rawContent;
  }
}

function stripBotName(rawText: string, botName: string, mentions: FeishuMention[]): string {
  let result = rawText;
  for (const mention of mentions) {
    if (!mention.name) {
      continue;
    }
    result = result.replaceAll(`@${mention.name}`, " ");
    if (mention.name === botName) {
      result = result.replaceAll(mention.name, " ");
    }
  }
  return result;
}

function buildP2PAlias(chatId: string, userId: string): string {
  return `p2p:${chatId}:${userId}`;
}

function buildGroupAlias(chatId: string, threadKey: string): string {
  return `group:${chatId}:${threadKey}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "chat_unavailable") {
    return "当前聊天模型未配置，暂时只能使用 SmartKit 排障命令。";
  }
  if (error instanceof Error && error.message === "empty_chat_message") {
    return "聊天消息不能为空。";
  }
  return error instanceof Error ? error.message : String(error);
}
