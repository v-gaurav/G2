/**
 * SqliteMessageStore — wraps the existing db.ts message functions.
 */
import {
  storeMessage,
  storeChatMetadata,
  getMessagesSince,
  getNewMessages,
} from '../db.js';
import type { NewMessage } from '../types.js';
import type { IMessageStore } from './message-store.js';

export class SqliteMessageStore implements IMessageStore {
  storeMessage(msg: NewMessage): void {
    storeMessage(msg);
  }

  storeChatMetadata(
    jid: string,
    time: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void {
    storeChatMetadata(jid, time, name, channel, isGroup);
  }

  getMessagesSince(jid: string, since: string, botName: string): NewMessage[] {
    return getMessagesSince(jid, since, botName);
  }

  getNewMessages(
    jids: string[],
    lastTimestamp: string,
    botPrefix: string,
  ): { messages: NewMessage[]; newTimestamp: string } {
    return getNewMessages(jids, lastTimestamp, botPrefix);
  }
}
