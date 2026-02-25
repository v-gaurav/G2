import fs from 'fs';
import os from 'os';
import path from 'path';

import { WhatsAppChannel } from './messaging/whatsapp/WhatsAppChannel.js';
import { GmailChannel, GMAIL_JID } from './messaging/gmail/GmailChannel.js';
import { database } from './infrastructure/Database.js';
import { GMAIL_POLL_INTERVAL, GMAIL_TRIGGER_ADDRESS, GMAIL_GROUP_FOLDER } from './infrastructure/Config.js';
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
  const whatsapp = new WhatsAppChannel(channelOpts);
  orchestrator.addChannel(whatsapp);

  // Gmail channel (if credentials exist)
  const gmailConfigDir = path.join(os.homedir(), '.gmail-mcp');
  if (fs.existsSync(path.join(gmailConfigDir, 'credentials.json'))) {
    const gmail = new GmailChannel({
      ...channelOpts,
      config: {
        triggerAddress: GMAIL_TRIGGER_ADDRESS,
        pollIntervalMs: GMAIL_POLL_INTERVAL,
        groupFolder: GMAIL_GROUP_FOLDER,
      },
    });
    orchestrator.addChannel(gmail);
    logger.info({ triggerAddress: GMAIL_TRIGGER_ADDRESS }, 'Gmail channel enabled');
  }

  await orchestrator.start();

  // Auto-register Gmail group if not already registered
  if (fs.existsSync(path.join(os.homedir(), '.gmail-mcp', 'credentials.json'))) {
    const groups = orchestrator.getRegisteredGroups();
    if (!groups[GMAIL_JID]) {
      orchestrator.registerGroup(GMAIL_JID, {
        name: 'Gmail',
        folder: GMAIL_GROUP_FOLDER,
        trigger: '',
        requiresTrigger: false,
        added_at: new Date().toISOString(),
        channel: 'gmail',
      });
      logger.info('Gmail group auto-registered');
    }
  }
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
