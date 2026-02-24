import { insertConversationArchive } from '../db.js';
import { logger } from '../logger.js';

import { readAndFormatTranscript } from './archive-utils.js';
import { BaseIpcHandler, HandlerContext } from './base-handler.js';

interface ClearSessionPayload {
  name?: string;
}

export class ClearSessionHandler extends BaseIpcHandler<ClearSessionPayload> {
  readonly command = 'clear_session';

  validate(data: Record<string, any>): ClearSessionPayload {
    return { name: data.name as string | undefined };
  }

  async execute(payload: ClearSessionPayload, context: HandlerContext): Promise<void> {
    const { sourceGroup, deps } = context;
    const sessionId = deps.sessionManager.get(sourceGroup);

    if (sessionId && payload.name) {
      const content = readAndFormatTranscript(sourceGroup, sessionId, payload.name);
      insertConversationArchive(sourceGroup, sessionId, payload.name, content || '', new Date().toISOString());
    }

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
