import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from '../db.js';
import { SqliteMessageStore } from './sqlite-message-store.js';
import type { NewMessage } from '../types.js';

describe('SqliteMessageStore', () => {
  let store: SqliteMessageStore;

  beforeEach(() => {
    _initTestDatabase();
    store = new SqliteMessageStore();
  });

  /** Helper: ensure the chat row exists so FK constraint is satisfied. */
  function ensureChat(jid: string): void {
    store.storeChatMetadata(jid, '2025-01-01T00:00:00.000Z', jid);
  }

  describe('storeMessage', () => {
    it('stores and retrieves a message', () => {
      ensureChat('group@g.us');
      const msg: NewMessage = {
        id: 'msg-1',
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Alice',
        content: 'Hello world',
        timestamp: '2025-01-01T00:00:01.000Z',
        is_from_me: false,
        is_bot_message: false,
      };

      store.storeMessage(msg);
      const messages = store.getMessagesSince('group@g.us', '2025-01-01T00:00:00.000Z', 'Bot');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello world');
      expect(messages[0].sender_name).toBe('Alice');
    });

    it('does not return bot messages', () => {
      ensureChat('group@g.us');
      store.storeMessage({
        id: 'msg-user',
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Alice',
        content: 'Hello',
        timestamp: '2025-01-01T00:00:01.000Z',
        is_from_me: false,
        is_bot_message: false,
      });
      store.storeMessage({
        id: 'msg-bot',
        chat_jid: 'group@g.us',
        sender: 'bot@s.whatsapp.net',
        sender_name: 'Bot',
        content: 'Bot: response',
        timestamp: '2025-01-01T00:00:02.000Z',
        is_from_me: true,
        is_bot_message: true,
      });

      const messages = store.getMessagesSince('group@g.us', '2025-01-01T00:00:00.000Z', 'Bot');
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-user');
    });
  });

  describe('storeChatMetadata', () => {
    it('stores metadata for a chat', () => {
      store.storeChatMetadata('group@g.us', '2025-01-01T00:00:00.000Z', 'My Group', 'whatsapp', true);
      // No error means success — metadata is stored
    });

    it('updates timestamp on subsequent calls', () => {
      store.storeChatMetadata('group@g.us', '2025-01-01T00:00:00.000Z', 'My Group');
      store.storeChatMetadata('group@g.us', '2025-01-02T00:00:00.000Z', 'My Group Updated');
      // No error means success
    });
  });

  describe('getMessagesSince', () => {
    it('returns messages after the given timestamp', () => {
      ensureChat('group@g.us');
      store.storeMessage({
        id: 'old',
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Alice',
        content: 'Old message',
        timestamp: '2025-01-01T00:00:00.000Z',
      });
      store.storeMessage({
        id: 'new',
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Alice',
        content: 'New message',
        timestamp: '2025-01-02T00:00:00.000Z',
      });

      const messages = store.getMessagesSince(
        'group@g.us',
        '2025-01-01T12:00:00.000Z',
        'Bot',
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('new');
    });

    it('returns empty array when no messages match', () => {
      const messages = store.getMessagesSince(
        'group@g.us',
        '2025-01-01T00:00:00.000Z',
        'Bot',
      );
      expect(messages).toEqual([]);
    });
  });

  describe('getNewMessages', () => {
    it('returns messages across multiple JIDs', () => {
      ensureChat('group-a@g.us');
      ensureChat('group-b@g.us');
      store.storeMessage({
        id: 'msg-a',
        chat_jid: 'group-a@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Alice',
        content: 'Hello A',
        timestamp: '2025-01-01T00:00:01.000Z',
      });
      store.storeMessage({
        id: 'msg-b',
        chat_jid: 'group-b@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Bob',
        content: 'Hello B',
        timestamp: '2025-01-01T00:00:02.000Z',
      });

      const result = store.getNewMessages(
        ['group-a@g.us', 'group-b@g.us'],
        '2025-01-01T00:00:00.000Z',
        'Bot',
      );
      expect(result.messages).toHaveLength(2);
      expect(result.newTimestamp).toBe('2025-01-01T00:00:02.000Z');
    });

    it('returns empty for empty JID list', () => {
      const result = store.getNewMessages([], '2025-01-01T00:00:00.000Z', 'Bot');
      expect(result.messages).toEqual([]);
      expect(result.newTimestamp).toBe('2025-01-01T00:00:00.000Z');
    });

    it('updates newTimestamp to latest message', () => {
      ensureChat('group@g.us');
      store.storeMessage({
        id: 'msg-1',
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Alice',
        content: 'First',
        timestamp: '2025-01-01T00:00:01.000Z',
      });
      store.storeMessage({
        id: 'msg-2',
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Bob',
        content: 'Second',
        timestamp: '2025-01-01T00:00:05.000Z',
      });

      const result = store.getNewMessages(
        ['group@g.us'],
        '2025-01-01T00:00:00.000Z',
        'Bot',
      );
      expect(result.messages).toHaveLength(2);
      expect(result.newTimestamp).toBe('2025-01-01T00:00:05.000Z');
    });

    it('filters out bot-prefixed messages', () => {
      ensureChat('group@g.us');
      store.storeMessage({
        id: 'msg-user',
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'Alice',
        content: 'Hello',
        timestamp: '2025-01-01T00:00:01.000Z',
      });
      store.storeMessage({
        id: 'msg-bot',
        chat_jid: 'group@g.us',
        sender: 'bot@s.whatsapp.net',
        sender_name: 'Bot',
        content: 'Bot: response here',
        timestamp: '2025-01-01T00:00:02.000Z',
      });

      const result = store.getNewMessages(
        ['group@g.us'],
        '2025-01-01T00:00:00.000Z',
        'Bot',
      );
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('msg-user');
    });
  });
});
