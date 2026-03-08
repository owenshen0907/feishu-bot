export type Mode = "sync" | "async";
export type Scope = "p2p" | "group";
export type TargetType = "trace" | "uid";
export type TimeRange = "15m" | "1h" | "6h" | "1d";
export type CommandAction = "help" | "trace" | "uid" | "job" | "followup";

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

export interface SessionRecord {
  sessionId: string;
  conversationId: string;
  jobId?: string | null;
  requesterId: string;
  scope: Scope;
  chatId: string;
  chatType: string;
  anchorMessageId: string;
  lastMessageId: string;
  threadId?: string | null;
  lastQuestion: string;
  jobStatus?: string | null;
  notificationSentAt?: string | null;
  updatedAt: string;
}

export interface BotMessenger {
  replyText(messageId: string, text: string, options?: ReplyOptions): Promise<SentMessage>;
}

export interface SmartKitGateway {
  analyzeTrace(input: { traceId: string; mode: Mode; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>>;
  analyzeUid(input: { uid: string; mode: Mode; timeRange: TimeRange; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>>;
  getJob(jobId: string): Promise<BridgeEnvelope<JobPayload>>;
  followup(input: { conversationId: string; message: string; requesterId: string; scope: Scope }): Promise<BridgeEnvelope<DiagnosisPayload | AcceptedPayload>>;
  getConversation(conversationId: string): Promise<BridgeEnvelope<ConversationPayload>>;
}
