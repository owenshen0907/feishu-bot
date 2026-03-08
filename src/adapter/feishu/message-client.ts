import { randomUUID } from "node:crypto";
import * as Lark from "@larksuiteoapi/node-sdk";
import type { BotMessenger, ReplyOptions, SentMessage } from "../../types.js";

export class FeishuMessageClient implements BotMessenger {
  constructor(private readonly client: Lark.Client) {}

  async replyText(messageId: string, text: string, options: ReplyOptions = {}): Promise<SentMessage> {
    const response = await this.client.im.v1.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text }),
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
}

export class InMemoryMessenger implements BotMessenger {
  public readonly replies: Array<{ messageId: string; text: string; options: ReplyOptions }> = [];

  async replyText(messageId: string, text: string, options: ReplyOptions = {}): Promise<SentMessage> {
    this.replies.push({ messageId, text, options });
    return {
      messageId: `bot-${this.replies.length}`,
      rootId: options.replyInThread ? messageId : undefined,
      threadId: options.replyInThread ? `thread-${this.replies.length}` : undefined
    };
  }
}
