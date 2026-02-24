import { describe, it, expect, vi } from 'vitest';

import { OutgoingMessageQueue } from './OutgoingMessageQueue.js';

describe('OutgoingMessageQueue', () => {
  describe('enqueue', () => {
    it('adds messages to the queue', () => {
      const queue = new OutgoingMessageQueue();
      queue.enqueue('jid1', 'Hello');
      queue.enqueue('jid2', 'World');
      expect(queue.size).toBe(2);
    });
  });

  describe('size', () => {
    it('returns 0 for empty queue', () => {
      const queue = new OutgoingMessageQueue();
      expect(queue.size).toBe(0);
    });

    it('tracks queue length', () => {
      const queue = new OutgoingMessageQueue();
      queue.enqueue('jid', 'msg');
      expect(queue.size).toBe(1);
      queue.enqueue('jid', 'msg2');
      expect(queue.size).toBe(2);
    });
  });

  describe('flush', () => {
    it('sends all queued messages in order', async () => {
      const queue = new OutgoingMessageQueue();
      queue.enqueue('jid1', 'First');
      queue.enqueue('jid2', 'Second');
      queue.enqueue('jid3', 'Third');

      const sent: Array<{ jid: string; text: string }> = [];
      await queue.flush(async (jid, text) => {
        sent.push({ jid, text });
      });

      expect(sent).toEqual([
        { jid: 'jid1', text: 'First' },
        { jid: 'jid2', text: 'Second' },
        { jid: 'jid3', text: 'Third' },
      ]);
      expect(queue.size).toBe(0);
    });

    it('does nothing when queue is empty', async () => {
      const queue = new OutgoingMessageQueue();
      const sender = vi.fn();
      await queue.flush(sender);
      expect(sender).not.toHaveBeenCalled();
    });

    it('prevents concurrent flushes', async () => {
      const queue = new OutgoingMessageQueue();
      queue.enqueue('jid1', 'msg1');
      queue.enqueue('jid2', 'msg2');

      let resolveFirst: () => void;
      const firstSendPromise = new Promise<void>((r) => { resolveFirst = r; });

      const sent: string[] = [];
      const sender = vi.fn(async (_jid: string, text: string) => {
        if (text === 'msg1') {
          await firstSendPromise;
        }
        sent.push(text);
      });

      // Start first flush
      const flush1 = queue.flush(sender);

      // Try second flush while first is in progress — should be a no-op
      const flush2 = queue.flush(sender);

      // Resolve the first send
      resolveFirst!();

      await flush1;
      await flush2;

      // Only 2 calls from the first flush, none from the second
      expect(sender).toHaveBeenCalledTimes(2);
      expect(sent).toEqual(['msg1', 'msg2']);
    });

    it('resets flushing flag on sender error and retains failed message', async () => {
      const queue = new OutgoingMessageQueue();
      queue.enqueue('jid1', 'will-fail');
      queue.enqueue('jid2', 'never-sent');

      const sender = vi.fn().mockRejectedValueOnce(new Error('send failed'));

      await expect(queue.flush(sender)).rejects.toThrow('send failed');

      // Flushing flag should be reset, allowing future flushes.
      // The failed message (will-fail) stays in the queue along with never-sent.
      queue.enqueue('jid3', 'retry');
      const sent: string[] = [];
      await queue.flush(async (_jid, text) => { sent.push(text); });

      expect(sent).toEqual(['will-fail', 'never-sent', 'retry']);
    });

    it('allows flush after a successful flush', async () => {
      const queue = new OutgoingMessageQueue();
      queue.enqueue('jid1', 'batch1');

      const sent: string[] = [];
      await queue.flush(async (_jid, text) => { sent.push(text); });

      queue.enqueue('jid2', 'batch2');
      await queue.flush(async (_jid, text) => { sent.push(text); });

      expect(sent).toEqual(['batch1', 'batch2']);
    });
  });
});
