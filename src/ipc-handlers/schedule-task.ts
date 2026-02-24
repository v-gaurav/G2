import { CronExpressionParser } from 'cron-parser';

import { AuthorizationPolicy } from '../authorization.js';
import { TIMEZONE } from '../config.js';
import { createTask } from '../db.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

interface ScheduleTaskPayload {
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  targetJid: string;
  context_mode: 'group' | 'isolated';
}

export class ScheduleTaskHandler extends BaseIpcHandler<ScheduleTaskPayload> {
  readonly command = 'schedule_task';

  validate(data: Record<string, any>): ScheduleTaskPayload {
    if (!data.prompt || !data.schedule_type || !data.schedule_value || !data.targetJid) {
      throw new IpcHandlerError('Missing required fields', {
        command: this.command,
        hasPrompt: !!data.prompt,
        hasScheduleType: !!data.schedule_type,
        hasScheduleValue: !!data.schedule_value,
        hasTargetJid: !!data.targetJid,
      });
    }
    return {
      prompt: data.prompt as string,
      schedule_type: data.schedule_type as 'cron' | 'interval' | 'once',
      schedule_value: data.schedule_value as string,
      targetJid: data.targetJid as string,
      context_mode:
        data.context_mode === 'group' || data.context_mode === 'isolated'
          ? data.context_mode
          : 'isolated',
    };
  }

  async execute(payload: ScheduleTaskPayload, context: HandlerContext): Promise<void> {
    const registeredGroups = context.deps.registeredGroups();
    const targetGroupEntry = registeredGroups[payload.targetJid];

    if (!targetGroupEntry) {
      throw new IpcHandlerError('Target group not registered', {
        targetJid: payload.targetJid,
      });
    }

    const targetFolder = targetGroupEntry.folder;
    const auth = new AuthorizationPolicy({ sourceGroup: context.sourceGroup, isMain: context.isMain });

    if (!auth.canScheduleTask(targetFolder)) {
      throw new IpcHandlerError('Unauthorized schedule_task attempt', {
        sourceGroup: context.sourceGroup,
        targetFolder,
      });
    }

    const nextRun = this.computeNextRun(payload.schedule_type, payload.schedule_value);

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createTask({
      id: taskId,
      group_folder: targetFolder,
      chat_jid: payload.targetJid,
      prompt: payload.prompt,
      schedule_type: payload.schedule_type,
      schedule_value: payload.schedule_value,
      context_mode: payload.context_mode,
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });
    logger.info(
      { taskId, sourceGroup: context.sourceGroup, targetFolder, contextMode: payload.context_mode },
      'Task created via IPC',
    );
  }

  private computeNextRun(scheduleType: string, scheduleValue: string): string | null {
    if (scheduleType === 'cron') {
      try {
        const interval = CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE });
        return interval.next().toISOString();
      } catch {
        throw new IpcHandlerError('Invalid cron expression', { scheduleValue });
      }
    } else if (scheduleType === 'interval') {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) {
        throw new IpcHandlerError('Invalid interval', { scheduleValue });
      }
      return new Date(Date.now() + ms).toISOString();
    } else if (scheduleType === 'once') {
      const scheduled = new Date(scheduleValue);
      if (isNaN(scheduled.getTime())) {
        throw new IpcHandlerError('Invalid timestamp', { scheduleValue });
      }
      return scheduled.toISOString();
    }
    return null;
  }
}
