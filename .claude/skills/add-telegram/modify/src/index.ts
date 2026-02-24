import { TelegramChannel } from './channels/telegram.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_ONLY } from './config.js';
import { storeChatMetadata, storeMessage } from './db.js';
import { logger } from './logger.js';
import { Orchestrator } from './orchestrator.js';
import type { NewMessage } from './types.js';

// Singleton orchestrator instance for the process
const orchestrator = new Orchestrator();

// --- Exports for tests and subsystems ---

export { Orchestrator } from './orchestrator.js';

export function getAvailableGroups() {
  return orchestrator.getAvailableGroups();
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, import('./types.js').RegisteredGroup>,
): void {
  orchestrator._setRegisteredGroups(groups);
}

// --- Entry point ---

async function main(): Promise<void> {
  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) =>
      storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => orchestrator.getRegisteredGroups(),
  };

  // Create and add channels
  if (!TELEGRAM_ONLY) {
    const whatsapp = new WhatsAppChannel(channelOpts);
    orchestrator.addChannel(whatsapp);
  }

  if (TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
    orchestrator.addChannel(telegram);
  }

  await orchestrator.start();
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start G2');
    process.exit(1);
  });
}
