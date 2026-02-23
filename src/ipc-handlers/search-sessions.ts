import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { searchConversationArchives } from '../db.js';
import { IpcDeps } from '../ipc.js';
import { logger } from '../logger.js';
import { IpcCommandHandler } from './types.js';

export class SearchSessionsHandler implements IpcCommandHandler {
  readonly type = 'search_sessions';

  async handle(data: Record<string, any>, sourceGroup: string, _isMain: boolean, _deps: IpcDeps): Promise<void> {
    const results = searchConversationArchives(sourceGroup, data.query || '');

    const responsesDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'responses');
    fs.mkdirSync(responsesDir, { recursive: true });

    const responsePath = path.join(responsesDir, `${data.requestId}.json`);
    const tmpPath = responsePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(results));
    fs.renameSync(tmpPath, responsePath);

    logger.info({ sourceGroup, query: data.query, resultCount: results.length }, 'Search sessions completed');
  }
}
