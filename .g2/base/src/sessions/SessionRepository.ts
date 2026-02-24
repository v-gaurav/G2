import BetterSqlite3 from 'better-sqlite3';
import type { ArchivedSession } from '../types.js';

export class SessionRepository {
  constructor(private db: BetterSqlite3.Database) {}

  // --- Active sessions (sessions table) ---

  getSession(groupFolder: string): string | undefined {
    const row = this.db
      .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
      .get(groupFolder) as { session_id: string } | undefined;
    return row?.session_id;
  }

  setSession(groupFolder: string, sessionId: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
    ).run(groupFolder, sessionId);
  }

  deleteSession(groupFolder: string): void {
    this.db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
  }

  getAllSessions(): Record<string, string> {
    const rows = this.db
      .prepare('SELECT group_folder, session_id FROM sessions')
      .all() as Array<{ group_folder: string; session_id: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.group_folder] = row.session_id;
    }
    return result;
  }

  // --- Archives (conversation_archives table) ---

  insertArchive(
    groupFolder: string,
    sessionId: string,
    name: string,
    content: string,
    archivedAt: string,
  ): void {
    this.db.prepare(
      `INSERT INTO conversation_archives (group_folder, session_id, name, content, archived_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(groupFolder, sessionId, name, content, archivedAt);
  }

  getArchives(
    groupFolder: string,
  ): Omit<ArchivedSession, 'content'>[] {
    return this.db
      .prepare(
        'SELECT id, group_folder, session_id, name, archived_at FROM conversation_archives WHERE group_folder = ? ORDER BY archived_at DESC',
      )
      .all(groupFolder) as Omit<ArchivedSession, 'content'>[];
  }

  getArchiveById(id: number): ArchivedSession | undefined {
    return this.db
      .prepare('SELECT * FROM conversation_archives WHERE id = ?')
      .get(id) as ArchivedSession | undefined;
  }

  searchArchives(
    groupFolder: string,
    query: string,
  ): Omit<ArchivedSession, 'content'>[] {
    return this.db
      .prepare(
        `SELECT id, group_folder, session_id, name, archived_at FROM conversation_archives WHERE group_folder = ? AND content LIKE ? ORDER BY archived_at DESC`,
      )
      .all(groupFolder, `%${query}%`) as Omit<ArchivedSession, 'content'>[];
  }

  deleteArchive(id: number): void {
    this.db.prepare('DELETE FROM conversation_archives WHERE id = ?').run(id);
  }
}
