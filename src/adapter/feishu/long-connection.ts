import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuReceiveMessageEvent } from "../../types.js";

export class FeishuLongConnection {
  private readonly wsClient: Lark.WSClient;
  private readonly eventDispatcher: Lark.EventDispatcher;

  constructor(
    params: { appId: string; appSecret: string },
    onMessage: (event: FeishuReceiveMessageEvent) => void
  ) {
    this.wsClient = new Lark.WSClient({
      appId: params.appId,
      appSecret: params.appSecret,
      autoReconnect: true,
      loggerLevel: Lark.LoggerLevel.info
    });
    this.eventDispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": (data) => {
        onMessage(data as FeishuReceiveMessageEvent);
      }
    });
  }

  async start(): Promise<void> {
    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
  }

  stop(): void {
    this.wsClient.close({ force: true });
  }

  getReconnectInfo(): { lastConnectTime: number; nextConnectTime: number } {
    return this.wsClient.getReconnectInfo();
  }
}
