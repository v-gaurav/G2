import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, STORE_DIR } from './config.js';
import { safeParse } from './safe-parse.js';
import { NewMessage, RegisteredGroup, ScheduledTask, TaskRunLog } from './types.js';

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

export interface ConversationArchiveRow {
  id: number;
  group_folder: string;
  session_id: string;
  name: string;
  content: string;
  archived_at: string;
}

/**
 * AppDatabase — wraps the SQLite instance and exposes all data operations
 * as methods. Encapsulates schema creation, migrations, and the db handle.
 */
export class AppDatabase {
  private db!: BetterSqlite3.Database;

  /** Open (or create) the database file at the standard location. */
  init(): void {
    const dbPath = path.join(STORE_DIR, 'messages.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new BetterSqlite3(dbPath);
    this.createSchema();
    this.migrateJsonState();
  }

  /** @internal — for tests only. Creates a fresh in-memory database. */
  _initTest(): void {
    this.db = new BetterSqlite3(':memory:');
    this.createSchema();
  }

  // ---------------------------------------------------------------------------
  // Chat metadata
  // ---------------------------------------------------------------------------

  storeChatMetadata(
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void {
    const ch = channel ?? null;
    const group = isGroup === undefined ? null : isGroup ? 1 : 0;

    if (name) {
      this.db.prepare(
        `
        INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          name = excluded.name,
          last_message_time = MAX(last_message_time, excluded.last_message_time),
          channel = COALESCE(excluded.channel, channel),
          is_group = COALESCE(excluded.is_group, is_group)
      `,
      ).run(chatJid, name, timestamp, ch, group);
    } else {
      this.db.prepare(
        `
        INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          last_message_time = MAX(last_message_time, excluded.last_message_time),
          channel = COALESCE(excluded.channel, channel),
          is_group = COALESCE(excluded.is_group, is_group)
      `,
      ).run(chatJid, chatJid, timestamp, ch, group);
    }
  }

  updateChatName(chatJid: string, name: string): void {
    this.db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET name = excluded.name
    `,
    ).run(chatJid, name, new Date().toISOString());
  }

  getAllChats(): ChatInfo[] {
    return this.db
      .prepare(
        `SELECT jid, name, last_message_time, channel, is_group FROM chats ORDER BY last_message_time DESC`,
      )
      .all() as ChatInfo[];
  }

  getLastGroupSync(): string | null {
    const row = this.db
      .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
      .get() as { last_message_time: string } | undefined;
    return row?.last_message_time || null;
  }

  setLastGroupSync(): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
    ).run(now);
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  storeMessage(msg: NewMessage): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      msg.is_from_me ? 1 : 0,
      msg.is_bot_message ? 1 : 0,
    );
  }

  storeMessageDirect(msg: {
    id: string;
    chat_jid: string;
    sender: string;
    sender_name: string;
    content: string;
    timestamp: string;
    is_from_me: boolean;
    is_bot_message?: boolean;
  }): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      msg.is_from_me ? 1 : 0,
      msg.is_bot_message ? 1 : 0,
    );
  }

  getNewMessages(
    jids: string[],
    lastTimestamp: string,
    botPrefix: string,
  ): { messages: NewMessage[]; newTimestamp: string } {
    if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

    const placeholders = jids.map(() => '?').join(',');
    const sql = `
      SELECT id, chat_jid, sender, sender_name, content, timestamp
      FROM messages
      WHERE timestamp > ? AND chat_jid IN (${placeholders})
        AND is_bot_message = 0 AND content NOT LIKE ?
      ORDER BY timestamp
    `;

    const rows = this.db
      .prepare(sql)
      .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

    let newTimestamp = lastTimestamp;
    for (const row of rows) {
      if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
    }

    return { messages: rows, newTimestamp };
  }

  getMessagesSince(
    chatJid: string,
    sinceTimestamp: string,
    botPrefix: string,
  ): NewMessage[] {
    const sql = `
      SELECT id, chat_jid, sender, sender_name, content, timestamp
      FROM messages
      WHERE chat_jid = ? AND timestamp > ?
        AND is_bot_message = 0 AND content NOT LIKE ?
      ORDER BY timestamp
    `;
    return this.db
      .prepare(sql)
      .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
  }

  // ---------------------------------------------------------------------------
  // Scheduled tasks
  // ---------------------------------------------------------------------------

  createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void {
    this.db.prepare(
      `
      INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      task.id,
      task.group_folder,
      task.chat_jid,
      task.prompt,
      task.schedule_type,
      task.schedule_value,
      task.context_mode || 'isolated',
      task.next_run,
      task.status,
      task.created_at,
    );
  }

  getTaskById(id: string): ScheduledTask | undefined {
    return this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
      | ScheduledTask
      | undefined;
  }

  getTasksForGroup(groupFolder: string): ScheduledTask[] {
    return this.db
      .prepare(
        'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
      )
      .all(groupFolder) as ScheduledTask[];
  }

  getAllTasks(): ScheduledTask[] {
    return this.db
      .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
      .all() as ScheduledTask[];
  }

  updateTask(
    id: string,
    updates: Partial<
      Pick<
        ScheduledTask,
        'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
      >
    >,
  ): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.prompt !== undefined) {
      fields.push('prompt = ?');
      values.push(updates.prompt);
    }
    if (updates.schedule_type !== undefined) {
      fields.push('schedule_type = ?');
      values.push(updates.schedule_type);
    }
    if (updates.schedule_value !== undefined) {
      fields.push('schedule_value = ?');
      values.push(updates.schedule_value);
    }
    if (updates.next_run !== undefined) {
      fields.push('next_run = ?');
      values.push(updates.next_run);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(
      `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
    ).run(...values);
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  }

  getDueTasks(): ScheduledTask[] {
    const now = new Date().toISOString();
    return this.db
      .prepare(
        `
      SELECT * FROM scheduled_tasks
      WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
      ORDER BY next_run
    `,
      )
      .all(now) as ScheduledTask[];
  }

  claimTask(id: string): boolean {
    const result = this.db
      .prepare(
        `
      UPDATE scheduled_tasks
      SET next_run = NULL
      WHERE id = ? AND status = 'active' AND next_run IS NOT NULL
    `,
      )
      .run(id);
    return result.changes > 0;
  }

  updateTaskAfterRun(
    id: string,
    nextRun: string | null,
    lastResult: string,
  ): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `
      UPDATE scheduled_tasks
      SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
      WHERE id = ?
    `,
    ).run(nextRun, now, lastResult, nextRun, id);
  }

  logTaskRun(log: TaskRunLog): void {
    this.db.prepare(
      `
      INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(log.task_id, log.run_at, log.duration_ms, log.status, log.result, log.error);
  }

  // ---------------------------------------------------------------------------
  // Router state
  // ---------------------------------------------------------------------------

  getRouterState(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM router_state WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setRouterState(key: string, value: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
    ).run(key, value);
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Conversation archives
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Registered groups
  // ---------------------------------------------------------------------------

  getRegisteredGroup(jid: string): (RegisteredGroup & { jid: string }) | undefined {
    const row = this.db
      .prepare('SELECT * FROM registered_groups WHERE jid = ?')
      .get(jid) as
      | {
          jid: string;
          name: string;
          folder: string;
          trigger_pattern: string;
          added_at: string;
          container_config: string | null;
          requires_trigger: number | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      jid: row.jid,
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? safeParse(row.container_config) ?? undefined
        : undefined,
      requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    };
  }

  setRegisteredGroup(jid: string, group: RegisteredGroup): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jid,
      group.name,
      group.folder,
      group.trigger,
      group.added_at,
      group.containerConfig ? JSON.stringify(group.containerConfig) : null,
      group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    );
  }

  getAllRegisteredGroups(): Record<string, RegisteredGroup> {
    const rows = this.db
      .prepare('SELECT * FROM registered_groups')
      .all() as Array<{
      jid: string;
      name: string;
      folder: string;
      trigger_pattern: string;
      added_at: string;
      container_config: string | null;
      requires_trigger: number | null;
    }>;
    const result: Record<string, RegisteredGroup> = {};
    for (const row of rows) {
      result[row.jid] = {
        name: row.name,
        folder: row.folder,
        trigger: row.trigger_pattern,
        added_at: row.added_at,
        containerConfig: row.container_config
          ? safeParse(row.container_config) ?? undefined
          : undefined,
        requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      };
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private: schema & migrations
  // ---------------------------------------------------------------------------

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        jid TEXT PRIMARY KEY,
        name TEXT,
        last_message_time TEXT,
        channel TEXT,
        is_group INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT,
        chat_jid TEXT,
        sender TEXT,
        sender_name TEXT,
        content TEXT,
        timestamp TEXT,
        is_from_me INTEGER,
        is_bot_message INTEGER DEFAULT 0,
        PRIMARY KEY (id, chat_jid),
        FOREIGN KEY (chat_jid) REFERENCES chats(jid)
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        group_folder TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        next_run TEXT,
        last_run TEXT,
        last_result TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
      CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

      CREATE TABLE IF NOT EXISTS task_run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        run_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

      CREATE TABLE IF NOT EXISTS router_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        group_folder TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS registered_groups (
        jid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        folder TEXT NOT NULL UNIQUE,
        trigger_pattern TEXT NOT NULL,
        added_at TEXT NOT NULL,
        container_config TEXT,
        requires_trigger INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS conversation_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_folder TEXT NOT NULL,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        archived_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_archives_group ON conversation_archives(group_folder);
    `);

    // Migrate session_history → conversation_archives (safe to run multiple times)
    try {
      const hasOldTable = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='session_history'`,
      ).get();
      if (hasOldTable) {
        this.db.exec(`
          INSERT INTO conversation_archives (group_folder, session_id, name, content, archived_at)
          SELECT group_folder, session_id, name, '', archived_at FROM session_history
        `);
        this.db.exec(`DROP TABLE session_history`);
      }
    } catch {
      /* migration already ran or table doesn't exist */
    }

    // Add context_mode column if it doesn't exist
    try {
      this.db.exec(
        `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
      );
    } catch {
      /* column already exists */
    }

    // Add is_bot_message column if it doesn't exist
    try {
      this.db.exec(
        `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
      );
      this.db.prepare(
        `UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`,
      ).run(`${ASSISTANT_NAME}:%`);
    } catch {
      /* column already exists */
    }

    // Add channel and is_group columns if they don't exist
    try {
      this.db.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
      this.db.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
      this.db.exec(`UPDATE chats SET channel = 'whatsapp', is_group = 1 WHERE jid LIKE '%@g.us'`);
      this.db.exec(`UPDATE chats SET channel = 'whatsapp', is_group = 0 WHERE jid LIKE '%@s.whatsapp.net'`);
      this.db.exec(`UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`);
      this.db.exec(`UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'tg:%'`);
    } catch {
      /* columns already exist */
    }
  }

  private migrateJsonState(): void {
    const migrateFile = (filename: string) => {
      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) return null;
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.renameSync(filePath, `${filePath}.migrated`);
        return data;
      } catch {
        return null;
      }
    };

    const routerState = migrateFile('router_state.json') as {
      last_timestamp?: string;
      last_agent_timestamp?: Record<string, string>;
    } | null;
    if (routerState) {
      if (routerState.last_timestamp) {
        this.setRouterState('last_timestamp', routerState.last_timestamp);
      }
      if (routerState.last_agent_timestamp) {
        this.setRouterState(
          'last_agent_timestamp',
          JSON.stringify(routerState.last_agent_timestamp),
        );
      }
    }

    const sessions = migrateFile('sessions.json') as Record<string, string> | null;
    if (sessions) {
      for (const [folder, sessionId] of Object.entries(sessions)) {
        this.setSession(folder, sessionId);
      }
    }

    const groups = migrateFile('registered_groups.json') as Record<
      string,
      RegisteredGroup
    > | null;
    if (groups) {
      for (const [jid, group] of Object.entries(groups)) {
        this.setRegisteredGroup(jid, group);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance + backward-compatible function exports
// ---------------------------------------------------------------------------

export const database = new AppDatabase();

export function initDatabase(): void { database.init(); }
export function _initTestDatabase(): void { database._initTest(); }

export function storeChatMetadata(
  chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean,
): void { database.storeChatMetadata(chatJid, timestamp, name, channel, isGroup); }
export function updateChatName(chatJid: string, name: string): void { database.updateChatName(chatJid, name); }
export function getAllChats(): ChatInfo[] { return database.getAllChats(); }
export function getLastGroupSync(): string | null { return database.getLastGroupSync(); }
export function setLastGroupSync(): void { database.setLastGroupSync(); }

export function storeMessage(msg: NewMessage): void { database.storeMessage(msg); }
export function storeMessageDirect(msg: Parameters<AppDatabase['storeMessageDirect']>[0]): void { database.storeMessageDirect(msg); }
export function getNewMessages(
  jids: string[], lastTimestamp: string, botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } { return database.getNewMessages(jids, lastTimestamp, botPrefix); }
export function getMessagesSince(
  chatJid: string, sinceTimestamp: string, botPrefix: string,
): NewMessage[] { return database.getMessagesSince(chatJid, sinceTimestamp, botPrefix); }

export function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void { database.createTask(task); }
export function getTaskById(id: string): ScheduledTask | undefined { return database.getTaskById(id); }
export function getTasksForGroup(groupFolder: string): ScheduledTask[] { return database.getTasksForGroup(groupFolder); }
export function getAllTasks(): ScheduledTask[] { return database.getAllTasks(); }
export function updateTask(
  id: string,
  updates: Partial<Pick<ScheduledTask, 'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'>>,
): void { database.updateTask(id, updates); }
export function deleteTask(id: string): void { database.deleteTask(id); }
export function getDueTasks(): ScheduledTask[] { return database.getDueTasks(); }
export function claimTask(id: string): boolean { return database.claimTask(id); }
export function updateTaskAfterRun(id: string, nextRun: string | null, lastResult: string): void { database.updateTaskAfterRun(id, nextRun, lastResult); }
export function logTaskRun(log: TaskRunLog): void { database.logTaskRun(log); }

export function getRouterState(key: string): string | undefined { return database.getRouterState(key); }
export function setRouterState(key: string, value: string): void { database.setRouterState(key, value); }

export function getSession(groupFolder: string): string | undefined { return database.getSession(groupFolder); }
export function setSession(groupFolder: string, sessionId: string): void { database.setSession(groupFolder, sessionId); }
export function deleteSession(groupFolder: string): void { database.deleteSession(groupFolder); }
export function getAllSessions(): Record<string, string> { return database.getAllSessions(); }

export function insertConversationArchive(
  groupFolder: string, sessionId: string, name: string, content: string, archivedAt: string,
): void { database.insertConversationArchive(groupFolder, sessionId, name, content, archivedAt); }
export function getConversationArchives(groupFolder: string): Omit<ConversationArchiveRow, 'content'>[] { return database.getConversationArchives(groupFolder); }
export function getConversationArchiveById(id: number): ConversationArchiveRow | undefined { return database.getConversationArchiveById(id); }
export function searchConversationArchives(
  groupFolder: string, query: string,
): Omit<ConversationArchiveRow, 'content'>[] { return database.searchConversationArchives(groupFolder, query); }
export function deleteConversationArchive(id: number): void { database.deleteConversationArchive(id); }

export function getRegisteredGroup(jid: string): (RegisteredGroup & { jid: string }) | undefined { return database.getRegisteredGroup(jid); }
export function setRegisteredGroup(jid: string, group: RegisteredGroup): void { database.setRegisteredGroup(jid, group); }
export function getAllRegisteredGroups(): Record<string, RegisteredGroup> { return database.getAllRegisteredGroups(); }
