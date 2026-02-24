import fs from 'fs';

import { GroupPaths } from '../groups/GroupPaths.js';
import { logger } from '../infrastructure/Logger.js';

import { SessionRepository } from './SessionRepository.js';
import type { ArchivedSession } from '../types.js';

// --- Transcript parsing (moved from ipc-handlers/archive-utils.ts) ---

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

/**
 * Read a session's .jsonl transcript and format it as markdown.
 * Returns the formatted markdown string, or null if no transcript found.
 */
export function readAndFormatTranscript(
  groupFolder: string,
  sessionId: string,
  name: string,
): string | null {
  const transcriptPath = GroupPaths.sessionTranscript(groupFolder, sessionId);

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

// --- SessionManager ---

export class SessionManager {
  private sessions: Record<string, string> = {};

  constructor(
    private sessionRepo: SessionRepository,
  ) {}

  /** Load all sessions from DB into memory cache */
  loadFromDb(): void {
    this.sessions = this.sessionRepo.getAllSessions();
  }

  get(groupFolder: string): string | undefined {
    return this.sessions[groupFolder];
  }

  set(groupFolder: string, sessionId: string): void {
    this.sessions[groupFolder] = sessionId;
    this.sessionRepo.setSession(groupFolder, sessionId);
  }

  delete(groupFolder: string): void {
    delete this.sessions[groupFolder];
    this.sessionRepo.deleteSession(groupFolder);
  }

  getAll(): Record<string, string> {
    return { ...this.sessions };
  }

  // --- Archive lifecycle ---

  archive(groupFolder: string, sessionId: string, name: string, content: string): void {
    this.sessionRepo.insertArchive(groupFolder, sessionId, name, content, new Date().toISOString());
  }

  getArchives(groupFolder: string): Omit<ArchivedSession, 'content'>[] {
    return this.sessionRepo.getArchives(groupFolder);
  }

  getArchiveById(id: number): ArchivedSession | undefined {
    return this.sessionRepo.getArchiveById(id);
  }

  search(groupFolder: string, query: string): Omit<ArchivedSession, 'content'>[] {
    return this.sessionRepo.searchArchives(groupFolder, query);
  }

  deleteArchive(id: number): void {
    this.sessionRepo.deleteArchive(id);
  }

  /**
   * Clear the current session, optionally archiving it first.
   * Returns the archived session's previous sessionId, or undefined if none.
   */
  clear(groupFolder: string, saveName?: string): void {
    const sessionId = this.get(groupFolder);

    if (sessionId && saveName) {
      const content = readAndFormatTranscript(groupFolder, sessionId, saveName);
      this.sessionRepo.insertArchive(groupFolder, sessionId, saveName, content || '', new Date().toISOString());
    }

    this.delete(groupFolder);
  }

  /**
   * Resume a previously archived session.
   * Archives the current session (if saveName provided), restores the target,
   * and removes it from archives. Returns the restored session ID.
   */
  resume(groupFolder: string, archiveId: number, saveName?: string): string {
    const target = this.sessionRepo.getArchiveById(archiveId);
    if (!target) {
      throw new Error(`Conversation archive entry not found: ${archiveId}`);
    }

    // Archive current session if save name provided
    if (saveName) {
      const currentSessionId = this.get(groupFolder);
      if (currentSessionId) {
        const content = readAndFormatTranscript(groupFolder, currentSessionId, saveName);
        this.sessionRepo.insertArchive(groupFolder, currentSessionId, saveName, content || '', new Date().toISOString());
      }
    }

    // Switch to the target session
    this.set(groupFolder, target.session_id);

    // Remove from archives — it's now active, not archived
    this.sessionRepo.deleteArchive(target.id);

    return target.session_id;
  }
}
