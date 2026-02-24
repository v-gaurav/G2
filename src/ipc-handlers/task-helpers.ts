import { AuthorizationPolicy } from '../authorization.js';
import { getTaskById } from '../db.js';

import { IpcHandlerError } from './base-handler.js';

/**
 * Look up a task by ID and verify the caller is authorized to manage it.
 * Throws IpcHandlerError if the task doesn't exist or authorization fails.
 */
export function getAuthorizedTask(
  taskId: string,
  sourceGroup: string,
  isMain: boolean,
) {
  const task = getTaskById(taskId);
  if (!task) {
    throw new IpcHandlerError('Task not found', { taskId });
  }
  const auth = new AuthorizationPolicy({ sourceGroup, isMain });
  if (!auth.canManageTask(task.group_folder)) {
    throw new IpcHandlerError('Unauthorized task management attempt', {
      taskId,
      sourceGroup,
    });
  }
  return task;
}
