import { updateTask } from '../db.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';
import { getAuthorizedTask } from './task-helpers.js';

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
    getAuthorizedTask(payload.taskId, context.sourceGroup, context.isMain);
    updateTask(payload.taskId, { status: 'active' });
    logger.info(
      { taskId: payload.taskId, sourceGroup: context.sourceGroup },
      'Task resumed via IPC',
    );
  }
}
