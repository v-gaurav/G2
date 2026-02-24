import {
  deleteConversationArchive,
  getConversationArchiveById,
  insertConversationArchive,
} from '../db.js';
import { logger } from '../logger.js';

import { readAndFormatTranscript } from './archive-utils.js';
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

    const target = getConversationArchiveById(Number(payload.sessionHistoryId));
    if (!target) {
      throw new IpcHandlerError('Conversation archive entry not found', {
        sourceGroup,
        id: payload.sessionHistoryId,
      });
    }

    // Archive current session if save name provided
    if (payload.saveName) {
      const currentSessionId = deps.sessionManager.get(sourceGroup);
      if (currentSessionId) {
        const content = readAndFormatTranscript(sourceGroup, currentSessionId, payload.saveName);
        insertConversationArchive(sourceGroup, currentSessionId, payload.saveName, content || '', new Date().toISOString());
      }
    }

    // Switch to the target session
    deps.sessionManager.set(sourceGroup, target.session_id);

    // Remove from archives — it's now active, not archived
    deleteConversationArchive(target.id);

    const resumeGroups = deps.registeredGroups();
    for (const [jid, g] of Object.entries(resumeGroups)) {
      if (g.folder === sourceGroup) {
        deps.closeStdin(jid);
        break;
      }
    }

    logger.info({ sourceGroup, restoredSessionId: target.session_id, name: payload.saveName }, 'Session resumed via IPC');
  }
}
