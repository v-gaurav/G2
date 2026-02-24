import { AuthorizationPolicy } from '../authorization.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

interface RegisterGroupPayload {
  jid: string;
  name: string;
  folder: string;
  trigger: string;
  containerConfig?: import('../types.js').ContainerConfig;
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
      containerConfig: payload.containerConfig,
      requiresTrigger: payload.requiresTrigger,
    });

    logger.info({ sourceGroup: context.sourceGroup, jid: payload.jid, folder: payload.folder }, 'Group registered via IPC');
  }
}
