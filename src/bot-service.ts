import { randomUUID } from "node:crypto";
import { capabilityIdForDiagnosticComponent, resolveUsableComponentCommand } from "./diagnostic-components.js";
import { loadConfig } from "./config.js";
import type { BotFormatter } from "./formatter.js";
import { readCapabilityCardHelpDescriptions, readHelpContent } from "./help-content.js";
import { logError, logInfo } from "./logger.js";
import { cleanMessage, parseMessage } from "./parser/index.js";
import type {
  AcceptedPayload,
  CapabilityGate,
  CapabilityID,
  BotChatService,
  BotMessenger,
  BotOutboundMessage,
  BridgeEnvelope,
  DiagnosticComponentProfile,
  DiagnosisPayload,
  DiagnosticGatewayProvider,
  DiagnosticIntentPrompt,
  FeishuMention,
  FeishuReceiveMessageEvent,
  HelpCapabilitySummaryItem,
  IdentityResolver,
  DiagnosticIntentResolver,
  Scope,
  SessionRecord,
  DiagnosticGateway
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

const PRIVATE_DIAGNOSTIC_FOLLOWUP_PATTERN =
  /(原因|根因|证据|建议|日志|链路|调用链|trace|uid|job|任务|状态|进度|结果|结论|报错|错误|异常|超时|失败|怎么处理|如何处理|怎么办|为啥|为什么|咋回事|影响范围|next step|status|reason|evidence|suggestion|error|timeout|result)/i;

export class BotService {
  private readonly diagnosticGatewayProvider?: DiagnosticGatewayProvider;

  constructor(
    private readonly store: SessionStore,
    diagnosticGateway: DiagnosticGateway | DiagnosticGatewayProvider | undefined,
    private readonly chatService: BotChatService,
    private readonly messenger: BotMessenger,
    private readonly formatter: BotFormatter,
    private readonly botName: string,
    private readonly identityResolver?: IdentityResolver,
    private readonly capabilityGate?: CapabilityGate,
    private readonly diagnosticIntentResolver?: DiagnosticIntentResolver
  ) {
    this.diagnosticGatewayProvider = this.normalizeDiagnosticGatewayProvider(diagnosticGateway);
  }

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
    const sessionId = session?.sessionId ?? randomUUID();
    const parsed = parseMessage(context.text, {
      hasThreadContext: Boolean(session),
      currentJobId: session?.jobId,
      allowChatFallback: context.scope === "p2p"
    });
    const diagnosticIntent = this.diagnosticIntentResolver?.resolve({
      message: context.text,
      parsed,
      currentJobId: session?.jobId,
      hasThreadContext: Boolean(session),
      preferredComponentId: session?.componentId,
      availableComponentIds: this.listAllowedDiagnosticComponentIds(context)
    });
    const effectiveParsed = diagnosticIntent?.kind === "command" && diagnosticIntent.command
      ? diagnosticIntent.command
      : parsed;
    const identityPromise = this.resolveThreadIdentity(context);
    const processingReactionId = await this.messenger.addProcessingReaction(context.messageId);

    try {
      const outcome = diagnosticIntent?.kind === "missing_target" && diagnosticIntent.prompt
        ? await this.handleDiagnosticInputPrompt(diagnosticIntent.prompt, context)
        : await this.executeCommand(effectiveParsed, session, context);
      const sentMessage = await this.replySafely(context.messageId, outcome.reply, context.replyInThread, processingReactionId);
      const identity = await identityPromise;
      const conversationId = outcome.conversationId ?? this.buildLocalConversationId(session, context);

      const effectiveRequester = outcome.requesterId ?? session?.requesterId ?? context.userId;
      const record: SessionRecord = {
        sessionId,
        conversationId,
        componentId: outcome.componentId ?? session?.componentId ?? null,
        jobId: outcome.jobId ?? session?.jobId ?? null,
        requesterId: effectiveRequester,
        requesterName: identity.requesterName ?? session?.requesterName ?? null,
        scope: outcome.scope ?? session?.scope ?? context.scope,
        chatId: context.chatId,
        chatName: identity.chatName ?? session?.chatName ?? null,
        chatType: context.chatType,
        anchorMessageId: session?.anchorMessageId ?? context.messageId,
        lastMessageId: context.messageId,
        threadId: sentMessage.threadId ?? event.message.thread_id ?? event.message.root_id ?? session?.threadId ?? null,
        lastQuestion: effectiveParsed.rawText,
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
      this.store.appendSessionMessages(sessionId, [
        {
          sessionId,
          role: "user",
          senderId: context.userId,
          senderName: record.requesterName ?? (context.scope == "group" ? "群成员" : "用户"),
          messageId: context.messageId,
          content: effectiveParsed.rawText,
          createdAt
        },
        {
          sessionId,
          role: "assistant",
          senderName: this.botName,
          messageId: sentMessage.messageId,
          content: outcome.reply.textPreview,
          createdAt: new Date().toISOString()
        }
      ]);
    } catch (error) {
      logError("handle message failed", {
        error: error instanceof Error ? error.message : String(error),
        messageId: context.messageId
      });
      const failureReply = this.formatter.formatBridgeError(toErrorMessage(error));
      const sentMessage = await this.replySafely(context.messageId, failureReply, context.replyInThread, processingReactionId);
      const identity = await identityPromise;
      const record: SessionRecord = {
        sessionId,
        conversationId: this.buildLocalConversationId(session, context),
        componentId: session?.componentId ?? null,
        jobId: session?.jobId ?? null,
        requesterId: session?.requesterId ?? context.userId,
        requesterName: identity.requesterName ?? session?.requesterName ?? null,
        scope: session?.scope ?? context.scope,
        chatId: context.chatId,
        chatName: identity.chatName ?? session?.chatName ?? null,
        chatType: context.chatType,
        anchorMessageId: session?.anchorMessageId ?? context.messageId,
        lastMessageId: context.messageId,
        threadId: sentMessage.threadId ?? event.message.thread_id ?? event.message.root_id ?? session?.threadId ?? null,
        lastQuestion: effectiveParsed.rawText,
        jobStatus: "failed",
        notificationSentAt: new Date().toISOString(),
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
      this.store.appendSessionMessages(sessionId, [
        {
          sessionId,
          role: "user",
          senderId: context.userId,
          senderName: record.requesterName ?? (context.scope == "group" ? "群成员" : "用户"),
          messageId: context.messageId,
          content: effectiveParsed.rawText,
          createdAt
        },
        {
          sessionId,
          role: "assistant",
          senderName: this.botName,
          messageId: sentMessage.messageId,
          content: failureReply.textPreview,
          createdAt: new Date().toISOString()
        }
      ]);
    }
  }

  private async executeCommand(
    parsed: ReturnType<typeof parseMessage>,
    session: SessionRecord | undefined,
    context: MessageContext
  ): Promise<{
    reply: BotOutboundMessage;
    componentId?: string | null;
    conversationId?: string;
    jobId?: string | null;
    jobStatus?: string | null;
    notificationSentAt?: string | null;
    requesterId?: string;
    scope?: Scope;
  }> {
    switch (parsed.action) {
      case "help":
        return {
          reply: this.formatter.formatHelp({
            capabilities: this.buildHelpCapabilitySummary(context)
          })
        };
      case "trace": {
        const selected = this.resolveDiagnosticGateway(context.text, session?.componentId, context);
        if (selected.kind === "error") {
          return { reply: selected.reply };
        }
        const envelope = await selected.gateway.analyzeTrace({
          traceId: parsed.targetId,
          mode: parsed.mode,
          requesterId: context.userId,
          scope: context.scope
        });
        return this.handleBridgeResponse(envelope, parsed.rawText, context.userId, context.scope, selected.component.id);
      }
      case "uid": {
        const selected = this.resolveDiagnosticGateway(context.text, session?.componentId, context);
        if (selected.kind === "error") {
          return { reply: selected.reply };
        }
        const envelope = await selected.gateway.analyzeUid({
          uid: parsed.targetId,
          mode: parsed.mode,
          timeRange: parsed.timeRange,
          requesterId: context.userId,
          scope: context.scope
        });
        return this.handleBridgeResponse(envelope, parsed.rawText, context.userId, context.scope, selected.component.id);
      }
      case "job": {
        const selected = this.resolveDiagnosticGateway(context.text, session?.componentId, context);
        if (selected.kind === "error") {
          return { reply: selected.reply };
        }
        const jobId = parsed.targetId || session?.jobId;
        if (!jobId) {
          return {
            reply: this.formatter.formatHelp({
              capabilities: this.buildHelpCapabilitySummary(context)
            })
          };
        }
        const envelope = await selected.gateway.getJob(jobId);
        ensureBridgeOk(envelope);
        return {
          reply: await this.formatter.formatJob(envelope.data),
          componentId: selected.component.id,
          conversationId: envelope.data.conversation_id || session?.conversationId,
          jobId: envelope.data.job_id,
          jobStatus: envelope.data.status,
          notificationSentAt: ["completed", "failed"].includes(envelope.data.status) ? new Date().toISOString() : null,
          requesterId: session?.requesterId ?? context.userId,
          scope: session?.scope ?? context.scope
        };
      }
      case "followup": {
        if (context.scope === "p2p" && !this.shouldUsePrivateDiagnosticFollowup(parsed.rawText, session)) {
          return this.executeChatReply(parsed.rawText, context);
        }
        const selected = this.resolveDiagnosticGateway(context.text, session?.componentId, context);
        if (selected.kind === "error") {
          return { reply: selected.reply };
        }
        if (!session?.conversationId) {
          return {
            reply: this.formatter.formatHelp({
              capabilities: this.buildHelpCapabilitySummary(context)
            })
          };
        }
        const requesterId = session.scope === "group" ? session.requesterId : context.userId;
        const envelope = await selected.gateway.followup({
          conversationId: session.conversationId,
          message: parsed.rawText,
          requesterId,
          scope: session.scope
        });
        return this.handleBridgeResponse(envelope, parsed.rawText, requesterId, session.scope, selected.component.id);
      }
      case "chat": {
        return this.executeChatReply(parsed.rawText, context);
      }
      case "memory_clear": {
        const denied = this.requireCapability("chat", context);
        if (denied) {
          return { reply: denied };
        }
        const deletedCount = this.chatService.clearMemory(context.userId);
        return { reply: this.formatter.formatMemoryCleared(deletedCount) };
      }
      case "memory_status": {
        const denied = this.requireCapability("chat", context);
        if (denied) {
          return { reply: denied };
        }
        const memoryCount = this.chatService.getMemoryCount(context.userId);
        return { reply: this.formatter.formatMemoryStatus(memoryCount) };
      }
      default:
        return {
          reply: this.formatter.formatHelp({
            capabilities: this.buildHelpCapabilitySummary(context)
          })
        };
    }
  }

  private async handleDiagnosticInputPrompt(
    prompt: DiagnosticIntentPrompt,
    context: MessageContext
  ): Promise<{
    reply: BotOutboundMessage;
    componentId?: string | null;
    conversationId?: string;
    jobId?: string | null;
    jobStatus?: string | null;
    notificationSentAt?: string | null;
    requesterId?: string;
    scope?: Scope;
  }> {
    const access = this.requireCapability(capabilityIdForDiagnosticComponent(prompt.component.id), context);
    if (access) {
      return { reply: access };
    }
    if (!this.diagnosticGatewayProvider?.getGateway(prompt.component.id)) {
      return { reply: this.formatter.formatDiagnosticUnavailable() };
    }
    return {
      componentId: prompt.component.id,
      reply: this.formatter.formatDiagnosticTargetRequired({
        component: prompt.component,
        reason: prompt.reason,
        expectedInputs: prompt.expectedInputs
      })
    };
  }

  private async executeChatReply(
    message: string,
    context: MessageContext
  ): Promise<{
    reply: BotOutboundMessage;
    componentId?: string | null;
    conversationId?: string;
    jobId?: string | null;
    jobStatus?: string | null;
    notificationSentAt?: string | null;
    requesterId?: string;
    scope?: Scope;
  }> {
    const denied = this.requireCapability("chat", context);
    if (denied) {
      return { reply: denied };
    }
    if (!this.chatService.isAvailable()) {
      return { reply: this.formatter.formatChatUnavailable() };
    }
    const result = await this.chatService.reply({
      userId: context.userId,
      message
    });
    return {
      reply: this.formatter.formatChatReply({
        question: message,
        answer: result.answer,
        memoryCount: result.memoryCount
      })
    };
  }

  private async handleBridgeResponse(
    envelope: BridgeEnvelope<DiagnosisPayload | AcceptedPayload>,
    question: string,
    requesterId: string,
    scope: Scope,
    componentId: string
  ): Promise<{
    reply: BotOutboundMessage;
    componentId?: string | null;
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
        componentId,
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
      componentId,
      conversationId: diagnosis.conversation_id,
      jobId: diagnosis.job_id ?? null,
      jobStatus: diagnosis.status,
      notificationSentAt: diagnosis.job_id ? new Date().toISOString() : null,
      requesterId,
      scope
    };
  }

  private requireCapability(capabilityID: CapabilityID, context: MessageContext): BotOutboundMessage | null {
    const access = this.capabilityAccess(capabilityID, context);
    if (!access) {
      return null;
    }
    if (access.allowed) {
      return null;
    }

    return this.formatter.formatCapabilityDenied({
      capabilityID,
      scope: context.scope,
      reason: access.reason
    });
  }

  private capabilityAccess(capabilityID: CapabilityID, context: MessageContext) {
    if (!this.capabilityGate) {
      return null;
    }

    return this.capabilityGate.canUse(capabilityID, {
      scope: context.scope,
      chatId: context.chatId,
      userId: context.userId
    });
  }

  private buildHelpCapabilitySummary(context: MessageContext): HelpCapabilitySummaryItem[] {
    const builtinItems: HelpCapabilitySummaryItem[] = [];
    const componentItems: HelpCapabilitySummaryItem[] = [];
    const config = loadConfig();
    const components = this.diagnosticGatewayProvider?.listComponents() ?? [];
    const capabilityDescriptions = readCapabilityCardHelpDescriptions();
    const orderMode = readHelpContent()?.capabilityOrderMode ?? "builtin_first";

    if (this.chatService.isAvailable() && (this.capabilityAccess("chat", context)?.allowed ?? true)) {
      builtinItems.push({
        title: "普通聊天",
        description: "私聊里直接发消息即可继续聊天；上下文会按用户单独记住。"
      });
    }

    if (config.capabilities.webSearchEnabled && (this.capabilityAccess("webSearch", context)?.allowed ?? true)) {
      builtinItems.push({
        title: "联网搜索",
        description: capabilityDescriptions.webSearch || "需要公开网页信息时，可以联网搜索后再整理给你。"
      });
    }

    if (config.capabilities.voiceReplyEnabled && (this.capabilityAccess("voiceReply", context)?.allowed ?? true)) {
      builtinItems.push({
        title: "语音回复",
        description: capabilityDescriptions.voiceReply || "支持把回答整理成语音结果返回。"
      });
    }

    if (config.capabilities.visionEnabled && (this.capabilityAccess("vision", context)?.allowed ?? true)) {
      builtinItems.push({
        title: "视觉理解",
        description: capabilityDescriptions.vision || "可以结合图片内容一起理解问题并给出说明。"
      });
    }

    for (const component of components) {
      if (!(this.capabilityAccess(capabilityIdForDiagnosticComponent(component.id), context)?.allowed ?? true)) {
        continue;
      }
      const command = resolveUsableComponentCommand(component, components);
      componentItems.push({
        title: component.name || "自定义 HTTP 组件",
        description: component.summary || component.usageDescription || "这是一项已开通的自定义组件能力。",
        command: command ? `/${command}` : undefined
      });
    }

    return orderMode === "component_first"
      ? [...componentItems, ...builtinItems]
      : [...builtinItems, ...componentItems];
  }

  private normalizeDiagnosticGatewayProvider(
    value: DiagnosticGateway | DiagnosticGatewayProvider | undefined
  ): DiagnosticGatewayProvider | undefined {
    if (!value) {
      return undefined;
    }
    if ("getGateway" in value && "getComponent" in value && "listComponents" in value) {
      return value;
    }
    const component = {
      id: "legacy-diagnostic-http",
      name: "自定义 HTTP 组件",
      enabled: true,
      command: "",
      summary: "",
      usageDescription: "",
      examplePrompts: [],
      baseUrl: "",
      token: "",
      caller: "feishu-bot",
      timeoutMs: 20000
    };
    return {
      listComponents: () => [component],
      getComponent: (componentId: string) => componentId === component.id ? component : null,
      getGateway: (componentId: string) => componentId === component.id ? value : undefined
    };
  }

  private listAllowedDiagnosticComponentIds(context: MessageContext): string[] {
    return (this.diagnosticGatewayProvider?.listComponents() ?? [])
      .filter((component) => !this.requireCapability(capabilityIdForDiagnosticComponent(component.id), context))
      .map((component) => component.id);
  }

  private resolveDiagnosticGateway(
    message: string,
    preferredComponentId: string | null | undefined,
    context: MessageContext
  ):
    | {
        kind: "ok";
        component: DiagnosticComponentProfile;
        gateway: DiagnosticGateway;
      }
    | {
        kind: "error";
        reply: BotOutboundMessage;
      } {
    const provider = this.diagnosticGatewayProvider;
    if (!provider) {
      return { kind: "error", reply: this.formatter.formatDiagnosticUnavailable() };
    }

    const available = provider.listComponents()
      .filter((component) => !this.requireCapability(capabilityIdForDiagnosticComponent(component.id), context));
    if (available.length === 0) {
      const allComponents = provider.listComponents();
      return {
        kind: "error",
        reply: allComponents.length === 0
          ? this.formatter.formatDiagnosticUnavailable()
          : this.formatter.formatCapabilityDenied({
              capabilityID: "diagnosticHttp",
              scope: context.scope,
              reason: "当前对象还没有开启任何可用的自定义 HTTP 组件。"
            })
      };
    }

    const selectedByMessage = this.diagnosticIntentResolver?.pickComponent({
      message,
      preferredComponentId,
      availableComponentIds: available.map((component) => component.id)
    });
    const selectedComponentId = selectedByMessage
      || (preferredComponentId && available.find((component) => component.id === preferredComponentId)?.id)
      || (available.length === 1 ? available[0]?.id : "");
    const component = selectedComponentId
      ? available.find((item) => item.id === selectedComponentId) ?? null
      : null;

    if (!component) {
      return {
        kind: "error",
        reply: this.formatter.formatDiagnosticComponentSelectionRequired(available.map((item) => item.name))
      };
    }

    const gateway = provider.getGateway(component.id);
    if (!gateway) {
      return { kind: "error", reply: this.formatter.formatDiagnosticUnavailable() };
    }

    return { kind: "ok", component, gateway };
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

  private buildLocalConversationId(session: SessionRecord | undefined, context: MessageContext): string {
    if (session?.conversationId) {
      return session.conversationId;
    }
    const stableKey = context.aliasKeys[0] || `${context.scope}:${context.chatId}:${context.userId}:${context.messageId}`;
    return `local:${stableKey}`;
  }

  private shouldUsePrivateDiagnosticFollowup(message: string, session: SessionRecord | undefined): boolean {
    if (!session?.componentId || !session.conversationId || session.conversationId.startsWith("local:")) {
      return false;
    }
    return PRIVATE_DIAGNOSTIC_FOLLOWUP_PATTERN.test(message);
  }

  private async replySafely(messageId: string, reply: BotOutboundMessage, replyInThread: boolean, processingReactionId: string | null) {
    await this.messenger.removeProcessingReaction(messageId, processingReactionId);
    const sent = await this.messenger.replyMessage(messageId, reply, { replyInThread });
    logInfo("reply sent", { messageId, replyInThread, kind: reply.kind });
    return sent;
  }

  private async resolveThreadIdentity(context: MessageContext) {
    if (!this.identityResolver) {
      return {};
    }
    try {
      return await this.identityResolver.resolveThreadIdentity({
        requesterId: context.userId,
        chatId: context.chatId,
        chatType: context.chatType,
        scope: context.scope
      });
    } catch (error) {
      logError("resolve thread identity failed", {
        error: error instanceof Error ? error.message : String(error),
        chatId: context.chatId,
        userId: context.userId
      });
      return {};
    }
  }
}

function ensureBridgeOk(envelope: BridgeEnvelope<unknown>): void {
  if (["ok", "accepted"].includes(envelope.code) && envelope.http_status < 400) {
    return;
  }
  throw new Error(envelope.message || `Diagnostic bridge returned ${envelope.http_status}`);
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
    return "当前聊天模型未配置，暂时只能使用组件命令。";
  }
  if (error instanceof Error && error.message === "empty_chat_message") {
    return "聊天消息不能为空。";
  }
  return error instanceof Error ? error.message : String(error);
}
