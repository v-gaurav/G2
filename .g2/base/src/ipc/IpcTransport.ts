import fs from 'fs';
import path from 'path';

import { GroupPaths } from '../groups/GroupPaths.js';
import { logger } from '../infrastructure/Logger.js';

/**
 * Handles file-based IPC communication with containers.
 * Writes message files and close sentinels to the container's input directory.
 */
export class IpcTransport {
  /**
   * Write a message file for the container to read.
   * Uses atomic write (tmp + rename) to prevent partial reads.
   */
  sendMessage(groupFolder: string, text: string): boolean {
    const inputDir = GroupPaths.ipcInputDir(groupFolder);
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch (err) {
      logger.warn({ err, groupFolder }, 'Failed to send follow-up via IPC');
      return false;
    }
  }

  /**
   * Write a close sentinel file to signal the container to wind down.
   */
  closeStdin(groupFolder: string): void {
    const inputDir = GroupPaths.ipcInputDir(groupFolder);
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch (err) {
      logger.warn({ err, groupFolder }, 'Failed to write close sentinel');
    }
  }
}
