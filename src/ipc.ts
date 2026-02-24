/**
 * IPC watcher — thin re-export layer.
 * Preserves the original `startIpcWatcher()` and `processTaskIpc()` API
 * for backward compatibility. All logic lives in IpcWatcher class.
 */
import { IpcWatcher } from './ipc-watcher.js';
import { SessionManager } from './session-manager.js';
import { AvailableGroup } from './snapshot-writer.js';
import { TaskManager } from './task-manager.js';
import { RegisteredGroup } from './types.js';

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
  taskManager: TaskManager;
}

const defaultWatcher = new IpcWatcher();

export function startIpcWatcher(deps: IpcDeps): void {
  defaultWatcher.start(deps);
}

export async function processTaskIpc(
  data: Record<string, any>,
  sourceGroup: string,
  isMain: boolean,
  deps: IpcDeps,
): Promise<void> {
  await defaultWatcher.dispatchTask(data, sourceGroup, isMain, deps);
}
