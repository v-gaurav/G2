/**
 * Gmail Channel for G2
 *
 * Polls for new emails matching a trigger address, delivers them as inbound
 * messages, and sends replies via the Gmail API.
 *
 * Uses a single JID `gmail:inbox` routed to a dedicated "email" registered group.
 * Reply targeting: tracks the most recently delivered email's thread metadata
 * and replies to that thread when sendMessage is called.
 */
import os from 'os';
import path from 'path';

import { logger } from '../../infrastructure/Logger.js';
import { startPollLoop } from '../../infrastructure/poll-loop.js';
import { GmailClient, GmailMessage } from './GmailClient.js';
import type {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../../types.js';

export const GMAIL_JID = 'gmail:inbox';

export interface GmailChannelConfig {
  triggerAddress: string;
  pollIntervalMs: number;
  groupFolder: string;
}

export interface GmailChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  config: GmailChannelConfig;
}

export class GmailChannel implements Channel {
  name = 'gmail';

  private client: GmailClient | null = null;
  private opts: GmailChannelOpts;
  private connected = false;
  private pollHandle: { stop: () => void } | null = null;
  private processedIds = new Set<string>();

  /** Track reply target: the most recently delivered email's thread info */
  private replyTarget: {
    threadId: string;
    from: string;
    subject: string;
    messageId: string;
  } | null = null;

  constructor(opts: GmailChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const configDir = path.join(os.homedir(), '.gmail-mcp');
    this.client = new GmailClient(configDir);
    this.connected = true;

    // Seed processedIds with recent emails to avoid processing old messages on startup
    await this.seedProcessedIds();

    // Start polling
    this.pollHandle = startPollLoop(
      'Gmail',
      this.opts.config.pollIntervalMs,
      () => this.poll(),
    );

    logger.info(
      { triggerAddress: this.opts.config.triggerAddress },
      'Gmail channel connected',
    );
  }

  async sendMessage(_jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Gmail client not initialized');
      return;
    }

    if (!this.replyTarget) {
      logger.warn('No reply target set, cannot send Gmail reply');
      return;
    }

    const { threadId, from, subject, messageId } = this.replyTarget;

    try {
      await this.client.sendReply(threadId, from, subject, text, messageId);
      logger.info({ to: from, subject }, 'Gmail reply sent');
    } catch (err) {
      logger.error({ err, to: from }, 'Failed to send Gmail reply');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('gmail:');
  }

  async disconnect(): Promise<void> {
    if (this.pollHandle) {
      this.pollHandle.stop();
      this.pollHandle = null;
    }
    this.connected = false;
    logger.info('Gmail channel disconnected');
  }

  // --- Private ---

  /**
   * Load recent message IDs so we don't reprocess old emails on startup.
   */
  private async seedProcessedIds(): Promise<void> {
    if (!this.client) return;
    try {
      const query = `to:${this.opts.config.triggerAddress}`;
      const recent = await this.client.search(query, 20);
      for (const msg of recent) {
        this.processedIds.add(msg.id);
      }
      logger.info(
        { count: this.processedIds.size },
        'Gmail: seeded processed IDs from recent emails',
      );
    } catch (err) {
      logger.warn({ err }, 'Gmail: failed to seed processed IDs');
    }
  }

  /**
   * Poll for new emails matching the trigger address.
   */
  private async poll(): Promise<void> {
    if (!this.client) return;

    const query = `to:${this.opts.config.triggerAddress} is:unread`;
    let messages: GmailMessage[];

    try {
      messages = await this.client.search(query, 5);
    } catch (err) {
      logger.error({ err }, 'Gmail poll error');
      return;
    }

    for (const msg of messages) {
      if (this.processedIds.has(msg.id)) continue;
      this.processedIds.add(msg.id);

      const timestamp = new Date(msg.date).toISOString();

      // Set reply target for when agent produces output
      this.replyTarget = {
        threadId: msg.threadId,
        from: msg.from,
        subject: msg.subject,
        messageId: msg.id,
      };

      // Register chat metadata
      this.opts.onChatMetadata(GMAIL_JID, timestamp, 'Gmail Inbox', 'gmail', false);

      // Build message content with email context
      const content = [
        `[Email from ${msg.from}]`,
        `Subject: ${msg.subject}`,
        '',
        msg.body,
      ].join('\n');

      // Deliver as inbound message via the single gmail:inbox JID
      this.opts.onMessage(GMAIL_JID, {
        id: msg.id,
        chat_jid: GMAIL_JID,
        sender: msg.from,
        sender_name: extractName(msg.from),
        content,
        timestamp,
        is_from_me: false,
      });

      // Mark as read
      try {
        await this.client.markAsRead(msg.id);
      } catch (err) {
        logger.warn({ id: msg.id, err }, 'Failed to mark email as read');
      }

      logger.info(
        { from: msg.from, subject: msg.subject, threadId: msg.threadId },
        'Gmail: new email processed',
      );
    }
  }
}

/**
 * Extract display name from an email address like "Name <email@example.com>"
 */
function extractName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split('@')[0];
}
