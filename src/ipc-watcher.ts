import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
} from './config.js';
import { AuthorizationPolicy } from './authorization.js';
import {
  ArchiveSessionHandler,
  CancelTaskHandler,
  ClearSessionHandler,
  IpcCommandDispatcher,
  PauseTaskHandler,
  RefreshGroupsHandler,
  RegisterGroupHandler,
  ResumeSessionHandler,
  ResumeTaskHandler,
  ScheduleTaskHandler,
  SearchSessionsHandler,
} from './ipc-handlers/index.js';
import { logger } from './logger.js';
import type { IpcDeps } from './ipc.js';
import { RegisteredGroup } from './types.js';

// Fallback poll interval: slower than before since fs.watch handles the fast path
const FALLBACK_POLL_INTERVAL = IPC_POLL_INTERVAL * 10; // 10s

/**
 * IpcWatcher — watches the IPC directory tree for command and message files
 * written by container agents, dispatches them to handlers.
 */
export class IpcWatcher {
  private readonly dispatcher: IpcCommandDispatcher;
  private readonly ipcBaseDir: string;
  private processing = false;
  private watcher: fs.FSWatcher | null = null;
  private running = false;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.dispatcher = new IpcCommandDispatcher([
      new ScheduleTaskHandler(),
      new PauseTaskHandler(),
      new ResumeTaskHandler(),
      new CancelTaskHandler(),
      new RefreshGroupsHandler(),
      new RegisterGroupHandler(),
      new ClearSessionHandler(),
      new ResumeSessionHandler(),
      new SearchSessionsHandler(),
      new ArchiveSessionHandler(),
    ]);
    this.ipcBaseDir = path.join(DATA_DIR, 'ipc');
  }

  start(deps: IpcDeps): void {
    if (this.running) {
      logger.debug('IPC watcher already running, skipping duplicate start');
      return;
    }
    this.running = true;

    fs.mkdirSync(this.ipcBaseDir, { recursive: true });

    // Set up fs.watch for event-driven processing
    try {
      this.watcher = fs.watch(this.ipcBaseDir, { recursive: true }, (_event, filename) => {
        if (filename && filename.endsWith('.json')) {
          this.processIpcFiles(deps);
        }
      });
      logger.info('IPC watcher started (fs.watch + fallback poll)');
    } catch (err) {
      logger.warn({ err }, 'fs.watch not available, using poll-only mode');
    }

    // Fallback poll at a slower interval for reliability
    const fallbackLoop = async () => {
      await this.processIpcFiles(deps);
      if (this.running) {
        this.fallbackTimer = setTimeout(fallbackLoop, FALLBACK_POLL_INTERVAL);
      }
    };
    fallbackLoop();
  }

  stop(): void {
    this.running = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /**
   * Dispatch a task IPC command directly (used by tests).
   */
  async dispatchTask(
    data: Record<string, any>,
    sourceGroup: string,
    isMain: boolean,
    deps: IpcDeps,
  ): Promise<void> {
    await this.dispatcher.dispatch(data, sourceGroup, isMain, deps);
  }

  private async processIpcFiles(deps: IpcDeps): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(this.ipcBaseDir, { withFileTypes: true });
      } catch (err) {
        logger.error({ err }, 'Error reading IPC base directory');
        return;
      }

      const groupFolders = entries
        .filter((e) => e.isDirectory() && e.name !== 'errors')
        .map((e) => e.name);

      const registeredGroups = deps.registeredGroups();

      for (const sourceGroup of groupFolders) {
        const isMain = sourceGroup === MAIN_GROUP_FOLDER;
        const messagesDir = path.join(this.ipcBaseDir, sourceGroup, 'messages');
        const tasksDir = path.join(this.ipcBaseDir, sourceGroup, 'tasks');

        await this.processDirectory(messagesDir, sourceGroup, isMain, registeredGroups, deps);
        await this.processTaskDirectory(tasksDir, sourceGroup, isMain, deps);
      }
    } catch (err) {
      logger.error({ err }, 'Error in IPC processing');
    } finally {
      this.processing = false;
    }
  }

  private async processDirectory(
    messagesDir: string,
    sourceGroup: string,
    isMain: boolean,
    registeredGroups: Record<string, RegisteredGroup>,
    deps: IpcDeps,
  ): Promise<void> {
    let messageFiles: string[];
    try {
      const entries = await fsp.readdir(messagesDir).catch(() => [] as string[]);
      messageFiles = (entries as string[]).filter((f: string) => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of messageFiles) {
      const filePath = path.join(messagesDir, file);
      try {
        const raw = await fsp.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.type === 'message' && data.chatJid && data.text) {
          const targetGroup = registeredGroups[data.chatJid];
          const auth = new AuthorizationPolicy({ sourceGroup, isMain });
          if (auth.canSendMessage(targetGroup?.folder ?? '')) {
            await deps.sendMessage(data.chatJid, data.text);
            logger.info(
              { chatJid: data.chatJid, sourceGroup },
              'IPC message sent',
            );
          } else {
            logger.warn(
              { chatJid: data.chatJid, sourceGroup },
              'Unauthorized IPC message attempt blocked',
            );
          }
        }
        await fsp.unlink(filePath);
      } catch (err) {
        logger.error(
          { file, sourceGroup, err },
          'Error processing IPC message',
        );
        const errorDir = path.join(this.ipcBaseDir, 'errors');
        await fsp.mkdir(errorDir, { recursive: true });
        await fsp.rename(
          filePath,
          path.join(errorDir, `${sourceGroup}-${file}`),
        ).catch(() => {});
      }
    }
  }

  private async processTaskDirectory(
    tasksDir: string,
    sourceGroup: string,
    isMain: boolean,
    deps: IpcDeps,
  ): Promise<void> {
    let taskFiles: string[];
    try {
      const entries = await fsp.readdir(tasksDir).catch(() => [] as string[]);
      taskFiles = (entries as string[]).filter((f: string) => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of taskFiles) {
      const filePath = path.join(tasksDir, file);
      try {
        const raw = await fsp.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw);
        await this.dispatcher.dispatch(data, sourceGroup, isMain, deps);
        await fsp.unlink(filePath);
      } catch (err) {
        logger.error(
          { file, sourceGroup, err },
          'Error processing IPC task',
        );
        const errorDir = path.join(this.ipcBaseDir, 'errors');
        await fsp.mkdir(errorDir, { recursive: true });
        await fsp.rename(
          filePath,
          path.join(errorDir, `${sourceGroup}-${file}`),
        ).catch(() => {});
      }
    }
  }
}
