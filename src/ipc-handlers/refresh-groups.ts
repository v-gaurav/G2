import { AuthorizationPolicy } from '../authorization.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

export class RefreshGroupsHandler extends BaseIpcHandler<Record<string, never>> {
  readonly command = 'refresh_groups';

  validate(_data: Record<string, any>): Record<string, never> {
    return {} as Record<string, never>;
  }

  async execute(_payload: Record<string, never>, context: HandlerContext): Promise<void> {
    const auth = new AuthorizationPolicy({ sourceGroup: context.sourceGroup, isMain: context.isMain });
    if (!auth.canRefreshGroups()) {
      throw new IpcHandlerError('Unauthorized refresh_groups attempt', {
        sourceGroup: context.sourceGroup,
      });
    }

    logger.info(
      { sourceGroup: context.sourceGroup },
      'Group metadata refresh requested via IPC',
    );
    await context.deps.syncGroupMetadata(true);
    const registeredGroups = context.deps.registeredGroups();
    const availableGroups = context.deps.getAvailableGroups();
    context.deps.writeGroupsSnapshot(
      context.sourceGroup,
      true,
      availableGroups,
      new Set(Object.keys(registeredGroups)),
    );
  }
}
