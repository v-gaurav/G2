import BetterSqlite3 from 'better-sqlite3';

export interface ConversationArchiveRow {
  id: number;
  group_folder: string;
  session_id: string;
  name: string;
  content: string;
  archived_at: string;
}

export class ArchiveRepository {
  constructor(private db: BetterSqlite3.Database) {}

  insertConversationArchive(
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

  getConversationArchives(
    groupFolder: string,
  ): Omit<ConversationArchiveRow, 'content'>[] {
    return this.db
      .prepare(
        'SELECT id, group_folder, session_id, name, archived_at FROM conversation_archives WHERE group_folder = ? ORDER BY archived_at DESC',
      )
      .all(groupFolder) as Omit<ConversationArchiveRow, 'content'>[];
  }

  getConversationArchiveById(id: number): ConversationArchiveRow | undefined {
    return this.db
      .prepare('SELECT * FROM conversation_archives WHERE id = ?')
      .get(id) as ConversationArchiveRow | undefined;
  }

  searchConversationArchives(
    groupFolder: string,
    query: string,
  ): Omit<ConversationArchiveRow, 'content'>[] {
    return this.db
      .prepare(
        `SELECT id, group_folder, session_id, name, archived_at FROM conversation_archives WHERE group_folder = ? AND content LIKE ? ORDER BY archived_at DESC`,
      )
      .all(groupFolder, `%${query}%`) as Omit<ConversationArchiveRow, 'content'>[];
  }

  deleteConversationArchive(id: number): void {
    this.db.prepare('DELETE FROM conversation_archives WHERE id = ?').run(id);
  }
}
