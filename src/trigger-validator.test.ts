import { describe, it, expect } from 'vitest';

import { hasTrigger } from './trigger-validator.js';
import { NewMessage, RegisteredGroup } from './types.js';

function makeMsg(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    id: '1',
    chat_jid: 'group@g.us',
    sender: '123@s.whatsapp.net',
    sender_name: 'Alice',
    content: 'hello',
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<RegisteredGroup> = {}): RegisteredGroup {
  return {
    name: 'Test Group',
    folder: 'test-group',
    trigger: '^@G2\\b',
    added_at: '2024-01-01T00:00:00.000Z',
    channel: 'whatsapp',
    ...overrides,
  };
}

describe('TriggerValidator', () => {
  describe('hasTrigger', () => {
    it('returns true when trigger required and message matches', () => {
      const messages = [makeMsg({ content: '@G2 do something' })];
      const group = makeGroup({ requiresTrigger: true });
      expect(hasTrigger(messages, group)).toBe(true);
    });

    it('returns false when trigger required and no message matches', () => {
      const messages = [makeMsg({ content: 'hello world' })];
      const group = makeGroup({ requiresTrigger: true });
      expect(hasTrigger(messages, group)).toBe(false);
    });

    it('returns true when requiresTrigger is false (no trigger needed)', () => {
      const messages = [makeMsg({ content: 'hello no trigger' })];
      const group = makeGroup({ requiresTrigger: false });
      expect(hasTrigger(messages, group)).toBe(true);
    });

    it('returns false for empty messages array when trigger required', () => {
      const group = makeGroup({ requiresTrigger: true });
      expect(hasTrigger([], group)).toBe(false);
    });

    it('matches trigger case-insensitively', () => {
      const group = makeGroup({ requiresTrigger: true });

      expect(hasTrigger([makeMsg({ content: '@g2 hello' })], group)).toBe(true);
      expect(hasTrigger([makeMsg({ content: '@G2 hello' })], group)).toBe(true);
      expect(hasTrigger([makeMsg({ content: '@G2 hello' })], group)).toBe(true);
    });

    it('returns true when only one of multiple messages matches', () => {
      const messages = [
        makeMsg({ id: '1', content: 'hello' }),
        makeMsg({ id: '2', content: '@G2 help me' }),
        makeMsg({ id: '3', content: 'goodbye' }),
      ];
      const group = makeGroup({ requiresTrigger: true });
      expect(hasTrigger(messages, group)).toBe(true);
    });

    it('requires trigger when requiresTrigger is undefined (defaults to true)', () => {
      const messages = [makeMsg({ content: 'hello no trigger' })];
      const group = makeGroup(); // requiresTrigger defaults to undefined
      expect(hasTrigger(messages, group)).toBe(false);
    });

    it('trims message content before matching', () => {
      const messages = [makeMsg({ content: '  @G2 hello  ' })];
      const group = makeGroup({ requiresTrigger: true });
      expect(hasTrigger(messages, group)).toBe(true);
    });

    it('uses group.trigger as the regex pattern', () => {
      const group = makeGroup({ trigger: 'help me', requiresTrigger: true });
      const matching = [makeMsg({ content: 'help me please' })];
      const nonMatching = [makeMsg({ content: 'hello world' })];
      expect(hasTrigger(matching, group)).toBe(true);
      expect(hasTrigger(nonMatching, group)).toBe(false);
    });
  });
});
