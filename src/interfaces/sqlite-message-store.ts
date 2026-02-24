/**
 * SqliteMessageStore — wraps repository instances for the IMessageStore interface.
 */
import { ChatRepository } from '../repositories/chat-repository.js';
import { MessageRepository } from '../repositories/message-repository.js';
import type { NewMessage } from '../types.js';
import type { IMessageStore } from './message-store.js';

export class SqliteMessageStore implements IMessageStore {
  constructor(
    private messageRepo: MessageRepository,
    private chatRepo: ChatRepository,
  ) {}

  storeMessage(msg: NewMessage): void {
    this.messageRepo.storeMessage(msg);
  }

  storeChatMetadata(
    jid: string,
    time: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void {
    this.chatRepo.storeChatMetadata(jid, time, name, channel, isGroup);
  }

  getMessagesSince(jid: string, since: string, botName: string): NewMessage[] {
    return this.messageRepo.getMessagesSince(jid, since, botName);
  }

  getNewMessages(
    jids: string[],
    lastTimestamp: string,
    botPrefix: string,
  ): { messages: NewMessage[]; newTimestamp: string } {
    return this.messageRepo.getNewMessages(jids, lastTimestamp, botPrefix);
  }
}
