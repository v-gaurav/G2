import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class ResumeSessionHandler implements IpcCommandHandler {
  readonly type = 'resume_session';

  async handle(data: Record<string, any>, sourceGroup: string, _isMain: boolean, deps: IpcDeps): Promise<void> {
    if (!data.sessionHistoryId) {
      logger.warn({ sourceGroup }, 'resume_session missing sessionHistoryId');
      return;
    }

    deps.sessionManager.archive(sourceGroup, data.saveName);

    const restored = deps.sessionManager.restore(sourceGroup, data.sessionHistoryId);
    if (!restored) {
      logger.warn({ sourceGroup, id: data.sessionHistoryId }, 'Session history entry not found');
      return;
    }

    const resumeGroups = deps.registeredGroups();
    for (const [jid, g] of Object.entries(resumeGroups)) {
      if (g.folder === sourceGroup) {
        deps.closeStdin(jid);
        break;
      }
    }

    logger.info({ sourceGroup, restoredSessionId: restored.sessionId, name: data.saveName }, 'Session resumed via IPC');
  }
}
