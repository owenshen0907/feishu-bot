import * as Lark from "@larksuiteoapi/node-sdk";
import { logWarn } from "./logger.js";
import type { IdentityResolver, ThreadIdentity } from "./types.js";

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function detectUserIdType(userId: string): "user_id" | "open_id" {
  return trim(userId).startsWith("ou_") ? "open_id" : "user_id";
}

function normalizeName(value: unknown): string | null {
  const name = trim(value);
  return name ? name : null;
}

export class FeishuIdentityResolver implements IdentityResolver {
  private readonly requesterNameCache = new Map<string, string | null>();
  private readonly chatNameCache = new Map<string, string | null>();

  constructor(private readonly client: Lark.Client) {}

  async resolveThreadIdentity(input: {
    requesterId: string;
    chatId: string;
    chatType: string;
    scope: "p2p" | "group";
  }): Promise<ThreadIdentity> {
    const [requesterName, chatName] = await Promise.all([
      this.resolveRequesterName(input.requesterId),
      input.scope === "group" ? this.resolveChatName(input.chatId) : Promise.resolve(null)
    ]);

    return {
      requesterName,
      chatName
    };
  }

  private async resolveRequesterName(requesterId: string): Promise<string | null> {
    const normalized = trim(requesterId);
    if (!normalized) {
      return null;
    }
    if (this.requesterNameCache.has(normalized)) {
      return this.requesterNameCache.get(normalized) ?? null;
    }

    try {
      const response = await this.client.contact.v3.user.get({
        path: {
          user_id: normalized
        },
        params: {
          user_id_type: detectUserIdType(normalized)
        }
      });
      const name = normalizeName(response.data?.user?.name) ?? normalizeName(response.data?.user?.nickname);
      this.requesterNameCache.set(normalized, name);
      return name;
    } catch (error) {
      logWarn("resolve feishu user display name failed", {
        requesterId: normalized,
        error: error instanceof Error ? error.message : String(error)
      });
      this.requesterNameCache.set(normalized, null);
      return null;
    }
  }

  private async resolveChatName(chatId: string): Promise<string | null> {
    const normalized = trim(chatId);
    if (!normalized) {
      return null;
    }
    if (this.chatNameCache.has(normalized)) {
      return this.chatNameCache.get(normalized) ?? null;
    }

    try {
      const response = await this.client.im.v1.chat.get({
        path: {
          chat_id: normalized
        }
      });
      const name =
        normalizeName(response.data?.name) ??
        normalizeName(response.data?.i18n_names?.zh_cn) ??
        normalizeName(response.data?.i18n_names?.en_us);
      this.chatNameCache.set(normalized, name);
      return name;
    } catch (error) {
      logWarn("resolve feishu chat display name failed", {
        chatId: normalized,
        error: error instanceof Error ? error.message : String(error)
      });
      this.chatNameCache.set(normalized, null);
      return null;
    }
  }
}
