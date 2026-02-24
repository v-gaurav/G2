import BetterSqlite3 from 'better-sqlite3';

import { NewMessage } from '../types.js';

export class MessageRepository {
  constructor(private db: BetterSqlite3.Database) {}

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
}
