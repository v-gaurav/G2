import {
  archiveSession,
  deleteSession,
  getAllSessions,
  getSessionHistory,
  restoreSession,
  setSession,
} from './db.js';

export class SessionManager {
  private sessions: Record<string, string> = {};

  /** Load all sessions from DB into memory cache */
  loadFromDb(): void {
    this.sessions = getAllSessions();
  }

  get(groupFolder: string): string | undefined {
    return this.sessions[groupFolder];
  }

  set(groupFolder: string, sessionId: string): void {
    this.sessions[groupFolder] = sessionId;
    setSession(groupFolder, sessionId);
  }

  delete(groupFolder: string): void {
    delete this.sessions[groupFolder];
    deleteSession(groupFolder);
  }

  getAll(): Record<string, string> {
    return { ...this.sessions };
  }

  archive(groupFolder: string, saveName?: string): void {
    const sessionId = this.sessions[groupFolder];
    if (sessionId && saveName) {
      archiveSession(groupFolder, sessionId, saveName, new Date().toISOString());
    }
  }

  restore(groupFolder: string, historyId: number): { sessionId: string } | null {
    const restored = restoreSession(historyId);
    if (restored) {
      this.sessions[groupFolder] = restored.session_id;
      setSession(groupFolder, restored.session_id);
      return { sessionId: restored.session_id };
    }
    return null;
  }

  getHistory(groupFolder: string) {
    return getSessionHistory(groupFolder);
  }
}
