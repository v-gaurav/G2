import { AuthorizationPolicy } from '../../groups/Authorization.js';
import { logger } from '../../infrastructure/Logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from '../IpcDispatcher.js';

// ── RegisterGroupHandler ─────────────────────────────────────────────

interface RegisterGroupPayload {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  channel?: string;
  containerConfig?: import('../../groups/types.js').ContainerConfig;
  requiresTrigger?: boolean;
}

export class RegisterGroupHandler extends BaseIpcHandler<RegisterGroupPayload> {
  readonly command = 'register_group';

  validate(data: Record<string, any>): RegisterGroupPayload {
    if (!data.jid || !data.name || !data.folder || !data.trigger) {
      throw new IpcHandlerError('Missing required fields', {
        command: this.command,
        hasJid: !!data.jid,
        hasName: !!data.name,
        hasFolder: !!data.folder,
        hasTrigger: !!data.trigger,
      });
    }
    return {
      jid: data.jid as string,
      name: data.name as string,
      folder: data.folder as string,
      trigger: data.trigger as string,
      channel: data.channel as string | undefined,
      containerConfig: data.containerConfig,
      requiresTrigger: data.requiresTrigger as boolean | undefined,
    };
  }

  async execute(payload: RegisterGroupPayload, context: HandlerContext): Promise<void> {
    const auth = new AuthorizationPolicy({ sourceGroup: context.sourceGroup, isMain: context.isMain });
    if (!auth.canRegisterGroup()) {
      throw new IpcHandlerError('Unauthorized register_group attempt', {
        sourceGroup: context.sourceGroup,
      });
    }

    context.deps.registerGroup(payload.jid, {
      name: payload.name,
      folder: payload.folder,
      trigger: payload.trigger,
      added_at: new Date().toISOString(),
      channel: payload.channel || 'whatsapp',
      containerConfig: payload.containerConfig,
      requiresTrigger: payload.requiresTrigger,
    });

    logger.info({ sourceGroup: context.sourceGroup, jid: payload.jid, folder: payload.folder }, 'Group registered via IPC');
  }
}

// ── RefreshGroupsHandler ─────────────────────────────────────────────

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
