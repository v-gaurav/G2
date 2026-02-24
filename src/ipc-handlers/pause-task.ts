import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

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
