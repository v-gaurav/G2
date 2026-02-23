import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class ClearSessionHandler implements IpcCommandHandler {
  readonly type = 'clear_session';

  async handle(data: Record<string, any>, sourceGroup: string, _isMain: boolean, deps: IpcDeps): Promise<void> {
    deps.sessionManager.archive(sourceGroup, data.name);

    deps.sessionManager.delete(sourceGroup);

    const clearGroups = deps.registeredGroups();
    for (const [jid, g] of Object.entries(clearGroups)) {
      if (g.folder === sourceGroup) {
        deps.closeStdin(jid);
        break;
      }
    }

    logger.info({ sourceGroup }, 'Session cleared via IPC');
  }
}
