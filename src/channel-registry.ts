import type { Channel } from './types.js';

export class ChannelRegistry {
  private channels: Channel[] = [];

  register(channel: Channel): void {
    if (this.channels.some(c => c.name === channel.name)) {
      throw new Error(`Channel "${channel.name}" is already registered`);
    }
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

  async syncAllMetadata(force?: boolean): Promise<void> {
    for (const channel of this.channels) {
      if (channel.syncMetadata) {
        await channel.syncMetadata(force);
      }
    }
  }

  async connectAll(): Promise<void> {
    for (const channel of this.channels) {
      await channel.connect();
    }
  }

  async disconnectAll(): Promise<void> {
    for (const channel of this.channels) {
      await channel.disconnect();
    }
  }
}
