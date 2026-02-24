import type { IpcDeps } from './IpcWatcher.js';
import { logger } from '../infrastructure/Logger.js';

import type { IpcCommandHandler } from './types.js';

export interface HandlerContext {
  sourceGroup: string;
  isMain: boolean;
  deps: IpcDeps;
}

export class IpcHandlerError extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IpcHandlerError';
  }
}

export abstract class BaseIpcHandler<T = Record<string, any>>
  implements IpcCommandHandler
{
  abstract readonly command: string;

  abstract validate(data: Record<string, any>): T;
  abstract execute(payload: T, context: HandlerContext): Promise<void>;

  async handle(
    data: Record<string, any>,
    sourceGroup: string,
    isMain: boolean,
    deps: IpcDeps,
  ): Promise<void> {
    const context: HandlerContext = { sourceGroup, isMain, deps };
    const validated = this.validate(data);
    return this.execute(validated, context);
  }
}

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
