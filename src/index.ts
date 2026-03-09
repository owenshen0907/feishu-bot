import path from "node:path";
import { pathToFileURL } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import { FeishuLongConnection } from "./adapter/feishu/long-connection.js";
import { FeishuMessageClient } from "./adapter/feishu/message-client.js";
import { BotService } from "./bot-service.js";
import { ChatService } from "./chat-service.js";
import { loadConfig } from "./config.js";
import { BotFormatter } from "./formatter.js";
import { startHealthServer } from "./health-server.js";
import { JobPoller } from "./job-poller.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { SessionStore } from "./session-store.js";
import { SmartKitClient } from "./smartkit-client.js";

export interface StartedFeishuBot {
  shutdown: () => void;
}

interface RuntimeFeatureStatus {
  configured: boolean;
  active: boolean;
  state: "ready" | "needs_config" | "degraded";
  message: string;
}

export async function startFeishuBot(): Promise<StartedFeishuBot> {
  const config = loadConfig();
  const store = new SessionStore(config.session.dbPath);
  const chatService = new ChatService(store, config.botLlm, config.botChat);
  const formatter = new BotFormatter(config.botLlm);
  const smartkit = config.smartkit.configured ? new SmartKitClient(config.smartkit) : undefined;

  const runtimeStatus: {
    feishu: RuntimeFeatureStatus;
    smartkit: RuntimeFeatureStatus;
    chat: RuntimeFeatureStatus;
  } = {
    feishu: config.feishu.configured
      ? { configured: true, active: false, state: "degraded", message: "准备连接飞书长连接..." }
      : {
          configured: false,
          active: false,
          state: "needs_config",
          message: "未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，桌面已启动，但机器人还不会上线。"
        },
    smartkit: config.smartkit.configured
      ? { configured: true, active: true, state: "ready", message: "SmartKit 诊断能力已启用。" }
      : {
          configured: false,
          active: false,
          state: "degraded",
          message: "未配置 SMARTKIT_BASE_URL，trace / uid / job 功能已关闭。"
        },
    chat: config.capabilities.chatAvailable
      ? { configured: true, active: true, state: "ready", message: "普通聊天能力已启用。" }
      : {
          configured: config.botChat.enabled,
          active: false,
          state: config.botChat.enabled ? "degraded" : "needs_config",
          message: config.botChat.enabled
            ? "未配置 BOT_LLM_API_KEY，普通聊天暂不可用。"
            : "BOT_CHAT_ENABLED=false，普通聊天已关闭。"
        }
  };

  const nextSteps = (): string[] => {
    const steps: string[] = [];
    if (!config.feishu.configured) {
      steps.push("先在 .env 填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET，重启后机器人才能真正上线。");
    }
    if (!config.smartkit.configured) {
      steps.push("如果暂时不接 SmartKit，可以先把它当普通聊天机器人使用；以后补上 SMARTKIT_BASE_URL 再重启即可。");
    }
    if (!config.capabilities.chatAvailable) {
      steps.push("如果要启用普通聊天，请补充 BOT_LLM_API_KEY，并保持 BOT_CHAT_ENABLED=true。");
    }
    return steps;
  };

  let connection: FeishuLongConnection | undefined;
  let poller: JobPoller | undefined;

  const healthServer = startHealthServer({
    bind: config.health.bind,
    port: config.health.port,
    getPayload: () => ({
      profile: config.profile,
      dbPath: config.session.dbPath,
      features: runtimeStatus,
      llm: {
        provider: config.botLlm.provider,
        model: config.botLlm.model,
        visionModel: config.botLlm.visionModel,
        ttsModel: config.botLlm.ttsModel
      },
      abilities: {
        webSearchEnabled: config.capabilities.webSearchEnabled,
        voiceReplyEnabled: config.capabilities.voiceReplyEnabled,
        visionEnabled: config.capabilities.visionEnabled,
        braveSearchConfigured: config.capabilities.braveSearchConfigured
      },
      nextSteps: nextSteps(),
      reconnect: connection ? connection.getReconnectInfo() : null
    })
  });

  if (config.feishu.configured) {
    const larkClient = new Lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      loggerLevel: Lark.LoggerLevel.info
    });
    const messenger = new FeishuMessageClient(larkClient);
    const botService = new BotService(store, smartkit, chatService, messenger, formatter, config.feishu.botName);

    if (smartkit) {
      poller = new JobPoller(store, smartkit, messenger, formatter, config.session.jobPollIntervalMs);
      poller.start();
    }

    connection = new FeishuLongConnection(
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

    try {
      await connection.start();
      runtimeStatus.feishu = {
        configured: true,
        active: true,
        state: "ready",
        message: "飞书长连接已建立，机器人已在线。"
      };
      logInfo("feishu long connection started");
    } catch (error) {
      runtimeStatus.feishu = {
        configured: true,
        active: false,
        state: "degraded",
        message: `飞书连接失败：${error instanceof Error ? error.message : String(error)}`
      };
      logWarn("feishu long connection unavailable", {
        error: error instanceof Error ? error.message : String(error)
      });
      poller?.stop();
      poller = undefined;
      connection = undefined;
    }
  } else {
    logInfo("feishu connection skipped because credentials are missing");
  }

  let stopped = false;
  const shutdown = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    poller?.stop();
    connection?.stop();
    healthServer?.close();
    store.close();
    logInfo("feishu bot stopped");
  };

  const handleSigint = () => shutdown();
  const handleSigterm = () => shutdown();
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  return {
    shutdown: () => {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      shutdown();
    }
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function runCli(): Promise<void> {
  try {
    await startFeishuBot();
  } catch (error) {
    logError("startup failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}

if (isDirectExecution()) {
  void runCli();
}
