import { canManageTask } from '../authorization.js';
import { getTaskById, updateTask } from '../db.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class PauseTaskHandler implements IpcCommandHandler {
  readonly type = 'pause_task';

  async handle(data: Record<string, any>, sourceGroup: string, isMain: boolean, _deps: IpcDeps): Promise<void> {
    if (data.taskId) {
      const task = getTaskById(data.taskId);
      if (task && canManageTask({ sourceGroup, isMain }, task.group_folder)) {
        updateTask(data.taskId, { status: 'paused' });
        logger.info(
          { taskId: data.taskId, sourceGroup },
          'Task paused via IPC',
        );
      } else {
        logger.warn(
          { taskId: data.taskId, sourceGroup },
          'Unauthorized task pause attempt',
        );
      }
    }
  }
}
