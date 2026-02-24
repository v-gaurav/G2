import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';

import { IpcHandlerError } from './base-handler.js';
import { IpcCommandHandler } from './types.js';

export class IpcCommandDispatcher {
  private handlers: Map<string, IpcCommandHandler>;

  constructor(handlers: IpcCommandHandler[]) {
    this.handlers = new Map(handlers.map(h => [h.command, h]));
  }

  async dispatch(data: Record<string, any>, sourceGroup: string, isMain: boolean, deps: IpcDeps): Promise<void> {
    const handler = this.handlers.get(data.type);
    if (!handler) {
      logger.warn({ type: data.type }, 'Unknown IPC task type');
      return;
    }
    try {
      await handler.handle(data, sourceGroup, isMain, deps);
    } catch (err) {
      if (err instanceof IpcHandlerError) {
        logger.warn({ command: data.type, sourceGroup, ...err.details }, err.message);
      } else {
        throw err;
      }
    }
  }
}
