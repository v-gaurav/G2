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
  /** Build the full list of volume mounts for a container run. */
  buildMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[];
}
