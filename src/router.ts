/**
 * Backward-compatible re-exports.
 *
 * The actual logic now lives in:
 *   - MessageFormatter  (src/message-formatter.ts) — format transforms
 *   - MessageRouter     (src/message-router.ts)    — routing decisions
 *
 * Existing callers that import { formatMessages } from './router.js' continue to work.
 */

export { MessageFormatter } from './message-formatter.js';
export { MessageRouter } from './message-router.js';

import { MessageFormatter } from './message-formatter.js';
import type { NewMessage } from './types.js';

export function escapeXml(s: string): string {
  return MessageFormatter.escapeXml(s);
}

export function formatMessages(messages: NewMessage[]): string {
  return MessageFormatter.formatMessages(messages);
}

export function stripInternalTags(text: string): string {
  return MessageFormatter.stripInternalTags(text);
}

export function formatOutbound(rawText: string): string {
  return MessageFormatter.formatOutbound(rawText);
}
