import BetterSqlite3 from 'better-sqlite3';

export class SessionRepository {
  constructor(private db: BetterSqlite3.Database) {}

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
}
