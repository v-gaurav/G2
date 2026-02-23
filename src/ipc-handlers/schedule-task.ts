import { CronExpressionParser } from 'cron-parser';

import { canScheduleTask } from '../authorization.js';
import { TIMEZONE } from '../config.js';
import { createTask } from '../db.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class ScheduleTaskHandler implements IpcCommandHandler {
  readonly type = 'schedule_task';

  async handle(data: Record<string, any>, sourceGroup: string, isMain: boolean, deps: IpcDeps): Promise<void> {
    if (
      data.prompt &&
      data.schedule_type &&
      data.schedule_value &&
      data.targetJid
    ) {
      const registeredGroups = deps.registeredGroups();
      const targetJid = data.targetJid as string;
      const targetGroupEntry = registeredGroups[targetJid];

      if (!targetGroupEntry) {
        logger.warn(
          { targetJid },
          'Cannot schedule task: target group not registered',
        );
        return;
      }

      const targetFolder = targetGroupEntry.folder;

      if (!canScheduleTask({ sourceGroup, isMain }, targetFolder)) {
        logger.warn(
          { sourceGroup, targetFolder },
          'Unauthorized schedule_task attempt blocked',
        );
        return;
      }

      const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

      let nextRun: string | null = null;
      if (scheduleType === 'cron') {
        try {
          const interval = CronExpressionParser.parse(data.schedule_value, {
            tz: TIMEZONE,
          });
          nextRun = interval.next().toISOString();
        } catch {
          logger.warn(
            { scheduleValue: data.schedule_value },
            'Invalid cron expression',
          );
          return;
        }
      } else if (scheduleType === 'interval') {
        const ms = parseInt(data.schedule_value, 10);
        if (isNaN(ms) || ms <= 0) {
          logger.warn(
            { scheduleValue: data.schedule_value },
            'Invalid interval',
          );
          return;
        }
        nextRun = new Date(Date.now() + ms).toISOString();
      } else if (scheduleType === 'once') {
        const scheduled = new Date(data.schedule_value);
        if (isNaN(scheduled.getTime())) {
          logger.warn(
            { scheduleValue: data.schedule_value },
            'Invalid timestamp',
          );
          return;
        }
        nextRun = scheduled.toISOString();
      }

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contextMode =
        data.context_mode === 'group' || data.context_mode === 'isolated'
          ? data.context_mode
          : 'isolated';
      createTask({
        id: taskId,
        group_folder: targetFolder,
        chat_jid: targetJid,
        prompt: data.prompt,
        schedule_type: scheduleType,
        schedule_value: data.schedule_value,
        context_mode: contextMode,
        next_run: nextRun,
        status: 'active',
        created_at: new Date().toISOString(),
      });
      logger.info(
        { taskId, sourceGroup, targetFolder, contextMode },
        'Task created via IPC',
      );
    }
  }
}
