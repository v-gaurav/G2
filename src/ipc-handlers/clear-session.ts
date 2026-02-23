import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from '../config.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

/**
 * Archive the session transcript to the group's conversations/ folder
 * so the agent can search past conversations by content.
 */
function archiveTranscriptToConversations(
  groupFolder: string,
  sessionId: string,
  name: string,
): void {
  // The SDK stores transcripts as JSONL keyed by session ID under the
  // project directory derived from the container cwd (/workspace/group).
  const transcriptPath = path.join(
    DATA_DIR, 'sessions', groupFolder, '.claude',
    'projects', '-workspace-group', `${sessionId}.jsonl`,
  );

  if (!fs.existsSync(transcriptPath)) {
    logger.debug({ groupFolder, sessionId, transcriptPath }, 'No transcript found for conversation archive');
    return;
  }

  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const messages = parseTranscript(content);

    if (messages.length === 0) {
      logger.debug({ groupFolder }, 'No messages to archive');
      return;
    }

    const conversationsDir = path.join(GROUPS_DIR, groupFolder, 'conversations');
    fs.mkdirSync(conversationsDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const safeName = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    const filename = `${date}-${safeName}.md`;
    const filePath = path.join(conversationsDir, filename);

    const markdown = formatTranscriptMarkdown(messages, name);
    fs.writeFileSync(filePath, markdown);

    logger.info({ groupFolder, filePath }, 'Archived conversation transcript');
  } catch (err) {
    logger.warn({ groupFolder, error: err }, 'Failed to archive conversation transcript');
  }
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
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

function formatTranscriptMarkdown(messages: ParsedMessage[], title: string): string {
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

export class ClearSessionHandler implements IpcCommandHandler {
  readonly type = 'clear_session';

  async handle(data: Record<string, any>, sourceGroup: string, _isMain: boolean, deps: IpcDeps): Promise<void> {
    const sessionId = deps.sessionManager.get(sourceGroup);

    // Archive transcript to conversations/ folder before clearing
    if (sessionId && data.name) {
      archiveTranscriptToConversations(sourceGroup, sessionId, data.name);
    }

    deps.sessionManager.archive(sourceGroup, data.name);

    deps.sessionManager.delete(sourceGroup);

    const clearGroups = deps.registeredGroups();
    for (const [jid, g] of Object.entries(clearGroups)) {
      if (g.folder === sourceGroup) {
        deps.closeStdin(jid);
        break;
      }
    }

    logger.info({ sourceGroup }, 'Session cleared via IPC');
  }
}
