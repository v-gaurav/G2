import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';

/** Centralized path construction for group-related directories and files. */
export const GroupPaths = {
  /** Root directory for a group: groups/{folder} */
  groupDir(folder: string): string {
    return path.join(GROUPS_DIR, folder);
  },

  /** Logs directory: groups/{folder}/logs */
  logsDir(folder: string): string {
    return path.join(GROUPS_DIR, folder, 'logs');
  },

  /** IPC root directory: data/ipc/{folder} */
  ipcDir(folder: string): string {
    return path.join(DATA_DIR, 'ipc', folder);
  },

  /** IPC input directory: data/ipc/{folder}/input */
  ipcInputDir(folder: string): string {
    return path.join(DATA_DIR, 'ipc', folder, 'input');
  },

  /** IPC messages directory: data/ipc/{folder}/messages */
  ipcMessagesDir(folder: string): string {
    return path.join(DATA_DIR, 'ipc', folder, 'messages');
  },

  /** IPC tasks directory: data/ipc/{folder}/tasks */
  ipcTasksDir(folder: string): string {
    return path.join(DATA_DIR, 'ipc', folder, 'tasks');
  },

  /** IPC responses directory: data/ipc/{folder}/responses */
  ipcResponsesDir(folder: string): string {
    return path.join(DATA_DIR, 'ipc', folder, 'responses');
  },

  /** Sessions directory: data/sessions/{folder}/.claude */
  sessionsDir(folder: string): string {
    return path.join(DATA_DIR, 'sessions', folder, '.claude');
  },

  /** Session transcript path */
  sessionTranscript(folder: string, sessionId: string): string {
    return path.join(
      DATA_DIR, 'sessions', folder, '.claude',
      'projects', '-workspace-group', `${sessionId}.jsonl`,
    );
  },
} as const;
