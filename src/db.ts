import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { ChatInfo, ChatRepository } from './repositories/chat-repository.js';
import { GroupRepository } from './repositories/group-repository.js';
import { MessageRepository } from './repositories/message-repository.js';
import { createSchema, runMigrations } from './repositories/schema.js';
import { SessionRepository } from './repositories/session-repository.js';
import { StateRepository } from './repositories/state-repository.js';
import { TaskRepository } from './repositories/task-repository.js';
import { ArchivedSession, NewMessage, RegisteredGroup, ScheduledTask, TaskRunLog } from './types.js';

// Re-export types so consumers can import repos and interfaces from './db.js'
export type { ArchivedSession, ChatInfo };
export { ChatRepository } from './repositories/chat-repository.js';
export { MessageRepository } from './repositories/message-repository.js';
export { TaskRepository } from './repositories/task-repository.js';
export { SessionRepository } from './repositories/session-repository.js';
export { GroupRepository } from './repositories/group-repository.js';
export { StateRepository } from './repositories/state-repository.js';

/**
 * AppDatabase — thin composition root that delegates to domain repositories.
 * Preserves the original public API for backward compatibility.
 */
export class AppDatabase {
  private db!: BetterSqlite3.Database;

  public chatRepo!: ChatRepository;
  public messageRepo!: MessageRepository;
  public taskRepo!: TaskRepository;
  public sessionRepo!: SessionRepository;
  public groupRepo!: GroupRepository;
  public stateRepo!: StateRepository;

  /** Open (or create) the database file at the standard location. */
  init(): void {
    const dbPath = path.join(STORE_DIR, 'messages.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new BetterSqlite3(dbPath);
    this.initRepos();
    runMigrations(this.db, {
      setRouterState: (k, v) => this.stateRepo.setRouterState(k, v),
      setSession: (g, s) => this.sessionRepo.setSession(g, s),
      setRegisteredGroup: (j, g) => this.groupRepo.setRegisteredGroup(j, g),
    });
  }

  /** @internal — for tests only. Creates a fresh in-memory database. */
  _initTest(): void {
    this.db = new BetterSqlite3(':memory:');
    this.initRepos();
  }

  private initRepos(): void {
    createSchema(this.db);
    this.chatRepo = new ChatRepository(this.db);
    this.messageRepo = new MessageRepository(this.db);
    this.taskRepo = new TaskRepository(this.db);
    this.sessionRepo = new SessionRepository(this.db);
    this.groupRepo = new GroupRepository(this.db);
    this.stateRepo = new StateRepository(this.db);
  }

  // --- Chat metadata (delegates to ChatRepository) ---
  storeChatMetadata(chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean): void { this.chatRepo.storeChatMetadata(chatJid, timestamp, name, channel, isGroup); }
  updateChatName(chatJid: string, name: string): void { this.chatRepo.updateChatName(chatJid, name); }
  getAllChats(): ChatInfo[] { return this.chatRepo.getAllChats(); }
  getLastGroupSync(): string | null { return this.chatRepo.getLastGroupSync(); }
  setLastGroupSync(): void { this.chatRepo.setLastGroupSync(); }

  // --- Messages (delegates to MessageRepository) ---
  storeMessage(msg: NewMessage): void { this.messageRepo.storeMessage(msg); }
  storeMessageDirect(msg: Parameters<MessageRepository['storeMessageDirect']>[0]): void { this.messageRepo.storeMessageDirect(msg); }
  getNewMessages(jids: string[], lastTimestamp: string, botPrefix: string): { messages: NewMessage[]; newTimestamp: string } { return this.messageRepo.getNewMessages(jids, lastTimestamp, botPrefix); }
  getMessagesSince(chatJid: string, sinceTimestamp: string, botPrefix: string): NewMessage[] { return this.messageRepo.getMessagesSince(chatJid, sinceTimestamp, botPrefix); }

  // --- Tasks (delegates to TaskRepository) ---
  createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void { this.taskRepo.createTask(task); }
  getTaskById(id: string): ScheduledTask | undefined { return this.taskRepo.getTaskById(id); }
  getTasksForGroup(groupFolder: string): ScheduledTask[] { return this.taskRepo.getTasksForGroup(groupFolder); }
  getAllTasks(): ScheduledTask[] { return this.taskRepo.getAllTasks(); }
  updateTask(id: string, updates: Partial<Pick<ScheduledTask, 'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'>>): void { this.taskRepo.updateTask(id, updates); }
  deleteTask(id: string): void { this.taskRepo.deleteTask(id); }
  getDueTasks(): ScheduledTask[] { return this.taskRepo.getDueTasks(); }
  claimTask(id: string): boolean { return this.taskRepo.claimTask(id); }
  updateTaskAfterRun(id: string, nextRun: string | null, lastResult: string): void { this.taskRepo.updateTaskAfterRun(id, nextRun, lastResult); }
  logTaskRun(log: TaskRunLog): void { this.taskRepo.logTaskRun(log); }

  // --- Router state (delegates to StateRepository) ---
  getRouterState(key: string): string | undefined { return this.stateRepo.getRouterState(key); }
  setRouterState(key: string, value: string): void { this.stateRepo.setRouterState(key, value); }

  // --- Sessions (delegates to SessionRepository) ---
  getSession(groupFolder: string): string | undefined { return this.sessionRepo.getSession(groupFolder); }
  setSession(groupFolder: string, sessionId: string): void { this.sessionRepo.setSession(groupFolder, sessionId); }
  deleteSession(groupFolder: string): void { this.sessionRepo.deleteSession(groupFolder); }
  getAllSessions(): Record<string, string> { return this.sessionRepo.getAllSessions(); }

  // --- Conversation archives (delegates to SessionRepository) ---
  insertConversationArchive(groupFolder: string, sessionId: string, name: string, content: string, archivedAt: string): void { this.sessionRepo.insertArchive(groupFolder, sessionId, name, content, archivedAt); }
  getConversationArchives(groupFolder: string): Omit<ArchivedSession, 'content'>[] { return this.sessionRepo.getArchives(groupFolder); }
  getConversationArchiveById(id: number): ArchivedSession | undefined { return this.sessionRepo.getArchiveById(id); }
  searchConversationArchives(groupFolder: string, query: string): Omit<ArchivedSession, 'content'>[] { return this.sessionRepo.searchArchives(groupFolder, query); }
  deleteConversationArchive(id: number): void { this.sessionRepo.deleteArchive(id); }

  // --- Registered groups (delegates to GroupRepository) ---
  getRegisteredGroup(jid: string): (RegisteredGroup & { jid: string }) | undefined { return this.groupRepo.getRegisteredGroup(jid); }
  setRegisteredGroup(jid: string, group: RegisteredGroup): void { this.groupRepo.setRegisteredGroup(jid, group); }
  getAllRegisteredGroups(): Record<string, RegisteredGroup> { return this.groupRepo.getAllRegisteredGroups(); }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const database = new AppDatabase();
