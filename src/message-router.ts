import type { Channel } from './types.js';
import type { ChannelRegistry } from './channel-registry.js';
import { MessageFormatter } from './message-formatter.js';
import { logger } from './logger.js';

/**
 * Handles routing decisions — which channel gets what message.
 * Wraps ChannelRegistry with higher-level send operations.
 */
export class MessageRouter {
  constructor(private registry: ChannelRegistry) {}

  /** Find the channel that owns a JID (connected or not). */
  findChannel(jid: string): Channel | undefined {
    return this.registry.findByJid(jid);
  }

  /** Find a connected channel that owns a JID. */
  findConnectedChannel(jid: string): Channel | undefined {
    return this.registry.findConnectedByJid(jid);
  }

  /**
   * Format outbound text (strip internal tags) and send via the appropriate channel.
   * No-ops if no connected channel owns the JID or if the text is empty after formatting.
   */
  async sendFormatted(jid: string, rawText: string): Promise<void> {
    const channel = this.registry.findConnectedByJid(jid);
    if (!channel) {
      logger.warn({ jid }, 'No connected channel for JID, cannot send message');
      return;
    }
    const text = MessageFormatter.formatOutbound(rawText);
    if (text) await channel.sendMessage(jid, text);
  }

  /** Send a raw (already-formatted) message via the appropriate channel. */
  async sendRaw(jid: string, text: string): Promise<void> {
    const channel = this.registry.findConnectedByJid(jid);
    if (!channel) {
      throw new Error(`No channel for JID: ${jid}`);
    }
    await channel.sendMessage(jid, text);
  }

  /** Set typing indicator on the appropriate channel. */
  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const channel = this.registry.findByJid(jid);
    if (channel?.setTyping) {
      await channel.setTyping(jid, isTyping);
    }
  }
}
