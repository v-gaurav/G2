import { insertConversationArchive } from '../db.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

interface ArchiveSessionPayload {
  sessionId: string;
  name: string;
  content: string;
  timestamp: string;
}

export class ArchiveSessionHandler extends BaseIpcHandler<ArchiveSessionPayload> {
  readonly command = 'archive_session';

  validate(data: Record<string, any>): ArchiveSessionPayload {
    if (!data.sessionId || !data.name) {
      throw new IpcHandlerError('Missing sessionId or name', { command: this.command });
    }
    return {
      sessionId: data.sessionId as string,
      name: data.name as string,
      content: (data.content as string) || '',
      timestamp: (data.timestamp as string) || new Date().toISOString(),
    };
  }

  async execute(payload: ArchiveSessionPayload, context: HandlerContext): Promise<void> {
    insertConversationArchive(
      context.sourceGroup,
      payload.sessionId,
      payload.name,
      payload.content,
      payload.timestamp,
    );

    logger.info({ sourceGroup: context.sourceGroup, sessionId: payload.sessionId, name: payload.name }, 'Session archived via IPC');
  }
}
