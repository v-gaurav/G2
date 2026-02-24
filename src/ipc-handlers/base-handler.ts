import { IpcDeps } from '../ipc.js';

import { IpcCommandHandler } from './types.js';

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
