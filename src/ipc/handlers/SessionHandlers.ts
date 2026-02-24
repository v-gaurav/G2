import fs from 'fs';
import path from 'path';

import { GroupPaths } from '../../groups/GroupPaths.js';
import { logger } from '../../infrastructure/Logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from '../IpcDispatcher.js';

// ── ClearSessionHandler ──────────────────────────────────────────────

interface ClearSessionPayload {
  name?: string;
}

export class ClearSessionHandler extends BaseIpcHandler<ClearSessionPayload> {
  readonly command = 'clear_session';

  validate(data: Record<string, any>): ClearSessionPayload {
    return { name: data.name as string | undefined };
  }

  async execute(payload: ClearSessionPayload, context: HandlerContext): Promise<void> {
    const { sourceGroup, deps } = context;

    deps.sessionManager.clear(sourceGroup, payload.name);

    const clearGroups = deps.registeredGroups();
    for (const [jid, g] of Object.entries(clearGroups)) {
      if (g.folder === sourceGroup) {
        deps.closeStdin(jid);
        break;
      }
    }

    logger.info({ sourceGroup }, 'Session cleared via IPC');
  }
}

// ── ResumeSessionHandler ─────────────────────────────────────────────

interface ResumeSessionPayload {
  sessionHistoryId: string;
  saveName?: string;
}

export class ResumeSessionHandler extends BaseIpcHandler<ResumeSessionPayload> {
  readonly command = 'resume_session';

  validate(data: Record<string, any>): ResumeSessionPayload {
    if (!data.sessionHistoryId) {
      throw new IpcHandlerError('Missing sessionHistoryId', { command: this.command });
    }
    return {
      sessionHistoryId: data.sessionHistoryId as string,
      saveName: data.saveName as string | undefined,
    };
  }

  async execute(payload: ResumeSessionPayload, context: HandlerContext): Promise<void> {
    const { sourceGroup, deps } = context;

    let restoredSessionId: string;
    try {
      restoredSessionId = deps.sessionManager.resume(sourceGroup, Number(payload.sessionHistoryId), payload.saveName);
    } catch {
      throw new IpcHandlerError('Conversation archive entry not found', {
        sourceGroup,
        id: payload.sessionHistoryId,
      });
    }

    const resumeGroups = deps.registeredGroups();
    for (const [jid, g] of Object.entries(resumeGroups)) {
      if (g.folder === sourceGroup) {
        deps.closeStdin(jid);
        break;
      }
    }

    logger.info({ sourceGroup, restoredSessionId, name: payload.saveName }, 'Session resumed via IPC');
  }
}

// ── SearchSessionsHandler ────────────────────────────────────────────

interface SearchSessionsPayload {
  query: string;
  requestId: string;
}

export class SearchSessionsHandler extends BaseIpcHandler<SearchSessionsPayload> {
  readonly command = 'search_sessions';

  validate(data: Record<string, any>): SearchSessionsPayload {
    if (!data.requestId) {
      throw new IpcHandlerError('Missing requestId', { command: this.command });
    }
    return {
      query: (data.query as string) || '',
      requestId: data.requestId as string,
    };
  }

  async execute(payload: SearchSessionsPayload, context: HandlerContext): Promise<void> {
    const results = context.deps.sessionManager.search(context.sourceGroup, payload.query);

    const responsesDir = GroupPaths.ipcResponsesDir(context.sourceGroup);
    fs.mkdirSync(responsesDir, { recursive: true });

    const responsePath = path.join(responsesDir, `${payload.requestId}.json`);
    const tmpPath = responsePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(results));
    fs.renameSync(tmpPath, responsePath);

    logger.info({ sourceGroup: context.sourceGroup, query: payload.query, resultCount: results.length }, 'Search sessions completed');
  }
}

// ── ArchiveSessionHandler ────────────────────────────────────────────

interface ArchiveSessionPayload {
  sessionId: string;
  name: string;
  content: string;
  timestamp: string;
}

export class ArchiveSessionHandler extends BaseIpcHandler<ArchiveSessionPayload> {
  readonly command = 'archive_session';

  validate(data: Record<string, any>): ArchiveSessionPayload {
    if (!data.sessionId || !data.name) {
      throw new IpcHandlerError('Missing sessionId or name', { command: this.command });
    }
    return {
      sessionId: data.sessionId as string,
      name: data.name as string,
      content: (data.content as string) || '',
      timestamp: (data.timestamp as string) || new Date().toISOString(),
    };
  }

  async execute(payload: ArchiveSessionPayload, context: HandlerContext): Promise<void> {
    context.deps.sessionManager.archive(
      context.sourceGroup,
      payload.sessionId,
      payload.name,
      payload.content,
    );

    logger.info({ sourceGroup: context.sourceGroup, sessionId: payload.sessionId, name: payload.name }, 'Session archived via IPC');
  }
}
