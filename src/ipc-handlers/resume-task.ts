import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

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
