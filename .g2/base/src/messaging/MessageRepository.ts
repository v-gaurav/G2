import BetterSqlite3 from 'better-sqlite3';

import { NewMessage } from '../types.js';

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

export class MessageRepository {
  constructor(private db: BetterSqlite3.Database) {}

  // ── Message operations ──────────────────────────────────────────────

  storeMessage(msg: NewMessage): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      msg.is_from_me ? 1 : 0,
      msg.is_bot_message ? 1 : 0,
    );
  }

  storeMessageDirect(msg: {
    id: string;
    chat_jid: string;
    sender: string;
    sender_name: string;
    content: string;
    timestamp: string;
    is_from_me: boolean;
    is_bot_message?: boolean;
  }): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      msg.is_from_me ? 1 : 0,
      msg.is_bot_message ? 1 : 0,
    );
  }

  getNewMessages(
    jids: string[],
    lastTimestamp: string,
    botPrefix: string,
  ): { messages: NewMessage[]; newTimestamp: string } {
    if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

    const placeholders = jids.map(() => '?').join(',');
    const sql = `
      SELECT id, chat_jid, sender, sender_name, content, timestamp
      FROM messages
      WHERE timestamp > ? AND chat_jid IN (${placeholders})
        AND is_bot_message = 0 AND content NOT LIKE ?
      ORDER BY timestamp
    `;

    const rows = this.db
      .prepare(sql)
      .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

    let newTimestamp = lastTimestamp;
    for (const row of rows) {
      if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
    }

    return { messages: rows, newTimestamp };
  }

  getMessagesSince(
    chatJid: string,
    sinceTimestamp: string,
    botPrefix: string,
  ): NewMessage[] {
    const sql = `
      SELECT id, chat_jid, sender, sender_name, content, timestamp
      FROM messages
      WHERE chat_jid = ? AND timestamp > ?
        AND is_bot_message = 0 AND content NOT LIKE ?
      ORDER BY timestamp
    `;
    return this.db
      .prepare(sql)
      .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
  }

  // ── Chat metadata operations ────────────────────────────────────────

  storeChatMetadata(
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void {
    const ch = channel ?? null;
    const group = isGroup === undefined ? null : isGroup ? 1 : 0;

    if (name) {
      this.db.prepare(
        `
        INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          name = excluded.name,
          last_message_time = MAX(last_message_time, excluded.last_message_time),
          channel = COALESCE(excluded.channel, channel),
          is_group = COALESCE(excluded.is_group, is_group)
      `,
      ).run(chatJid, name, timestamp, ch, group);
    } else {
      this.db.prepare(
        `
        INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          last_message_time = MAX(last_message_time, excluded.last_message_time),
          channel = COALESCE(excluded.channel, channel),
          is_group = COALESCE(excluded.is_group, is_group)
      `,
      ).run(chatJid, chatJid, timestamp, ch, group);
    }
  }

  updateChatName(chatJid: string, name: string): void {
    this.db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET name = excluded.name
    `,
    ).run(chatJid, name, new Date().toISOString());
  }

  getAllChats(): ChatInfo[] {
    return this.db
      .prepare(
        `SELECT jid, name, last_message_time, channel, is_group FROM chats ORDER BY last_message_time DESC`,
      )
      .all() as ChatInfo[];
  }

  getLastGroupSync(): string | null {
    const row = this.db
      .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
      .get() as { last_message_time: string } | undefined;
    return row?.last_message_time || null;
  }

  setLastGroupSync(): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
    ).run(now);
  }
}

/** @deprecated Use MessageRepository instead */
export { MessageRepository as ChatRepository };
