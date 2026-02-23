import { CONTAINER_TIMEOUT, IDLE_TIMEOUT } from './config.js';
import type { RegisteredGroup } from './types.js';

export class TimeoutConfig {
  readonly containerTimeout: number;
  readonly idleTimeout: number;

  constructor(containerTimeout: number = CONTAINER_TIMEOUT, idleTimeout: number = IDLE_TIMEOUT) {
    this.containerTimeout = containerTimeout;
    this.idleTimeout = idleTimeout;
  }

  /** Get the hard timeout (ensures idle timeout can trigger before hard kill) */
  getHardTimeout(): number {
    return Math.max(this.containerTimeout, this.idleTimeout + 30_000);
  }

  /** Create a TimeoutConfig for a specific group, using group's custom timeout if set */
  forGroup(group: RegisteredGroup): TimeoutConfig {
    const groupTimeout = group.containerConfig?.timeout || this.containerTimeout;
    return new TimeoutConfig(groupTimeout, this.idleTimeout);
  }
}
