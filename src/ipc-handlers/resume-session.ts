import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

interface ResumeSessionPayload {
  sessionHistoryId: string;
  saveName?: string;
}

export class ResumeSessionHandler extends BaseIpcHandler<ResumeSessionPayload> {
  readonly command = 'resume_session';

  validate(data: Record<string, any>): ResumeSessionPayload {
    if (!data.sessionHistoryId) {
      throw new IpcHandlerError('Missing sessionHistoryId', { command: this.command });
    }
    return {
      sessionHistoryId: data.sessionHistoryId as string,
      saveName: data.saveName as string | undefined,
    };
  }

  async execute(payload: ResumeSessionPayload, context: HandlerContext): Promise<void> {
    const { sourceGroup, deps } = context;

    let restoredSessionId: string;
    try {
      restoredSessionId = deps.sessionManager.resume(sourceGroup, Number(payload.sessionHistoryId), payload.saveName);
    } catch {
      throw new IpcHandlerError('Conversation archive entry not found', {
        sourceGroup,
        id: payload.sessionHistoryId,
      });
    }

    const resumeGroups = deps.registeredGroups();
    for (const [jid, g] of Object.entries(resumeGroups)) {
      if (g.folder === sourceGroup) {
        deps.closeStdin(jid);
        break;
      }
    }

    logger.info({ sourceGroup, restoredSessionId, name: payload.saveName }, 'Session resumed via IPC');
  }
}
