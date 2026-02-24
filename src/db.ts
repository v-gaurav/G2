import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { ArchiveRepository, ConversationArchiveRow } from './repositories/archive-repository.js';
import { ChatInfo, ChatRepository } from './repositories/chat-repository.js';
import { GroupRepository } from './repositories/group-repository.js';
import { MessageRepository } from './repositories/message-repository.js';
import { createSchema, runMigrations } from './repositories/schema.js';
import { SessionRepository } from './repositories/session-repository.js';
import { StateRepository } from './repositories/state-repository.js';
import { TaskRepository } from './repositories/task-repository.js';
import { NewMessage, RegisteredGroup, ScheduledTask, TaskRunLog } from './types.js';

// Re-export interfaces so existing `import { ChatInfo } from './db.js'` still works
export type { ChatInfo, ConversationArchiveRow };

/**
 * AppDatabase — thin composition root that delegates to domain repositories.
 * Preserves the original public API for backward compatibility.
 */
export class AppDatabase {
  private db!: BetterSqlite3.Database;

  private chatRepo!: ChatRepository;
  private messageRepo!: MessageRepository;
  private taskRepo!: TaskRepository;
  private sessionRepo!: SessionRepository;
  private archiveRepo!: ArchiveRepository;
  private groupRepo!: GroupRepository;
  private stateRepo!: StateRepository;

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
    this.archiveRepo = new ArchiveRepository(this.db);
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

  // --- Conversation archives (delegates to ArchiveRepository) ---
  insertConversationArchive(groupFolder: string, sessionId: string, name: string, content: string, archivedAt: string): void { this.archiveRepo.insertConversationArchive(groupFolder, sessionId, name, content, archivedAt); }
  getConversationArchives(groupFolder: string): Omit<ConversationArchiveRow, 'content'>[] { return this.archiveRepo.getConversationArchives(groupFolder); }
  getConversationArchiveById(id: number): ConversationArchiveRow | undefined { return this.archiveRepo.getConversationArchiveById(id); }
  searchConversationArchives(groupFolder: string, query: string): Omit<ConversationArchiveRow, 'content'>[] { return this.archiveRepo.searchConversationArchives(groupFolder, query); }
  deleteConversationArchive(id: number): void { this.archiveRepo.deleteConversationArchive(id); }

  // --- Registered groups (delegates to GroupRepository) ---
  getRegisteredGroup(jid: string): (RegisteredGroup & { jid: string }) | undefined { return this.groupRepo.getRegisteredGroup(jid); }
  setRegisteredGroup(jid: string, group: RegisteredGroup): void { this.groupRepo.setRegisteredGroup(jid, group); }
  getAllRegisteredGroups(): Record<string, RegisteredGroup> { return this.groupRepo.getAllRegisteredGroups(); }
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
