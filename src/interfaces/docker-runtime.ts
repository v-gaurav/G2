/**
 * DockerRuntime — Docker implementation of IContainerRuntime.
 */
import { execSync } from 'child_process';

import { logger } from '../logger.js';
import type { IContainerRuntime } from './container-runtime.js';

const CONTAINER_RUNTIME_BIN = 'docker';

export class DockerRuntime implements IContainerRuntime {
  get bin(): string {
    return CONTAINER_RUNTIME_BIN;
  }

  readonlyMountArgs(hostPath: string, containerPath: string): string[] {
    return ['-v', `${hostPath}:${containerPath}:ro`];
  }

  readwriteMountArgs(hostPath: string, containerPath: string): string[] {
    return ['-v', `${hostPath}:${containerPath}`];
  }

  stopContainer(name: string): string {
    return `${CONTAINER_RUNTIME_BIN} stop ${name}`;
  }

  ensureRunning(): void {
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} info`, { stdio: 'pipe', timeout: 10000 });
      logger.debug('Container runtime already running');
    } catch (err) {
      logger.error({ err }, 'Failed to reach container runtime');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Container runtime failed to start                      ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Agents cannot run without a container runtime. To fix:        ║',
      );
      console.error(
        '║  1. Ensure Docker is installed and running                     ║',
      );
      console.error(
        '║  2. Run: docker info                                           ║',
      );
      console.error(
        '║  3. Restart G2                                           ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Container runtime is required but failed to start');
    }
  }

  cleanupOrphans(): void {
    try {
      const output = execSync(
        `${CONTAINER_RUNTIME_BIN} ps --filter name=g2- --format '{{.Names}}'`,
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
      );
      const orphans = output.trim().split('\n').filter(Boolean);
      for (const name of orphans) {
        try {
          execSync(this.stopContainer(name), { stdio: 'pipe' });
        } catch { /* already stopped */ }
      }
      if (orphans.length > 0) {
        logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to clean up orphaned containers');
    }
  }
}
