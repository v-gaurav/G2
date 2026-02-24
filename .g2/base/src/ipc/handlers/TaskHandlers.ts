import { AuthorizationPolicy } from '../../groups/Authorization.js';
import { logger } from '../../infrastructure/Logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from '../IpcDispatcher.js';

// ── ScheduleTaskHandler ──────────────────────────────────────────────

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

    try {
      const taskId = context.deps.taskManager.create({
        groupFolder: targetFolder,
        chatJid: payload.targetJid,
        prompt: payload.prompt,
        scheduleType: payload.schedule_type,
        scheduleValue: payload.schedule_value,
        contextMode: payload.context_mode,
      });
      logger.info(
        { taskId, sourceGroup: context.sourceGroup, targetFolder, contextMode: payload.context_mode },
        'Task created via IPC',
      );
    } catch (err) {
      throw new IpcHandlerError(err instanceof Error ? err.message : String(err), {
        scheduleType: payload.schedule_type,
        scheduleValue: payload.schedule_value,
      });
    }
  }
}

// ── PauseTaskHandler ─────────────────────────────────────────────────

interface PauseTaskPayload {
  taskId: string;
}

export class PauseTaskHandler extends BaseIpcHandler<PauseTaskPayload> {
  readonly command = 'pause_task';

  validate(data: Record<string, any>): PauseTaskPayload {
    if (!data.taskId) {
      throw new IpcHandlerError('Missing taskId', { command: this.command });
    }
    return { taskId: data.taskId as string };
  }

  async execute(payload: PauseTaskPayload, context: HandlerContext): Promise<void> {
    try {
      context.deps.taskManager.getAuthorized(payload.taskId, context.sourceGroup, context.isMain);
    } catch (err) {
      throw new IpcHandlerError(err instanceof Error ? err.message : String(err), {
        taskId: payload.taskId,
        sourceGroup: context.sourceGroup,
      });
    }
    context.deps.taskManager.pause(payload.taskId);
    logger.info(
      { taskId: payload.taskId, sourceGroup: context.sourceGroup },
      'Task paused via IPC',
    );
  }
}

// ── ResumeTaskHandler ────────────────────────────────────────────────

interface ResumeTaskPayload {
  taskId: string;
}

export class ResumeTaskHandler extends BaseIpcHandler<ResumeTaskPayload> {
  readonly command = 'resume_task';

  validate(data: Record<string, any>): ResumeTaskPayload {
    if (!data.taskId) {
      throw new IpcHandlerError('Missing taskId', { command: this.command });
    }
    return { taskId: data.taskId as string };
  }

  async execute(payload: ResumeTaskPayload, context: HandlerContext): Promise<void> {
    try {
      context.deps.taskManager.getAuthorized(payload.taskId, context.sourceGroup, context.isMain);
    } catch (err) {
      throw new IpcHandlerError(err instanceof Error ? err.message : String(err), {
        taskId: payload.taskId,
        sourceGroup: context.sourceGroup,
      });
    }
    context.deps.taskManager.resume(payload.taskId);
    logger.info(
      { taskId: payload.taskId, sourceGroup: context.sourceGroup },
      'Task resumed via IPC',
    );
  }
}

// ── CancelTaskHandler ────────────────────────────────────────────────

interface CancelTaskPayload {
  taskId: string;
}

export class CancelTaskHandler extends BaseIpcHandler<CancelTaskPayload> {
  readonly command = 'cancel_task';

  validate(data: Record<string, any>): CancelTaskPayload {
    if (!data.taskId) {
      throw new IpcHandlerError('Missing taskId', { command: this.command });
    }
    return { taskId: data.taskId as string };
  }

  async execute(payload: CancelTaskPayload, context: HandlerContext): Promise<void> {
    try {
      context.deps.taskManager.getAuthorized(payload.taskId, context.sourceGroup, context.isMain);
    } catch (err) {
      throw new IpcHandlerError(err instanceof Error ? err.message : String(err), {
        taskId: payload.taskId,
        sourceGroup: context.sourceGroup,
      });
    }
    context.deps.taskManager.cancel(payload.taskId);
    logger.info(
      { taskId: payload.taskId, sourceGroup: context.sourceGroup },
      'Task cancelled via IPC',
    );
  }
}
