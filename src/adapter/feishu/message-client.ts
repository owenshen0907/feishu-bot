import { randomUUID } from "node:crypto";
import * as Lark from "@larksuiteoapi/node-sdk";
import { logError } from "../../logger.js";
import { DEFAULT_PROCESSING_REACTION } from "../../processing-feedback.js";
import type {
  BotMessenger,
  BotOutboundMessage,
  ProcessingReactionProvider,
  ReplyOptions,
  SentMessage
} from "../../types.js";

const defaultProcessingReactionProvider: ProcessingReactionProvider = {
  getProcessingReaction: () => DEFAULT_PROCESSING_REACTION
};

export class FeishuMessageClient implements BotMessenger {
  constructor(
    private readonly client: Lark.Client,
    private readonly processingReactionProvider: ProcessingReactionProvider = defaultProcessingReactionProvider
  ) {}

  async replyMessage(messageId: string, reply: BotOutboundMessage, options: ReplyOptions = {}): Promise<SentMessage> {
    const payload = reply.kind === "card"
      ? {
          msg_type: "interactive",
          content: JSON.stringify(reply.card)
        }
      : {
          msg_type: "text",
          content: JSON.stringify({ text: reply.text })
        };
    const response = await this.client.im.v1.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: payload.msg_type,
        content: payload.content,
        reply_in_thread: options.replyInThread ?? false,
        uuid: randomUUID()
      }
    });
    if ((response.code ?? 0) !== 0) {
      throw new Error(response.msg || "failed to reply message");
    }
    return {
      messageId: response.data?.message_id || "",
      rootId: response.data?.root_id,
      parentId: response.data?.parent_id,
      threadId: response.data?.thread_id
    };
  }

  async addProcessingReaction(messageId: string): Promise<string | null> {
    const reaction = this.processingReactionProvider.getProcessingReaction();
    if (!reaction.enabled) {
      return null;
    }
    const emoji = reaction.emoji.trim() || DEFAULT_PROCESSING_REACTION.emoji;
    try {
      const response = await this.client.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: {
            emoji_type: emoji
          }
        }
      });
      if ((response.code ?? 0) !== 0) {
        logError("failed to add processing reaction", {
          messageId,
          emoji,
          code: response.code,
          message: response.msg
        });
        return null;
      }
      return response.data?.reaction_id?.trim() || null;
    } catch (error) {
      logError("processing reaction create failed", {
        messageId,
        emoji,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async removeProcessingReaction(messageId: string, reactionId: string | null): Promise<void> {
    const normalizedReactionId = reactionId?.trim();
    if (!messageId.trim() || !normalizedReactionId) {
      return;
    }
    try {
      const response = await this.client.im.v1.messageReaction.delete({
        path: {
          message_id: messageId,
          reaction_id: normalizedReactionId
        }
      });
      if ((response.code ?? 0) !== 0) {
        logError("failed to delete processing reaction", {
          messageId,
          reactionId: normalizedReactionId,
          code: response.code,
          message: response.msg
        });
      }
    } catch (error) {
      logError("processing reaction delete failed", {
        messageId,
        reactionId: normalizedReactionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

interface InMemoryMessengerOptions {
  processingReactionEnabled?: boolean;
}

export class InMemoryMessenger implements BotMessenger {
  public readonly replies: Array<{ messageId: string; reply: BotOutboundMessage; options: ReplyOptions }> = [];
  public readonly processingEvents: Array<{ type: "add" | "remove"; messageId: string; reactionId: string | null }> = [];

  constructor(private readonly options: InMemoryMessengerOptions = {}) {}

  async replyMessage(messageId: string, reply: BotOutboundMessage, options: ReplyOptions = {}): Promise<SentMessage> {
    this.replies.push({ messageId, reply, options });
    return {
      messageId: `bot-${this.replies.length}`,
      rootId: options.replyInThread ? messageId : undefined,
      threadId: options.replyInThread ? `thread-${this.replies.length}` : undefined
    };
  }

  async addProcessingReaction(messageId: string): Promise<string | null> {
    if (this.options.processingReactionEnabled === false) {
      return null;
    }
    const reactionId = `reaction-${this.processingEvents.length + 1}`;
    this.processingEvents.push({ type: "add", messageId, reactionId });
    return reactionId;
  }

  async removeProcessingReaction(messageId: string, reactionId: string | null): Promise<void> {
    if (!reactionId?.trim()) {
      return;
    }
    this.processingEvents.push({ type: "remove", messageId, reactionId });
  }
}
