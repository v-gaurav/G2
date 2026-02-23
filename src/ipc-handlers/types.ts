import { IpcDeps } from '../ipc.js';

export interface IpcCommandHandler {
  readonly type: string;
  handle(data: Record<string, any>, sourceGroup: string, isMain: boolean, deps: IpcDeps): Promise<void>;
}
