import fs from 'fs';
import path from 'path';

import { GroupPaths } from '../groups/GroupPaths.js';
import { TaskManager } from './TaskService.js';

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Unified snapshot writer for container-visible JSON files.
 * Writes tasks, session history, and groups snapshots to each group's IPC directory.
 */
export class SnapshotWriter {
  constructor(private taskManager: TaskManager) {}
  /**
   * Write a filtered tasks snapshot for the container to read.
   * Main sees all tasks; non-main groups see only their own.
   */
  writeTasks(
    groupFolder: string,
    isMain: boolean,
    tasks: Array<{
      id: string;
      groupFolder: string;
      prompt: string;
      schedule_type: string;
      schedule_value: string;
      status: string;
      next_run: string | null;
    }>,
  ): void {
    const groupIpcDir = GroupPaths.ipcDir(groupFolder);
    fs.mkdirSync(groupIpcDir, { recursive: true });

    const filteredTasks = isMain
      ? tasks
      : tasks.filter((t) => t.groupFolder === groupFolder);

    const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
    fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
  }

  /**
   * Write session history snapshot for the container to read.
   */
  writeSessionHistory(
    groupFolder: string,
    sessions: Array<{ id: number; name: string; session_id: string; archived_at: string }>,
  ): void {
    const groupIpcDir = GroupPaths.ipcDir(groupFolder);
    fs.mkdirSync(groupIpcDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupIpcDir, 'session_history.json'),
      JSON.stringify(sessions, null, 2),
    );
  }

  /**
   * Write available groups snapshot for the container to read.
   * Only main group can see all available groups (for activation).
   */
  writeGroups(
    groupFolder: string,
    isMain: boolean,
    groups: AvailableGroup[],
    _registeredJids: Set<string>,
  ): void {
    const groupIpcDir = GroupPaths.ipcDir(groupFolder);
    fs.mkdirSync(groupIpcDir, { recursive: true });

    const visibleGroups = isMain ? groups : [];

    const groupsFile = path.join(groupIpcDir, 'available_groups.json');
    fs.writeFileSync(
      groupsFile,
      JSON.stringify(
        {
          groups: visibleGroups,
          lastSync: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  /**
   * Refresh the tasks snapshot from the database.
   * Convenience method that fetches all tasks and writes the filtered snapshot.
   */
  refreshTasks(groupFolder: string, isMain: boolean): void {
    const tasks = this.taskManager.getAll();
    this.writeTasks(
      groupFolder,
      isMain,
      tasks.map((t) => ({
        id: t.id,
        groupFolder: t.group_folder,
        prompt: t.prompt,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
      })),
    );
  }

  /**
   * Prepare all snapshots for a container execution.
   * Writes tasks, groups, and session history in one call.
   */
  prepareForExecution(
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
    conversationArchives: Array<{ id: number; name: string; session_id: string; archived_at: string }>,
  ): void {
    this.refreshTasks(groupFolder, isMain);
    this.writeGroups(groupFolder, isMain, availableGroups, registeredJids);
    this.writeSessionHistory(groupFolder, conversationArchives);
  }
}
