export type Mode = "sync" | "async";
export type Scope = "p2p" | "group";
export type TargetType = "trace" | "uid";
export type TimeRange = "15m" | "1h" | "6h" | "1d";
export type CommandAction = "help" | "trace" | "uid" | "job" | "followup" | "chat" | "memory_clear" | "memory_status";
export type ChatRole = "system" | "user" | "assistant";
export type DynamicDiagnosticCapabilityID = `component:${string}`;
export type CapabilityID = "chat" | "smartkit" | "diagnosticHttp" | "webSearch" | "voiceReply" | "vision" | DynamicDiagnosticCapabilityID;
export type CapabilityAccessSource = "user" | "group" | "default";
export type HelpCapabilityOrderMode = "builtin_first" | "component_first";

export interface BridgeEnvelope<T = unknown> {
  code: string;
  message: string;
  data: T;
  trace_id: string;
  http_status: number;
}

export interface EvidenceItem {
  title?: string;
  detail?: string;
  source?: string;
  severity?: string;
  snippet?: string;
}

export interface LinkItem {
  label?: string;
  url?: string;
  kind?: string;
}

export interface DiagnosisPayload {
  target_type: TargetType;
  target_id: string;
  status: string;
  structured_result: Record<string, unknown>;
  canonical_summary: string;
  probable_causes: string[];
  evidence: EvidenceItem[];
  recommended_actions: string[];
  links: LinkItem[];
  conversation_id: string;
  job_id?: string | null;
}

export interface AcceptedPayload {
  target_type: TargetType;
  target_id: string;
  status: string;
  conversation_id: string;
  job_id: string;
}

export interface JobPayload {
  job_id: string;
  conversation_id: string;
  target_type: TargetType;
  target_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  request_payload: Record<string, unknown>;
  result_payload?: DiagnosisPayload;
  error_message?: string;
}

export interface ConversationPayload {
  conversation_id: string;
  target_type: TargetType;
  target_id: string;
  scope: Scope;
  requester_id: string;
  mode: Mode;
  status: string;
  summary?: string;
  latest_result?: Record<string, unknown>;
  evidence_snapshot?: EvidenceItem[];
  allowed_actions?: string[];
  job_id?: string | null;
  history?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface ParsedCommand {
  action: CommandAction;
  targetId: string;
  mode: Mode;
  timeRange: TimeRange;
  rawText: string;
  isFollowup: boolean;
  errors: string[];
  useCurrentJob: boolean;
}

export interface DiagnosticComponentProfile {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  summary: string;
  usageDescription: string;
  examplePrompts: string[];
  baseUrl: string;
  token: string;
  caller: string;
  timeoutMs: number;
}

export interface DiagnosticIntentPrompt {
  component: DiagnosticComponentProfile;
  reason: string;
  expectedInputs: string[];
}

export interface DiagnosticIntentResolution {
  kind: "command" | "missing_target";
  componentId: string;
  command?: ParsedCommand;
  prompt?: DiagnosticIntentPrompt;
}

export interface FeishuMention {
  key?: string;
  name?: string;
  id?: {
    union_id?: string;
    user_id?: string;
    open_id?: string;
  };
}

export interface FeishuReceiveMessageEvent {
  event_id?: string;
  sender: {
    sender_id?: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    sender_type: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    thread_id?: string;
    create_time: string;
    update_time?: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: FeishuMention[];
  };
}

export interface ReplyOptions {
  replyInThread?: boolean;
}

export interface SentMessage {
  messageId: string;
  rootId?: string;
  parentId?: string;
  threadId?: string;
}

export interface ThreadIdentity {
  requesterName?: string | null;
  chatName?: string | null;
}

export interface SessionRecord {
  sessionId: string;
  conversationId: string;
  componentId?: string | null;
  jobId?: string | null;
  requesterId: string;
  requesterName?: string | null;
  scope: Scope;
  chatId: string;
  chatName?: string | null;
  chatType: string;
  anchorMessageId: string;
  lastMessageId: string;
  threadId?: string | null;
  lastQuestion: string;
  jobStatus?: string | null;
  notificationSentAt?: string | null;
  updatedAt: string;
}

export interface ChatMemoryRecord {
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface SessionMessageRecord {
  sessionId: string;
  role: ChatRole;
  senderId?: string | null;
  senderName?: string | null;
  messageId?: string | null;
  content: string;
  createdAt: string;
}

export interface ChatReply {
  answer: string;
  memoryCount: number;
}

export interface BotChatService {
  isAvailable(): boolean;
  reply(input: { userId: string; message: string }): Promise<ChatReply>;
  clearMemory(userId: string): number;
  getMemoryCount(userId: string): number;
}

export interface LarkCardMessage {
  config?: Record<string, unknown>;
  header: {
    template: string;
    title: {
      tag: "plain_text";
      content: string;
    };
  };
  elements: Array<Record<string, unknown>>;
}

export interface BotReplyMessage {
  kind: "card";
  card: LarkCardMessage;
  textPreview: string;
}

export interface BotTextReplyMessage {
  kind: "text";
  text: string;
  textPreview: string;
}

export type BotOutboundMessage = BotReplyMessage | BotTextReplyMessage;

export interface BotMessenger {
  replyMessage(messageId: string, reply: BotOutboundMessage, options?: ReplyOptions): Promise<SentMessage>;
  addProcessingReaction(messageId: string): Promise<string | null>;
  removeProcessingReaction(messageId: string, reactionId: string | null): Promise<void>;
}

export interface CapabilityContext {
  scope: Scope;
  chatId: string;
  userId: string;
}

export interface CapabilityAccessResult {
  allowed: boolean;
  source: CapabilityAccessSource;
  reason: string;
}

export interface CapabilityGate {
  canUse(capabilityID: CapabilityID, context: CapabilityContext): CapabilityAccessResult;
}

export interface IdentityResolver {
  resolveThreadIdentity(input: {
    requesterId: string;
    chatId: string;
    chatType: string;
    scope: Scope;
  }): Promise<ThreadIdentity>;
}

export interface DiagnosticIntentResolver {
  getComponents(): DiagnosticComponentProfile[];
  pickComponent(input: {
    message: string;
    preferredComponentId?: string | null;
    availableComponentIds?: string[];
  }): string | null;
  resolve(input: {
    message: string;
    parsed: ParsedCommand;
    currentJobId?: string | null;
    hasThreadContext: boolean;
    preferredComponentId?: string | null;
    availableComponentIds?: string[];
  }): DiagnosticIntentResolution | null;
}

export interface HelpContentProfile {
  title: string;
  summary: string;
  newCommandDescription: string;
  capabilityOrderMode: HelpCapabilityOrderMode;
  examplePrompts: string[];
  notes: string[];
}

export interface HelpCapabilitySummaryItem {
  title: string;
  description: string;
  command?: string;
}

export interface HelpContentProvider {
  getHelpContent(): HelpContentProfile | null;
}

export interface ProcessingReactionProfile {
  enabled: boolean;
  emoji: string;
}

export interface ProcessingReactionProvider {
  getProcessingReaction(): ProcessingReactionProfile;
}

export interface DiagnosticGateway {
  analyzeTrace(input: { traceId: string; mode: Mode; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>>;
  analyzeUid(input: { uid: string; mode: Mode; timeRange: TimeRange; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>>;
  getJob(jobId: string): Promise<BridgeEnvelope<JobPayload>>;
  followup(input: { conversationId: string; message: string; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>>;
  getConversation(conversationId: string): Promise<BridgeEnvelope<ConversationPayload>>;
}

export interface DiagnosticGatewayProvider {
  listComponents(): DiagnosticComponentProfile[];
  getComponent(componentId: string): DiagnosticComponentProfile | null;
  getGateway(componentId: string): DiagnosticGateway | undefined;
}

export type SmartKitGateway = DiagnosticGateway;
