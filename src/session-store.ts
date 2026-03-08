import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { SessionRecord } from "./types.js";

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
      .run(messageId, createdAt);
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
             job_id,
             requester_id,
             scope,
             chat_id,
             chat_type,
             anchor_message_id,
             last_message_id,
             thread_id,
             last_question,
             job_status,
             notification_sent_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             job_id = excluded.job_id,
             requester_id = excluded.requester_id,
             scope = excluded.scope,
             chat_id = excluded.chat_id,
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
          record.jobId ?? null,
          record.requesterId,
          record.scope,
          record.chatId,
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

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        job_id TEXT,
        requester_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        chat_id TEXT NOT NULL,
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
    `);
  }

  private toSession(row: Record<string, unknown>): SessionRecord {
    return {
      sessionId: String(row.session_id ?? ""),
      conversationId: String(row.conversation_id ?? ""),
      jobId: row.job_id ? String(row.job_id) : null,
      requesterId: String(row.requester_id ?? ""),
      scope: row.scope === "group" ? "group" : "p2p",
      chatId: String(row.chat_id ?? ""),
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
}
