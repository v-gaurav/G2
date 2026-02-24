import { ChildProcess } from 'child_process';
import fs from 'fs';

import {
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  SCHEDULER_POLL_INTERVAL,
} from '../infrastructure/Config.js';
import { GroupPaths } from '../groups/GroupPaths.js';
import { ContainerOutput, ContainerRunner } from '../execution/ContainerRunner.js';
import { GroupQueue } from '../execution/ExecutionQueue.js';
import { createIdleTimer } from '../infrastructure/idle-timer.js';
import { logger } from '../infrastructure/Logger.js';
import { SnapshotWriter } from './SnapshotWriter.js';
import { TaskManager } from './TaskService.js';
import { RegisteredGroup, ScheduledTask } from '../types.js';
import { startPollLoop } from '../infrastructure/poll-loop.js';

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (groupJid: string, proc: ChildProcess, containerName: string, groupFolder: string) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
  taskManager: TaskManager;
  snapshotWriter: SnapshotWriter;
  containerRunner: ContainerRunner;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const { taskManager, snapshotWriter, containerRunner } = deps;
  const startTime = Date.now();
  const groupDir = GroupPaths.groupDir(task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    taskManager.completeRun(task, Date.now() - startTime, null, `Group not found: ${task.group_folder}`);
    return;
  }

  const isMain = task.group_folder === MAIN_GROUP_FOLDER;

  // Update tasks snapshot for container to read (filtered by group)
  snapshotWriter.refreshTasks(task.group_folder, isMain);

  let result: string | null = null;
  let error: string | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // Idle timer: closes container stdin after IDLE_TIMEOUT of no output,
  // so the container exits instead of hanging at waitForIpcMessage forever.
  const idle = createIdleTimer(() => {
    logger.debug({ taskId: task.id }, 'Scheduled task idle timeout, closing container stdin');
    deps.queue.closeStdin(task.chat_jid);
  }, IDLE_TIMEOUT);

  try {
    const output = await containerRunner.run(
      group,
      {
        prompt: task.prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
      },
      (proc, containerName) => deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          // Forward result to user (sendMessage handles formatting)
          await deps.sendMessage(task.chat_jid, streamedOutput.result);
          // Only reset idle timer on actual results, not session-update markers
          idle.reset();
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    idle.clear();

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      // Messages are sent via MCP tool (IPC), result text is just logged
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    idle.clear();
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;
  taskManager.completeRun(task, durationMs, result, error);
}

export function startSchedulerLoop(deps: SchedulerDependencies): { stop: () => void } {
  const { taskManager } = deps;
  return startPollLoop('Scheduler', SCHEDULER_POLL_INTERVAL, async () => {
    const dueTasks = taskManager.getDueTasks();
    if (dueTasks.length > 0) {
      logger.info({ count: dueTasks.length }, 'Found due tasks');
    }

    for (const task of dueTasks) {
      // Atomically claim the task by nullifying next_run.
      // Prevents duplicate execution if the task runs longer than the poll interval.
      if (!taskManager.claim(task.id)) {
        continue;
      }

      deps.queue.enqueueTask(
        task.chat_jid,
        task.id,
        () => runTask(task, deps),
      );
    }
  });
}
