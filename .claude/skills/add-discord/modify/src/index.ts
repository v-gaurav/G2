import { DiscordChannel } from './messaging/discord/DiscordChannel.js';
import { WhatsAppChannel } from './messaging/whatsapp/WhatsAppChannel.js';
import { DISCORD_BOT_TOKEN, DISCORD_ONLY } from './infrastructure/Config.js';
import { database } from './infrastructure/Database.js';
import { logger } from './infrastructure/Logger.js';
import { Orchestrator } from './app.js';
import type { NewMessage } from './types.js';

// Singleton orchestrator instance for the process
const orchestrator = new Orchestrator();

// --- Exports for tests and subsystems ---

export { Orchestrator } from './app.js';

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
    onMessage: (_chatJid: string, msg: NewMessage) => database.messageRepo.storeMessage(msg),
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) =>
      database.chatRepo.storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => orchestrator.getRegisteredGroups(),
  };

  // Create and add channels
  if (!DISCORD_ONLY) {
    const whatsapp = new WhatsAppChannel(channelOpts);
    orchestrator.addChannel(whatsapp);
  }

  if (DISCORD_BOT_TOKEN) {
    const discord = new DiscordChannel(DISCORD_BOT_TOKEN, channelOpts);
    orchestrator.addChannel(discord);
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
