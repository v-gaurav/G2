import { CronExpressionParser } from 'cron-parser';

import { AuthorizationPolicy } from '../groups/Authorization.js';
import { TIMEZONE } from '../infrastructure/Config.js';
import { TaskRepository } from './TaskRepository.js';
import { ScheduledTask, TaskRunLog } from '../types.js';

export class TaskManager {
  constructor(private taskRepo: TaskRepository) {}

  // --- CRUD ---

  create(params: {
    groupFolder: string;
    chatJid: string;
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    contextMode: 'group' | 'isolated';
  }): string {
    const nextRun = this.computeNextRun(params.scheduleType, params.scheduleValue);
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.taskRepo.createTask({
      id: taskId,
      group_folder: params.groupFolder,
      chat_jid: params.chatJid,
      prompt: params.prompt,
      schedule_type: params.scheduleType,
      schedule_value: params.scheduleValue,
      context_mode: params.contextMode,
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });

    return taskId;
  }

  getById(id: string): ScheduledTask | undefined {
    return this.taskRepo.getTaskById(id);
  }

  getAll(): ScheduledTask[] {
    return this.taskRepo.getAllTasks();
  }

  getForGroup(groupFolder: string): ScheduledTask[] {
    return this.taskRepo.getTasksForGroup(groupFolder);
  }

  // --- Lifecycle ---

  pause(id: string): void {
    this.taskRepo.updateTask(id, { status: 'paused' });
  }

  resume(id: string): void {
    this.taskRepo.updateTask(id, { status: 'active' });
  }

  cancel(id: string): void {
    this.taskRepo.deleteTask(id);
  }

  // --- Scheduling ---

  getDueTasks(): ScheduledTask[] {
    return this.taskRepo.getDueTasks();
  }

  claim(id: string): boolean {
    return this.taskRepo.claimTask(id);
  }

  completeRun(task: ScheduledTask, durationMs: number, result: string | null, error: string | null): void {
    this.taskRepo.logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: durationMs,
      status: error ? 'error' : 'success',
      result,
      error,
    });

    const nextRun = this.computeNextRunAfterExecution(task);
    const resultSummary = error
      ? `Error: ${error}`
      : result
        ? result.slice(0, 200)
        : 'Completed';
    this.taskRepo.updateTaskAfterRun(task.id, nextRun, resultSummary);
  }

  // --- Authorization ---

  getAuthorized(taskId: string, sourceGroup: string, isMain: boolean): ScheduledTask {
    const task = this.taskRepo.getTaskById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const auth = new AuthorizationPolicy({ sourceGroup, isMain });
    if (!auth.canManageTask(task.group_folder)) {
      throw new Error(`Unauthorized task management: ${taskId}`);
    }
    return task;
  }

  // --- Internal ---

  /**
   * Compute the initial next_run for a newly created task.
   * Throws on invalid schedule expressions.
   */
  computeNextRun(scheduleType: string, scheduleValue: string): string | null {
    if (scheduleType === 'cron') {
      try {
        const interval = CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE });
        return interval.next().toISOString();
      } catch {
        throw new Error(`Invalid cron expression: ${scheduleValue}`);
      }
    } else if (scheduleType === 'interval') {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) {
        throw new Error(`Invalid interval: ${scheduleValue}`);
      }
      return new Date(Date.now() + ms).toISOString();
    } else if (scheduleType === 'once') {
      const scheduled = new Date(scheduleValue);
      if (isNaN(scheduled.getTime())) {
        throw new Error(`Invalid timestamp: ${scheduleValue}`);
      }
      return scheduled.toISOString();
    }
    return null;
  }

  /**
   * Compute the next_run after a task has completed execution.
   * 'once' tasks return null (completed). Cron/interval compute the next occurrence.
   */
  private computeNextRunAfterExecution(task: ScheduledTask): string | null {
    if (task.schedule_type === 'cron') {
      const interval = CronExpressionParser.parse(task.schedule_value, { tz: TIMEZONE });
      return interval.next().toISOString();
    } else if (task.schedule_type === 'interval') {
      const ms = parseInt(task.schedule_value, 10);
      return new Date(Date.now() + ms).toISOString();
    }
    // 'once' tasks have no next run
    return null;
  }
}
