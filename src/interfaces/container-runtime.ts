/**
 * IContainerRuntime — abstraction over container runtimes (Docker, Apple Container, etc.)
 * Consumers depend on this interface; implementations live in separate files.
 */

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
