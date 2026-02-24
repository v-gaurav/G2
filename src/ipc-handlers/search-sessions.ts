import fs from 'fs';
import path from 'path';

import { GroupPaths } from '../group-paths.js';
import { logger } from '../logger.js';

import { BaseIpcHandler, HandlerContext, IpcHandlerError } from './base-handler.js';

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
