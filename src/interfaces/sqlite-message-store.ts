/**
 * SqliteMessageStore — wraps the AppDatabase singleton for the IMessageStore interface.
 */
import { database } from '../db.js';
import type { NewMessage } from '../types.js';
import type { IMessageStore } from './message-store.js';

export class SqliteMessageStore implements IMessageStore {
  storeMessage(msg: NewMessage): void {
    database.storeMessage(msg);
  }

  storeChatMetadata(
    jid: string,
    time: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void {
    database.storeChatMetadata(jid, time, name, channel, isGroup);
  }

  getMessagesSince(jid: string, since: string, botName: string): NewMessage[] {
    return database.getMessagesSince(jid, since, botName);
  }

  getNewMessages(
    jids: string[],
    lastTimestamp: string,
    botPrefix: string,
  ): { messages: NewMessage[]; newTimestamp: string } {
    return database.getNewMessages(jids, lastTimestamp, botPrefix);
  }
}
