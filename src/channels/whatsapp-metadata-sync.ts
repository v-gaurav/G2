import { ChatRepository } from '../repositories/chat-repository.js';
import { logger } from '../logger.js';

export class WhatsAppMetadataSync {
  private timerStarted = false;
  private intervalMs: number;

  constructor(intervalMs: number, private chatRepo: ChatRepository) {
    this.intervalMs = intervalMs;
  }

  /**
   * Sync group metadata.
   * Fetches all participating groups via the provided callback and stores names in the database.
   * Respects a time-based cache unless force=true.
   */
  async sync(
    fetchGroups: () => Promise<Record<string, { subject?: string }>>,
    force = false,
  ): Promise<void> {
    if (!force) {
      const lastSync = this.chatRepo.getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        // Guard against corrupted timestamps — NaN comparison is always false,
        // so a bad value falls through to sync (safe default).
        if (!isNaN(lastSyncTime) && Date.now() - lastSyncTime < this.intervalMs) {
          logger.debug({ lastSync }, 'Skipping group sync - synced recently');
          return;
        }
      }
    }

    try {
      logger.info('Syncing group metadata from WhatsApp...');
      const groups = await fetchGroups();

      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          this.chatRepo.updateChatName(jid, metadata.subject);
          count++;
        }
      }

      this.chatRepo.setLastGroupSync();
      logger.info({ count }, 'Group metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync group metadata');
    }
  }

  /** Start periodic sync. Only starts the timer once (idempotent). */
  startPeriodicSync(
    fetchGroups: () => Promise<Record<string, { subject?: string }>>,
  ): void {
    if (this.timerStarted) return;
    this.timerStarted = true;
    setInterval(() => {
      this.sync(fetchGroups).catch((err) =>
        logger.error({ err }, 'Periodic group sync failed'),
      );
    }, this.intervalMs);
  }
}
