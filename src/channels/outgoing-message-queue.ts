export interface QueuedMessage {
  jid: string;
  text: string;
}

export class OutgoingMessageQueue {
  private queue: QueuedMessage[] = [];
  private flushing = false;

  enqueue(jid: string, text: string): void {
    this.queue.push({ jid, text });
  }

  get size(): number {
    return this.queue.length;
  }

  async flush(sender: (jid: string, text: string) => Promise<void>): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];        // peek
        await sender(item.jid, item.text);
        this.queue.shift();                // remove only after success
      }
    } finally {
      this.flushing = false;
    }
  }
}
