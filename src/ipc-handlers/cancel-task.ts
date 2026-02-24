import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

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
