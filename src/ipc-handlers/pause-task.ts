import { updateTask } from '../db.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';
import { getAuthorizedTask } from './task-helpers.js';

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
    getAuthorizedTask(payload.taskId, context.sourceGroup, context.isMain);
    updateTask(payload.taskId, { status: 'paused' });
    logger.info(
      { taskId: payload.taskId, sourceGroup: context.sourceGroup },
      'Task paused via IPC',
    );
  }
}
