import { writeTasksSnapshot } from './container-runner.js';
import { getAllTasks } from './db.js';

/**
 * Writes filtered task snapshots for containers to read.
 * Main groups see all tasks; non-main groups see only their own.
 */
export class TaskSnapshotWriter {
  /**
   * Fetch all tasks from the database and write a filtered snapshot
   * for the container to read.
   */
  refresh(groupFolder: string, isMain: boolean): void {
    const tasks = getAllTasks();
    writeTasksSnapshot(
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
}

/** Backward-compatible function export */
export function refreshTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
): void {
  defaultWriter.refresh(groupFolder, isMain);
}

const defaultWriter = new TaskSnapshotWriter();
