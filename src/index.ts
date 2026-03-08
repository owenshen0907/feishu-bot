import * as Lark from "@larksuiteoapi/node-sdk";
import { BotService } from "./bot-service.js";
import { loadConfig } from "./config.js";
import { BotFormatter } from "./formatter.js";
import { startHealthServer } from "./health-server.js";
import { JobPoller } from "./job-poller.js";
import { logError, logInfo } from "./logger.js";
import { FeishuLongConnection } from "./adapter/feishu/long-connection.js";
import { FeishuMessageClient } from "./adapter/feishu/message-client.js";
import { SessionStore } from "./session-store.js";
import { SmartKitClient } from "./smartkit-client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new SessionStore(config.session.dbPath);
  const smartkit = new SmartKitClient(config.smartkit);
  const formatter = new BotFormatter(config.botLlm);
  const larkClient = new Lark.Client({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    loggerLevel: Lark.LoggerLevel.info
  });
  const messenger = new FeishuMessageClient(larkClient);
  const botService = new BotService(store, smartkit, messenger, formatter, config.feishu.botName);
  const poller = new JobPoller(store, smartkit, messenger, formatter, config.session.jobPollIntervalMs);
  const connection = new FeishuLongConnection(
    {
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret
    },
    (event) => {
      void botService.handleEvent(event).catch((error) => {
        logError("async event handle failed", {
          error: error instanceof Error ? error.message : String(error),
          messageId: event.message.message_id
        });
      });
    }
  );

  poller.start();
  const healthServer = startHealthServer({
    bind: config.health.bind,
    port: config.health.port,
    getPayload: () => ({
      dbPath: config.session.dbPath,
      reconnect: connection.getReconnectInfo()
    })
  });

  await connection.start();
  logInfo("feishu long connection started");

  const shutdown = () => {
    poller.stop();
    connection.stop();
    healthServer?.close();
    store.close();
    logInfo("feishu bot stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logError("startup failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
