import { canManageTask } from '../authorization.js';
import { deleteTask, getTaskById } from '../db.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class CancelTaskHandler implements IpcCommandHandler {
  readonly type = 'cancel_task';

  async handle(data: Record<string, any>, sourceGroup: string, isMain: boolean, _deps: IpcDeps): Promise<void> {
    if (data.taskId) {
      const task = getTaskById(data.taskId);
      if (task && canManageTask({ sourceGroup, isMain }, task.group_folder)) {
        deleteTask(data.taskId);
        logger.info(
          { taskId: data.taskId, sourceGroup },
          'Task cancelled via IPC',
        );
      } else {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          'Unauthorized task cancel attempt',
        );
      }
    }
  }
}
