import { describe, it, expect, vi } from 'vitest';

import { ChannelRegistry } from './channel-registry.js';
import type { Channel } from './types.js';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    name: 'test',
    connect: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    ownsJid: vi.fn(() => false),
    disconnect: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('ChannelRegistry', () => {
  describe('register', () => {
    it('adds a channel to the registry', () => {
      const registry = new ChannelRegistry();
      const channel = makeChannel();
      registry.register(channel);
      expect(registry.getAll()).toHaveLength(1);
    });

    it('allows registering multiple channels', () => {
      const registry = new ChannelRegistry();
      registry.register(makeChannel({ name: 'whatsapp' }));
      registry.register(makeChannel({ name: 'telegram' }));
      expect(registry.getAll()).toHaveLength(2);
    });

    it('rejects duplicate channel names', () => {
      const registry = new ChannelRegistry();
      registry.register(makeChannel({ name: 'whatsapp' }));
      expect(() => registry.register(makeChannel({ name: 'whatsapp' }))).toThrow(
        'Channel "whatsapp" is already registered',
      );
      expect(registry.getAll()).toHaveLength(1);
    });
  });

  describe('findByJid', () => {
    it('returns channel that owns the JID', () => {
      const registry = new ChannelRegistry();
      const wa = makeChannel({
        name: 'whatsapp',
        ownsJid: vi.fn((jid: string) => jid.endsWith('@g.us')),
      });
      registry.register(wa);

      expect(registry.findByJid('group@g.us')).toBe(wa);
    });

    it('returns undefined when no channel owns the JID', () => {
      const registry = new ChannelRegistry();
      const wa = makeChannel({
        name: 'whatsapp',
        ownsJid: vi.fn(() => false),
      });
      registry.register(wa);

      expect(registry.findByJid('unknown@x.net')).toBeUndefined();
    });
  });

  describe('findConnectedByJid', () => {
    it('returns connected channel that owns the JID', () => {
      const registry = new ChannelRegistry();
      const wa = makeChannel({
        name: 'whatsapp',
        ownsJid: vi.fn((jid: string) => jid.endsWith('@g.us')),
        isConnected: vi.fn(() => true),
      });
      registry.register(wa);

      expect(registry.findConnectedByJid('group@g.us')).toBe(wa);
    });

    it('returns undefined when channel owns JID but is disconnected', () => {
      const registry = new ChannelRegistry();
      const wa = makeChannel({
        name: 'whatsapp',
        ownsJid: vi.fn((jid: string) => jid.endsWith('@g.us')),
        isConnected: vi.fn(() => false),
      });
      registry.register(wa);

      expect(registry.findConnectedByJid('group@g.us')).toBeUndefined();
    });

    it('skips disconnected channel and finds connected one', () => {
      const registry = new ChannelRegistry();
      const disconnected = makeChannel({
        name: 'wa-old',
        ownsJid: vi.fn((jid: string) => jid.endsWith('@g.us')),
        isConnected: vi.fn(() => false),
      });
      const connected = makeChannel({
        name: 'wa-new',
        ownsJid: vi.fn((jid: string) => jid.endsWith('@g.us')),
        isConnected: vi.fn(() => true),
      });
      registry.register(disconnected);
      registry.register(connected);

      expect(registry.findConnectedByJid('group@g.us')).toBe(connected);
    });
  });

  describe('getAll', () => {
    it('returns a copy of the channels array', () => {
      const registry = new ChannelRegistry();
      const channel = makeChannel();
      registry.register(channel);

      const all = registry.getAll();
      all.push(makeChannel());

      expect(registry.getAll()).toHaveLength(1);
    });

    it('returns empty array when no channels registered', () => {
      const registry = new ChannelRegistry();
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('syncAllMetadata', () => {
    it('calls syncMetadata on channels that implement it', async () => {
      const registry = new ChannelRegistry();
      const withSync = makeChannel({
        name: 'whatsapp',
        syncMetadata: vi.fn(async () => {}),
      });
      const withoutSync = makeChannel({ name: 'telegram' });
      registry.register(withSync);
      registry.register(withoutSync);

      await registry.syncAllMetadata(true);

      expect(withSync.syncMetadata).toHaveBeenCalledWith(true);
    });

    it('does nothing when no channels have syncMetadata', async () => {
      const registry = new ChannelRegistry();
      registry.register(makeChannel({ name: 'basic' }));
      await registry.syncAllMetadata();
      // No error thrown
    });
  });

  describe('disconnectAll', () => {
    it('calls disconnect on all channels', async () => {
      const registry = new ChannelRegistry();
      const ch1 = makeChannel({ name: 'ch1' });
      const ch2 = makeChannel({ name: 'ch2' });
      registry.register(ch1);
      registry.register(ch2);

      await registry.disconnectAll();

      expect(ch1.disconnect).toHaveBeenCalledOnce();
      expect(ch2.disconnect).toHaveBeenCalledOnce();
    });

    it('does nothing when no channels registered', async () => {
      const registry = new ChannelRegistry();
      await registry.disconnectAll();
      // No error thrown
    });
  });
});
