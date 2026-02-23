import {
  deleteSession,
  getAllSessions,
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
}
