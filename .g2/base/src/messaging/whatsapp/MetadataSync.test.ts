import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
const mockLogger = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../infrastructure/Logger.js', () => mockLogger);

import { WhatsAppMetadataSync } from './MetadataSync.js';
import type { ChatRepository } from '../MessageRepository.js';
import { logger } from '../../infrastructure/Logger.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function createMockChatRepo() {
  return {
    getLastGroupSync: vi.fn(() => null as string | null),
    setLastGroupSync: vi.fn(),
    updateChatName: vi.fn(),
  } as unknown as ChatRepository;
}

let mockChatRepo: ReturnType<typeof createMockChatRepo>;

beforeEach(() => {
  vi.clearAllMocks();
  mockChatRepo = createMockChatRepo();
});

describe('WhatsAppMetadataSync', () => {
  describe('sync', () => {
    it('fetches groups and updates names in the database', async () => {
      const sync = new WhatsAppMetadataSync(INTERVAL_MS, mockChatRepo);
      const fetchGroups = vi.fn().mockResolvedValue({
        'group1@g.us': { subject: 'Group One' },
        'group2@g.us': { subject: 'Group Two' },
      });

      await sync.sync(fetchGroups);

      expect(fetchGroups).toHaveBeenCalled();
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group1@g.us', 'Group One');
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group2@g.us', 'Group Two');
      expect(mockChatRepo.setLastGroupSync).toHaveBeenCalled();
    });

    it('skips sync when synced recently', async () => {
      vi.mocked(mockChatRepo.getLastGroupSync).mockReturnValue(
        new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      );

      const sync = new WhatsAppMetadataSync(INTERVAL_MS, mockChatRepo);
      const fetchGroups = vi.fn();

      await sync.sync(fetchGroups);

      expect(fetchGroups).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ lastSync: expect.any(String) }),
        'Skipping group sync - synced recently',
      );
    });

    it('forces sync regardless of cache', async () => {
      vi.mocked(mockChatRepo.getLastGroupSync).mockReturnValue(
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      );

      const sync = new WhatsAppMetadataSync(INTERVAL_MS, mockChatRepo);
      const fetchGroups = vi.fn().mockResolvedValue({
        'group@g.us': { subject: 'Forced' },
      });

      await sync.sync(fetchGroups, true);

      expect(fetchGroups).toHaveBeenCalled();
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group@g.us', 'Forced');
    });

    it('handles fetch failure gracefully', async () => {
      const sync = new WhatsAppMetadataSync(INTERVAL_MS, mockChatRepo);
      const fetchGroups = vi.fn().mockRejectedValue(new Error('Network timeout'));

      // Should not throw
      await expect(sync.sync(fetchGroups)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to sync group metadata',
      );
    });

    it('skips groups with no subject', async () => {
      const sync = new WhatsAppMetadataSync(INTERVAL_MS, mockChatRepo);
      const fetchGroups = vi.fn().mockResolvedValue({
        'group1@g.us': { subject: 'Has Subject' },
        'group2@g.us': { subject: '' },
        'group3@g.us': {},
      });

      await sync.sync(fetchGroups, true);

      expect(mockChatRepo.updateChatName).toHaveBeenCalledTimes(1);
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group1@g.us', 'Has Subject');
    });

    it('syncs when lastSync is null (first run)', async () => {
      vi.mocked(mockChatRepo.getLastGroupSync).mockReturnValue(null);

      const sync = new WhatsAppMetadataSync(INTERVAL_MS, mockChatRepo);
      const fetchGroups = vi.fn().mockResolvedValue({});

      await sync.sync(fetchGroups);

      expect(fetchGroups).toHaveBeenCalled();
    });

    it('syncs when lastSync is older than interval', async () => {
      vi.mocked(mockChatRepo.getLastGroupSync).mockReturnValue(
        new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
      );

      const sync = new WhatsAppMetadataSync(INTERVAL_MS, mockChatRepo);
      const fetchGroups = vi.fn().mockResolvedValue({});

      await sync.sync(fetchGroups);

      expect(fetchGroups).toHaveBeenCalled();
    });
  });

  describe('startPeriodicSync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts periodic timer', async () => {
      const sync = new WhatsAppMetadataSync(1000, mockChatRepo);
      const fetchGroups = vi.fn().mockResolvedValue({});

      sync.startPeriodicSync(fetchGroups);

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(fetchGroups).toHaveBeenCalledTimes(1);

      // Advance past another interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(fetchGroups).toHaveBeenCalledTimes(2);
    });

    it('only starts timer once (idempotent)', async () => {
      const sync = new WhatsAppMetadataSync(1000, mockChatRepo);
      const fetchGroups1 = vi.fn().mockResolvedValue({});
      const fetchGroups2 = vi.fn().mockResolvedValue({});

      sync.startPeriodicSync(fetchGroups1);
      sync.startPeriodicSync(fetchGroups2); // Second call should be ignored

      await vi.advanceTimersByTimeAsync(1000);

      expect(fetchGroups1).toHaveBeenCalledTimes(1);
      expect(fetchGroups2).not.toHaveBeenCalled();
    });
  });
});
