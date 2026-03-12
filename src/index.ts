import path from "node:path";
import { pathToFileURL } from "node:url";
import * as Lark from "@larksuiteoapi/node-sdk";
import { FeishuLongConnection } from "./adapter/feishu/long-connection.js";
import { FeishuMessageClient } from "./adapter/feishu/message-client.js";
import { BotService } from "./bot-service.js";
import { ConsoleCapabilityPolicy } from "./capability-policy.js";
import { ChatService } from "./chat-service.js";
import { loadConfig } from "./config.js";
import { ConsoleDiagnosticComponentProvider, ConsoleDiagnosticGatewayProvider } from "./diagnostic-components.js";
import { ConsoleDiagnosticIntentRouter } from "./diagnostic-intent-router.js";
import { FeishuIdentityResolver } from "./feishu-identity.js";
import { BotFormatter } from "./formatter.js";
import { ConsoleHelpContentProvider } from "./help-content.js";
import { startHealthServer } from "./health-server.js";
import { JobPoller } from "./job-poller.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { ConsoleProcessingReactionProvider } from "./processing-feedback.js";
import { SessionStore } from "./session-store.js";

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
  const helpContentProvider = new ConsoleHelpContentProvider();
  const processingReactionProvider = new ConsoleProcessingReactionProvider();
  const formatter = new BotFormatter(config.botLlm, helpContentProvider);
  const capabilityPolicy = new ConsoleCapabilityPolicy();
  const diagnosticIntentRouter = new ConsoleDiagnosticIntentRouter();
  const diagnosticComponentProvider = new ConsoleDiagnosticComponentProvider();
  const diagnosticGatewayProvider = new ConsoleDiagnosticGatewayProvider();

  const buildDiagnosticRuntimeStatus = (): RuntimeFeatureStatus => {
    const allComponents = diagnosticComponentProvider.listComponents();
    const configuredComponents = allComponents.filter((component) => Boolean(component.baseUrl));
    const activeComponents = configuredComponents.filter((component) => component.enabled);

    if (activeComponents.length > 0) {
      return {
        configured: true,
        active: true,
        state: "ready",
        message: activeComponents.length === 1
          ? "已启用 1 个自定义 HTTP 组件。"
          : `已启用 ${activeComponents.length} 个自定义 HTTP 组件。`
      };
    }

    if (configuredComponents.length > 0) {
      return {
        configured: true,
        active: false,
        state: "degraded",
        message: configuredComponents.length === 1
          ? "组件已接入，但全局开关关闭。"
          : `已有 ${configuredComponents.length} 个组件接入，但全局开关关闭。`
      };
    }

    return {
      configured: false,
      active: false,
      state: "degraded",
      message: "未配置组件地址，trace / uid / job 功能已关闭。"
    };
  };

  const diagnosticAvailable = buildDiagnosticRuntimeStatus().active;

  const runtimeStatus: {
    feishu: RuntimeFeatureStatus;
    diagnosticHttp: RuntimeFeatureStatus;
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
    diagnosticHttp: buildDiagnosticRuntimeStatus(),
    smartkit: buildDiagnosticRuntimeStatus(),
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
    if (!diagnosticAvailable) {
      steps.push("如果暂时不接组件，可以先把它当普通聊天机器人使用；以后补上组件地址并打开开关后即可使用诊断命令。");
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
      features: {
        ...runtimeStatus,
        diagnosticHttp: buildDiagnosticRuntimeStatus(),
        smartkit: buildDiagnosticRuntimeStatus()
      },
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
    const messenger = new FeishuMessageClient(larkClient, processingReactionProvider);
    const identityResolver = new FeishuIdentityResolver(larkClient);
    const botService = new BotService(
      store,
      diagnosticGatewayProvider,
      chatService,
      messenger,
      formatter,
      config.feishu.botName,
      identityResolver,
      capabilityPolicy,
      diagnosticIntentRouter
    );

    poller = new JobPoller(
      store,
      diagnosticGatewayProvider,
      messenger,
      formatter,
      config.session.jobPollIntervalMs,
      config.feishu.botName,
      capabilityPolicy
    );
    poller.start();

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
