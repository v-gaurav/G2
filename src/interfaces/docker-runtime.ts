/**
 * DockerRuntime — Docker implementation of IContainerRuntime.
 * Wraps the existing functions from container-runtime.ts.
 */
import {
  CONTAINER_RUNTIME_BIN,
  readonlyMountArgs,
  stopContainer,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
} from '../container-runtime.js';
import type { IContainerRuntime } from './container-runtime.js';

export class DockerRuntime implements IContainerRuntime {
  get bin(): string {
    return CONTAINER_RUNTIME_BIN;
  }

  readonlyMountArgs(hostPath: string, containerPath: string): string[] {
    return readonlyMountArgs(hostPath, containerPath);
  }

  readwriteMountArgs(hostPath: string, containerPath: string): string[] {
    return ['-v', `${hostPath}:${containerPath}`];
  }

  stopContainer(name: string): string {
    return stopContainer(name);
  }

  ensureRunning(): void {
    ensureContainerRuntimeRunning();
  }

  cleanupOrphans(): void {
    cleanupOrphans();
  }
}
