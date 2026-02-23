/**
 * IMessageStore — abstraction over message persistence.
 * Decouples message storage from the SQLite implementation in db.ts.
 */
import type { NewMessage } from '../types.js';

export interface IMessageStore {
  /** Store a message with full content. */
  storeMessage(msg: NewMessage): void;

  /** Store chat metadata (no message content). */
  storeChatMetadata(
    jid: string,
    time: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void;

  /** Get messages for a chat since a given timestamp, excluding bot messages. */
  getMessagesSince(jid: string, since: string, botName: string): NewMessage[];

  /** Get new messages across multiple JIDs since a timestamp, excluding bot messages. */
  getNewMessages(
    jids: string[],
    lastTimestamp: string,
    botPrefix: string,
  ): { messages: NewMessage[]; newTimestamp: string };
}
