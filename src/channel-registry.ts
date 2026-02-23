import type { Channel } from './types.js';

export class ChannelRegistry {
  private channels: Channel[] = [];

  register(channel: Channel): void {
    this.channels.push(channel);
  }

  findByJid(jid: string): Channel | undefined {
    return this.channels.find(c => c.ownsJid(jid));
  }

  findConnectedByJid(jid: string): Channel | undefined {
    return this.channels.find(c => c.ownsJid(jid) && c.isConnected());
  }

  getAll(): Channel[] {
    return [...this.channels];
  }

  async disconnectAll(): Promise<void> {
    for (const channel of this.channels) {
      await channel.disconnect();
    }
  }
}
