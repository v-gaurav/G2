import { deleteTask } from '../db.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';
import { getAuthorizedTask } from './task-helpers.js';

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
    getAuthorizedTask(payload.taskId, context.sourceGroup, context.isMain);
    deleteTask(payload.taskId);
    logger.info(
      { taskId: payload.taskId, sourceGroup: context.sourceGroup },
      'Task cancelled via IPC',
    );
  }
}
