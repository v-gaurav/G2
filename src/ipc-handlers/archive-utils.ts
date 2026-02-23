import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { logger } from '../logger.js';

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

export function formatTranscriptMarkdown(messages: ParsedMessage[], title: string): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : 'G2';
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Read a session's .jsonl transcript and format it as markdown.
 * Returns the formatted markdown string, or null if no transcript found.
 */
export function readAndFormatTranscript(
  groupFolder: string,
  sessionId: string,
  name: string,
): string | null {
  const transcriptPath = path.join(
    DATA_DIR, 'sessions', groupFolder, '.claude',
    'projects', '-workspace-group', `${sessionId}.jsonl`,
  );

  if (!fs.existsSync(transcriptPath)) {
    logger.debug({ groupFolder, sessionId, transcriptPath }, 'No transcript found for conversation archive');
    return null;
  }

  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const messages = parseTranscript(content);

    if (messages.length === 0) {
      logger.debug({ groupFolder }, 'No messages to archive');
      return null;
    }

    return formatTranscriptMarkdown(messages, name);
  } catch (err) {
    logger.warn({ groupFolder, error: err }, 'Failed to read/format conversation transcript');
    return null;
  }
}
