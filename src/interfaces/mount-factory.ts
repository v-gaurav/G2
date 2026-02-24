/**
 * IMountFactory — abstraction for building container volume mounts.
 * Decouples mount logic from container-runner so it can be tested and swapped.
 */
import type { RegisteredGroup } from '../types.js';

export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export interface IMountFactory {
  /** Create directories, write settings, sync skills — all side effects. */
  prepare(group: RegisteredGroup, isMain: boolean): void;

  /** Build the full list of volume mounts for a container run. Pure — assumes dirs exist. */
  buildMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[];
}
