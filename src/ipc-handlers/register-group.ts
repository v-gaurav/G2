import { canRegisterGroup } from '../authorization.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class RegisterGroupHandler implements IpcCommandHandler {
  readonly type = 'register_group';

  async handle(data: Record<string, any>, sourceGroup: string, isMain: boolean, deps: IpcDeps): Promise<void> {
    if (!canRegisterGroup({ sourceGroup, isMain })) {
      logger.warn(
        { sourceGroup },
        'Unauthorized register_group attempt blocked',
      );
      return;
    }
    if (data.jid && data.name && data.folder && data.trigger) {
      deps.registerGroup(data.jid, {
        name: data.name,
        folder: data.folder,
        trigger: data.trigger,
        added_at: new Date().toISOString(),
        containerConfig: data.containerConfig,
        requiresTrigger: data.requiresTrigger,
      });
    } else {
      logger.warn(
        { data },
        'Invalid register_group request - missing required fields',
      );
    }
  }
}
