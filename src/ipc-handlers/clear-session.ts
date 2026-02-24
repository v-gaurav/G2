import { logger } from '../logger.js';

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

    deps.sessionManager.clear(sourceGroup, payload.name);

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
