import { IpcDeps } from '../ipc.js';

export interface IpcCommandHandler {
  readonly command: string;
  handle(data: Record<string, any>, sourceGroup: string, isMain: boolean, deps: IpcDeps): Promise<void>;
}
