/**
 * IContainerRuntime — abstraction over container runtimes (Docker, Apple Container, etc.)
 * Consumers depend on this interface; implementations live in this same file.
 *
 * DockerRuntime — Docker implementation of IContainerRuntime.
 */
import { execSync } from 'child_process';

import { logger } from '../infrastructure/Logger.js';

export interface IContainerRuntime {
  /** The container runtime binary name (e.g. 'docker'). */
  readonly bin: string;

  /** Returns CLI args for a readonly bind mount. */
  readonlyMountArgs(hostPath: string, containerPath: string): string[];

  /** Returns CLI args for a read-write bind mount. */
  readwriteMountArgs(hostPath: string, containerPath: string): string[];

  /** Returns the shell command to stop a container by name. */
  stopContainer(name: string): string;

  /** Ensure the container runtime is running, starting it if needed. */
  ensureRunning(): void;

  /** Kill orphaned G2 containers from previous runs. */
  cleanupOrphans(): void;
}

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
