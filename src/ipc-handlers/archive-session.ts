import { insertConversationArchive } from '../db.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class ArchiveSessionHandler implements IpcCommandHandler {
  readonly type = 'archive_session';

  async handle(data: Record<string, any>, sourceGroup: string, _isMain: boolean, _deps: IpcDeps): Promise<void> {
    if (!data.sessionId || !data.name) {
      logger.warn({ sourceGroup }, 'archive_session missing sessionId or name');
      return;
    }

    insertConversationArchive(
      sourceGroup,
      data.sessionId,
      data.name,
      data.content || '',
      data.timestamp || new Date().toISOString(),
    );

    logger.info({ sourceGroup, sessionId: data.sessionId, name: data.name }, 'Session archived via IPC');
  }
}
