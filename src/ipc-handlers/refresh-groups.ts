import { canRefreshGroups } from '../authorization.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class RefreshGroupsHandler implements IpcCommandHandler {
  readonly type = 'refresh_groups';

  async handle(_data: Record<string, any>, sourceGroup: string, isMain: boolean, deps: IpcDeps): Promise<void> {
    if (canRefreshGroups({ sourceGroup, isMain })) {
      logger.info(
        { sourceGroup },
        'Group metadata refresh requested via IPC',
      );
      await deps.syncGroupMetadata(true);
      const registeredGroups = deps.registeredGroups();
      const availableGroups = deps.getAvailableGroups();
      deps.writeGroupsSnapshot(
        sourceGroup,
        true,
        availableGroups,
        new Set(Object.keys(registeredGroups)),
      );
    } else {
      logger.warn(
        { sourceGroup },
        'Unauthorized refresh_groups attempt blocked',
      );
    }
  }
}
