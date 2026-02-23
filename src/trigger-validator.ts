import type { NewMessage, RegisteredGroup } from './types.js';

/**
 * Check if any message in the batch matches the group's trigger pattern.
 * Returns true if:
 * - The group doesn't require a trigger (requiresTrigger === false)
 * - Any message content matches the group's trigger pattern
 */
export function hasTrigger(messages: NewMessage[], group: RegisteredGroup): boolean {
  if (group.requiresTrigger === false) return true;
  const pattern = new RegExp(group.trigger, 'i');
  return messages.some((m) => pattern.test(m.content.trim()));
}
