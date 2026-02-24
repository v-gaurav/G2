import { SessionRepository } from './repositories/session-repository.js';
import { readAndFormatTranscript } from './ipc-handlers/archive-utils.js';
import type { ArchivedSession } from './types.js';

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
