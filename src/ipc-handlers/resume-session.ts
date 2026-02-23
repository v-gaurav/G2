import {
  deleteConversationArchive,
  getConversationArchiveById,
  insertConversationArchive,
} from '../db.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { readAndFormatTranscript } from './archive-utils.js';
import { IpcCommandHandler } from './types.js';

export class ResumeSessionHandler implements IpcCommandHandler {
  readonly type = 'resume_session';

  async handle(data: Record<string, any>, sourceGroup: string, _isMain: boolean, deps: IpcDeps): Promise<void> {
    if (!data.sessionHistoryId) {
      logger.warn({ sourceGroup }, 'resume_session missing sessionHistoryId');
      return;
    }

    const target = getConversationArchiveById(data.sessionHistoryId);
    if (!target) {
      logger.warn({ sourceGroup, id: data.sessionHistoryId }, 'Conversation archive entry not found');
      return;
    }

    // Archive current session if save name provided
    if (data.saveName) {
      const currentSessionId = deps.sessionManager.get(sourceGroup);
      if (currentSessionId) {
        const content = readAndFormatTranscript(sourceGroup, currentSessionId, data.saveName);
        insertConversationArchive(sourceGroup, currentSessionId, data.saveName, content || '', new Date().toISOString());
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

    logger.info({ sourceGroup, restoredSessionId: target.session_id, name: data.saveName }, 'Session resumed via IPC');
  }
}
