import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ChatMemoryRecord, ChatRole, SessionMessageRecord, SessionRecord } from "./types.js";

function ensureParentDir(dbPath: string): void {
  if (dbPath === ":memory:") {
    return;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export class SessionStore {
  private readonly db: Database.Database;

  constructor(private readonly dbPath: string) {
    ensureParentDir(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  close(): void {
    this.db.close();
  }

  hasProcessedMessage(messageId: string): boolean {
    if (!messageId) {
      return false;
    }
    const row = this.db
      .prepare("SELECT message_id FROM processed_messages WHERE message_id = ?")
      .get(messageId) as { message_id?: string } | undefined;
    return Boolean(row?.message_id);
  }

  markProcessedMessage(messageId: string, createdAt: string): void {
    if (!messageId) {
      return;
    }
    this.db
      .prepare("INSERT OR IGNORE INTO processed_messages (message_id, created_at) VALUES (?, ?)")
      .run(messageId, normalizeRecordedTimestamp(createdAt));
  }

  getSessionByAlias(aliasKey: string): SessionRecord | undefined {
    if (!aliasKey) {
      return undefined;
    }
    const row = this.db
      .prepare(
        `SELECT s.*
         FROM session_aliases a
         JOIN sessions s ON s.session_id = a.session_id
         WHERE a.alias_key = ?`
      )
      .get(aliasKey) as Record<string, unknown> | undefined;
    return row ? this.toSession(row) : undefined;
  }

  upsertSession(session: SessionRecord, aliasKeys: string[]): void {
    const transaction = this.db.transaction((record: SessionRecord, aliases: string[]) => {
      this.db
        .prepare(
           `INSERT INTO sessions (
             session_id,
             conversation_id,
             component_id,
             job_id,
             requester_id,
             requester_name,
             scope,
             chat_id,
             chat_name,
             chat_type,
             anchor_message_id,
             last_message_id,
             thread_id,
             last_question,
             job_status,
             notification_sent_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             component_id = excluded.component_id,
             job_id = excluded.job_id,
             requester_id = excluded.requester_id,
             requester_name = excluded.requester_name,
             scope = excluded.scope,
             chat_id = excluded.chat_id,
             chat_name = excluded.chat_name,
             chat_type = excluded.chat_type,
             anchor_message_id = excluded.anchor_message_id,
             last_message_id = excluded.last_message_id,
             thread_id = excluded.thread_id,
             last_question = excluded.last_question,
             job_status = excluded.job_status,
             notification_sent_at = excluded.notification_sent_at,
             updated_at = excluded.updated_at`
        )
        .run(
          record.sessionId,
          record.conversationId,
          record.componentId ?? null,
          record.jobId ?? null,
          record.requesterId,
          record.requesterName ?? null,
          record.scope,
          record.chatId,
          record.chatName ?? null,
          record.chatType,
          record.anchorMessageId,
          record.lastMessageId,
          record.threadId ?? null,
          record.lastQuestion,
          record.jobStatus ?? null,
          record.notificationSentAt ?? null,
          record.updatedAt
        );
      const aliasStmt = this.db
        .prepare(
          `INSERT INTO session_aliases (alias_key, session_id, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(alias_key) DO UPDATE SET
             session_id = excluded.session_id,
             updated_at = excluded.updated_at`
        );
      for (const alias of new Set(aliases.filter(Boolean))) {
        aliasStmt.run(alias, record.sessionId, record.updatedAt);
      }
    });
    transaction(session, aliasKeys);
  }

  appendSessionMessages(sessionId: string, messages: SessionMessageRecord[]): void {
    if (!sessionId || messages.length === 0) {
      return;
    }
    const insert = this.db.prepare(
      `INSERT INTO session_messages (
         session_id,
         role,
         sender_id,
         sender_name,
         message_id,
         content,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction((records: SessionMessageRecord[]) => {
      for (const message of records) {
        const content = String(message.content ?? "").trim();
        if (!content) {
          continue;
        }
        insert.run(
          sessionId,
          normalizeChatRole(message.role),
          message.senderId ?? null,
          message.senderName ?? null,
          message.messageId ?? null,
          content,
          normalizeRecordedTimestamp(message.createdAt)
        );
      }
    });

    transaction(messages);
  }

  listSessionMessages(sessionId: string, limit = 200): SessionMessageRecord[] {
    if (!sessionId || limit <= 0 || !this.tableExists("session_messages")) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, sender_id, sender_name, message_id, content, created_at
         FROM session_messages
         WHERE session_id = ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(sessionId, limit) as Record<string, unknown>[];
    return rows
      .map((row) => ({
        id: Number(row.id ?? 0),
        sessionId: String(row.session_id ?? ""),
        role: normalizeChatRole(row.role),
        senderId: row.sender_id ? String(row.sender_id) : null,
        senderName: row.sender_name ? String(row.sender_name) : null,
        messageId: row.message_id ? String(row.message_id) : null,
        content: String(row.content ?? ""),
        createdAt: normalizeRecordedTimestamp(row.created_at)
      }))
      .sort((left, right) => compareRecordedTimestamps(left.createdAt, right.createdAt) || left.id - right.id)
      .map(({ id: _id, ...record }) => record);
  }

  listSessionsAwaitingJobResult(limit = 50): SessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM sessions
         WHERE job_id IS NOT NULL
           AND notification_sent_at IS NULL
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.toSession(row));
  }

  markJobNotified(sessionId: string, jobStatus: string, notifiedAt: string): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET job_status = ?,
             notification_sent_at = ?,
             updated_at = ?
         WHERE session_id = ?`
      )
      .run(jobStatus, notifiedAt, notifiedAt, sessionId);
  }

  listChatMemory(userId: string, limit: number): ChatMemoryRecord[] {
    if (!userId || limit <= 0) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT role, content, created_at
         FROM chat_memories
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(userId, limit) as Array<Record<string, unknown>>;
    return rows.reverse().map((row) => ({
      role: normalizeChatRole(row.role),
      content: String(row.content ?? ""),
      createdAt: String(row.created_at ?? "")
    }));
  }

  appendChatMemory(userId: string, messages: ChatMemoryRecord[], maxMessages: number): number {
    if (!userId || messages.length === 0) {
      return this.getChatMemoryCount(userId);
    }
    const transaction = this.db.transaction((ownerId: string, records: ChatMemoryRecord[], limit: number) => {
      const insertStmt = this.db.prepare(
        `INSERT INTO chat_memories (user_id, role, content, created_at)
         VALUES (?, ?, ?, ?)`
      );
      for (const message of records) {
        insertStmt.run(ownerId, message.role, message.content, message.createdAt);
      }
      this.db
        .prepare(
          `DELETE FROM chat_memories
           WHERE user_id = ?
             AND id NOT IN (
               SELECT id FROM chat_memories
               WHERE user_id = ?
               ORDER BY id DESC
               LIMIT ?
             )`
        )
        .run(ownerId, ownerId, limit);
    });
    transaction(userId, messages, Math.max(1, maxMessages));
    return this.getChatMemoryCount(userId);
  }

  clearChatMemory(userId: string): number {
    if (!userId) {
      return 0;
    }
    const result = this.db
      .prepare("DELETE FROM chat_memories WHERE user_id = ?")
      .run(userId);
    return result.changes;
  }

  getChatMemoryCount(userId: string): number {
    if (!userId) {
      return 0;
    }
    const row = this.db
      .prepare("SELECT COUNT(1) AS total FROM chat_memories WHERE user_id = ?")
      .get(userId) as { total?: number } | undefined;
    return Number(row?.total ?? 0);
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        component_id TEXT,
        job_id TEXT,
        requester_id TEXT NOT NULL,
        requester_name TEXT,
        scope TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        chat_name TEXT,
        chat_type TEXT NOT NULL,
        anchor_message_id TEXT NOT NULL,
        last_message_id TEXT NOT NULL,
        thread_id TEXT,
        last_question TEXT NOT NULL,
        job_status TEXT,
        notification_sent_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_aliases (
        alias_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        sender_id TEXT,
        sender_name TEXT,
        message_id TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_memories_user_id_id
      ON chat_memories(user_id, id DESC);

      CREATE INDEX IF NOT EXISTS idx_session_messages_session_id_id
      ON session_messages(session_id, id ASC);
    `);

    this.ensureColumn("sessions", "requester_name", "TEXT");
    this.ensureColumn("sessions", "chat_name", "TEXT");
    this.ensureColumn("sessions", "component_id", "TEXT");
  }

  private toSession(row: Record<string, unknown>): SessionRecord {
    return {
      sessionId: String(row.session_id ?? ""),
      conversationId: String(row.conversation_id ?? ""),
      componentId: row.component_id ? String(row.component_id) : null,
      jobId: row.job_id ? String(row.job_id) : null,
      requesterId: String(row.requester_id ?? ""),
      requesterName: row.requester_name ? String(row.requester_name) : null,
      scope: row.scope === "group" ? "group" : "p2p",
      chatId: String(row.chat_id ?? ""),
      chatName: row.chat_name ? String(row.chat_name) : null,
      chatType: String(row.chat_type ?? ""),
      anchorMessageId: String(row.anchor_message_id ?? ""),
      lastMessageId: String(row.last_message_id ?? ""),
      threadId: row.thread_id ? String(row.thread_id) : null,
      lastQuestion: String(row.last_question ?? ""),
      jobStatus: row.job_status ? String(row.job_status) : null,
      notificationSentAt: row.notification_sent_at ? String(row.notification_sent_at) : null,
      updatedAt: String(row.updated_at ?? "")
    };
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private tableExists(tableName: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as { name?: string } | undefined;
    return Boolean(row?.name);
  }
}

function normalizeChatRole(value: unknown): ChatRole {
  return value === "assistant" || value === "system" ? value : "user";
}

function normalizeRecordedTimestamp(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return new Date().toISOString();
  }
  if (/^\d{10,13}$/.test(raw)) {
    const millis = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    if (Number.isFinite(millis)) {
      return new Date(millis).toISOString();
    }
  }
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return raw;
}

function compareRecordedTimestamps(left: string, right: string): number {
  return toTimestampNumber(left) - toTimestampNumber(right);
}

function toTimestampNumber(value: string): number {
  const raw = String(value ?? "").trim();
  if (/^\d{10,13}$/.test(raw)) {
    return raw.length === 10 ? Number(raw) * 1000 : Number(raw);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
