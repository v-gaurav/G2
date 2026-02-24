import { describe, it, expect, vi } from 'vitest';

vi.mock('./env.js', () => ({
  readEnvFile: () => ({}),
}));

import { TimeoutConfig } from './config.js';
import type { RegisteredGroup } from './types.js';

const baseGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@G2',
  added_at: '2024-01-01T00:00:00.000Z',
  channel: 'whatsapp',
};

describe('TimeoutConfig', () => {
  describe('constructor', () => {
    it('uses config defaults when no arguments provided', () => {
      const config = new TimeoutConfig();
      expect(config.containerTimeout).toBe(1800000);
      expect(config.idleTimeout).toBe(1800000);
    });

    it('accepts custom values', () => {
      const config = new TimeoutConfig(60000, 30000);
      expect(config.containerTimeout).toBe(60000);
      expect(config.idleTimeout).toBe(30000);
    });
  });

  describe('getHardTimeout', () => {
    it('returns containerTimeout when it exceeds idleTimeout + 30s', () => {
      const config = new TimeoutConfig(1800000, 1800000);
      // idleTimeout + 30s = 1830000, containerTimeout = 1800000
      // max(1800000, 1830000) = 1830000
      expect(config.getHardTimeout()).toBe(1830000);
    });

    it('returns idleTimeout + 30s when it exceeds containerTimeout', () => {
      const config = new TimeoutConfig(60000, 120000);
      // max(60000, 150000) = 150000
      expect(config.getHardTimeout()).toBe(150000);
    });

    it('returns containerTimeout when both are equal after adding grace', () => {
      const config = new TimeoutConfig(150000, 120000);
      // max(150000, 150000) = 150000
      expect(config.getHardTimeout()).toBe(150000);
    });
  });

  describe('forGroup', () => {
    it('uses group custom timeout when set', () => {
      const config = new TimeoutConfig(1800000, 1800000);
      const group: RegisteredGroup = {
        ...baseGroup,
        containerConfig: { timeout: 300000 },
      };
      const groupConfig = config.forGroup(group);
      expect(groupConfig.containerTimeout).toBe(300000);
      expect(groupConfig.idleTimeout).toBe(1800000);
    });

    it('falls back to default containerTimeout when group has no custom timeout', () => {
      const config = new TimeoutConfig(1800000, 1800000);
      const groupConfig = config.forGroup(baseGroup);
      expect(groupConfig.containerTimeout).toBe(1800000);
      expect(groupConfig.idleTimeout).toBe(1800000);
    });

    it('falls back when containerConfig exists but timeout is undefined', () => {
      const config = new TimeoutConfig(1800000, 1800000);
      const group: RegisteredGroup = {
        ...baseGroup,
        containerConfig: {},
      };
      const groupConfig = config.forGroup(group);
      expect(groupConfig.containerTimeout).toBe(1800000);
    });

    it('getHardTimeout works on group-derived config', () => {
      const config = new TimeoutConfig(1800000, 1800000);
      const group: RegisteredGroup = {
        ...baseGroup,
        containerConfig: { timeout: 60000 },
      };
      const groupConfig = config.forGroup(group);
      // containerTimeout = 60000, idleTimeout = 1800000
      // max(60000, 1830000) = 1830000
      expect(groupConfig.getHardTimeout()).toBe(1830000);
    });
  });
});
