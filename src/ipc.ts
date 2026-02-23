import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { canSendMessage } from './authorization.js';
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
import { SessionManager } from './session-manager.js';
import { RegisteredGroup } from './types.js';

const dispatcher = new IpcCommandDispatcher([
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

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  sessionManager: SessionManager;
  closeStdin: (chatJid: string) => void;
}

// Fallback poll interval: slower than before since fs.watch handles the fast path
const FALLBACK_POLL_INTERVAL = IPC_POLL_INTERVAL * 10; // 10s

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  let processing = false;

  const processIpcFiles = async () => {
    // Prevent overlapping runs from rapid fs.watch events
    if (processing) return;
    processing = true;

    try {
      // Scan all group IPC directories (identity determined by directory)
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(ipcBaseDir, { withFileTypes: true });
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
        const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
        const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

        // Process messages from this group's IPC directory
        await processDirectory(messagesDir, sourceGroup, isMain, registeredGroups, deps);

        // Process tasks from this group's IPC directory
        await processTaskDirectory(tasksDir, sourceGroup, isMain, deps);
      }
    } catch (err) {
      logger.error({ err }, 'Error in IPC processing');
    } finally {
      processing = false;
    }
  };

  // Set up fs.watch for event-driven processing
  try {
    fs.watch(ipcBaseDir, { recursive: true }, (_event, filename) => {
      // Only react to new .json files (ignore _close sentinels, tmp files, etc.)
      if (filename && filename.endsWith('.json')) {
        processIpcFiles();
      }
    });
    logger.info('IPC watcher started (fs.watch + fallback poll)');
  } catch (err) {
    logger.warn({ err }, 'fs.watch not available, using poll-only mode');
  }

  // Fallback poll at a slower interval for reliability
  const fallbackLoop = async () => {
    await processIpcFiles();
    if (ipcWatcherRunning) {
      setTimeout(fallbackLoop, FALLBACK_POLL_INTERVAL);
    }
  };
  fallbackLoop();
}

async function processDirectory(
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

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');

  for (const file of messageFiles) {
    const filePath = path.join(messagesDir, file);
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.type === 'message' && data.chatJid && data.text) {
        // Authorization: verify this group can send to this chatJid
        const targetGroup = registeredGroups[data.chatJid];
        const ctx = { sourceGroup, isMain };
        if (canSendMessage(ctx, targetGroup?.folder ?? '')) {
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
      const errorDir = path.join(ipcBaseDir, 'errors');
      await fsp.mkdir(errorDir, { recursive: true });
      await fsp.rename(
        filePath,
        path.join(errorDir, `${sourceGroup}-${file}`),
      ).catch(() => {});
    }
  }
}

async function processTaskDirectory(
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

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');

  for (const file of taskFiles) {
    const filePath = path.join(tasksDir, file);
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      await processTaskIpc(data, sourceGroup, isMain, deps);
      await fsp.unlink(filePath);
    } catch (err) {
      logger.error(
        { file, sourceGroup, err },
        'Error processing IPC task',
      );
      const errorDir = path.join(ipcBaseDir, 'errors');
      await fsp.mkdir(errorDir, { recursive: true });
      await fsp.rename(
        filePath,
        path.join(errorDir, `${sourceGroup}-${file}`),
      ).catch(() => {});
    }
  }
}

export async function processTaskIpc(
  data: Record<string, any>,
  sourceGroup: string,
  isMain: boolean,
  deps: IpcDeps,
): Promise<void> {
  await dispatcher.dispatch(data, sourceGroup, isMain, deps);
}
