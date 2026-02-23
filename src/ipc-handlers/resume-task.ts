import { canManageTask } from '../authorization.js';
import { getTaskById, updateTask } from '../db.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class ResumeTaskHandler implements IpcCommandHandler {
  readonly type = 'resume_task';

  async handle(data: Record<string, any>, sourceGroup: string, isMain: boolean, _deps: IpcDeps): Promise<void> {
    if (data.taskId) {
      const task = getTaskById(data.taskId);
      if (task && canManageTask({ sourceGroup, isMain }, task.group_folder)) {
        updateTask(data.taskId, { status: 'active' });
        logger.info(
          { taskId: data.taskId, sourceGroup },
          'Task resumed via IPC',
        );
      } else {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          'Unauthorized task resume attempt',
        );
      }
    }
  }
}
